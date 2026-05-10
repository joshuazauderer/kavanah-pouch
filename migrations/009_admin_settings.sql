-- Admin settings key-value store
CREATE TABLE IF NOT EXISTS admin_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed defaults (idempotent)
INSERT INTO admin_settings (key, value)
  VALUES ('packing_slip_include_prices', 'true')
  ON CONFLICT (key) DO NOTHING;
