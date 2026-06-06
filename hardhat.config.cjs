require('dotenv').config();
require('@nomiclabs/hardhat-ethers');

module.exports = {
  solidity: '0.8.20',
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {},
    sepolia: {
      url: process.env.SEPOLIA_URL || process.env.ALCHEMY_SEPOLIA_URL || process.env.INFURA_SEPOLIA_URL,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId: 11155111,
    },
    mainnet: {
      url:
        process.env.MAINNET_URL ||
        process.env.ALCHEMY_MAINNET_URL ||
        process.env.INFURA_MAINNET_URL,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      chainId: 1,
    },
  },
  paths: {
    sources: './contracts/solidity',
    artifacts: './artifacts',
    cache: './cache',
  },
};
