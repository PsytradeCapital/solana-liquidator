import { BigNumber } from 'ethers';
import { PublicKey } from '@solana/web3.js';
/**
 * Ethereum Chainlink oracle tracker
 */
export class ChainlinkOracleMonitor {
    constructor() {
        this.aggregatorAddresses = new Map();
        this.lastSeenPrices = new Map();
        // Common Chainlink aggregators on mainnet
        this.aggregatorAddresses.set('0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', {
            symbol: 'ETH/USD',
            address: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
        });
        this.aggregatorAddresses.set('0xF4030086522a5bEEa4988F8cA5B36dbC97beE88c', {
            symbol: 'BTC/USD',
            address: '0xF4030086522a5bEEa4988F8cA5B36dbC97beE88c',
        });
        this.aggregatorAddresses.set('0x8fFfFfd4AfB6115b954bd242c08266AF629033B9', {
            symbol: 'USDC/USD',
            address: '0x8fFfFfd4AfB6115b954bd242c08266AF629033B9',
        });
    }
    async detectPriceUpdates(provider, txData) {
        const updates = [];
        // Try to decode Chainlink price update transactions
        // Chainlink transmit function signature: 0xc91b3754 (updateRoundData)
        if (txData.startsWith('0xc91b3754')) {
            try {
                // Extract oracle address from tx to field (if available)
                // Price updates are typically in call data
                const priceHex = txData.slice(138, 202); // Typical price position in calldata
                const newPrice = BigNumber.from('0x' + priceHex);
                updates.push({
                    chainId: 'ethereum',
                    oracleAddress: 'unknown',
                    tokenSymbol: 'MIXED',
                    previousPrice: BigNumber.from(0),
                    newPrice,
                    priceChangePercent: 0, // Would calculate if we had previous
                    timestamp: Date.now(),
                    confidence: 'medium',
                });
            }
            catch (e) {
                // Silently skip unparseable updates
            }
        }
        return updates;
    }
    addAggregator(address, symbol) {
        this.aggregatorAddresses.set(address.toLowerCase(), { symbol, address });
    }
    getAggregators() {
        return Array.from(this.aggregatorAddresses.values());
    }
}
/**
 * Pyth network oracle tracker for both chains
 */
export class PythOracleMonitor {
    constructor() {
        this.pythProgramId = new PublicKey('PriceFunctions11111111111111111111111111111');
        this.trackingPriceIds = new Map(); // priceId -> symbol
        // Common Pyth price IDs (use actual mainnet IDs in production)
        this.trackingPriceIds.set('0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', 'ETH/USD');
        this.trackingPriceIds.set('0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e641a6f6ce88f', 'BTC/USD');
        this.trackingPriceIds.set('0x8ac0c70fff57e9aefdf5eabd8a9a5724d8480737f4955be967ee29ca2e37e445', 'SOL/USD');
    }
    async detectSolanaPythUpdates(connection, txSignature) {
        try {
            const tx = await connection.getParsedTransaction(txSignature);
            if (!tx || !tx.transaction.message.instructions) {
                return [];
            }
            const updates = [];
            for (const ix of tx.transaction.message.instructions) {
                // Look for Pyth program interactions
                if ('programId' in ix && ix.programId.toString() === this.pythProgramId.toString()) {
                    // In production, parse actual Pyth instruction data
                    updates.push({
                        chainId: 'solana',
                        oracleAddress: 'pyth',
                        tokenSymbol: 'MIXED',
                        previousPrice: 0,
                        newPrice: 0,
                        priceChangePercent: 0,
                        timestamp: Date.now(),
                        txHash: txSignature,
                        confidence: 'high',
                    });
                }
            }
            return updates;
        }
        catch (e) {
            return [];
        }
    }
    addPriceId(priceId, symbol) {
        this.trackingPriceIds.set(priceId.toLowerCase(), symbol);
    }
    getPriceIds() {
        return new Map(this.trackingPriceIds);
    }
}
/**
 * Switchboard oracle tracker for Solana
 */
