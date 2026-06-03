import { BigNumber, providers, utils } from 'ethers';
import { LAMPORTS_PER_SOL, Connection } from '@solana/web3.js';

/**
 * Dynamic bribe calculator: monitors real-time gas/compute prices and adjusts
 * tip percentage based on competitive block space demand.
 *
 * Key strategy:
 * - Low congestion: Minimal tip (base 10%)
 * - Moderate congestion: Scale linearly (10-50%)
 * - High congestion: Aggressive (50-100%)
 * - Extreme congestion: Maximum (100%+)
 */

export interface BribeMetrics {
  gasPrice: BigNumber;
  baseFeePerGas: BigNumber;
  priorityFeePerGas: BigNumber;
  congestionLevel: 'low' | 'moderate' | 'high' | 'extreme';
  congestionScore: number; // 0-100
  recommendedTipBps: number; // basis points (0-10000)
}

export interface SolanaBribeMetrics {
  lamportsPerComputeUnit: number;
  averageTipLamports: number;
  jitoTipFloor: number;
  congestionLevel: 'low' | 'moderate' | 'high' | 'extreme';
  congestionScore: number; // 0-100
  recommendedTipLamports: number;
}

/**
 * Analyze Ethereum network congestion and return bribe recommendation
 */
export async function getEthereumBribeMetrics(
  provider: providers.JsonRpcProvider,
  lastSeenGasPrice?: BigNumber
): Promise<BribeMetrics> {
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || lastSeenGasPrice || BigNumber.from('20000000000');
  const baseFeePerGas = feeData.lastBaseFeePerGas || BigNumber.from('10000000000');
  const priorityFeePerGas = feeData.maxPriorityFeePerGas || BigNumber.from('2000000000');

  const priorityFeeGwei = Number(utils.formatUnits(priorityFeePerGas, 'gwei'));
  const baseFeeGwei = Number(utils.formatUnits(baseFeePerGas, 'gwei'));

  // Congestion scoring: 0-100
  // threshold: <20 gwei = low, 20-50 = moderate, 50-100 = high, >100 = extreme
  let congestionLevel: 'low' | 'moderate' | 'high' | 'extreme' = 'low';
  let congestionScore = 0;

  if (priorityFeeGwei < 2) {
    congestionLevel = 'low';
    congestionScore = 10;
  } else if (priorityFeeGwei < 5) {
    congestionLevel = 'moderate';
    congestionScore = 40;
  } else if (priorityFeeGwei < 15) {
    congestionLevel = 'high';
    congestionScore = 70;
  } else {
    congestionLevel = 'extreme';
    congestionScore = 95;
  }

  // Recommended tip bps: scale from 10% (low) to 100%+ (extreme)
  // Formula: baseTip + (congestionScore / 100) * additionalTip
  const baseTip = 1000; // 10%
  const additionalTip = 9000; // up to 90% more
  const recommendedTipBps = baseTip + Math.floor((congestionScore / 100) * additionalTip);

  return {
    gasPrice,
    baseFeePerGas,
    priorityFeePerGas,
    congestionLevel,
    congestionScore,
    recommendedTipBps: Math.min(recommendedTipBps, 10000), // cap at 100%
  };
}

/**
 * Estimate Solana network congestion and return bribe recommendation
 * Monitors average tip floor and compute unit costs
 */
export async function getSolanaBribeMetrics(
  connection: Connection,
  recentTransactionFees?: number[]
): Promise<SolanaBribeMetrics> {
  // Fetch recent block info to estimate compute unit costs
  const slot = await connection.getSlot();
  const blockTime = await connection.getBlockTime(slot - 1);
  const recentFees = recentTransactionFees || [];

  // Calculate average tip from recent transactions (default: 25000 lamports for Jito)
  const avgTip = recentFees.length > 0
    ? Math.round(recentFees.reduce((a, b) => a + b, 0) / recentFees.length)
    : 25000;

  // Estimate compute unit lamports (Solana typically charges 10-100 lamports per compute unit)
  // High activity = higher cost
  const baseComputeUnitLamports = 10;
  const adjustedComputeUnitLamports = Math.max(10, Math.min(50, baseComputeUnitLamports + recentFees.length / 100));

  // Jito tip floor: monitor from recent tips
  const jitoTipFloor = Math.max(10000, avgTip / 2); // tip floor is typically 50% of average

  // Congestion scoring: 0-100
  // <15k lamports = low, 15-40k = moderate, 40-100k = high, >100k = extreme
  let congestionLevel: 'low' | 'moderate' | 'high' | 'extreme' = 'low';
  let congestionScore = 0;

  if (avgTip < 15000) {
    congestionLevel = 'low';
    congestionScore = 15;
  } else if (avgTip < 40000) {
    congestionLevel = 'moderate';
    congestionScore = 45;
  } else if (avgTip < 100000) {
    congestionLevel = 'high';
    congestionScore = 70;
  } else {
    congestionLevel = 'extreme';
    congestionScore = 95;
  }

  // Recommended tip lamports: scale from base to aggressive
  // Formula: baseTip + (congestionScore / 100) * additionalTip
  const baseTip = 25000; // Minimum for most transactions
  const additionalTip = 250000; // Up to 250k additional in extreme congestion
  const recommendedTipLamports = baseTip + Math.floor((congestionScore / 100) * additionalTip);

  return {
    lamportsPerComputeUnit: adjustedComputeUnitLamports,
    averageTipLamports: avgTip,
    jitoTipFloor: jitoTipFloor,
    congestionLevel,
    congestionScore,
    recommendedTipLamports: Math.max(jitoTipFloor, recommendedTipLamports),
  };
}

