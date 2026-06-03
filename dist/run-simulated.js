import { SolanaLiquidationSearcher } from './liquidation-bot.js';
import { findOptimalSwapRoute, TOKEN_MINTS } from './jupiter-integration.js';
async function run() {
    console.log('Starting simulated run...');
    process.env.ALLOW_EPHEMERAL_WALLET = 'true';
    const bot = new SolanaLiquidationSearcher();
    const candidates = await bot.fetchCandidatePositions();
    console.log('Candidates (sample):', candidates.slice(0, 3));
    for (const c of candidates) {
        const quote = await findOptimalSwapRoute(c.collateralMint, TOKEN_MINTS.USDC, Math.floor(c.collateralAmount * 1e9), 30, 2.0);
        console.log('Quote:', quote?.data?.[0]);
        const net = bot.calculateNetProfitUsd ? bot.calculateNetProfitUsd(c, quote) : null;
        console.log('Estimated net profit USD:', net);
    }
}
run().catch((e) => { console.error(e); process.exit(1); });
