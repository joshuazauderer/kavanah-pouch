-- Migration 006: Enhance bulk_inquiries with shipping zip, dedication flag,
--                quoted amounts, admin notes, converted flag, and richer statuses

BEGIN;

ALTER TABLE bulk_inquiries
  ADD COLUMN IF NOT EXISTS shipping_zip         TEXT,
  ADD COLUMN IF NOT EXISTS is_dedication        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quoted_shipping_cents INTEGER,
  ADD COLUMN IF NOT EXISTS quoted_total_cents    INTEGER,
  ADD COLUMN IF NOT EXISTS admin_notes          TEXT,
  ADD COLUMN IF NOT EXISTS converted_to_order   BOOLEAN NOT NULL DEFAULT false;

-- status: new | contacted | quoted | paid | shipped | closed | not_a_fit
COMMENT ON COLUMN bulk_inquiries.status IS
  'new | contacted | quoted | paid | shipped | closed | not_a_fit';

COMMIT;
