import fs from 'fs';
import path from 'path';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  findOptimalSwapRoute,
  buildJupiterSwapTransaction,
  JupiterQuote,
  TOKEN_MINTS,
} from './jupiter-integration.js';
import { getSolanaBribeMetrics, calculateSolanaBribe, SolanaFeeMonitor } from './dynamic-bribe-calculator.js';
import { OracleMemoryMonitor } from './oracle-mempool-monitor.js';
import { ForkedSimulationOrchestrator } from './forked-simulation-pipeline.js';

const CONFIG = {
  rpcEndpoint: process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
  privateRpcEndpoint: process.env.SOLANA_PRIVATE_RPC_ENDPOINT || '',
  walletKeyPath: process.env.WALLET_KEY_PATH || path.resolve('./wallet.json'),
  minProfitThresholdUsd: Number(process.env.MIN_PROFIT_THRESHOLD_USD) || 10,
  maxPriceImpactPct: Number(process.env.MAX_PRICE_IMPACT_PCT) || 2.0,
  slippageBps: Number(process.env.SLIPPAGE_BPS) || 30,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 12_000,
  gasEstimateLamports: 60_000,
  basePriorityFeeLamports: 10_000,
  liquidatorProgramId: new PublicKey('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS'),
  jitoTipAccount: process.env.JITO_TIP_ACCOUNT ? new PublicKey(process.env.JITO_TIP_ACCOUNT) : undefined,
  jitoTipAmountLamports: Number(process.env.JITO_TIP_AMOUNT_LAMPORTS || '25000'),
  computeUnitLimit: Number(process.env.COMPUTE_UNIT_LIMIT || '1_000_000'),
  monitoringTargetPrograms: [
    new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo'),
    new PublicKey('mfmiuQuxaea2VDvDvQ81Sx1gyYyj3HF9awx1mQtuCsr'),
  ],
};

const feeMonitor = new SolanaFeeMonitor();
const oracleMonitor = new OracleMemoryMonitor();
let forkedSimulator: ForkedSimulationOrchestrator | null = null;

export interface PositionInfo {
  borrower: PublicKey;
  collateralMint: PublicKey;
  debtMint: PublicKey;
  collateralAmount: number;
  debtAmountUsd: number;
  liquidationBonusPct: number;
  collateralAccount: PublicKey;
  debtAccount: PublicKey;
  protocolName: string;
}

export function estimateCollateralPriceUsd(collateralMint: PublicKey): number {
  if (collateralMint.equals(TOKEN_MINTS.SOL)) {
    return 25.0;
  }
  return 1.0;
}

export function estimateGasCostUsd(priceUsd: number): number {
  return (CONFIG.gasEstimateLamports / LAMPORTS_PER_SOL) * priceUsd;
}

export function calculatePriorityFeeUsd(expectedProfitUsd: number): number {
  const tipUsd = Math.max(1.0, Math.min(0.01 * expectedProfitUsd, 5.0));
  return tipUsd;
}

export function calculateNetProfitUsd(position: PositionInfo, quote: JupiterQuote): number {
  const route = quote.data[0];
  const swapOutUsd = Number(route.outAmount) / 1_000_000;
  const estimatedGasUsd = estimateGasCostUsd(estimateCollateralPriceUsd(position.collateralMint));
  const priorityFeeUsd = calculatePriorityFeeUsd(swapOutUsd);
  return swapOutUsd - position.debtAmountUsd - estimatedGasUsd - priorityFeeUsd;
}

function loadWalletKeypair(keyPath: string): Keypair {
  if (fs.existsSync(keyPath)) {
    const secretKey = JSON.parse(fs.readFileSync(keyPath, 'utf8')) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }

  if (process.env.ALLOW_EPHEMERAL_WALLET === 'true') {
    console.warn('Wallet key file not found. Using an ephemeral wallet for simulation.');
    return Keypair.generate();
  }

  throw new Error(`Wallet key file not found: ${keyPath}`);
}

export class SolanaLiquidationSearcher {
  private connection: Connection;
  private privateConnection: Connection | null = null;
  private wallet: Keypair;

