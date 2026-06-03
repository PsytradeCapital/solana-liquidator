import { providers, Wallet, Contract, utils, BigNumber } from 'ethers';
import { FlashbotsBundleProvider, FlashbotsBundleResolution } from '@flashbots/ethers-provider-bundle';
import { startPendingTxWatcher, inspectPendingTx } from './eth-mempool.js';
import { getEthereumBribeMetrics, calculateEthereumBribe, EthereumGasPriceMonitor } from './dynamic-bribe-calculator.js';
import { OracleMemoryMonitor } from './oracle-mempool-monitor.js';
import { ForkedSimulationOrchestrator } from './forked-simulation-pipeline.js';
import dotenv from 'dotenv';

dotenv.config();

const CONFIG = {
  ETH_RPC: process.env.ETH_RPC || 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY',
  ETH_WS: process.env.ETH_WS || 'wss://mainnet.infura.io/ws/v3/YOUR_INFURA_KEY',
  FLASHBOTS_RELAY: process.env.FLASHBOTS_RELAY || 'https://relay.flashbots.net',
  RELAY_SIGNER_PRIVATE_KEY: process.env.RELAY_SIGNER_PRIVATE_KEY || '',
  SEARCHER_PRIVATE_KEY: process.env.SEARCHER_PRIVATE_KEY || '',
  FLASHLOAN_CONTRACT_ADDRESS: process.env.FLASHLOAN_CONTRACT_ADDRESS || '',
  AAVE_POOL_ADDRESS: process.env.AAVE_POOL_ADDRESS || '',
  UNISWAP_V3_ROUTER_ADDRESS: process.env.UNISWAP_V3_ROUTER_ADDRESS || '',
  UNISWAP_V3_QUOTER_ADDRESS: process.env.UNISWAP_V3_QUOTER_ADDRESS || '',
  WETH_ADDRESS: process.env.WETH_ADDRESS || '',
  ORACLE_ADDRESSES: (process.env.ORACLE_ADDRESSES || '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean),
  COLLATERAL_ASSET: process.env.COLLATERAL_ASSET || '',
  LIQUIDATION_TARGET: process.env.LIQUIDATION_TARGET || '',
  LIQUIDATION_DATA: process.env.LIQUIDATION_DATA || '0x',
  DEBT_AMOUNT: process.env.DEBT_AMOUNT || '0',
  SWAP_FEE: Number(process.env.SWAP_FEE || '3000'),
  MIN_DEBT_OUT: process.env.MIN_DEBT_OUT || '0',
  MIN_PROFIT: process.env.MIN_PROFIT || '0',
  ORACLE_CONGESTION_GWEI: Number(process.env.ORACLE_CONGESTION_GWEI || '150'),
  HIGH_CONGESTION_TIP_BPS: Number(process.env.HIGH_CONGESTION_TIP_BPS || '80'),
  LOW_CONGESTION_TIP_BPS: Number(process.env.LOW_CONGESTION_TIP_BPS || '50'),
  SIMULATION_RPC: process.env.SIMULATION_RPC || process.env.ANVIL_RPC || '',
};

const gasPriceMonitor = new EthereumGasPriceMonitor();
const oracleMonitor = new OracleMemoryMonitor();
let forkedSimulator: ForkedSimulationOrchestrator | null = null;

const FLASH_LOAN_ABI = [
  'function executeFlashLiquidation(address pool,address debtAsset,uint256 debtAmount,address collateralAsset,address liquidationTarget,bytes calldata liquidationData,address swapRouter,uint24 swapFee,uint256 minDebtOut,uint256 minProfit) external',
  'function setBuilderFeeBps(uint16 feeBps) external',
];

const QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
];

function requireEnv(name: keyof typeof CONFIG, value: string) {
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
}

function parseBytes(value: string) {
  if (value === '' || value === '0x') return '0x';
  return utils.hexlify(value);
}

function isOracleAddress(address: string) {
  return CONFIG.ORACLE_ADDRESSES.includes(address.toLowerCase());
}

async function createProviders() {
  const provider = new providers.JsonRpcProvider(CONFIG.ETH_RPC);
  const wsProvider = new providers.WebSocketProvider(CONFIG.ETH_WS);
  return { provider, wsProvider };
}

