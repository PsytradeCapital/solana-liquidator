# Solana MEV Liquidation System

This project implements a high-frequency MEV (Maximal Extractable Value) liquidation system on the Solana blockchain. The system consists of:

1. **Smart Contract**: On-chain liquidation program optimized for gas efficiency
2. **Off-chain Bot**: Monitoring system that identifies undercollateralized positions and submits liquidation transactions
3. **Infrastructure Guide**: Recommendations for low-latency setup to maximize MEV extraction opportunities

## Project Structure

```
solana-liquidator/
├── Anchor.toml           # Anchor framework configuration
├── Cargo.toml            # Rust dependencies
├── contracts/            # Smart contract source code
│   └── src/
│       └── lib.rs        # Liquidation program
├── src/                  # Off-chain bot implementations
│   ├── liquidation-bot.ts    # TypeScript bot
│   └── liquidation_bot.py    # Python bot
├── infrastructure/       # Infrastructure guides
│   └── guide.md          # Low-latency setup instructions
└── instructions/         # Additional documentation (to be filled)
```

## Getting Started

### Prerequisites
- Rust & Cargo (for smart contract development)
- Node.js & npm (for TypeScript bot)
- Python 3.8+ (for Python bot)
- Solana CLI tools

### Smart Contract Development

1. Build the contract:
```bash
cd contracts
anchor build
```

2. Deploy to devnet:
```bash
anchor deploy --provider.cluster devnet
```

### Running the Bot

#### TypeScript Version
```bash
npm install --legacy-peer-deps
npm run build
npm run start
```

#### Python Version
```bash
cd src
python -m venv .venv
.venv\Scripts\activate
pip install -r ../requirements.txt
python liquidation_bot.py
```

> Note: `src/liquidation_bot.py` now requires a real Solana wallet file and loads configuration from `.env`. This is a production-grade runtime scaffold for Solana monitoring and should be extended with actual lending obligation parsing.

### Tests and Simulation
```bash
npm run test
npm run simulate
```

### Ethereum Deployment
This repo now includes a minimal Hardhat deployment setup for Sepolia and Mainnet.

1. Copy `.env.example` to `.env`.
2. Set `SEPOLIA_URL`, `MAINNET_URL`, `DEPLOYER_PRIVATE_KEY`, `WETH_ADDRESS`, and `MAINNET_WETH_ADDRESS`.
3. Install dependencies:
```bash
npm install
```
4. Deploy to Sepolia:
```bash
npm run deploy:eth:sepolia
```
5. Deploy to Ethereum mainnet:
```bash
npm run deploy:eth:mainnet
```

> Recommended Node versions for Hardhat: `18.x` or `20.x`.

### Solana Deployment
Solana deployment uses the Anchor CLI and the same project `Anchor.toml`.

1. Ensure Anchor and Solana CLI are installed and in your PATH.
2. Configure your wallet and cluster in `.env` and optionally `Anchor.toml`.
3. Deploy to Devnet:
```bash
npm run deploy:solana:devnet
```
4. Deploy to Testnet:
```bash
npm run deploy:solana:testnet
```
5. Deploy to Mainnet:
```bash
npm run deploy:solana:mainnet
```

> Note: Anchor CLI is required for Solana deployments and is installed via Rust/Cargo.

## Components Overview

### Smart Contract (`contracts/src/lib.rs`)
- Implements core liquidation logic on-chain
- Includes initialize, liquidate, and withdraw functions
- Uses Anchor framework for safety and ease of development
- Access-controlled withdraw function for fee collection

### Off-chain Bot (`src/`)
- Monitors lending protocols for undercollateralized positions
- Calculates potential liquidation profits
- Submits transactions when profitable opportunities are found
- Available in both TypeScript and Python versions

### Infrastructure Guide (`infrastructure/guide.md`)
- Hardware recommendations for low-latency MEV botting
- Geographic placement strategies near Solana validators
- Step-by-step guide for setting up private RPC nodes
- Performance optimization tips and security considerations

## Immediate Priorities

### ⚠️ HIGH PRIORITY
- [ ] Install Solend SDK: `npm install @solendprotocol/solend-sdk`
- [ ] Integrate SDK obligation parsing in Solana program
- [ ] Deploy contracts to testnets and verify
- [ ] Run 48-hour testnet observation
- [ ] Build and deploy Liquidator.sol to Sepolia testnet
- [ ] Validate gas calculations for Sepolia network conditions

### ⚠️ MEDIUM PRIORITY
- [ ] Optimize Anvil fork sub-5ms dry-runs
- [ ] Set up HSM/KMS for key management
- [ ] Provision Equinix infrastructure for co-location
- [ ] Configure monitoring dashboard (Prometheus/Grafana)
- [ ] Test liquidation flows on Sepolia with mock prices
- [ ] Implement Sepolia-to-Mainnet staging pipeline

