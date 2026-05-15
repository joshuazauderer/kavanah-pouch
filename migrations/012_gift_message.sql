-- Migration 012: Add gift message field to orders table
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS gift_message TEXT;
