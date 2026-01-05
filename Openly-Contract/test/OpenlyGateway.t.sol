// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/OpenlyGateway.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract OpenlyGatewayTest is Test {
    OpenlyGateway public openlyGateway;
    MockUSDC public usdc;

    address public admin = address(1);
    address public operator = address(2);
    address public merchant1 = address(3);
    address public merchant2 = address(4);
    address public customer = address(5);

    string constant MERCHANT_ID_1 = "merchant_123";
    string constant MERCHANT_ID_2 = "merchant_456";
    string constant PAYMENT_REF_1 = "payment_123";
    string constant PAYMENT_REF_2 = "payment_456";
    string constant USER_ID_1 = "user_123";
    string constant USER_ID_2 = "user_456";

    uint256 constant USDC_AMOUNT = 100 * 10 ** 6;

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

    function setUp() public {
        usdc = new MockUSDC();

        vm.startPrank(admin);
        openlyGateway = new OpenlyGateway(address(usdc), admin);
        openlyGateway.grantRole(openlyGateway.OPERATOR_ROLE(), operator);
        vm.stopPrank();

        usdc.mint(customer, 10000 * 10 ** 6); // 10,000 USDC
    }

    function testDeployment() public {
        assertEq(address(openlyGateway.usdcToken()), address(usdc));
        assertTrue(
            openlyGateway.hasRole(openlyGateway.DEFAULT_ADMIN_ROLE(), admin)
        );
        assertTrue(openlyGateway.hasRole(openlyGateway.ADMIN_ROLE(), admin));
        assertTrue(openlyGateway.hasRole(openlyGateway.OPERATOR_ROLE(), admin));
        assertTrue(
            openlyGateway.hasRole(openlyGateway.OPERATOR_ROLE(), operator)
        );
    }

    function testComputeForwarderAddress() public {
        address computed1 = openlyGateway.computeForwarderAddress(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1
        );
        address computed2 = openlyGateway.computeForwarderAddress(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1
        );

        console2.log("computed1: ", computed1);
        console2.log("computed2: ", computed2);
        assertEq(computed1, computed2);
        address computed3 = openlyGateway.computeForwarderAddress(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_2
        );
        assertTrue(computed1 != computed3);
        console2.log("computed3: ", computed3);
    }

    function testDeployForwarder() public {
        address expectedAddress = openlyGateway.computeForwarderAddress(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1
        );

        vm.expectEmit(true, true, false, true);
        emit PaymentForwarderDeployed(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1,
            expectedAddress,
            block.timestamp
        );

        address deployed = openlyGateway.deployForwarder(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1
        );
        console2.log("deployed: ", deployed.code.length);

        assertEq(deployed, expectedAddress);
        assertTrue(deployed.code.length > 0);
    }

    function testConnectDeployForwarderTwice() public {
        openlyGateway.deployForwarder(MERCHANT_ID_1, USER_ID_1, PAYMENT_REF_1);
        vm.expectRevert();
        openlyGateway.deployForwarder(MERCHANT_ID_1, USER_ID_1, PAYMENT_REF_1);
    }

    function testCompletePaymentFlow() public {
        address forwarder = openlyGateway.deployForwarder(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1
        );

        vm.startPrank(customer);
        usdc.transfer(forwarder, USDC_AMOUNT);
        vm.stopPrank();

        assertEq(usdc.balanceOf(forwarder), USDC_AMOUNT);
        vm.expectEmit(true, true, false, true);
        emit PaymentReceived(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1,
            USDC_AMOUNT,
            forwarder,
            block.timestamp
        );

        PaymentForwarder(forwarder).forward(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1,
            USDC_AMOUNT
        );

        assertEq(openlyGateway.getMerchantBalance(MERCHANT_ID_1), USDC_AMOUNT);
        assertEq(usdc.balanceOf(address(openlyGateway)), USDC_AMOUNT);
        assertEq(usdc.balanceOf(forwarder), 0);
    }

    function testWithdrawForMerchant() public {
        address forwarder = openlyGateway.deployForwarder(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1
        );
        vm.startPrank(customer);
        usdc.transfer(forwarder, USDC_AMOUNT);
        PaymentForwarder(forwarder).forward(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1,
            USDC_AMOUNT
        );

        uint256 withdrawalAmount = 50 * 10 ** 6; // 50 USDC

        vm.expectEmit(true, true, false, true);
        emit WithdrawalProcessed(
            MERCHANT_ID_1,
            merchant1,
            withdrawalAmount,
            block.timestamp
        );

        vm.startPrank(operator);
        openlyGateway.withdrawForMerchant(
            MERCHANT_ID_1,
            merchant1,
            withdrawalAmount
        );

        assertEq(usdc.balanceOf(merchant1), withdrawalAmount);
        assertEq(
            openlyGateway.getMerchantBalance(MERCHANT_ID_1),
            USDC_AMOUNT - withdrawalAmount
        );
    }

    function testWithdrawFailsWithInsufficientBalance() public {
        vm.prank(operator);
        vm.expectRevert("Insufficient balance");
        openlyGateway.withdrawForMerchant(
            MERCHANT_ID_1,
            merchant1,
            USDC_AMOUNT
        );
    }

    function testWithdrawFailsBelowMinimum() public {
        address forwarder = openlyGateway.deployForwarder(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1
        );
        vm.prank(customer);
        usdc.transfer(forwarder, USDC_AMOUNT);
        PaymentForwarder(forwarder).forward(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1,
            USDC_AMOUNT
        );

        vm.prank(operator);
        vm.expectRevert("Below minimum withdrawal");
        openlyGateway.withdrawForMerchant(
            MERCHANT_ID_1,
            merchant1,
            0.5 * 10 ** 6
        );
    }

    function testBatchWithdraw() public {
        address forwarder1 = openlyGateway.deployForwarder(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1
        );
        address forwarder2 = openlyGateway.deployForwarder(
            MERCHANT_ID_2,
            USER_ID_2,
            PAYMENT_REF_2
        );

        vm.startPrank(customer);
        usdc.transfer(forwarder1, USDC_AMOUNT);
        usdc.transfer(forwarder2, USDC_AMOUNT * 2);
        vm.stopPrank();

        PaymentForwarder(forwarder1).forward(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1,
            USDC_AMOUNT
        );
        PaymentForwarder(forwarder2).forward(
            MERCHANT_ID_2,
            USER_ID_2,
            PAYMENT_REF_2,
            USDC_AMOUNT * 2
        );

        string[] memory merchantIds = new string[](2);
        merchantIds[0] = MERCHANT_ID_1;
        merchantIds[1] = MERCHANT_ID_2;

        string[] memory userIds = new string[](2);
        userIds[0] = USER_ID_1;
        userIds[1] = USER_ID_2;

        address[] memory recipients = new address[](2);
        recipients[0] = merchant1;
        recipients[1] = merchant2;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = USDC_AMOUNT;
        amounts[1] = USDC_AMOUNT * 2;

        vm.prank(operator);
        openlyGateway.batchWithdraw(merchantIds, recipients, amounts);

        assertEq(usdc.balanceOf(merchant1), USDC_AMOUNT);
        assertEq(usdc.balanceOf(merchant2), USDC_AMOUNT * 2);
    }

    function testOnlyOperatorCanWithdraw() public {
        address forwarder = openlyGateway.deployForwarder(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1
        );
        vm.prank(customer);
        usdc.transfer(forwarder, USDC_AMOUNT);
        PaymentForwarder(forwarder).forward(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1,
            USDC_AMOUNT
        );

        vm.prank(address(999));
        vm.expectRevert();
        openlyGateway.deployForwarder(MERCHANT_ID_1, USER_ID_1, PAYMENT_REF_1);
    }

    function testUnpause() public {
        vm.prank(admin);
        openlyGateway.pause();
        vm.prank(admin);
        openlyGateway.unpause();

        openlyGateway.deployForwarder(MERCHANT_ID_1, USER_ID_1, PAYMENT_REF_1);
    }

    function testUpdateMinWithdrawal() public {
        uint256 newMin = 500000 * 10 ** 6; // 50,000 USDC

        vm.prank(admin);
        openlyGateway.setMinWithdrawal(newMin);

        assertEq(openlyGateway.minWithdrawal(), newMin);
    }

    function testCannotProcessSamePaymentTwice() public {
        address forwarder = openlyGateway.deployForwarder(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1
        );
        vm.prank(customer);
        bool success = usdc.transfer(forwarder, USDC_AMOUNT * 2);
        require(success, "USDC transfer failed");

        PaymentForwarder(forwarder).forward(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1,
            USDC_AMOUNT
        );

        vm.expectRevert("Payment already processed");
        PaymentForwarder(forwarder).forward(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1,
            USDC_AMOUNT
        );
    }

    function testMultiplePaymentsSameMerchant() public {
        address forwarder1 = openlyGateway.deployForwarder(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1
        );
        address forwarder2 = openlyGateway.deployForwarder(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_2
        );

        vm.startPrank(customer);
        bool success = usdc.transfer(forwarder1, USDC_AMOUNT);
        require(success, "USDC transfer failed");
        bool success1 = usdc.transfer(forwarder2, USDC_AMOUNT);
        require(success1, "USDC transfer failed");
        vm.stopPrank();

        PaymentForwarder(forwarder1).forward(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1,
            USDC_AMOUNT
        );
        PaymentForwarder(forwarder2).forward(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_2,
            USDC_AMOUNT
        );

        assertEq(
            openlyGateway.getMerchantBalance(MERCHANT_ID_1),
            USDC_AMOUNT * 2
        );
    }

    function testFuzzPaymentAmounts(uint256 amount) public {
        amount = bound(amount, 1 * 10 ** 6, 1000000 * 10 ** 6);

        address forwarder = openlyGateway.deployForwarder(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1
        );
        usdc.mint(customer, amount);
        vm.prank(customer);
        bool success = usdc.transfer(forwarder, amount);
        require(success, "USDC transfer failed");

        PaymentForwarder(forwarder).forward(
            MERCHANT_ID_1,
            USER_ID_1,
            PAYMENT_REF_1,
            amount
        );
    }
}
