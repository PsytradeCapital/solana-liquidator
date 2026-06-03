# Infrastructure Guide for Ultra-Low-Latency MEV Bot on Solana

## Hardware Requirements

### Minimum Specifications
- CPU: AMD Ryzen 9 5950X or Intel Core i9-12900K (16+ cores recommended)
- RAM: 64GB DDR4 ECC
- Storage: 2TB NVMe SSD (PCIe 4.0)
- Network: 10Gbps Ethernet connection

### Recommended Specifications for High-Frequency Trading
- CPU: Dual AMD EPYC 7763 or Intel Xeon Platinum 8358 (64+ cores total)
- RAM: 128GB-256GB DDR4 ECC
- Storage: 4TB NVMe SSD in RAID 1 configuration
- Network: Dual 25Gbps or 100Gbps Ethernet
- Optional: FPGA acceleration for signature verification

## Geographic Server Placement Strategies

### Key Considerations
1. **Proximity to Validators**: Place servers near major Solana validators to minimize network latency
2. **Exchange Proximity**: Consider proximity to major SERUM order books if applicable
3. **Regulatory Jurisdiction**: Choose locations with favorable crypto regulations

### Recommended Locations
- **Primary**: Ashburn, Virginia (Equinix EB2) - Major internet hub with low latency to East Coast validators
- **Secondary**: Chicago, Illinois (Equinix CH1) - Good for Midwest validator connections
- **Tertiary**: Los Angeles, California (Equinix LA2) - West Coast validator proximity
- **International**: Frankfurt, Germany (Equinix FR1) - European validator access
- **Asia-Pacific**: Singapore (Equinix SG1) - Asian validator access

### Validator Node Distribution (as of 2024)
- Concentrated in: US East Coast, US West Coast, Europe (Frankfurt, London), Asia (Singapore, Tokyo)
- Ideal placement: Within 10-20ms of major validator clusters

## Setting Up a Dedicated Private RPC Node

### Software Requirements
- OS: Ubuntu 22.04 LTS (minimal installation)
- Solana Software: v1.14.11 or later
- Dependencies: build-essential, pkg-config, libssl-dev, libudev

### Installation Steps

1. **System Preparation**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y build-essential pkg-config libssl-dev libudev-dev

# Install Rust (required for Solana)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env
```

2. **Install Solana Suite**
```bash
# Install Solana release
sh -c "$(curl -sSfL https://release.solana.com/v1.14.11/install)"

# Add Solana to PATH
export PATH="/home/$USER/.local/share/solana/install/active_release/bin:$PATH"

# Verify installation
solana --version
# Should show: solana-cli 1.14.11
```

3. **Configure Validator/RPC Node**
```bash
# Create configuration directory
mkdir -p ~/solana/validator ~/solana/rpc

# Generate identity keypair
solana-keygen new -o ~/solana/validator/identity.json

# Create vote account
solana-keygen new -o ~/solana/validator/vote-account.json

# Create authorized withdrawer keypair
solana-keygen new -o ~/solana/validator/authorized-withdrawer.json
```

4. **RPC Node Configuration (Recommended for MEV Bot)**
Create `~/solana/rpc/config.toml`:
```toml
# RPC Node Configuration for MEV Bot
rpc_port = 8899
pubsub_port = 8900

# Enable features needed for MEV
enable_rpc_transaction_history = true
enable_cpi_and_log_storage = true

# Performance optimizations
limit_ledger_size = 50000000  # 50MB ledger
max_transactions_per_account = 100
extra_account_lifetime = 1000000

# TPU settings for faster processing
tpu_coalesce_ms = 2
tpu_coalesce_signers_count_limit = 1000