  constructor() {
    this.connection = new Connection(CONFIG.rpcEndpoint, 'confirmed');
    if (CONFIG.privateRpcEndpoint) {
      this.privateConnection = new Connection(CONFIG.privateRpcEndpoint, 'confirmed');
    }
    this.wallet = loadWalletKeypair(CONFIG.walletKeyPath);
  }

  async initialize(): Promise<void> {
    console.log(`Connected to RPC: ${CONFIG.rpcEndpoint}`);
    if (this.privateConnection) {
      console.log(`Private RPC configured: ${CONFIG.privateRpcEndpoint}`);
    }

    await this.connection.getVersion();
    if (this.privateConnection) {
      await this.privateConnection.getVersion();
    }
    // Initialize forked simulation pipeline
    forkedSimulator = new ForkedSimulationOrchestrator(undefined, CONFIG.rpcEndpoint);
    try {
      await forkedSimulator.initialize();
      console.log('✓ Forked simulation ready (sub-5ms validation enabled)');
    } catch (e) {
      console.warn('Forked simulation unavailable, using standard simulation:', e);
      forkedSimulator = null;
    }  }

  private async subscribeToProgramLogs(): Promise<void> {
    for (const programId of CONFIG.monitoringTargetPrograms) {
      this.connection.onLogs(programId, (logInfo) => {
        console.log(`Observed activity on ${programId.toString()} signature=${logInfo.signature}`);
      });
    }
  }

  private estimateCollateralPriceUsd(collateralMint: PublicKey): number {
    if (collateralMint.equals(TOKEN_MINTS.SOL)) {
      return 25.0;
    }
    return 1.0;
  }

  private collateralValueUsd(position: PositionInfo): number {
    return position.collateralAmount * this.estimateCollateralPriceUsd(position.collateralMint);
  }

  private isUndercollateralized(position: PositionInfo): boolean {
    const healthFactor = this.collateralValueUsd(position) / Math.max(position.debtAmountUsd, 1);
    return healthFactor < 1.0;
  }

  private estimateGasCostUsd(priceUsd: number): number {
    return (CONFIG.gasEstimateLamports / LAMPORTS_PER_SOL) * priceUsd;
  }

  private calculatePriorityFeeUsd(expectedProfitUsd: number): number {
    const tipUsd = Math.max(1.0, Math.min(0.01 * expectedProfitUsd, 5.0));
    return tipUsd;
  }

  private async fetchCandidatePositions(): Promise<PositionInfo[]> {
    const positions: PositionInfo[] = [];
    // Try to fetch from known monitoring programs (e.g., Solend, Marginfi)
    try {
      const { fetchSolendPositions } = await import('./solend-integration.js');
      for (const programId of CONFIG.monitoringTargetPrograms) {
        try {
          const p = await fetchSolendPositions(this.connection, programId);
          if (Array.isArray(p) && p.length) {
            positions.push(...p as PositionInfo[]);
          }
        } catch (e) {
          console.warn(`Failed to fetch positions for program ${programId.toString()}:`, e);
        }
      }
    } catch (e) {
      console.warn('Solend integration not available, using fallback mock positions. Error:', e);
      positions.push({
        borrower: new PublicKey('11111111111111111111111111111111'),
        collateralMint: TOKEN_MINTS.SOL,
        debtMint: TOKEN_MINTS.USDC,
        collateralAmount: 9.6,
        debtAmountUsd: 240,
        liquidationBonusPct: 0.05,
        collateralAccount: new PublicKey('11111111111111111111111111111112'),
        debtAccount: new PublicKey('11111111111111111111111111111113'),
        protocolName: 'Solend',
      });
    }

    return positions;
  }

