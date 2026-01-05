#!/bin/bash

# Load environment variables
source .env

# Check for API Key
if [ -z "$ETHERSCAN_API_KEY" ]; then
    if [ -n "$BASESCAN_API_KEY" ]; then
        ETHERSCAN_API_KEY=$BASESCAN_API_KEY
    else
        echo "Error: ETHERSCAN_API_KEY or BASESCAN_API_KEY not found in .env"
        echo "Please add your Base Scan API key to .env"
        exit 1
    fi
fi

echo "Verifying OpenlyGateway..."
forge verify-contract \
  --chain-id 84532 \
  --watch \
  --constructor-args 000000000000000000000000e8810705a35de3e166eba14a4e3ec6442b5e05380000000000000000000000003f2ef67089f2904e65745cec7870139485929486 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  0xad8E837A696222b00572B3C9c5DC4685FC24D2A9 \
  src/OpenlyGateway.sol:OpenlyGateway

echo "Verifying MockUSDC..."
forge verify-contract \
  --chain-id 84532 \
  --watch \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  0xe8810705a35de3E166ebA14a4e3eC6442B5e0538 \
  script/DeployOpenlyGateway.s.sol:MockUSDC
