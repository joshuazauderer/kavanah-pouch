-- Migration 007: add discount / promotion-code fields to orders
-- Idempotent: uses ADD COLUMN IF NOT EXISTS

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS discount_code          TEXT,
  ADD COLUMN IF NOT EXISTS discount_amount_cents  INTEGER NOT NULL DEFAULT 0;
