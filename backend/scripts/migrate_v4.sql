-- ================================================================
-- OmliveStream — Migration v4
-- Adds: admin_broadcasts (email campaigns from admin dashboard)
-- Run AFTER migrate_v3.sql
-- ================================================================

-- ── admin_broadcasts — campaign records ──────────────────────────
create table if not exists admin_broadcasts (
  id              uuid primary key default uuid_generate_v4(),
  admin_id        uuid not null references admin_users(id) on delete cascade,

  -- Content
  subject         text not null,
  body_html       text not null,       -- full HTML email body (admin composes)
  body_text       text,                -- plain-text fallback (auto-generated)
  preview_text    text,                -- shown in email clients below subject

  -- Targeting
  segment         text not null default 'all'
                  check (segment in (
                    'all',             -- every verified user
                    'free_trial',      -- users in 90-day trial
                    'free',            -- trial-expired free users
                    'premium',         -- paying subscribers
                    'waitlist_members',-- users who joined from waitlist
                    'inactive'         -- no stream in last 14 days
                  )),

  -- Status lifecycle
  status          text not null default 'draft'
                  check (status in ('draft','scheduled','sending','sent','cancelled','failed')),

  -- Scheduling
  scheduled_at    timestamptz,         -- null = send immediately on /send
  sent_at         timestamptz,

  -- Stats (updated as emails deliver)
  recipient_count integer not null default 0,
  sent_count      integer not null default 0,
  failed_count    integer not null default 0,

  -- Metadata
  tags            text[],              -- e.g. ['product-update','launch']
  internal_notes  text,               -- admin-only notes, not sent

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_broadcasts_admin   on admin_broadcasts(admin_id);
create index if not exists idx_broadcasts_status  on admin_broadcasts(status);
create index if not exists idx_broadcasts_segment on admin_broadcasts(segment);
create index if not exists idx_broadcasts_created on admin_broadcasts(created_at desc);

-- ── broadcast_logs — per-user delivery tracking ──────────────────
create table if not exists broadcast_logs (
  id             uuid primary key default uuid_generate_v4(),
  broadcast_id   uuid not null references admin_broadcasts(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  email          text not null,
  status         text not null default 'pending'
                 check (status in ('pending','sent','failed','skipped')),
  error          text,
  sent_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_blogpost_broadcast on broadcast_logs(broadcast_id);
create index if not exists idx_blogpost_user      on broadcast_logs(user_id);
create index if not exists idx_blogpost_status    on broadcast_logs(status);

-- ── RLS ─────────────────────────────────────────────────────────
alter table admin_broadcasts enable row level security;
alter table broadcast_logs    enable row level security;

-- Backend uses service role key (bypasses RLS)
create policy "broadcasts: no public access" on admin_broadcasts for all using (false);
create policy "broadcast_logs: own row"      on broadcast_logs    for select using (auth.uid() = user_id);

-- ── Done ─────────────────────────────────────────────────────────
-- Admin can:
--   POST   /admin/broadcasts          → create draft
--   PATCH  /admin/broadcasts/:id      → edit draft
--   POST   /admin/broadcasts/:id/send → send now or schedule
--   DELETE /admin/broadcasts/:id      → cancel scheduled
--   GET    /admin/broadcasts          → list all with stats
--   GET    /admin/broadcasts/:id      → detail + per-user logs
--   GET    /admin/broadcasts/:id/preview → preview rendered HTML