async function createFlashbotsProvider(provider: providers.JsonRpcProvider) {
  const relaySigner = new Wallet(CONFIG.RELAY_SIGNER_PRIVATE_KEY, provider);
  return await FlashbotsBundleProvider.create(provider, relaySigner, CONFIG.FLASHBOTS_RELAY);
}

function calculateBuilderTipBps(gasPriceGwei: number) {
  gasPriceMonitor.addPrice(gasPriceGwei);
  // Fallback to congestion-based logic if no dynamic metrics
  return gasPriceGwei >= CONFIG.ORACLE_CONGESTION_GWEI
    ? CONFIG.HIGH_CONGESTION_TIP_BPS
    : CONFIG.LOW_CONGESTION_TIP_BPS;
}

function applyTipShare(grossProfit: BigNumber, tipBps: number) {
  return grossProfit.mul(tipBps).div(100);
}

async function estimateSwapOutput(
  provider: providers.JsonRpcProvider,
  tokenIn: string,
  tokenOut: string,
  fee: number,
  amountIn: BigNumber
): Promise<BigNumber> {
  if (!CONFIG.UNISWAP_V3_QUOTER_ADDRESS) return BigNumber.from(0);
  const quoter = new Contract(CONFIG.UNISWAP_V3_QUOTER_ADDRESS, QUOTER_ABI, provider);
  const amountOut = await quoter.callStatic.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0);
  return BigNumber.from(amountOut);
}

function buildFlashLoanContractInterface(provider: providers.Provider, signer: Wallet) {
  return new Contract(CONFIG.FLASHLOAN_CONTRACT_ADDRESS, FLASH_LOAN_ABI, signer);
}

function serializeTransactionFromResponse(tx: providers.TransactionResponse): string | null {
  if (tx.raw) return tx.raw;
  if (!tx.r || !tx.s || tx.v === undefined) return null;

  const txRequest: any = {
    to: tx.to || undefined,
    nonce: tx.nonce,
    gasLimit: tx.gasLimit || undefined,
    gasPrice: tx.gasPrice || undefined,
    value: tx.value || undefined,
    data: tx.data || '0x',
    chainId: tx.chainId || undefined,
    maxFeePerGas: tx.maxFeePerGas || undefined,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas || undefined,
    type: tx.type || undefined,
  };

  return utils.serializeTransaction(txRequest, {
    v: tx.v,
    r: tx.r,
    s: tx.s,
  });
}

async function simulateTransaction(
  provider: providers.JsonRpcProvider,
  txRequest: providers.TransactionRequest
) {
  const gasEstimate = await provider.estimateGas(txRequest);
  let trace: any = null;

  try {
    trace = await provider.send('debug_traceCall', [txRequest, 'latest', { tracer: 'callTracer' }]);
  } catch {
    // Fallback when debug tracing is unavailable
  }

  return {
    gasEstimate: gasEstimate.toString(),
    trace,
  };
}

async function buildFlashLoanTransaction(
  provider: providers.JsonRpcProvider,
  wallet: Wallet,
  amount: BigNumber,
  minDebtOut: BigNumber,
  minProfit: BigNumber
) {
  const contract = buildFlashLoanContractInterface(provider, wallet);
  const populated = await contract.populateTransaction.executeFlashLiquidation(
    CONFIG.AAVE_POOL_ADDRESS,
    CONFIG.WETH_ADDRESS,
    amount,
    CONFIG.COLLATERAL_ASSET,
    CONFIG.LIQUIDATION_TARGET,
    parseBytes(CONFIG.LIQUIDATION_DATA),
    CONFIG.UNISWAP_V3_ROUTER_ADDRESS,
    CONFIG.SWAP_FEE,
    minDebtOut,
    minProfit
  );

  const gasPrice = await provider.getGasPrice();
  const nonce = await provider.getTransactionCount(wallet.address, 'pending');
  return {
    ...populated,
    from: wallet.address,
    gasPrice,
    gasLimit: BigNumber.from(1_500_000),
    nonce,
    chainId: (await provider.getNetwork()).chainId,
  } as providers.TransactionRequest;
}