export class SwitchboardOracleMonitor {
    constructor() {
        this.switchboardProgramId = new PublicKey('SW1TCHvHkhiDvvCu9ct42Mp8AXohjKc3ZNi5JAKc7Jw');
        this.feedAddresses = new Map(); // feed -> symbol
    }
    async detectSwitchboardUpdates(connection, txSignature) {
        try {
            const tx = await connection.getParsedTransaction(txSignature);
            if (!tx || !tx.transaction.message.instructions) {
                return [];
            }
            const updates = [];
            for (const ix of tx.transaction.message.instructions) {
                if ('programId' in ix && ix.programId.toString() === this.switchboardProgramId.toString()) {
                    updates.push({
                        chainId: 'solana',
                        oracleAddress: 'switchboard',
                        tokenSymbol: 'MIXED',
                        previousPrice: 0,
                        newPrice: 0,
                        priceChangePercent: 0,
                        timestamp: Date.now(),
                        txHash: txSignature,
                        confidence: 'high',
                    });
                }
            }
            return updates;
        }
        catch (e) {
            return [];
        }
    }
    addFeed(feedAddress, symbol) {
        this.feedAddresses.set(feedAddress.toLowerCase(), symbol);
    }
    getFeeds() {
        return new Map(this.feedAddresses);
    }
}
/**
 * Integrated oracle monitor for both chains
 */
export class OracleMemoryMonitor {
    constructor() {
        this.recentUpdates = [];
        this.updateCallbacks = [];
        this.maxCacheSize = 1000;
        this.chainlinkMonitor = new ChainlinkOracleMonitor();
        this.pythMonitor = new PythOracleMonitor();
        this.switchboardMonitor = new SwitchboardOracleMonitor();
    }
    /**
     * Register callback for oracle updates
     */
    onOracleUpdate(callback) {
        this.updateCallbacks.push(callback);
    }
    /**
     * Process detected oracle update
     */
    async recordUpdate(update) {
        this.recentUpdates.push(update);
        if (this.recentUpdates.length > this.maxCacheSize) {
            this.recentUpdates.shift();
        }
        // Trigger all registered callbacks
        for (const callback of this.updateCallbacks) {
            try {
                await callback(update);
            }
            catch (e) {
                console.error('Oracle update callback error:', e);
            }
        }
    }
    /**
     * Scan Ethereum mempool for Chainlink updates
     */
    async scanEthereumMempoolForOracleUpdates(provider, txHash, txData) {
        return await this.chainlinkMonitor.detectPriceUpdates(provider, txData);
    }
    /**
     * Scan Solana transaction logs for Pyth updates
     */
    async scanSolanaMempoolForPythUpdates(connection, txSignature) {
        return await this.pythMonitor.detectSolanaPythUpdates(connection, txSignature);
    }
    /**
     * Scan Solana transaction logs for Switchboard updates
     */
    async scanSolanaMempoolForSwitchboardUpdates(connection, txSignature) {
        return await this.switchboardMonitor.detectSwitchboardUpdates(connection, txSignature);
    }
    /**
     * Get recent updates within time window
     */
    getRecentUpdates(windowMs = 60000) {
        const cutoff = Date.now() - windowMs;
        return this.recentUpdates.filter((u) => u.timestamp >= cutoff);
    }
    /**
     * Predict liquidation triggers from price update
     */
    predictLiquidationTrigger(update, positionsHealthFactors) {
        const affectedPositions = [];
        let maxThresholdBreach = 0;
        // Estimate health factor impact from price change
        const priceChangeImpact = Math.abs(update.priceChangePercent) / 100;
        for (const [positionId, hf] of positionsHealthFactors.entries()) {
            const newHf = hf - priceChangeImpact; // Rough estimate
            if (newHf < 1.0 && hf >= 1.0) {
                affectedPositions.push(positionId);
                maxThresholdBreach = Math.max(maxThresholdBreach, 1.0 - newHf);
            }
        }
        if (affectedPositions.length === 0) {
            return null;
        }
        // Urgency based on how close to liquidation
        let urgency = 'normal';
        if (maxThresholdBreach > 0.1)
            urgency = 'urgent';
        if (maxThresholdBreach > 0.2)
            urgency = 'immediate';
        return {
            oracleUpdate: update,
            affectedPositions,
            liquidationThresholdBreach: maxThresholdBreach,
            estimatedOpportunityUsd: 0, // Would calculate with position data
            urgency,
        };
    }
    addChainlinkAggregator(address, symbol) {
        this.chainlinkMonitor.addAggregator(address, symbol);
    }
    addPythPriceId(priceId, symbol) {
        this.pythMonitor.addPriceId(priceId, symbol);
    }
    addSwitchboardFeed(feedAddress, symbol) {
        this.switchboardMonitor.addFeed(feedAddress, symbol);
    }
}
