-- Rename pack_type value 'single' -> 'one_pouch' to match updated priceKey naming.
-- Safe to run on empty tables; also handles any test orders created before this change.

BEGIN;

UPDATE order_items
SET pack_type = 'one_pouch'
WHERE pack_type = 'single';

-- pack_type values: one_pouch | two_pack | three_pack

COMMIT;
