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
pip install solders solana
python liquidation_bot.py
```

### Tests and Simulation
```bash
npm run test
npm run simulate
```

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

## Next Steps

1. Integrate with actual Solana lending protocols (Solend, Marginfi)
2. Implement Jupiter API integration for optimal collateral swaps
3. Add Flashbots-equivalent private transaction submission for Solana
4. Enhance bot with mempool monitoring and predictive liquidation
5. Implement advanced fee distribution and reward systems

## Disclaimer

This code is for educational purposes only. MEV extraction carries financial risks and may be subject to regulatory scrutiny. Always conduct thorough testing and consider legal implications before deploying MEV strategies in production.