// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

// Optimized Rube protocol liquidation helper. This contract is illustrative and must be audited before production.

contract Liquidator {
    address public owner;
    uint256 public totalExecutedProfit;

    error NotOwner();
    error NotProfitable();
    error ZeroAmount();
    error InvalidBatchLength();
    error ProfitTooLow(uint256 profit, uint256 minProfit);

    event LiquidationExecuted(address indexed target, uint256 profit);
    event BatchLiquidation(uint256 totalProfit, uint256 timestamp);
    event Withdraw(address indexed to, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    receive() external payable {}

    function batchLiquidate(address[] calldata targets, bytes[] calldata data, uint256 minProfit) external onlyOwner {
        uint256 count = targets.length;
        if (count == 0) revert ZeroAmount();
        if (count != data.length) revert InvalidBatchLength();

        uint256 totalProfit = 0;
        for (uint256 i = 0; i < count; ++i) {
            totalProfit += _liquidate(targets[i], data[i], minProfit);
        }

        if (totalProfit < minProfit) revert ProfitTooLow(totalProfit, minProfit);
        totalExecutedProfit += totalProfit;
        emit BatchLiquidation(totalProfit, block.timestamp);
    }

    function _liquidate(address target, bytes calldata payload, uint256 minProfit) internal returns (uint256 profit) {
        (bool ok, bytes memory ret) = target.call(payload);
        if (!ok) revert NotProfitable();

        profit = _decodeUint256(ret);
        if (profit < minProfit) revert ProfitTooLow(profit, minProfit);

        emit LiquidationExecuted(target, profit);
    }

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        uint256 balance = address(this).balance;
        if (amount > balance) amount = balance;
        (bool sent, ) = to.call{value: amount}('');
        if (!sent) revert NotProfitable();
        emit Withdraw(to, amount);
    }

    function _decodeUint256(bytes memory data) internal pure returns (uint256 value) {
        if (data.length < 32) revert NotProfitable();
        assembly {
            value := mload(add(data, 32))
        }
    }

    function isUndercollateralized(uint256 debt, uint256 collateral, uint256 threshold) public pure returns (bool) {
        assembly {
            if iszero(collateral) { revert(0, 0) }
            let numerator := mul(debt, 0x3782dace9d900000)
            let ratio := div(numerator, collateral)
            mstore(0x00, gt(ratio, threshold))
            return(0x00, 0x20)
        }
    }
}
