-- Migration 010: Full bulk order processing workflow
-- Adds Stripe invoice fields, shipping address, tracking, email tracking,
-- refined statuses, and a quantity_pouches column to bulk_inquiries.

BEGIN;

ALTER TABLE bulk_inquiries
  -- Quantity actually confirmed (may differ from requested estimate)
  ADD COLUMN IF NOT EXISTS quantity_pouches      INTEGER,
  -- Quote line items (split from old quoted_total_cents)
  ADD COLUMN IF NOT EXISTS quoted_bundle_cents   INTEGER,
  -- Stripe Invoice
  ADD COLUMN IF NOT EXISTS stripe_customer_id    TEXT,
  ADD COLUMN IF NOT EXISTS stripe_invoice_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS stripe_invoice_url    TEXT,
  ADD COLUMN IF NOT EXISTS stripe_invoice_pdf    TEXT,
  ADD COLUMN IF NOT EXISTS invoice_sent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at               TIMESTAMPTZ,
  -- Full shipping address (collected after inquiry confirmed)
  ADD COLUMN IF NOT EXISTS shipping_name         TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS shipping_city         TEXT,
  ADD COLUMN IF NOT EXISTS shipping_state        TEXT,
  ADD COLUMN IF NOT EXISTS shipping_postal_code  TEXT,
  ADD COLUMN IF NOT EXISTS shipping_country      TEXT DEFAULT 'US',
  -- Shipment tracking
  ADD COLUMN IF NOT EXISTS tracking_number       TEXT,
  ADD COLUMN IF NOT EXISTS tracking_carrier      TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url          TEXT,
  ADD COLUMN IF NOT EXISTS shipped_at            TIMESTAMPTZ,
  -- Email tracking
  ADD COLUMN IF NOT EXISTS email_quote_sent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_invoice_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_payment_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_shipping_sent_at   TIMESTAMPTZ;

-- Updated status comment
-- new | contacted | quoted | invoice_sent | paid | packed | shipped | closed | canceled
COMMENT ON COLUMN bulk_inquiries.status IS
  'new | contacted | quoted | invoice_sent | paid | packed | shipped | closed | canceled';

-- Index for Stripe invoice lookup (webhook)
CREATE INDEX IF NOT EXISTS idx_bulk_inquiries_stripe_invoice
  ON bulk_inquiries(stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

COMMIT;
