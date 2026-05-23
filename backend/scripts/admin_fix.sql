-- ============================================================
-- OmliveStream — Admin Account Fix
-- Run this in Supabase Dashboard → SQL Editor
-- if you cannot log in to /admin
-- ============================================================

-- Step 1: Check if admin_users table exists and has data
SELECT id, email, full_name, role, is_active, last_login_at
FROM admin_users;

-- Step 2: If empty (no rows), the migration wasn't run yet.
-- The seeded admin is created by migrate_v2.sql.
-- Run migrate_v2.sql first, then come back here.

-- Step 3: Force-ensure the default super admin exists
-- Password below = "ChangeMe!2026" (bcrypt 12 rounds)
INSERT INTO admin_users (id, email, password_hash, full_name, role, is_active, created_at)
VALUES (
  gen_random_uuid(),
  'superadmin@omlivestreamapp.com',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsCQL6DihrW5/eBaEZ4kfmUPnwi6',
  'OmliveStream Super Admin',
  'super_admin',
  true,
  now()
)
ON CONFLICT (email) DO UPDATE
  SET is_active = true,
      password_hash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsCQL6DihrW5/eBaEZ4kfmUPnwi6';

-- Step 4: Verify
SELECT id, email, full_name, role, is_active FROM admin_users;

-- ── After Login ─────────────────────────────────────────────────────
-- Once you can log in, create your real admin account via the API:
-- POST /api/v1/admin/admins (requires super_admin token)
-- Body: { "email": "you@yourdomain.com", "password": "YourStrongPass!1", "full_name": "Your Name", "role": "super_admin" }
--
-- Then deactivate the default:
-- UPDATE admin_users SET is_active = false WHERE email = 'superadmin@omlivestreamapp.com';

-- ── Admin Sessions cleanup (run if tokens are stale) ────────────────
DELETE FROM admin_sessions WHERE expires_at < now();
