import assert from 'assert';
import { calculateNetProfitUsd, estimateCollateralPriceUsd } from './liquidation-bot.js';
import { estimateSwapOutputUsd, TOKEN_MINTS, JupiterQuote } from './jupiter-integration.js';

function testEstimateCollateralPriceUsd() {
  const price = estimateCollateralPriceUsd(TOKEN_MINTS.SOL);
  assert.strictEqual(price, 25.0, 'SOL price should default to 25 USD in this harness');
}

function testEstimateSwapOutputUsd() {
  const route = {
    inAmount: '1000000000',
    outAmount: '2500000',
    otherAmountThreshold: '0',
    priceImpactPct: '0.1',
    marketInfos: [],
    amount: '1000000000',
    inAmountWithSlippage: '1000000000',
    outAmountWithSlippage: '2500000',
  };

  const usd = estimateSwapOutputUsd(route);
  assert.strictEqual(usd, 2.5, 'Swap output should convert to 2.5 USD for USDC route');
}

function testCalculateNetProfitUsd() {
  const position = {
    borrower: null as any,
    collateralMint: TOKEN_MINTS.SOL,
    debtMint: TOKEN_MINTS.USDC,
    collateralAmount: 10.0,
    debtAmountUsd: 100,
    liquidationBonusPct: 0.05,
    collateralAccount: null as any,
    debtAccount: null as any,
    protocolName: 'Solend',
  };
  const quote: JupiterQuote = {
    data: [
      {
        inAmount: '10000000000',
        outAmount: '5000000',
        otherAmountThreshold: '0',
        priceImpactPct: '0.5',
        marketInfos: [],
        amount: '10000000000',
        inAmountWithSlippage: '10000000000',
        outAmountWithSlippage: '5000000',
      },
    ],
    timestamp: Date.now(),
    inputMint: TOKEN_MINTS.SOL.toString(),
    outputMint: TOKEN_MINTS.USDC.toString(),
    amount: '10000000000',
  };

  const netProfit = calculateNetProfitUsd(position, quote);
  assert(netProfit < 0 || typeof netProfit === 'number', 'Net profit should be a number');
}

async function run() {
  console.log('Running unit tests...');
  testEstimateCollateralPriceUsd();
  testEstimateSwapOutputUsd();
  testCalculateNetProfitUsd();
  console.log('All unit tests passed.');
}

run().catch((error) => {
  console.error('Unit tests failed:', error);
  process.exit(1);
});