async function signTransaction(wallet: Wallet, txRequest: providers.TransactionRequest) {
  return await wallet.signTransaction(txRequest);
}

async function executeBundle(
  provider: providers.JsonRpcProvider,
  flashbotsProvider: FlashbotsBundleProvider,
  oracleTxRaw: string | null,
  liquidationTxRaw: string,
  targetBlockNumber: number
) {
  const signedTransactions = oracleTxRaw ? [oracleTxRaw, liquidationTxRaw] : [liquidationTxRaw];
  const bundleResponse = await flashbotsProvider.sendRawBundle(signedTransactions, targetBlockNumber);

  if ('error' in bundleResponse) {
    throw new Error(`Flashbots relay error: ${bundleResponse.error.message} (${bundleResponse.error.code})`);
  }

  const waitResult = await bundleResponse.wait();
  if (waitResult === FlashbotsBundleResolution.BlockPassedWithoutInclusion || waitResult === FlashbotsBundleResolution.AccountNonceTooHigh) {
    throw new Error(`Flashbots bundle was not included: ${FlashbotsBundleResolution[waitResult]}`);
  }

  return waitResult;
}

async function handleOracleUpdate(txHash: string, provider: providers.JsonRpcProvider, flashbotsProvider: FlashbotsBundleProvider, wallet: Wallet) {
  const pendingTx = await provider.getTransaction(txHash);
  if (!pendingTx) {
    console.warn(`Oracle tx ${txHash} is unavailable`);
    return;
  }

  const oracleTxRaw = serializeTransactionFromResponse(pendingTx);
  if (!oracleTxRaw) {
    console.warn('Unable to serialize oracle transaction for bundle inclusion. The bundle will proceed without the oracle tx.');
  }

  const debtAmount = BigNumber.from(CONFIG.DEBT_AMOUNT);
  const minDebtOut = BigNumber.from(CONFIG.MIN_DEBT_OUT);
  const minProfit = BigNumber.from(CONFIG.MIN_PROFIT);

  const amountOutEstimate = await estimateSwapOutput(provider, CONFIG.COLLATERAL_ASSET, CONFIG.WETH_ADDRESS, CONFIG.SWAP_FEE, debtAmount);
  console.log(`Estimated swap output from collateral to debt asset: ${utils.formatEther(amountOutEstimate)} WETH`);

  const flashLoanTx = await buildFlashLoanTransaction(provider, wallet, debtAmount, minDebtOut, minProfit);
  
  // Use forked simulator if available for sub-5ms validation
  let simulation: any;
  if (forkedSimulator) {
    console.log('Running simulation on forked Ethereum...');
    const simResult = await forkedSimulator.simulateEthereumTransaction(flashLoanTx);
    console.log(`Forked simulation: ${simResult.simulationTimeMs}ms (gas: ${simResult.gasUsed}, cache: ${simResult.cacheHit})`);
    simulation = { gasEstimate: simResult.gasUsed?.toString() || '0', trace: null };
  } else {
    simulation = await simulateTransaction(provider, flashLoanTx);
    console.log(`Standard simulation: gas estimate ${simulation.gasEstimate}`);
  }

  const feeData = await provider.getFeeData();
  const gasPriceGwei = Number(utils.formatUnits(feeData.gasPrice || feeData.maxFeePerGas || BigNumber.from('0'), 'gwei'));
  
  // Fetch dynamic bribe metrics based on real-time congestion
  const bribeMetrics = await getEthereumBribeMetrics(provider);
  console.log(`\n=== Dynamic Bribe Analysis ===`);
  console.log(`Congestion Level: ${bribeMetrics.congestionLevel} (score: ${bribeMetrics.congestionScore}/100)`);
  console.log(`Priority Fee: ${Number(utils.formatUnits(bribeMetrics.priorityFeePerGas, 'gwei')).toFixed(2)} gwei`);
  console.log(`Recommended Tip: ${bribeMetrics.recommendedTipBps / 100}% of profit`);

  // Calculate exact builder fee based on gross profit and dynamic metrics
  const grossProfit = amountOutEstimate.sub(debtAmount).mul(1000).div(1050); // rough estimate
  const bribeCalc = calculateEthereumBribe(grossProfit, bribeMetrics);
  console.log(`Builder Tip (dynamic): ${utils.formatEther(bribeCalc.tipWei)} WETH`);
  console.log(`Competitive: ${bribeCalc.isCompetitive ? 'YES ✓' : 'NO ✗'}\n`);

  const signedLiquidationTx = await signTransaction(wallet, flashLoanTx);
  const targetBlockNumber = (await provider.getBlockNumber()) + 1;

  try {
    const result = await executeBundle(provider, flashbotsProvider, oracleTxRaw, signedLiquidationTx, targetBlockNumber);
    console.log('Flashbots bundle result:', result);
  } catch (error) {
    console.error('Failed to submit Flashbots bundle:', error);
  }
}

