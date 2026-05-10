-- Migration 008: first-party analytics tables
-- Idempotent: uses CREATE TABLE IF NOT EXISTS

BEGIN;

-- ────────────────────────────────────────────
-- analytics_sessions
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_sessions (
  id                   SERIAL PRIMARY KEY,
  session_id           TEXT NOT NULL,
  anonymous_visitor_id TEXT NOT NULL,
  referrer             TEXT,
  referrer_domain      TEXT,
  source_category      TEXT,
  utm_source           TEXT,
  utm_medium           TEXT,
  utm_campaign         TEXT,
  device_type          TEXT,
  landing_page         TEXT,
  converted_order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_sessions_session_id_unique UNIQUE (session_id)
);

-- ────────────────────────────────────────────
-- analytics_events
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_events (
  id                   SERIAL PRIMARY KEY,
  event_type           TEXT NOT NULL,
  anonymous_visitor_id TEXT,
  session_id           TEXT,
  page_url             TEXT,
  page_path            TEXT,
  referrer             TEXT,
  utm_source           TEXT,
  utm_medium           TEXT,
  utm_campaign         TEXT,
  utm_content          TEXT,
  utm_term             TEXT,
  user_agent           TEXT,
  device_type          TEXT,
  browser              TEXT,
  operating_system     TEXT,
  metadata             JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────
-- indexes
-- ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at       ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event_type       ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session_id       ON analytics_events(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_visitor_id       ON analytics_events(anonymous_visitor_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_page_path        ON analytics_events(page_path);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_visitor_id     ON analytics_sessions(anonymous_visitor_id);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_started_at     ON analytics_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_converted      ON analytics_sessions(converted_order_id) WHERE converted_order_id IS NOT NULL;

COMMIT;
