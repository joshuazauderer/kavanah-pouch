-- Add order confirmation email tracking columns to orders table.
-- email_status values: pending | sent | failed

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_confirmation_email_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS order_confirmation_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS order_confirmation_email_error   TEXT;
