-- Migration 005: Fix inventory uniqueness, add shipment fields, add audit log
-- Safe to run multiple times (all statements are idempotent)

BEGIN;

-- ────────────────────────────────────────────
-- Fix inventory: deduplicate and add UNIQUE constraint
-- Keep the row with the highest quantity_available per product_id
-- ────────────────────────────────────────────
DELETE FROM inventory
WHERE id NOT IN (
  SELECT DISTINCT ON (product_id) id
  FROM inventory
  ORDER BY product_id, quantity_available DESC, id ASC
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_product_id_unique'
  ) THEN
    ALTER TABLE inventory ADD CONSTRAINT inventory_product_id_unique UNIQUE (product_id);
  END IF;
END $$;

-- ────────────────────────────────────────────
-- Orders: add inventory_decremented_at (idempotent decrement guard)
-- ────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS inventory_decremented_at TIMESTAMPTZ;

-- ────────────────────────────────────────────
-- Orders: add shipment tracking fields
-- ────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_service TEXT,
  ADD COLUMN IF NOT EXISTS shipped_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_notes      TEXT;

-- ────────────────────────────────────────────
-- inventory_adjustments audit log
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id                BIGSERIAL PRIMARY KEY,
  sku               TEXT NOT NULL DEFAULT 'KAVANAH-POUCH',
  adjustment_amount INTEGER NOT NULL,
  reason            TEXT NOT NULL,
  order_id          INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  previous_quantity INTEGER NOT NULL,
  new_quantity      INTEGER NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_adj_order_id   ON inventory_adjustments(order_id);
CREATE INDEX IF NOT EXISTS idx_inv_adj_created_at ON inventory_adjustments(created_at DESC);

COMMIT;
