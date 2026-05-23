-- ================================================================
-- OmliveStream — Migration v3
-- Adds: waitlist, free_trial plan, trial enforcement columns
-- Run AFTER migrate.sql and migrate_v2.sql
-- ================================================================

-- ── 1. Update plan column to include free_trial ───────────────────
do $$
begin
  -- Drop old check constraint, add new one with free_trial
  alter table users drop constraint if exists users_plan_check;
  alter table users add constraint users_plan_check
    check (plan in ('free_trial', 'free', 'premium'));

  -- Add trial tracking columns
  if not exists (
    select 1 from information_schema.columns
    where table_name='users' and column_name='trial_started_at'
  ) then
    alter table users add column trial_started_at timestamptz;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name='users' and column_name='trial_expires_at'
  ) then
    alter table users add column trial_expires_at timestamptz;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name='users' and column_name='waitlist_member'
  ) then
    alter table users add column waitlist_member boolean not null default false;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name='users' and column_name='waitlist_reward_claimed'
  ) then
    alter table users add column waitlist_reward_claimed boolean not null default false;
  end if;
end $$;

-- Set all existing free users to free_trial with trial starting now
-- (90-day trial from account creation for existing users)
update users
set
  plan              = 'free_trial',
  trial_started_at  = created_at,
  trial_expires_at  = created_at + interval '90 days'
where plan = 'free'
  and trial_started_at is null;

-- ── 2. Waitlist table ─────────────────────────────────────────────
create table if not exists waitlist (
  id              uuid primary key default uuid_generate_v4(),
  email           text unique not null,
  source          text default 'landing-page',       -- where they signed up from
  converted_user_id uuid references users(id) on delete set null, -- set when they register
  reward_granted  boolean not null default false,    -- 1 month free + discount applied
  reward_granted_at timestamptz,
  ip_address      text,
  metadata        jsonb,                             -- page, timestamp, etc from getform
  created_at      timestamptz not null default now()
);
create index if not exists idx_waitlist_email    on waitlist(email);
create index if not exists idx_waitlist_reward   on waitlist(reward_granted);
create index if not exists idx_waitlist_created  on waitlist(created_at desc);

-- ── 3. Discount codes table (waitlist reward tracking) ────────────
create table if not exists discount_codes (
  id            uuid primary key default uuid_generate_v4(),
  code          text unique not null,
  user_id       uuid references users(id) on delete cascade,
  waitlist_id   uuid references waitlist(id) on delete set null,
  discount_type text not null check (discount_type in ('first_month_free', 'six_month_50pct')),
  discount_pct  integer,                            -- e.g. 50 for 50% off
  free_months   integer,                            -- e.g. 1 for 1 free month
  is_used       boolean not null default false,
  used_at       timestamptz,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_discounts_code    on discount_codes(code);
create index if not exists idx_discounts_user    on discount_codes(user_id);

-- ── 4. Plan limits reference (read by backend, shown in frontend) ─
create table if not exists plan_limits (
  plan                text primary key,
  max_stream_platforms integer not null,   -- how many platforms per stream
  can_reply_comments  boolean not null,    -- cross-platform comment reply
  max_streams_per_day integer not null,    -- daily stream limit
  recording_days      integer not null,    -- how long recordings kept (days)
  show_upgrade_popup  boolean not null,    -- whether to show upgrade prompts
  label               text not null,
  description         text not null
);

insert into plan_limits (plan, max_stream_platforms, can_reply_comments, max_streams_per_day, recording_days, show_upgrade_popup, label, description) values
  ('free_trial', 2,  false, 3, 30, false, 'Free Trial',    '90-day trial — 2 platforms, view comments, no replies'),
  ('free',       1,  false, 1, 7,  true,  'Free',          '1 platform, view comments, no replies. Upgrade for full access.'),
  ('premium',    8,  true,  99, 365, false, 'Premium',     'All platforms, comment replies, unlimited streams, 365-day recording storage')
on conflict (plan) do update set
  max_stream_platforms = excluded.max_stream_platforms,
  can_reply_comments   = excluded.can_reply_comments,
  max_streams_per_day  = excluded.max_streams_per_day,
  recording_days       = excluded.recording_days,
  show_upgrade_popup   = excluded.show_upgrade_popup,
  label                = excluded.label,
  description          = excluded.description;

-- ── 5. RLS ───────────────────────────────────────────────────────
alter table waitlist       enable row level security;
alter table discount_codes enable row level security;
alter table plan_limits    enable row level security;

create policy "waitlist: no public access"   on waitlist       for all using (false);
create policy "discounts: own row"           on discount_codes for select using (auth.uid() = user_id);
create policy "plan_limits: public read"     on plan_limits    for select using (true);

-- ── Done ─────────────────────────────────────────────────────────
-- New plan flow:
--   Register → free_trial (90 days, 2 platforms, view comments)
--   After 90 days → free (1 platform, view comments, upgrade popups)
--   Subscribe → premium (all platforms, replies, unlimited)
--   Waitlist join → reward: 1 month free + 50% off first 6 months