  private async buildLiquidationInstruction(position: PositionInfo): Promise<TransactionInstruction> {
    const amountLamports = BigInt(Math.floor(position.collateralAmount * LAMPORTS_PER_SOL));
    const data = Buffer.alloc(9);
    data.writeUInt8(1, 0);
    data.writeBigUInt64LE(amountLamports, 1);

    return new TransactionInstruction({
      programId: CONFIG.liquidatorProgramId,
      keys: [
        { pubkey: position.collateralAccount, isSigner: false, isWritable: true },
        { pubkey: position.debtAccount, isSigner: false, isWritable: true },
        { pubkey: position.borrower, isSigner: false, isWritable: false },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  private buildComputeBudgetInstruction(): TransactionInstruction | null {
    if (!CONFIG.computeUnitLimit || CONFIG.computeUnitLimit <= 0) {
      return null;
    }
    return ComputeBudgetProgram.setComputeUnitLimit({ units: CONFIG.computeUnitLimit });
  }

  private buildJitoTipInstruction(): TransactionInstruction | null {
    if (!CONFIG.jitoTipAccount || CONFIG.jitoTipAmountLamports <= 0) {
      return null;
    }

    // In production, dynamically adjust tip based on feeMonitor congestion data
    const adjustedTip = this.calculateDynamicJitoTip();
    feeMonitor.addFee(adjustedTip);

    return SystemProgram.transfer({
      fromPubkey: this.wallet.publicKey,
      toPubkey: CONFIG.jitoTipAccount,
      lamports: BigInt(adjustedTip),
    });
  }

  private calculateDynamicJitoTip(): number {
    // Base tip from config or monitor's suggestion
    let tip = CONFIG.jitoTipAmountLamports;

    // If we have recent fee history, scale based on observed congestion
    const recentFees = feeMonitor.getRecentFees();
    if (recentFees.length > 10) {
      const medianFee = feeMonitor.getMedianFee();
      const peakFee = feeMonitor.getPeakFee();
      const avgFee = feeMonitor.getAverageFee();

      // If peak is 2x median, increase our tip by 50%
      if (peakFee > medianFee * 2) {
        tip = Math.floor(tip * 1.5);
      }
      // If average is already high, be even more aggressive
      if (avgFee > 50000) {
        tip = Math.floor(tip * 2.0);
      }
    }

    return tip;
  }

  private async buildAtomicLiquidationAndSwapTransaction(
    position: PositionInfo,
    quote: JupiterQuote,
  ): Promise<Transaction | null> {
    const swapTransaction = await buildJupiterSwapTransaction(quote, this.wallet.publicKey, CONFIG.slippageBps);
    if (!swapTransaction) {
      return null;
    }

    const liquidationInstruction = await this.buildLiquidationInstruction(position);
    const combined = new Transaction({
      feePayer: this.wallet.publicKey,
      recentBlockhash: swapTransaction.recentBlockhash,
    });

    const computeBudgetIx = this.buildComputeBudgetInstruction();
    if (computeBudgetIx) {
      combined.add(computeBudgetIx);
    }

    combined.add(liquidationInstruction, ...swapTransaction.instructions);

    const tipIx = this.buildJitoTipInstruction();
    if (tipIx) {
      combined.add(tipIx);
    }

    combined.sign(this.wallet);
    return combined;
  }

  private async simulateTransaction(transaction: Transaction): Promise<{ ok: boolean; logs: string[]; units?: number }> {
    const connectionToUse = this.privateConnection || this.connection;
    try {
      // Use forked simulator if available for sub-5ms validation
      if (forkedSimulator) {
        const simResult = await forkedSimulator.simulateSolanaTransaction(transaction);
        const logs = simResult.revert ? [`ERROR: ${simResult.revert}`] : [];
        return { ok: simResult.success, logs, units: simResult.computeUnitsUsed };
      }

      const simulated = await connectionToUse.simulateTransaction(transaction);
      const logs: string[] = simulated.value?.logs || [];
      let units: number | undefined = undefined;

      // Try to parse compute units from logs using common patterns
      for (const l of logs) {
        const m1 = /([0-9]+)\s+compute units/i.exec(l);
        const m2 = /consumed[: ]+([0-9]+)/i.exec(l);
        if (m1) { units = Number(m1[1]); break; }
        if (m2) { units = Number(m2[1]); break; }
      }

      return { ok: simulated.value?.err == null, logs, units };
    } catch (e) {
      console.error('Simulation failed', e);
      return { ok: false, logs: [] };
    }
  }

  private estimatePriorityFeeUsdFromUnits(units: number | undefined, collateralPriceUsd: number): number {
    if (!units) return 0;
    const lamportsPerUnit = Number(process.env.COMPUTE_UNIT_LAMPORTS) || 10; // configurable
    const lamports = units * lamportsPerUnit;
    const sol = lamports / LAMPORTS_PER_SOL;
    return sol * collateralPriceUsd;
  }

  private async submitTransaction(transaction: Transaction): Promise<string> {
    const raw = transaction.serialize();
    const connectionToUse = this.privateConnection || this.connection;
    if (connectionToUse === this.privateConnection) {
      console.log('Submitting transaction through private Solana RPC / Jito endpoint.');
    }

    const signature = await connectionToUse.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    await connectionToUse.confirmTransaction(signature, 'confirmed');
    return signature;
  }

  private calculateNetProfitUsd(position: PositionInfo, quote: JupiterQuote): number {
    const route = quote.data[0];
    const swapOutUsd = Number(route.outAmount) / 1_000_000;
    const estimatedGasUsd = this.estimateGasCostUsd(this.estimateCollateralPriceUsd(position.collateralMint));
    const priorityFeeUsd = this.calculatePriorityFeeUsd(swapOutUsd);
    return swapOutUsd - position.debtAmountUsd - estimatedGasUsd - priorityFeeUsd;
  }

  private logCongestionAnalysis(expectedProfitLamports: number): void {
    // Log dynamic bribe analysis for Solana
    const recentFees = feeMonitor.getRecentFees();
    if (recentFees.length > 5) {
      const medianFee = feeMonitor.getMedianFee();
      const avgFee = feeMonitor.getAverageFee();
      const peakFee = feeMonitor.getPeakFee();

      console.log(`\n=== Dynamic Bribe Analysis (Solana/Jito) ===`);
      console.log(`Recent Median Tip: ${medianFee} lamports`);
      console.log(`Recent Average Tip: ${avgFee} lamports`);
      console.log(`Recent Peak Tip: ${peakFee} lamports`);

      const dynamicTip = this.calculateDynamicJitoTip();
      const tipPercent = (dynamicTip / expectedProfitLamports) * 100;
      console.log(`Recommended Dynamic Tip: ${dynamicTip} lamports (${tipPercent.toFixed(2)}% of profit)`);
      console.log(`Tip Floor Multiplier: ${dynamicTip / CONFIG.jitoTipAmountLamports}x\n`);
    }
  }

  public async run(): Promise<void> {
    await this.initialize();
    await this.subscribeToProgramLogs();

    while (true) {
      try {
        const candidates = await this.fetchCandidatePositions();

        for (const position of candidates) {
          if (!this.isUndercollateralized(position)) {
            continue;
          }

          const quote = await findOptimalSwapRoute(
            position.collateralMint,
            TOKEN_MINTS.USDC,
            Math.floor(position.collateralAmount * LAMPORTS_PER_SOL),
            CONFIG.slippageBps,
            CONFIG.maxPriceImpactPct,
          );

          if (!quote) {
            console.log('No viable Jupiter route found for candidate position.');
            continue;
          }

          const netProfitUsd = this.calculateNetProfitUsd(position, quote);
          if (netProfitUsd < CONFIG.minProfitThresholdUsd) {
            console.log(`Candidate found but net profit ${netProfitUsd.toFixed(2)} USD is below threshold.`);
            continue;
          }

          console.log(`Liquidation opportunity: expected ${netProfitUsd.toFixed(2)} USD profit.`);
          const transaction = await this.buildAtomicLiquidationAndSwapTransaction(position, quote);
          if (!transaction) {
            console.log('Failed to build atomic transaction.');
            continue;
          }

          // Log dynamic bribe analysis before submission
          const expectedProfitLamports = Math.floor(netProfitUsd * LAMPORTS_PER_SOL / 25); // rough estimate
          this.logCongestionAnalysis(expectedProfitLamports);

          const signature = await this.submitTransaction(transaction);
          console.log(`Submitted liquidation bundle: ${signature}`);
        }

        await new Promise((resolve) => setTimeout(resolve, CONFIG.pollIntervalMs));
      } catch (error) {
        console.error('Polling error:', error);
        await new Promise((resolve) => setTimeout(resolve, CONFIG.pollIntervalMs * 2));
      }
    }
  }
}

