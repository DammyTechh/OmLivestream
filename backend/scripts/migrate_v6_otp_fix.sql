-- ─────────────────────────────────────────────────────────────────
-- Migration v6: Fix OTP type check constraint
-- Problem: original migration only allowed 'register' and 'reset'
-- but the code inserts 'login' for existing users signing in.
-- This caused silent INSERT failures → "No active code" on verify.
-- ─────────────────────────────────────────────────────────────────

-- Drop the old constraint
alter table otp_codes drop constraint if exists otp_codes_type_check;

-- Add the new one including 'login'
alter table otp_codes add constraint otp_codes_type_check
  check (type in ('register', 'login', 'reset'));

-- Clean out any stuck/corrupt OTP rows so users can start fresh
delete from otp_codes where used_at is null and expires_at < now();
