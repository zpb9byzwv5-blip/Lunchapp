ALTER TABLE pre_orders
ADD COLUMN IF NOT EXISTS synced_to_till BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    external_ref VARCHAR(120) UNIQUE NOT NULL,
    tx_type VARCHAR(20) NOT NULL CHECK (tx_type IN ('PARENTPAY_TOPUP', 'TILL_SNAPSHOT', 'MANUAL_ADJUST')),
    amount_pence INTEGER NOT NULL,
    balance_after_pence INTEGER NOT NULL CHECK (balance_after_pence >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id);
