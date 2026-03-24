-- =============================================================
-- Add pin_code column for persistent PIN storage
-- The PIN survives otp_plain being nulled after delivery,
-- so it can be verified when the user returns to retrieve.
--
-- Run: psql "$NEON_DATABASE_URL" -f migrations/002_add_pin_code.sql
-- =============================================================

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pin_code VARCHAR(10);
