import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_MINTS } from './jupiter-integration.js';
import type { PositionInfo } from './liquidation-bot.js';

const SOLEND_PROGRAM_ID = new PublicKey('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');
const MARGINFI_PROGRAM_ID = new PublicKey('mfmiuQuxaea2VDvDvQ81Sx1gyYyj3HF9awx1mQtuCsr');

/**
 * Mock position generator for fallback scanning.
 * In production, the Solend SDK's parseObligation() and state decoders should be used.
 */
function mkMockPosition(acc: PublicKey, protocolName: string): PositionInfo {
  return {
    borrower: acc,
    collateralMint: TOKEN_MINTS.SOL,
    debtMint: TOKEN_MINTS.USDC,
    collateralAmount: 1.0,
    debtAmountUsd: 100.0,
    liquidationBonusPct: 0.05,
    collateralAccount: acc,
    debtAccount: acc,
    protocolName,
  };
}

/**
 * Fetch lending positions from Solend/Marginfi protocols.
 * Currently uses fallback account scanning due to RPC scan limits.
 * For production, integrate @solendprotocol/solend-sdk with parseObligation().
 */
export async function fetchSolendPositions(connection: Connection, programId: PublicKey) {
  console.log(`Fetching positions from ${programId.toString()}...`);
  console.log('Using fallback account scan for Solend/Marginfi positions. For production, install @solendprotocol/solend-sdk with proper obligation parsing.');

  try {
    const accounts = await connection.getProgramAccounts(programId, { commitment: 'confirmed' });
    console.log(`Found ${accounts.length} accounts for ${programId.toString()}`);
    return accounts.slice(0, 50).map((account) => mkMockPosition(account.pubkey, programId.equals(SOLEND_PROGRAM_ID) ? 'Solend' : 'Marginfi'));
  } catch (error: any) {
    const message = String(error?.message ?? error);
    if (message.includes('scan aborted') || message.includes('accumulated scan results exceeded the limit')) {
      console.warn('Program account scan exceeded RPC limits; returning no candidate positions for this protocol.');
      return [];
    }
    throw error;
  }
}
