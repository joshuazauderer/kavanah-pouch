-- Kavanah Pouch — initial database schema
-- Run once: psql $DATABASE_URL -f migrations/001_initial_schema.sql
-- Or via: npm run migrate

BEGIN;

-- ────────────────────────────────────────────
-- products
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  sku         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO products (sku, name, description)
VALUES ('KAVANAH-POUCH', 'Kavanah Pouch', 'Signal-blocking phone pouch for davening focus')
ON CONFLICT (sku) DO NOTHING;

-- ────────────────────────────────────────────
-- inventory
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory (
  id                  SERIAL PRIMARY KEY,
  product_id          INTEGER NOT NULL REFERENCES products(id),
  quantity_available  INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 10,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO inventory (product_id, quantity_available, low_stock_threshold)
SELECT id, 0, 10 FROM products WHERE sku = 'KAVANAH-POUCH'
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────
-- orders
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                          SERIAL PRIMARY KEY,
  order_number                TEXT NOT NULL UNIQUE,
  stripe_checkout_session_id  TEXT UNIQUE,
  stripe_payment_intent_id    TEXT,
  customer_email              TEXT NOT NULL,
  customer_name               TEXT,
  phone                       TEXT,
  shipping_name               TEXT,
  shipping_address_line1      TEXT,
  shipping_address_line2      TEXT,
  shipping_city               TEXT,
  shipping_state              TEXT,
  shipping_postal_code        TEXT,
  shipping_country            TEXT,
  subtotal_cents              INTEGER,
  shipping_cents              INTEGER,
  tax_cents                   INTEGER,
  total_cents                 INTEGER NOT NULL,
  currency                    TEXT NOT NULL DEFAULT 'usd',
  payment_status              TEXT NOT NULL DEFAULT 'pending',
  fulfillment_status          TEXT NOT NULL DEFAULT 'unfulfilled',
  pirate_ship_exported_at     TIMESTAMPTZ,
  tracking_number             TEXT,
  tracking_carrier             TEXT DEFAULT 'USPS',
  tracking_url                TEXT,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- payment_status: pending | paid | failed | refunded | canceled
-- fulfillment_status: unfulfilled | exported | shipped | canceled

-- ────────────────────────────────────────────
-- order_items
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id                  SERIAL PRIMARY KEY,
  order_id            INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id          INTEGER NOT NULL REFERENCES products(id),
  sku                 TEXT NOT NULL,
  name                TEXT NOT NULL,
  pack_type           TEXT NOT NULL,
  quantity_pouches    INTEGER NOT NULL,
  quantity_packs      INTEGER NOT NULL DEFAULT 1,
  unit_amount_cents   INTEGER,
  total_amount_cents  INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- pack_type: single | two_pack | three_pack

-- ────────────────────────────────────────────
-- waitlist_signups
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waitlist_signups (
  id                  SERIAL PRIMARY KEY,
  email               TEXT NOT NULL,
  name                TEXT,
  quantity_interested INTEGER,
  interest_type       TEXT,
  source              TEXT,
  notified_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- interest_type: personal | gift | bulk | shul | yeshiva | other

-- ────────────────────────────────────────────
-- bulk_inquiries
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bulk_inquiries (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  email               TEXT NOT NULL,
  phone               TEXT,
  organization_name   TEXT,
  organization_type   TEXT,
  quantity_requested  INTEGER,
  dedication_text     TEXT,
  message             TEXT,
  status              TEXT NOT NULL DEFAULT 'new',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- status: new | contacted | quoted | closed | not_a_fit

-- ────────────────────────────────────────────
-- support_messages
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_messages (
  id           SERIAL PRIMARY KEY,
  name         TEXT,
  email        TEXT NOT NULL,
  order_number TEXT,
  category     TEXT,
  subject      TEXT,
  message      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'new',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────
-- feedback_messages
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback_messages (
  id                      SERIAL PRIMARY KEY,
  name                    TEXT,
  email                   TEXT,
  usage_context           TEXT,
  message                 TEXT NOT NULL,
  may_contact             BOOLEAN NOT NULL DEFAULT FALSE,
  may_use_as_testimonial  BOOLEAN NOT NULL DEFAULT FALSE,
  status                  TEXT NOT NULL DEFAULT 'new',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────
-- admin_users
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────
-- indexes
-- ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_created_at        ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON orders(fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status    ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_waitlist_email           ON waitlist_signups(email);
CREATE INDEX IF NOT EXISTS idx_bulk_inquiries_status    ON bulk_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_support_messages_status  ON support_messages(status);

COMMIT;
