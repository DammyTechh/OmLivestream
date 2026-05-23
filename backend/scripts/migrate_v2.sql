-- ================================================================
-- OmliveStream — Migration v2 (run AFTER migrate.sql)
-- ================================================================
-- Adds: admin system, device/login tracking, multi-account detection,
--       user status column, sessions last_seen_at, audit logs
-- Safe to run multiple times (IF NOT EXISTS guards throughout)

-- ── 1. Add status column to users (if not exists) ────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name='users' and column_name='status'
  ) then
    alter table users add column status text not null default 'active'
      check (status in ('active','flagged','suspended','banned'));
  end if;
end $$;

-- ── 2. Add last_seen_at to sessions ──────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name='sessions' and column_name='last_seen_at'
  ) then
    alter table sessions add column last_seen_at timestamptz not null default now();
  end if;
end $$;

-- ── 3. login_logs — device fingerprint, risk level, new-device flag
create table if not exists login_logs (
  id                 uuid primary key default uuid_generate_v4(),
  user_id            uuid not null references users(id) on delete cascade,
  ip_address         text not null,
  user_agent         text not null,
  device_fingerprint text,           -- SHA-256(userAgent|ip) first 32 chars
  country            text,
  city               text,
  is_new_device      boolean not null default false,
  risk_level         text not null default 'low' check (risk_level in ('low','medium','high')),
  created_at         timestamptz not null default now()
);
create index if not exists idx_login_logs_user       on login_logs(user_id);
create index if not exists idx_login_logs_fingerprint on login_logs(device_fingerprint);
create index if not exists idx_login_logs_risk        on login_logs(risk_level);
create index if not exists idx_login_logs_created     on login_logs(created_at desc);

-- ── 4. admin_users ────────────────────────────────────────────────
create table if not exists admin_users (
  id            uuid primary key default uuid_generate_v4(),
  email         text unique not null,
  password_hash text not null,                          -- bcrypt, cost 12
  full_name     text not null,
  role          text not null default 'support'
                  check (role in ('super_admin','admin','support')),
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── 5. admin_sessions ─────────────────────────────────────────────
create table if not exists admin_sessions (
  id         uuid primary key default uuid_generate_v4(),
  admin_id   uuid not null references admin_users(id) on delete cascade,
  token_hash text not null unique,
  ip_address text,
  user_agent text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_admin_sessions_admin on admin_sessions(admin_id);
create index if not exists idx_admin_sessions_token on admin_sessions(token_hash);

-- ── 6. admin_audit_logs ───────────────────────────────────────────
create table if not exists admin_audit_logs (
  id             uuid primary key default uuid_generate_v4(),
  admin_id       uuid not null references admin_users(id) on delete cascade,
  action         text not null,      -- 'flag_user','suspend_user','ban_user','grant_premium','revoke_premium','restore_user','delete_user','create_admin'
  target_user_id uuid references users(id) on delete set null,
  notes          text,
  metadata       jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_audit_admin      on admin_audit_logs(admin_id);
create index if not exists idx_audit_target     on admin_audit_logs(target_user_id);
create index if not exists idx_audit_action     on admin_audit_logs(action);
create index if not exists idx_audit_created    on admin_audit_logs(created_at desc);

-- ── 7. RLS on new tables ──────────────────────────────────────────
alter table login_logs      enable row level security;
alter table admin_users     enable row level security;
alter table admin_sessions  enable row level security;
alter table admin_audit_logs enable row level security;

-- login_logs: users can only see their own logs
create policy "login_logs: own rows" on login_logs
  for select using (auth.uid() = user_id);

-- admin tables: blocked for anon/user JWT; backend uses service role
create policy "admin_users: no direct access"     on admin_users     for all using (false);
create policy "admin_sessions: no direct access"  on admin_sessions  for all using (false);
create policy "admin_audit: no direct access"     on admin_audit_logs for all using (false);

-- ── 8. Seed default super admin ──────────────────────────────────
-- IMPORTANT: Change this password immediately after first login!
-- Password below is:  ChangeMe!2026
-- bcrypt hash generated with cost 12
insert into admin_users (id, email, password_hash, full_name, role, is_active)
values (
  uuid_generate_v4(),
  'superadmin@omlivestreamapp.com',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TsCQL6DihrW5/eBaEZ4kfmUPnwi6',
  'OmliveStream Super Admin',
  'super_admin',
  true
)
on conflict (email) do nothing;

-- ── 9. Useful indexes on existing tables (performance) ───────────
create index if not exists idx_users_plan        on users(plan);
create index if not exists idx_users_status      on users(status);
create index if not exists idx_users_created     on users(created_at desc);
create index if not exists idx_invoices_status   on invoices(status);
create index if not exists idx_invoices_created  on invoices(created_at desc);
create index if not exists idx_subs_status       on subscriptions(status);
create index if not exists idx_subs_plan         on subscriptions(plan);
create index if not exists idx_streams_live      on streams(status) where status = 'live';

-- ── Done ──────────────────────────────────────────────────────────
-- Super admin login:
--   Email:    superadmin@omlivestreamapp.com
--   Password: ChangeMe!2026
-- POST /api/v1/admin/auth/login   { "email": "...", "password": "..." }
