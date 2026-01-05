// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/OpenlyGateway.sol";

/**
 * @title DeployWithMockUSDC
 * @notice Deployment script with mock USDC for local testing
 * @dev Run with: forge script script/DeployOpenlyGateway.s.sol:DeployWithMockUSDC --rpc-url http://localhost:8545 --broadcast
 */
contract DeployWithMockUSDC is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address deployer = vm.addr(deployerPrivateKey);
        console2.log("======================================");
        console2.log("Deploying with Mock USDC (base-sepolia");
        console2.log("======================================");
        console2.log("Deployer: ", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy mock USDC
        MockUSDC usdc = new MockUSDC();
        console2.log("Mock. USDC deployed at: ", address(usdc));

        // Mint test USDC
        usdc.mint(deployer, 100000 * 10 ** 6); // 100,000 USDC
        console2.log("Minted 100,000 USDC to deployer");

        // Deploy OpenlyGateway
        OpenlyGateway openlyGateway = new OpenlyGateway(
            address(usdc),
            deployer
        );
        console2.log("OpenlyGateway deployed at: ", address(openlyGateway));

        address testMerchant = address(
            0x1234567890123456789012345678901234567890
        );
        console2.log("Test merchant address: ", testMerchant);

        string memory merchantId = "merchant_test_001";
        string memory userId = "user_test_001";
        string memory paymentRef = "payment_test_001";

        address paymentAddress = openlyGateway.computeForwarderAddress(
            merchantId,
            userId,
            paymentRef
        );
        console2.log("Test Payment Address: ", paymentAddress);

        vm.stopBroadcast();

        console2.log("=======================================");
        console2.log("Base Sepolia Deployment Complete!");
        console2.log("=======================================");
        console2.log("");
        console2.log("Try these commands: ");
        console2.log("1. Deploy a forwarder: ");
        string memory deployCmd = string.concat(
            "   cast send ",
            vm.toString(address(openlyGateway)),
            " 'deployForwarder(string,string)' 'merchant_test_001' 'invoice_001' --private-key ",
            vm.toString(deployerPrivateKey)
        );
        console2.log(deployCmd);
        console2.log("");
        console2.log("2. Send USDC to payment address:");
        string memory transferCmd = string.concat(
            "   cast send ",
            vm.toString(address(usdc)),
            " 'transfer(address,uint256)' ",
            vm.toString(paymentAddress),
            " $(cast to-wei 100 6) --private-key ",
            vm.toString(deployerPrivateKey)
        );
        console2.log(transferCmd);
        console2.log("========================================");
    }
}

// Mock USDC for testing on base sepolia
contract MockUSDC {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(
        address indexed owner,
        address indexed spender,
        uint256 value
    );

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        require(
            allowance[from][msg.sender] >= amount,
            "Insufficient allowance"
        );
        require(balanceOf[from] >= amount, "Insufficient balance");

        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