# Logging
log_level = "info"
```

5. **Start the RPC Node**
```bash
# Start Solana RPC node (non-validating)
solana-validator \
  --identity ~/solana/validator/identity.json \
  --vote-account ~/solana/validator/vote-account.json \
  --authorized-voter ~/solana/validator/identity.json \
  --authorized-withdrawer ~/solana/validator/authorized-withdrawer.json \
  --rpc-port 8899 \
  --pubsub-port 8900 \
  --enable-rpc-transaction-history \
  --enable-cpi-and-log-storage \
  --no-wait-for-vote-to-start-root \
  --no-genesis-fetch \
  --entrypoint entrypoint.mainnet-beta.solana.com:8001 \
  --expected-genesis-hash 5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d \
  --ledger ~/solana/validator/ledger \
  --logs ~/solana/validator/logs \
  --limit-ledger-size
```

### Performance Optimization Flags

#### Critical Flags for MEV Bots
- `--no-wait-for-vote-to-start-root`: Start processing immediately
- `--no-genesis-fetch`: Skip genesis fetch if ledger exists
- `--limit-ledger-size`: Prevent ledger from growing too large
- `--rpc-bind-address`: Bind to specific interface (use localhost for security)
- `--only-known-rpc`: Only serve RPC from known networks (security)

#### System-Level Optimizations
1. **Kernel Parameters** (/etc/sysctl.conf):
```bash
# Increase network buffers
net.core.rmem_max = 2500000
net.core.wmem_max = 2500000
net.ipv4.tcp_rmem = 4096 87380 2500000
net.ipv4.tcp_wmem = 4096 65536 2500000

# Reduce TCP latency
net.ipv4.tcp_low_latency = 1
net.ipv4.tcp_fastopen = 3

# Increase file descriptors
fs.file-max = 1000000
```

2. **CPU Governor**:
```bash
# Set to performance mode
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor
```

3. **Network IRQ Affinity**:
- Distribute network interrupts across CPU cores
- Use `ethtool` to configure NIC settings

## Monitoring and Maintenance

### Essential Monitoring Metrics
- Node latency to validators (should be <50ms)
- Block propagation time
- Transaction confirmation rate
- CPU/memory/disk utilization
- Network packet loss

### Recommended Monitoring Tools
- Prometheus + Grafana for metrics
- ELK stack for log aggregation
- Custom Solana RPC latency checker
- GPU/CPU temperature monitoring

### Regular Maintenance Tasks
1. **Daily**: Check logs for errors, verify block production
2. **Weekly**: Update Solana software, check disk space
3. **Monthly**: Review security logs, rotate keys if needed
4. **Quarterly**: Hardware diagnostics, network performance testing

## Security Considerations

### Network Security
- Firewall: Only allow necessary ports (8899 for RPC, 8900 for PubSub)
- Use private networking between bot and RPC node
- Consider VPN for remote access

### Wallet Security
- Use hardware wallets for significant funds
- Implement multi-signature for withdrawals
- Store keys in HSM or secure enclave

### Software Security
- Keep Solana software updated
- Regular dependency audits
- Run bot with least privilege principles

## Cost Estimates

### Monthly Costs (Approximate)
- Cloud instance (c6i.4xlarge equivalent): $400-$600
- Premium bandwidth: $100-$200
- Storage/backups: $50-$100
- Monitoring/services: $50-$150
- **Total**: $600-$1050/month

### Bare Metal Alternative
- Initial hardware: $3000-$5000
- Colocation (1U, 10Gbps): $150-$300/month
- Bandwidth: $50-$150/month
- **Total**: $200-$450/month after initial investment

## Troubleshooting Common Issues

### High Latency
- Check geographic placement
- Verify network routing (use mtr/traceroute)
- Check for ISP throttling
- Consider upgrading network tier

### Dropped Transactions
- Increase compute unit price in transactions
- Check RPC node performance
- Verify network connectivity
- Consider using multiple RPC endpoints

### Node Synchronization Problems
- Check ledger for corruption
- Verify genesis hash matches
- Ensure sufficient disk I/O performance
- Consider snapshot synchronization

## References
- Solana Documentation: https://docs.solana.com/
- Validator Guide: https://docs.solana.com/running-validator/validator-start
- RPC Node Configuration: https://docs.solana.com/developing/clients/jsonrpc-api#configuration
- Meganelabs RPC Tips: https://medium.com/@meganelabs