-- =============================================================
-- AutoLock Sessions Table
-- Run against Neon PostgreSQL:
--   psql "$NEON_DATABASE_URL" -f migrations/001_create_sessions.sql
-- =============================================================

CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locker_id       VARCHAR(50) NOT NULL,
  phone           VARCHAR(20) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- OTP fields: otp_plain is nulled after first delivery to ESP32
  otp_hash        VARCHAR(128),
  otp_plain       VARCHAR(10),
  otp_delivered   BOOLEAN DEFAULT FALSE,
  -- Paystack reference for tracking charges
  paystack_ref    VARCHAR(100),
  -- Amounts in KES (integer, no decimals)
  amount_initial  INTEGER DEFAULT 0,
  amount_final    INTEGER DEFAULT 0,
  -- Timestamps
  started_at      TIMESTAMP,
  ended_at        TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Index for ESP32 polling: fast lookup by locker_id + status
CREATE INDEX IF NOT EXISTS idx_sessions_locker_status
  ON sessions(locker_id, status);

-- Index for dashboard: fast ordering by creation time
CREATE INDEX IF NOT EXISTS idx_sessions_created_at
  ON sessions(created_at DESC);