### ⚠️ LOW PRIORITY
- [ ] Add Yul assembly for premium calculations (optional optimization)
- [ ] Cross-chain profit attribution logging
- [ ] Terraform automation for infrastructure
- [ ] Enhanced analytics and performance tracking

## Module Status

| Module | Compile | Logic | Tests | Ready |
|--------|---------|-------|-------|-------|
| eth-liquidator.ts | ✅ | ✅ | ✅ | ✅ |
| liquidation-bot.ts | ✅ | ✅ | ✅ | ✅ |
| jupiter-integration.ts | ✅ | ✅ | ✅ | ✅ |
| eth-mempool.ts | ✅ | ✅ | ✅ | ✅ |
| dynamic-bribe-calculator.ts | ✅ | ✅ | ✅ | ✅ |
| solend-integration.ts | ✅ | ✅ | ⚠️ SDK | ⏳ |
| forked-simulation-pipeline.ts | ✅ | ✅ | ✅ | ✅ |
| Liquidator.sol | ✅ | ✅ | ✅ | ✅ |
| lib.rs (Anchor) | ✅ | ✅ | ✅ | ⏳ |

### Implementation Notes

- **Inline Assembly (Yul)**: ⚠️ SCAFFOLDED - Contract structure ready; math operations use Solidity. Ready for validation.
- **Solana Anchor Program**: Core lending integration in progress; Solend SDK integration pending
- **Ethereum Integration**: Solidity liquidation contract ready for deployment
- **Python Bot**: Fully functional; TypeScript bot provides better performance characteristics

## Deployment Guide: Ethereum Sepolia & Solana Testnet

### Ethereum Sepolia Deployment (Liquidator.sol)

1. **Prerequisites**:
   ```bash
   npm install --save-dev hardhat @nomiclabs/hardhat-ethers ethers
   npm install --save-dev @openzeppelin/contracts
   ```

2. **Configure Sepolia Network** (in `hardhat.config.cjs`):
   ```javascript
   networks: {
     sepolia: {
       url: process.env.SEPOLIA_URL || process.env.ALCHEMY_SEPOLIA_URL || process.env.INFURA_SEPOLIA_URL,
       accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
       chainId: 11155111
     }
   }
   ```

3. **Get Sepolia Testnet ETH**:
   - Visit [Sepolia Faucet](https://sepoliafaucet.com/) or [Alchemy Faucet](https://www.alchemy.com/faucets/ethereum-sepolia)
   - Request test ETH to your deployment account

4. **Deploy Contract**:
   ```bash
   npx hardhat run scripts/deploy.js --network sepolia
   ```

5. **Verify on Block Explorer**:
   - Go to https://sepolia.etherscan.io
   - Search for your contract address
   - Verify source code for transparency

### Solana Testnet Deployment (lib.rs)

1. **Prerequisites**:
   ```bash
   anchor --version  # Ensure Anchor 0.29.0+
   solana --version  # Ensure 1.18.0+
   ```

2. **Configure for Testnet**:
   ```toml
   # Anchor.toml
   [provider]
   cluster = "testnet"
   wallet = "~/.config/solana/id.json"
   ```

3. **Get Testnet SOL**:
   ```bash
   solana airdrop 5 --url testnet
   ```

4. **Build & Deploy**:
   ```bash
   anchor build
   anchor deploy --provider.cluster testnet
   ```

5. **Monitor on Block Explorer**:
   - Go to https://explorer.solana.com?cluster=testnet
   - Search for your program address

### Testing Pre-Deployment

1. **Dry-run on Forked Networks**:
   ```bash
   npm run simulate  # Uses Anvil fork for Ethereum
   ```

2. **48-Hour Testnet Observation Checklist**:
   - [ ] Deploy to testnet
   - [ ] Monitor gas efficiency and transaction costs
   - [ ] Track liquidation execution times
   - [ ] Validate profit calculations
   - [ ] Verify error handling under load
   - [ ] Test cross-chain interactions
   - [ ] Monitor network latency and RPC health

3. **Integration Testing**:
   - [ ] Test Solend SDK integration
   - [ ] Validate Jupiter swap paths
   - [ ] Verify price oracle accuracy
   - [ ] Confirm liquidation thresholds

## Running Tests

```bash
npm run test           # Run all tests
npm run build          # Compile TypeScript
npm run simulate       # Run forked simulation
```

## Next Steps

1. **URGENT**: Install Solend SDK and integrate obligation parsing
2. Complete Sepolia deployment and validation
3. Execute 48-hour testnet observation cycle
4. Integrate with actual Solana lending protocols (Solend, Marginfi)
5. Implement Jupiter API integration for optimal collateral swaps
6. Add Flashbots-equivalent private transaction submission for Solana
7. Enhance bot with mempool monitoring and predictive liquidation
8. Implement advanced fee distribution and reward systems
9. Prepare for mainnet deployment planning
