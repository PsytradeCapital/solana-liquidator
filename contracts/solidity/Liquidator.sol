// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IWETH9 is IERC20 {
    function withdraw(uint256 wad) external;
}

interface IUniswapV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

contract Liquidator is IFlashLoanSimpleReceiver {
    address public immutable owner;
    address public immutable WETH;
    uint16 public builderFeeBps;
    bool private locked;

    error NotOwner();
    error Reentrancy();
    error InvalidBuilderFee(uint256 fee);
    error InvalidAmount();
    error UnsupportedBuilderFeeToken(address token);
    error FlashLoanFailed();
    error LiquidationFailed();
    error SwapFailed();
    error InsufficientProfit(uint256 netProfit, uint256 minProfit);
    error InsufficientOutput(uint256 output, uint256 minOutput);
    error BuilderPaymentFailed();
    error TransferFailed();
    error ZeroCollateralReceived();

    event FlashLoanExecuted(uint256 amount, uint256 premium, uint256 netProfit, uint256 builderFee);
    event BuilderFeeUpdated(uint16 feeBps);
    event Withdraw(address indexed to, uint256 amount);
    event WithdrawERC20(address indexed token, address indexed to, uint256 amount);

    constructor(address weth_) {
        owner = msg.sender;
        WETH = weth_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked) revert Reentrancy();
        locked = true;
        _;
        locked = false;
    }

    receive() external payable {}
    fallback() external payable {}

    function setBuilderFeeBps(uint16 feeBps) external onlyOwner {
        if (feeBps > 5000) revert InvalidBuilderFee(feeBps);
        builderFeeBps = feeBps;
        emit BuilderFeeUpdated(feeBps);
    }

    function executeFlashLiquidation(
        address pool,
        address debtAsset,
        uint256 debtAmount,
        address collateralAsset,
        address liquidationTarget,
        bytes calldata liquidationData,
        address swapRouter,
        uint24 swapFee,
        uint256 minDebtOut,
        uint256 minProfit
    ) external onlyOwner nonReentrant {
        if (debtAmount == 0 || swapRouter == address(0)) revert InvalidAmount();
        if (builderFeeBps > 0 && debtAsset != WETH) revert UnsupportedBuilderFeeToken(debtAsset);

        bytes memory params = abi.encode(
            pool,
            debtAsset,
            collateralAsset,
            liquidationTarget,
            liquidationData,
            swapRouter,
            swapFee,
            minDebtOut,
            minProfit
        );

        IPool(pool).flashLoanSimple(address(this), debtAsset, debtAmount, params, 0);
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address,
        bytes calldata params
    ) external returns (bool) {
        (
            address pool,
            address debtAsset,
            address collateralAsset,
            address liquidationTarget,
            bytes memory liquidationData,
            address swapRouter,
            uint24 swapFee,
            uint256 minDebtOut,
            uint256 minProfit
        ) = abi.decode(params, (address,address,address,address,bytes,address,uint24,uint256,uint256));

        if (msg.sender != pool) revert FlashLoanFailed();
        if (asset != debtAsset) revert FlashLoanFailed();

        uint256 collateralBefore = IERC20(collateralAsset).balanceOf(address(this));
        (bool ok, ) = liquidationTarget.call(liquidationData);
        if (!ok) revert LiquidationFailed();

        uint256 collateralReceived = _sub(IERC20(collateralAsset).balanceOf(address(this)), collateralBefore);
        if (collateralReceived == 0) revert ZeroCollateralReceived();

        uint256 amountOut = collateralReceived;
        if (collateralAsset != debtAsset) {
            _safeApprove(collateralAsset, swapRouter, collateralReceived);
            amountOut = IUniswapV3Router(swapRouter).exactInputSingle(
                IUniswapV3Router.ExactInputSingleParams({
                    tokenIn: collateralAsset,
                    tokenOut: debtAsset,
                    fee: swapFee,
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: collateralReceived,
                    amountOutMinimum: minDebtOut,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        if (amountOut < minDebtOut) revert InsufficientOutput(amountOut, minDebtOut);

        uint256 totalOwed = _add(amount, premium);
        if (amountOut <= totalOwed) revert InsufficientProfit(0, minProfit);

        uint256 grossProfit = _sub(amountOut, totalOwed);
        uint256 builderFee = _mulDiv(grossProfit, builderFeeBps, 10000);
        uint256 netProfit = _sub(grossProfit, builderFee);
        if (netProfit < minProfit) revert InsufficientProfit(netProfit, minProfit);

        // Approve Aave pool to pull the flash loan repayment.
        _safeApprove(debtAsset, pool, totalOwed);

        if (builderFee > 0) _payBuilder(builderFee, debtAsset);

        // Final explicit validation: Ensure contract has enough balance to repay flash loan
        uint256 finalBalance = IERC20(debtAsset).balanceOf(address(this));
        uint256 flashLoanCost = _add(amount, premium);
        if (finalBalance < flashLoanCost) revert InsufficientProfit(finalBalance, flashLoanCost);

        emit FlashLoanExecuted(amount, premium, netProfit, builderFee);
        return true;
    }

    function _payBuilder(uint256 builderFee, address debtAsset) internal {
        if (builderFee == 0) return;
        if (debtAsset != WETH) revert UnsupportedBuilderFeeToken(debtAsset);

        IWETH9(WETH).withdraw(builderFee);
        (bool sent, ) = payable(block.coinbase).call{value: builderFee}("");
        if (!sent) revert BuilderPaymentFailed();
    }

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        uint256 balance = address(this).balance;
        if (amount > balance) amount = balance;
        (bool sent, ) = to.call{value: amount}("");
        if (!sent) revert TransferFailed();
        emit Withdraw(to, amount);
    }

    function withdrawERC20(address token, address to, uint256 amount) external onlyOwner {
        if (!_safeTransfer(token, to, amount)) revert TransferFailed();
        emit WithdrawERC20(token, to, amount);
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert SwapFailed();
    }

    function _safeTransfer(address token, address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        return ok && (data.length == 0 || abi.decode(data, (bool)));
    }

    function _add(uint256 a, uint256 b) internal pure returns (uint256 result) {
        assembly { result := add(a, b) }
    }

    function _sub(uint256 a, uint256 b) internal pure returns (uint256 result) {
        assembly { result := sub(a, b) }
    }

    function _mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
        assembly { result := div(mul(a, b), denominator) }
    }
}
