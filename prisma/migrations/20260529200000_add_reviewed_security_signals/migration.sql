CREATE TABLE IF NOT EXISTS reviewed_security_signals (
  id          TEXT PRIMARY KEY,
  signal_type TEXT NOT NULL,
  signal_value TEXT NOT NULL,
  case_id     TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_user_ids TEXT[] NOT NULL DEFAULT '{}',
  UNIQUE (signal_type, signal_value)
);
CREATE INDEX IF NOT EXISTS idx_reviewed_signals_type_value ON reviewed_security_signals(signal_type, signal_value);

-- Guard: re-add search_vector if db push dropped it
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS search_vector tsvector;
