-- Migration 011: Add gift order fields to orders table
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_gift              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gift_recipient_name  TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_is_gift ON orders(is_gift) WHERE is_gift = true;
