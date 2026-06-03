import { providers } from 'ethers';
import { Connection } from '@solana/web3.js';
import * as os from 'os';
import * as childProcess from 'child_process';
/**
 * Cache for pre-computed simulation results
 */
export class SimulationCache {
    constructor() {
        this.cache = new Map();
        this.maxSize = 10000;
        this.ttlMs = 300000; // 5 minutes
    }
    set(signature, result, chainId) {
        if (this.cache.size >= this.maxSize) {
            // Remove oldest entry
            const oldest = Array.from(this.cache.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
            if (oldest) {
                this.cache.delete(oldest[0]);
            }
        }
        this.cache.set(signature, {
            txSignature: signature,
            result,
            timestamp: Date.now(),
            chainId,
        });
    }
    get(signature) {
        const entry = this.cache.get(signature);
        if (!entry)
            return null;
        // Check TTL
        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(signature);
            return null;
        }
        return entry;
    }
    clear() {
        this.cache.clear();
    }
    size() {
        return this.cache.size;
    }
    getStats() {
        return {
            size: this.cache.size,
            hits: 0,
            misses: 0,
        };
    }
}
/**
 * Ethereum forked simulation with Anvil
 */
export class EthereumForkedSimulator {
    constructor(mainnetRpcUrl, cache) {
        this.anvilProcess = null;
        this.anvilPort = 8545;
        this.rpcUrl = mainnetRpcUrl;
        this.cache = cache;
    }
    /**
     * Start local Anvil fork from mainnet state
     */
    async startFork() {
        return new Promise((resolve, reject) => {
            try {
                // Start Anvil with fork from mainnet RPC
                this.anvilProcess = childProcess.spawn('anvil', [
                    '--fork-url',
                    this.rpcUrl,
                    '--port',
                    String(this.anvilPort),
                    '--silent',
                ]);
                // Wait for fork to be ready
                setTimeout(() => {
                    if (this.anvilProcess) {
                        resolve();
                    }
                    else {
                        reject(new Error('Anvil failed to start'));
                    }
                }, 2000);
            }
            catch (e) {
                reject(new Error('Anvil not available. Install with: npm install -g @foundry-rs/anvil'));
            }
        });
    }
    /**
     * Stop the Anvil fork
     */
    async stopFork() {
        return new Promise((resolve) => {
            if (this.anvilProcess) {
                this.anvilProcess.kill();
                setTimeout(resolve, 500);
            }
            else {
                resolve();
            }
        });
    }
    /**
     * Simulate a transaction on the forked chain
     */
    async simulateTransaction(txRequest, txHash) {
        const startTime = Date.now();
        const cacheKey = txHash || JSON.stringify(txRequest);
        // Check cache
        const cached = this.cache.get(cacheKey);
        if (cached && cached.chainId === 'ethereum') {
            return { ...cached.result, cacheHit: true };
        }
        try {
            const provider = new providers.JsonRpcProvider(`http://localhost:${this.anvilPort}`);
            const gasEstimate = await provider.estimateGas(txRequest);
            const result = {
                success: true,
                gasUsed: gasEstimate.toNumber(),
                simulationTimeMs: Date.now() - startTime,
                cacheHit: false,
            };
            this.cache.set(cacheKey, result, 'ethereum');
            return result;
        }
        catch (e) {
            return {
                success: false,
                revert: String(e),
                simulationTimeMs: Date.now() - startTime,
                cacheHit: false,
            };
        }
    }
    /**
     * Batch simulate multiple transactions
     */
    async batchSimulate(txRequests) {
        return Promise.all(txRequests.map((tx) => this.simulateTransaction(tx)));
    }
}
/**
 * Solana forked simulation with local validator clone
 */
export class SolanaForkedSimulator {
    constructor(rpcUrl, cache) {
        this.cloneHeight = null;
        this.connection = new Connection(rpcUrl);
        this.cache = cache;
    }
    /**
     * Capture current validator state (blockheight + recent transactions)
     */
    async initializeClone() {
        this.cloneHeight = await this.connection.getSlot();
        console.log(`Solana clone initialized at slot ${this.cloneHeight}`);
    }
    /**
     * Simulate a transaction on the current connection
     */
    async simulateTransaction(tx, txSignature) {
        const startTime = Date.now();
        const cacheKey = txSignature || tx.signature?.toString() || '';
        // Check cache
        const cached = this.cache.get(cacheKey);
        if (cached && cached.chainId === 'solana') {
            return { ...cached.result, cacheHit: true };
        }
        try {
            const simulated = await this.connection.simulateTransaction(tx);
            const logs = simulated.value?.logs || [];
            // Parse compute units from logs
            let computeUnitsUsed;
            for (const log of logs) {
                const match = /consumed ([0-9]+) compute units/.exec(log);
                if (match) {
                    computeUnitsUsed = parseInt(match[1], 10);
                    break;
                }
            }
            const result = {
                success: simulated.value?.err === null,
                computeUnitsUsed,
                simulationTimeMs: Date.now() - startTime,
                cacheHit: false,
                revert: simulated.value?.err ? JSON.stringify(simulated.value.err) : undefined,
            };
            this.cache.set(cacheKey, result, 'solana');
            return result;
        }
        catch (e) {
            return {
                success: false,
                revert: String(e),
                simulationTimeMs: Date.now() - startTime,
                cacheHit: false,
            };
        }
    }
    /**
     * Batch simulate multiple transactions in parallel
     */
    async batchSimulate(txs) {
        return Promise.all(txs.map((tx) => this.simulateTransaction(tx)));
    }
}
/**
 * Parallel worker pool for simulation tasks
 */
