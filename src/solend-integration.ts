import { Connection, PublicKey } from '@solana/web3.js';
import { fetchObligationsByWallet } from '@solendprotocol/solend-sdk';
import { TOKEN_MINTS } from './jupiter-integration.js';
import type { PositionInfo } from './liquidation-bot.js';

const SOLEND_PROGRAM_ID = new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');
const MARGINFI_PROGRAM_ID = new PublicKey('mfmiuQuxaea2VDvDvQ81Sx1gyYyj3HF9awx1mQtuCsr');
const SOLANA_MONITOR_WALLETS = process.env.SOLANA_MONITOR_WALLETS
  ? process.env.SOLANA_MONITOR_WALLETS.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => new PublicKey(entry))
  : [];
const DEFAULT_LIQUIDATION_BONUS_PCT = 0.05;
const USD_SCALE = 1_000_000;

function parseUsdValue(value: { toString(): string }): number {
  return Number(value.toString()) / USD_SCALE;
}

function getProtocolName(programId: PublicKey): string {
  if (programId.equals(SOLEND_PROGRAM_ID)) return 'Solend';
  if (programId.equals(MARGINFI_PROGRAM_ID)) return 'Marginfi';
  return 'SolanaLending';
}

function buildPositionFromObligation(obligation: any, protocolName: string): PositionInfo {
  const debtAmountUsd = parseUsdValue(obligation.info.borrowedValue);
  const collateralAmount = parseUsdValue(obligation.info.depositedValue);

  return {
    borrower: obligation.info.owner,
    collateralMint: TOKEN_MINTS.SOL,
    debtMint: TOKEN_MINTS.USDC,
    collateralAmount,
    debtAmountUsd,
    liquidationBonusPct: DEFAULT_LIQUIDATION_BONUS_PCT,
    collateralAccount: obligation.pubkey,
    debtAccount: obligation.pubkey,
    protocolName,
  };
}

function isUndercollateralized(obligation: any): boolean {
  const debtAmountUsd = parseUsdValue(obligation.info.borrowedValue);
  const allowedBorrowUsd = parseUsdValue(obligation.info.allowedBorrowValue);
  return debtAmountUsd > 0 && debtAmountUsd >= allowedBorrowUsd;
}

export async function fetchSolendPositions(connection: Connection, programId: PublicKey) {
  if (SOLANA_MONITOR_WALLETS.length === 0) {
    console.warn('SOLANA_MONITOR_WALLETS is not configured. No wallet obligations will be monitored.');
    return [];
  }

  const protocolName = getProtocolName(programId);
  const positions: PositionInfo[] = [];

  for (const walletPubkey of SOLANA_MONITOR_WALLETS) {
    try {
      const obligations = await fetchObligationsByWallet(walletPubkey, connection, programId.toString(), true);
      for (const obligation of obligations) {
        if (isUndercollateralized(obligation)) {
          positions.push(buildPositionFromObligation(obligation, protocolName));
        }
      }
    } catch (error: any) {
      console.warn(`Failed to fetch obligations for wallet ${walletPubkey.toString()}:`, error?.message ?? error);
    }
  }

  return positions;
}
