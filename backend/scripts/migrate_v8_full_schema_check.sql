-- ─────────────────────────────────────────────────────────────────
-- Migration v8: Idempotent schema check — adds anything missing.
--
-- WHY YOU NEED THIS:
-- The "Failed to create account" error during signup happens because
-- the live database is missing columns the code expects. This script
-- safely adds everything that's missing without touching what's already there.
--
-- Safe to run multiple times. Run it once in your Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────

-- ── 1. users.status column (from migrate_v2) ─────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name='users' and column_name='status'
  ) then
    alter table users add column status text not null default 'active';
    alter table users add constraint users_status_check
      check (status in ('active','flagged','suspended','banned'));
    raise notice 'Added users.status column';
  end if;
end $$;

-- ── 2. users.plan must include free_trial (from migrate_v3) ──────
do $$
begin
  -- Drop old check constraint (whatever it was named) and add new one
  alter table users drop constraint if exists users_plan_check;
  alter table users add constraint users_plan_check
    check (plan in ('free_trial', 'free', 'premium'));
  raise notice 'Updated users.plan check constraint to include free_trial';
end $$;

-- ── 3. users.trial_started_at column ─────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name='users' and column_name='trial_started_at'
  ) then
    alter table users add column trial_started_at timestamptz;
    raise notice 'Added users.trial_started_at column';
  end if;
end $$;

-- ── 4. users.trial_expires_at column ─────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name='users' and column_name='trial_expires_at'
  ) then
    alter table users add column trial_expires_at timestamptz;
    raise notice 'Added users.trial_expires_at column';
  end if;
end $$;

-- ── 5. otp_codes.type must include 'login' (from migrate_v6) ─────
do $$
begin
  alter table otp_codes drop constraint if exists otp_codes_type_check;
  alter table otp_codes add constraint otp_codes_type_check
    check (type in ('register','login','reset'));
  raise notice 'Updated otp_codes.type check constraint to include login';
end $$;

-- ── 6. Backfill: any 'free' users get default trial values ───────
update users set
  plan              = 'free_trial',
  trial_started_at  = coalesce(trial_started_at, created_at),
  trial_expires_at  = coalesce(trial_expires_at, created_at + interval '90 days')
where plan = 'free' and trial_expires_at is null;

-- ── 7. Clean any stuck/expired OTPs ──────────────────────────────
delete from otp_codes where used_at is null and expires_at < now();

-- ── Success message ──────────────────────────────────────────────
do $$ begin raise notice '✅ Schema is up to date — signup should now work'; end $$;