/**
 * Calculate optimized bribe for Ethereum based on gross profit
 * Returns the tip amount and percentage to maximize inclusion probability
 */
export function calculateEthereumBribe(
  grossProfitWei: BigNumber,
  metrics: BribeMetrics
): { tipWei: BigNumber; tipBps: number; isCompetitive: boolean } {
  // Conservative: spend up to recommendedTipBps of gross profit as builder fee
  const tipWei = grossProfitWei.mul(metrics.recommendedTipBps).div(10000);

  // Competitive check: if profit is very high, increase aggressiveness
  const profitGwei = Number(utils.formatUnits(grossProfitWei, 'gwei'));
  const isCompetitive = profitGwei > 100; // >100 Gwei profit = highly profitable

  return {
    tipWei,
    tipBps: metrics.recommendedTipBps,
    isCompetitive,
  };
}

/**
 * Calculate optimized bribe for Solana based on gross profit
 * Returns the tip amount in lamports
 */
export function calculateSolanaBribe(
  grossProfitLamports: number,
  metrics: SolanaBribeMetrics
): { tipLamports: number; tipPercentage: number; isCompetitive: boolean } {
  const grossProfitSol = grossProfitLamports / LAMPORTS_PER_SOL;

  // Scale tip based on profitability
  // Low profit: use floor tip, High profit: be aggressive
  let tipLamports = metrics.recommendedTipLamports;

  if (grossProfitSol < 0.1) {
    // Very low profit: use minimum floor
    tipLamports = metrics.jitoTipFloor;
  } else if (grossProfitSol > 5.0) {
    // Very high profit: increase tip by 50%
    tipLamports = Math.floor(tipLamports * 1.5);
  }

  const tipPercentage = (tipLamports / grossProfitLamports) * 100;
  const isCompetitive = grossProfitSol > 1.0; // >1 SOL profit = highly profitable

  return {
    tipLamports: Math.max(metrics.jitoTipFloor, tipLamports),
    tipPercentage,
    isCompetitive,
  };
}

/**
 * Monitor and cache recent transaction fees for Solana (used for congestion estimation)
 */
export class SolanaFeeMonitor {
  private recentFees: number[] = [];
  private maxCacheSize = 100;

  addFee(lamports: number): void {
    this.recentFees.push(lamports);
    if (this.recentFees.length > this.maxCacheSize) {
      this.recentFees.shift();
    }
  }

  getRecentFees(): number[] {
    return [...this.recentFees];
  }

  getAverageFee(): number {
    if (this.recentFees.length === 0) return 25000;
    return Math.round(this.recentFees.reduce((a, b) => a + b, 0) / this.recentFees.length);
  }

  getMedianFee(): number {
    if (this.recentFees.length === 0) return 25000;
    const sorted = [...this.recentFees].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  getPeakFee(): number {
    if (this.recentFees.length === 0) return 25000;
    return Math.max(...this.recentFees);
  }

  reset(): void {
    this.recentFees = [];
  }
}

/**
 * Monitor and cache recent Ethereum gas prices for trend analysis
 */
export class EthereumGasPriceMonitor {
  private recentPrices: number[] = [];
  private maxCacheSize = 50;

  addPrice(gweiPrice: number): void {
    this.recentPrices.push(gweiPrice);
    if (this.recentPrices.length > this.maxCacheSize) {
      this.recentPrices.shift();
    }
  }

  getRecentPrices(): number[] {
    return [...this.recentPrices];
  }

  getAveragePrice(): number {
    if (this.recentPrices.length === 0) return 30;
    return this.recentPrices.reduce((a, b) => a + b, 0) / this.recentPrices.length;
  }

  getMedianPrice(): number {
    if (this.recentPrices.length === 0) return 30;
    const sorted = [...this.recentPrices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  getPriceChange(): number {
    if (this.recentPrices.length < 2) return 0;
    const first = this.recentPrices[0];
    const last = this.recentPrices[this.recentPrices.length - 1];
    return ((last - first) / first) * 100; // percentage change
  }

  reset(): void {
    this.recentPrices = [];
  }
}