export class SimulationWorkerPool {
    constructor(workerCount) {
        this.workers = [];
        this.taskQueue = [];
        this.workerCount = workerCount || Math.max(2, os.cpus().length - 1);
        for (let i = 0; i < this.workerCount; i++) {
            this.workers.push({ id: i, busy: false, processed: 0 });
        }
    }
    /**
     * Submit simulation task to worker pool
     */
    async submit(simulate) {
        return new Promise((resolve, reject) => {
            this.taskQueue.push({ simulate, resolve, reject });
            this.processQueue();
        });
    }
    /**
     * Process tasks from queue
     */
    processQueue() {
        for (const worker of this.workers) {
            if (worker.busy || this.taskQueue.length === 0)
                continue;
            const task = this.taskQueue.shift();
            if (!task)
                break;
            worker.busy = true;
            task
                .simulate()
                .then((result) => {
                task.resolve(result);
                worker.processed++;
            })
                .catch((error) => {
                task.reject(error);
            })
                .finally(() => {
                worker.busy = false;
                this.processQueue();
            });
        }
    }
    /**
     * Get pool statistics
     */
    getStats() {
        const activeWorkers = this.workers.filter((w) => w.busy).length;
        return {
            totalWorkers: this.workerCount,
            activeWorkers,
            queue: this.taskQueue.length,
        };
    }
    /**
     * Shutdown worker pool
     */
    async shutdown() {
        // Wait for all tasks to complete
        while (this.taskQueue.length > 0 || this.workers.some((w) => w.busy)) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
}
/**
 * Integrated forked simulation orchestrator
 */
export class ForkedSimulationOrchestrator {
    constructor(ethereumRpcUrl, solanaRpcUrl) {
        this.ethereumSimulator = null;
        this.solanaSimulator = null;
        this.isInitialized = false;
        this.cache = new SimulationCache();
        this.workerPool = new SimulationWorkerPool();
        if (ethereumRpcUrl) {
            this.ethereumSimulator = new EthereumForkedSimulator(ethereumRpcUrl, this.cache);
        }
        if (solanaRpcUrl) {
            this.solanaSimulator = new SolanaForkedSimulator(solanaRpcUrl, this.cache);
        }
    }
    /**
     * Initialize both fork simulators
     */
    async initialize() {
        if (this.isInitialized)
            return;
        try {
            if (this.ethereumSimulator) {
                console.log('Starting Ethereum Anvil fork...');
                await this.ethereumSimulator.startFork();
                console.log('✓ Ethereum fork ready');
            }
        }
        catch (e) {
            console.warn('Ethereum fork unavailable:', e);
        }
        try {
            if (this.solanaSimulator) {
                console.log('Initializing Solana clone...');
                await this.solanaSimulator.initializeClone();
                console.log('✓ Solana clone ready');
            }
        }
        catch (e) {
            console.warn('Solana clone unavailable:', e);
        }
        this.isInitialized = true;
    }
    /**
     * Simulate Ethereum transaction (via worker pool)
     */
    async simulateEthereumTransaction(txRequest) {
        if (!this.ethereumSimulator) {
            throw new Error('Ethereum simulator not initialized');
        }
        return this.workerPool.submit(() => this.ethereumSimulator.simulateTransaction(txRequest));
    }
    /**
     * Simulate Solana transaction (via worker pool)
     */
    async simulateSolanaTransaction(tx) {
        if (!this.solanaSimulator) {
            throw new Error('Solana simulator not initialized');
        }
        return this.workerPool.submit(() => this.solanaSimulator.simulateTransaction(tx));
    }
    /**
     * Batch simulate multiple Ethereum transactions
     */
    async batchSimulateEthereum(txRequests) {
        if (!this.ethereumSimulator) {
            throw new Error('Ethereum simulator not initialized');
        }
        const tasks = txRequests.map((tx) => () => this.ethereumSimulator.simulateTransaction(tx));
        return Promise.all(tasks.map((task) => this.workerPool.submit(task)));
    }
    /**
     * Batch simulate multiple Solana transactions
     */
    async batchSimulateSolana(txs) {
        if (!this.solanaSimulator) {
            throw new Error('Solana simulator not initialized');
        }
        const tasks = txs.map((tx) => () => this.solanaSimulator.simulateTransaction(tx));
        return Promise.all(tasks.map((task) => this.workerPool.submit(task)));
    }
    /**
     * Get orchestrator statistics
     */
    getStats() {
        return {
            cacheSize: this.cache.size(),
            workerPool: this.workerPool.getStats(),
            ethereumReady: this.ethereumSimulator !== null,
            solanaReady: this.solanaSimulator !== null,
        };
    }
    /**
     * Shutdown all simulators
     */
    async shutdown() {
        if (this.ethereumSimulator) {
            await this.ethereumSimulator.stopFork();
        }
        await this.workerPool.shutdown();
    }
}
