import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();
const ETH_WS = process.env.ETH_WS || 'wss://mainnet.infura.io/ws/v3/YOUR_INFURA_KEY';
export function startPendingTxWatcher(onPendingTx) {
    const provider = new ethers.providers.WebSocketProvider(ETH_WS);
    provider.on('pending', async (txHash) => {
        try {
            // Notify caller to fetch and inspect tx details
            await onPendingTx(txHash);
        }
        catch (e) {
            console.error('Error processing pending tx', txHash, e);
        }
    });
    provider._websocket.on('error', (err) => {
        console.error('WebSocket error', err);
    });
    provider._websocket.on('close', (code) => {
        console.warn('WebSocket closed, code=', code);
        // Reconnect logic could be added here
    });
    console.log('Started Ethereum mempool pending tx watcher');
    return provider;
}
export async function inspectPendingTx(provider, txHash) {
    const tx = await provider.getTransaction(txHash);
    if (!tx)
        return null;
    // Simple heuristic: check if tx touches known oracle contracts
    // This list should be populated with actual oracle addresses used by target protocols
    const ORACLES = [
        '0x0000000000000000000000000000000000000000',
    ].map((a) => a.toLowerCase());
    if (tx.to && ORACLES.includes(tx.to.toLowerCase())) {
        return { type: 'oracle', tx };
    }
    return { type: 'other', tx };
}
