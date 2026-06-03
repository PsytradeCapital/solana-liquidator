import { providers, Wallet } from 'ethers';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';
import dotenv from 'dotenv';
dotenv.config();
const ETH_RPC = process.env.ETH_RPC || 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY';
const RELAY_SIGNER_PRIVATE_KEY = process.env.RELAY_SIGNER_PRIVATE_KEY || '';
const SEARCHER_PRIVATE_KEY = process.env.SEARCHER_PRIVATE_KEY || '';
async function createFlashbotsProvider() {
    const provider = new providers.JsonRpcProvider(ETH_RPC);
    const relaySigner = new Wallet(RELAY_SIGNER_PRIVATE_KEY, provider);
    const flashbotsProvider = await FlashbotsBundleProvider.create(provider, relaySigner);
    return { provider, flashbotsProvider };
}
export async function sendPrivateBundle(rawTxHexes, targetBlockNumber) {
    if (!RELAY_SIGNER_PRIVATE_KEY || !SEARCHER_PRIVATE_KEY) {
        throw new Error('Missing RELAY_SIGNER_PRIVATE_KEY or SEARCHER_PRIVATE_KEY in env');
    }
    const { provider, flashbotsProvider } = await createFlashbotsProvider();
    const bundle = rawTxHexes.map((signedTransaction) => ({ signedTransaction }));
    const blockNumber = targetBlockNumber ?? (await provider.getBlockNumber()) + 1;
    const result = await flashbotsProvider.sendBundle(bundle, blockNumber);
    if (result == null) {
        throw new Error('Flashbots bundle submission returned no result');
    }
    if (typeof result.wait === 'function') {
        const simulation = await result.wait();
        return { blockNumber, simulation };
    }
    if (result.error) {
        throw new Error(`Flashbots relay error: ${result.error.message ?? JSON.stringify(result.error)}`);
    }
    return { blockNumber, simulation: null };
}
export async function exampleUsage() {
    console.log('Flashbots helper loaded. Configure env and implement example as needed.');
}
const mainUrl = import.meta.url;
const isExecutedDirectly = mainUrl === new URL(process.argv[1], import.meta.url).href;
if (isExecutedDirectly) {
    exampleUsage().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
