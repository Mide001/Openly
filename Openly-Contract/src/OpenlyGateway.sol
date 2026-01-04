// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IPaymentGateway {
    function recordPayment(
        string calldata merchantId,
        string calldata userId,
        string calldata paymentRef,
        uint256 amount
    ) external;
}

/**
 * @title PaymentForwarder
 * @notice Minimal proxy to forward payments to main gateway
 */
contract PaymentForwarder {
    address public immutable gateway;
    address public immutable usdcToken;

    constructor(address _gateway, address _usdcToken) {
        gateway = _gateway;
        usdcToken = _usdcToken;
    }

    /**
     * @notice Sends all USDC to the gateway contract
     */
    function forward(
        string calldata merchantId,
        string calldata userId,
        string calldata paymentRef,
        uint256 amount
    ) external {
        require(amount > 0, "Amount must be greater than 0");
        IERC20 usdc = IERC20(usdcToken);
        require(
            usdc.balanceOf(address(this)) >= amount,
            "Insufficient balance"
        );

        SafeERC20.safeTransfer(usdc, gateway, amount);
        IPaymentGateway(gateway).recordPayment(
            merchantId,
            userId,
            paymentRef,
            amount
        );
    }
}

/**
 * @title OpenlyGateway
 * @notice Main payment gateway contract for Openly
 */
contract OpenlyGateway is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IERC20 public immutable usdcToken;

    mapping(string => uint256) public merchantBalances;

    uint256 public minWithdrawal = 1 * 10 ** 6; // 1 USDC

    mapping(bytes32 => bool) public processedPayments;

    event PaymentReceived(
        string indexed merchantId,
        string indexed userId,
        string indexed paymentRef,
        uint256 amount,
        address payer,
        uint256 timestamp
    );

    event PaymentForwarderDeployed(
        string indexed merchantId,
        string indexed userId,
        string indexed paymentRef,
        address forwarderAddress,
        uint256 timestamp
    );

    event WithdrawalProcessed(
        string indexed merchantId,
        address indexed recipient,
        uint256 amount,
        uint256 timestamp
    );

    event MinWithdrawalUpdated(uint256 oldMin, uint256 newMin);

    constructor(address _usdcToken, address _admin) {
        require(_usdcToken != address(0), "Invalid USDC address");
        require(_admin != address(0), "Invalid admin address");

        usdcToken = IERC20(_usdcToken);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
    }

    function computeForwarderAddress(
        string calldata merchantId,
        string calldata userId,
        string calldata paymentRef
    ) public view returns (address) {
        bytes32 salt = keccak256(
            abi.encodePacked(merchantId, userId, paymentRef)
        );
        bytes memory bytecode = abi.encodePacked(
            type(PaymentForwarder).creationCode,
            abi.encode(address(this), address(usdcToken))
        );
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(bytecode)
            )
        );

        return address(uint160(uint256(hash)));
    }

    function deployForwarder(
        string calldata merchantId,
        string calldata userId,
        string calldata paymentRef
    ) external whenNotPaused returns (address forwarder) {
        bytes32 salt = keccak256(
            abi.encodePacked(merchantId, userId, paymentRef)
        );

        bytes memory bytecode = abi.encodePacked(
            type(PaymentForwarder).creationCode,
            abi.encode(address(this), address(usdcToken))
        );

        assembly {
            forwarder := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
            if iszero(extcodesize(forwarder)) {
                revert(0, 0)
            }
        }

        emit PaymentForwarderDeployed(
            merchantId,
            userId,
            paymentRef,
            forwarder,
            block.timestamp
        );
    }

    function recordPayment(
        string calldata merchantId,
        string calldata userId,
        string calldata paymentRef,
        uint amount
    ) external whenNotPaused {
        require(amount > 0, "Amount must be greater than 0");

        address expectedForwarder = computeForwarderAddress(
            merchantId,
            userId,
            paymentRef
        );
        require(msg.sender == expectedForwarder, "Unauthorized caller");

        bytes32 paymentId = keccak256(
            abi.encodePacked(
                merchantId,
                userId,
                paymentRef,
                amount,
                block.timestamp
            )
        );
        require(!processedPayments[paymentId], "Payment already processed");

        processedPayments[paymentId] = true;
        merchantBalances[merchantId] += amount;

        emit PaymentReceived(
            merchantId,
            userId,
            paymentRef,
            amount,
            msg.sender,
            block.timestamp
        );
    }

    function withdrawForMerchant(
        string calldata merchantId,
        address recipient,
        uint256 amount
    ) external nonReentrant whenNotPaused onlyRole(OPERATOR_ROLE) {
        require(recipient != address(0), "Invalid recipient");
        require(amount >= minWithdrawal, "Below minimum withdrawal");
        require(merchantBalances[merchantId] >= amount, "Insufficient balance");

        merchantBalances[merchantId] -= amount;

        usdcToken.safeTransfer(recipient, amount);

        emit WithdrawalProcessed(
            merchantId,
            recipient,
            amount,
            block.timestamp
        );
    }

    function batchWithdraw(
        string[] calldata merchantIds,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant whenNotPaused onlyRole(OPERATOR_ROLE) {
        require(
            merchantIds.length == recipients.length &&
                recipients.length == amounts.length,
            "Array length must match"
        );

        for (uint256 i = 0; i < merchantIds.length; i++) {
            string calldata merchantId = merchantIds[i];
            address recipient = recipients[i];
            uint256 amount = amounts[i];

            require(recipient != address(0), "Invalid recipient");
            require(amount >= minWithdrawal, "Below minimum withdrawal");
            require(
                merchantBalances[merchantId] >= amount,
                "Insufficient balance"
            );

            merchantBalances[merchantId] -= amount;

            usdcToken.safeTransfer(recipient, amount);

            emit WithdrawalProcessed(
                merchantId,
                recipient,
                amount,
                block.timestamp
            );
        }
    }

    function setMinWithdrawal(uint256 newMin) external onlyRole(ADMIN_ROLE) {
        uint256 oldMin = minWithdrawal;
        minWithdrawal = newMin;

        emit MinWithdrawalUpdated(oldMin, newMin);
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function getMerchantBalance(
        string calldata merchantId
    ) external view returns (uint256) {
        return merchantBalances[merchantId];
    }
}
