use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
mod solana_liquidator {
    use super::*;

    /// Initialize the liquidator program
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }

    /// Liquidate an undercollateralized position
    /// This is a simplified version - in practice, you'd integrate with lending protocols like Solend or Marginfi
    pub fn liquidate(
        ctx: Context<Liquidate>,
        liquidation_amount: u64,
    ) -> Result<()> {
        // Implementation would go here
        // Check health factor, calculate liquidation reward, transfer assets, etc.
        Ok(())
    }

    /// Withdraw fees collected by the liquidator
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        // Only owner can withdraw
        require!(ctx.accounts.owner.key() == ctx.accounts.owner_account.key(), ErrorCode::NotOwner);
        
        // Transfer fees to owner
        **ctx.accounts.fee_account.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.owner_account.try_borrow_mut_lamports()? += amount;
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + 32)]
    pub fee_account: AccountInfo<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub owner_account: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Liquidate<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub collateral_account: AccountInfo<'info>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub debt_account: AccountInfo<'info>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub liquidator: AccountInfo<'info>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub receiver: AccountInfo<'info>,
    #[account(mut)]
    pub fee_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub fee_account: AccountInfo<'info>,
    /// CHECK: Owner account
    pub owner_account: AccountInfo<'info>,
    pub owner: Signer<'info>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Only the owner can perform this action")]
    NotOwner,
    #[msg("Insufficient collateral for liquidation")]
    InsufficientCollateral,
    #[msg("Invalid liquidation amount")]
    InvalidLiquidationAmount,
}