const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying to network:', hre.network.name);
  console.log('Deploying with account:', deployer.address);

  const wethAddress = hre.network.name === 'mainnet'
    ? process.env.MAINNET_WETH_ADDRESS || process.env.WETH_ADDRESS
    : process.env.WETH_ADDRESS;

  if (!wethAddress) {
    throw new Error(
      `Missing WETH address in .env. Set ${hre.network.name === 'mainnet' ? 'MAINNET_WETH_ADDRESS' : 'WETH_ADDRESS'}.`
    );
  }

  const Liquidator = await hre.ethers.getContractFactory('Liquidator');
  const liquidator = await Liquidator.deploy(wethAddress);
  await liquidator.deployed();

  console.log('Liquidator deployed to:', liquidator.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