async function run() {
  requireEnv('SEARCHER_PRIVATE_KEY', CONFIG.SEARCHER_PRIVATE_KEY);
  requireEnv('RELAY_SIGNER_PRIVATE_KEY', CONFIG.RELAY_SIGNER_PRIVATE_KEY);
  requireEnv('FLASHLOAN_CONTRACT_ADDRESS', CONFIG.FLASHLOAN_CONTRACT_ADDRESS);
  requireEnv('AAVE_POOL_ADDRESS', CONFIG.AAVE_POOL_ADDRESS);
  requireEnv('UNISWAP_V3_ROUTER_ADDRESS', CONFIG.UNISWAP_V3_ROUTER_ADDRESS);
  requireEnv('UNISWAP_V3_QUOTER_ADDRESS', CONFIG.UNISWAP_V3_QUOTER_ADDRESS);
  requireEnv('WETH_ADDRESS', CONFIG.WETH_ADDRESS);
  requireEnv('COLLATERAL_ASSET', CONFIG.COLLATERAL_ASSET);
  requireEnv('LIQUIDATION_TARGET', CONFIG.LIQUIDATION_TARGET);

  const { provider, wsProvider } = await createProviders();
  const flashbotsProvider = await createFlashbotsProvider(provider);
  const wallet = new Wallet(CONFIG.SEARCHER_PRIVATE_KEY, provider);

  // Initialize forked simulation pipeline
  forkedSimulator = new ForkedSimulationOrchestrator(CONFIG.ETH_RPC);
  try {
    await forkedSimulator.initialize();
    console.log('✓ Forked simulation ready (sub-5ms validation enabled)');
  } catch (e) {
    console.warn('Forked simulation unavailable, using standard simulation:', e);
    forkedSimulator = null;
  }

  // Set up oracle update listener
  oracleMonitor.onOracleUpdate(async (update) => {
    console.log(`\n🔔 Oracle update detected: ${update.tokenSymbol} (${update.priceChangePercent.toFixed(2)}% change)`);
    await handleOracleUpdate(update.txHash || '', provider, flashbotsProvider, wallet);
  });

  startPendingTxWatcher(async (txHash: string) => {
    const inspection = await inspectPendingTx(provider, txHash);
    if (!inspection) return;

    // Check for oracle updates in pending mempool
    try {
      const tx = await provider.getTransaction(txHash);
      if (tx && tx.data) {
        const oracleUpdates = await oracleMonitor.scanEthereumMempoolForOracleUpdates(
          provider,
          txHash,
          tx.data
        );
        for (const update of oracleUpdates) {
          await oracleMonitor.recordUpdate(update);
        }
      }
    } catch (e) {
      // Silently skip if not an oracle update
    }

    if (inspection.type !== 'oracle') return;
    console.log(`Oracle update detected: ${txHash}`);
    await handleOracleUpdate(txHash, provider, flashbotsProvider, wallet);
  });

  wsProvider.on('error', (e) => console.error('WS error', e));
  wsProvider.on('close', (code: number) => console.warn('WS closed', code));

  console.log('Ethereum liquidation monitor started. Watching oracle transactions...');
}

if (process.argv[1].endsWith('eth-liquidator.ts')) {
  run().catch((error) => {
    console.error('Ethereum liquidator fatal error:', error);
    process.exit(1);
  });
}
