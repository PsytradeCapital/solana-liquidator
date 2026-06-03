import fetch from 'node-fetch';
import { PublicKey, Transaction } from '@solana/web3.js';

const JUPITER_API = {
  QUOTE: 'https://quote-api.jup.ag/v6/quote',
  SWAP: 'https://quote-api.jup.ag/v6/swap',
};

export const TOKEN_MINTS = {
  SOL: new PublicKey('So11111111111111111111111111111111111111112'),
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
};

export interface JupiterRoute {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  marketInfos: Array<any>;
  amount: string;
  inAmountWithSlippage: string;
  outAmountWithSlippage: string;
}

export interface JupiterQuote {
  data: JupiterRoute[];
  timestamp: number;
  inputMint: string;
  outputMint: string;
  amount: string;
}

export async function getJupiterQuote(
  inputMint: PublicKey,
  outputMint: PublicKey,
  amount: number,
  slippageBps: number = 50,
  onlyDirectRoutes = false,
): Promise<JupiterQuote | null> {
  const params = new URLSearchParams({
    inputMint: inputMint.toString(),
    outputMint: outputMint.toString(),
    amount: amount.toString(),
    slippageBps: slippageBps.toString(),
    onlyDirectRoutes: onlyDirectRoutes ? 'true' : 'false',
  });

  const response = await fetch(`${JUPITER_API.QUOTE}?${params.toString()}`);
  if (!response.ok) {
    console.error('Jupiter quote request failed:', response.statusText);
    return null;
  }

  const quoteData = (await response.json()) as JupiterQuote;
  if (!quoteData?.data?.length) {
    console.warn('Jupiter quote returned no route data');
    return null;
  }

  return quoteData;
}

export async function findOptimalSwapRoute(
  inputMint: PublicKey,
  outputMint: PublicKey,
  inputAmount: number,
  slippageBps: number,
  maxPriceImpactPct: number,
): Promise<JupiterQuote | null> {
  const quote = await getJupiterQuote(inputMint, outputMint, inputAmount, slippageBps, false);
  if (!quote) {
    return null;
  }

  const routes = quote.data.sort((a, b) => Number(a.priceImpactPct) - Number(b.priceImpactPct));
  const bestRoute = routes[0];
  const priceImpact = Number(bestRoute.priceImpactPct);

  if (priceImpact > maxPriceImpactPct) {
    console.log(`Rejecting Jupiter route because price impact ${priceImpact}% is above max ${maxPriceImpactPct}%`);
    return null;
  }

  return { ...quote, data: [bestRoute] };
}

export async function buildJupiterSwapTransaction(
  quote: JupiterQuote,
  userPublicKey: PublicKey,
  slippageBps: number,
): Promise<Transaction | null> {
  const swapRequest = {
    quoteResponse: quote,
    userPublicKey: userPublicKey.toString(),
    wrapUnwrapSol: true,
  };

  const response = await fetch(JUPITER_API.SWAP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(swapRequest),
  });

  if (!response.ok) {
    console.error('Jupiter swap transaction creation failed:', response.statusText);
    return null;
  }

  const swapData = await response.json() as { swapTransaction?: string };
  if (!swapData?.swapTransaction) {
    console.error('Jupiter swap response did not include swapTransaction');
    return null;
  }

  const rawTx = Buffer.from(swapData.swapTransaction, 'base64');
  const transaction = Transaction.from(rawTx);
  return transaction;
}

export function estimateSwapPriceUsd(route: JupiterRoute): number {
  const inAmount = Number(route.inAmount);
  const outAmount = Number(route.outAmount);
  if (!inAmount) {
    return 0;
  }
  return (outAmount / 1_000_000) / (inAmount / 1_000_000_000);
}

export function estimateSwapOutputUsd(route: JupiterRoute): number {
  return Number(route.outAmount) / 1_000_000;
}
