-- ================================================================
-- OmliveStream — Complete Supabase Database Migration
-- ================================================================
-- Run this in Supabase Dashboard → SQL Editor
-- Run once on a fresh project. Safe to re-run (IF NOT EXISTS guards).

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ── users ────────────────────────────────────────────────────────
create table if not exists users (
  id                    uuid primary key default uuid_generate_v4(),
  email                 text unique not null,
  full_name             text,
  dob                   date,
  location              text,
  avatar_url            text,
  plan                  text not null default 'free' check (plan in ('free','premium')),
  is_verified           boolean not null default false,
  last_stream_ended_at  timestamptz,
  re_engagement_sent_at timestamptz,
  birthday_wished_at    timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── sessions (refresh token store) ───────────────────────────────
create table if not exists sessions (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_sessions_user   on sessions(user_id);
create index if not exists idx_sessions_token  on sessions(token_hash);
create index if not exists idx_sessions_expiry on sessions(expires_at);

-- ── otp_codes ────────────────────────────────────────────────────
create table if not exists otp_codes (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references users(id) on delete cascade,
  code_hash  text not null,
  type       text not null check (type in ('register','reset')),
  attempts   integer not null default 0,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_otp_user on otp_codes(user_id);

-- ── onboarding_responses ─────────────────────────────────────────
create table if not exists onboarding_responses (
  user_id      uuid primary key references users(id) on delete cascade,
  heard_from   text[] not null default '{}',
  use_case     text[] not null default '{}',
  completed_at timestamptz not null default now()
);

-- ── platform_connections ─────────────────────────────────────────
create table if not exists platform_connections (
  id                      uuid primary key default uuid_generate_v4(),
  user_id                 uuid not null references users(id) on delete cascade,
  platform                text not null,
  access_token_encrypted  text,
  refresh_token_encrypted text,
  rtmp_url                text,
  stream_key_encrypted    text,
  platform_user_id        text,
  platform_username       text,
  status                  text not null default 'connected' check (status in ('connected','error','disconnected')),
  connected_at            timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (user_id, platform)
);
create index if not exists idx_plat_user on platform_connections(user_id);

-- ── streams ──────────────────────────────────────────────────────
create table if not exists streams (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references users(id) on delete cascade,
  title               text not null,
  description         text,
  thumbnail_url       text,
  status              text not null default 'scheduled' check (status in ('scheduled','live','ended')),
  mediasoup_router_id text,
  started_at          timestamptz,
  ended_at            timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists idx_streams_user_status on streams(user_id, status);
create index if not exists idx_streams_status       on streams(status);

-- ── stream_platforms ─────────────────────────────────────────────
create table if not exists stream_platforms (
  id               uuid primary key default uuid_generate_v4(),
  stream_id        uuid not null references streams(id) on delete cascade,
  platform         text not null,
  rtmp_push_status text not null default 'pending' check (rtmp_push_status in ('pending','active','failed','ended')),
  viewers_peak     integer not null default 0,
  impressions      integer not null default 0,
  total_comments   integer not null default 0,
  -- Live-session identifiers, captured when the broadcast starts.
  -- These are per-stream, not per-connection: YouTube mints a new
  -- liveBroadcast (and with it a new liveChatId) for every go-live, and a
  -- Facebook live video is single-use. Caching them on the connection row
  -- would point every future stream at a dead object.
  live_chat_id     text,
  live_video_id    text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_sp_stream on stream_platforms(stream_id);

-- ── stream_comments ──────────────────────────────────────────────
-- Live chat pulled in from every connected platform, unified into one
-- feed. Persisted rather than only relayed over the socket so that a
-- late-joining or reconnecting client can backfill, and so replies have a
-- stable id to address.
create table if not exists stream_comments (
  id                  uuid primary key default uuid_generate_v4(),
  stream_id           uuid not null references streams(id) on delete cascade,
  platform            text not null,
  -- The platform's own comment id. Unique per platform, so this is what
  -- makes ingestion idempotent across a poller restart.
  platform_comment_id text not null,
  -- Where a reply must be sent, which is not always the comment id:
  -- YouTube replies post into the live chat, Facebook onto the comment.
  reply_target        text,
  author_name         text,
  author_platform_id  text,
  text                text not null default '',
  posted_at           timestamptz not null default now(),
  replied_at          timestamptz,
  reply_text          text,
  created_at          timestamptz not null default now(),
  unique (platform, platform_comment_id)
);
create index if not exists idx_sc_stream on stream_comments(stream_id, posted_at desc);

-- ── recordings ───────────────────────────────────────────────────
create table if not exists recordings (
  id               uuid primary key default uuid_generate_v4(),
  stream_id        uuid not null references streams(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  file_url         text,
  duration_seconds integer,
  size_bytes       bigint,
  quality          text check (quality in ('480p','720p','1080p')),
  status           text not null default 'processing' check (status in ('processing','ready','failed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_rec_user_status on recordings(user_id, status);

-- ── stream_metrics ───────────────────────────────────────────────
create table if not exists stream_metrics (
  id             uuid primary key default uuid_generate_v4(),
  stream_id      uuid not null references streams(id) on delete cascade,
  platform       text not null,
  timestamp      timestamptz not null default now(),
  viewers        integer not null default 0,
  impressions    integer not null default 0,
  comments_count integer not null default 0,
  bitrate_kbps   integer not null default 0
);
create index if not exists idx_metrics_stream   on stream_metrics(stream_id);
create index if not exists idx_metrics_ts       on stream_metrics(timestamp desc);

-- ── platform_analytics ───────────────────────────────────────────
create table if not exists platform_analytics (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references users(id) on delete cascade,
  platform          text not null,
  period            text not null check (period in ('daily','weekly','monthly')),
  total_views       integer not null default 0,
  total_impressions integer not null default 0,
  total_engagement  integer not null default 0,
  recorded_at       timestamptz not null default now()
);
create index if not exists idx_analytics_user on platform_analytics(user_id, recorded_at desc);

-- ── video_edits ──────────────────────────────────────────────────
create table if not exists video_edits (
  id           uuid primary key default uuid_generate_v4(),
  recording_id uuid not null references recordings(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  edit_type    text not null check (edit_type in ('manual','ai')),
  ai_prompt    text,
  status       text not null default 'pending' check (status in ('pending','processing','done','failed')),
  output_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── video_publishes ──────────────────────────────────────────────
create table if not exists video_publishes (
  id           uuid primary key default uuid_generate_v4(),
  recording_id uuid not null references recordings(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  platform     text not null,
  caption      text,
  status       text not null default 'pending' check (status in ('pending','published','failed')),
  scheduled_at timestamptz,
  published_at timestamptz
);

-- ── subscriptions ────────────────────────────────────────────────
create table if not exists subscriptions (
  id                          uuid primary key default uuid_generate_v4(),
  user_id                     uuid not null references users(id) on delete cascade,
  plan                        text not null default 'free',
  billing_cycle               text not null check (billing_cycle in ('monthly','annual')),
  status                      text not null check (status in ('active','cancelled','past_due')),
  paystack_subscription_code  text,
  paystack_customer_code      text,
  current_period_start        timestamptz not null,
  current_period_end          timestamptz not null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (user_id)
);

-- ── invoices ─────────────────────────────────────────────────────
create table if not exists invoices (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references users(id) on delete cascade,
  subscription_id     uuid references subscriptions(id),
  amount              integer not null,
  currency            text not null default 'NGN',
  status              text not null check (status in ('paid','pending','failed')),
  paystack_reference  text unique,
  receipt_url         text,
  created_at          timestamptz not null default now()
);

-- ── feedback ─────────────────────────────────────────────────────
create table if not exists feedback (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references users(id) on delete cascade,
  message    text not null,
  rating     integer not null check (rating between 1 and 5),
  created_at timestamptz not null default now()
);

-- ── feature_updates ──────────────────────────────────────────────
create table if not exists feature_updates (
  id           uuid primary key default uuid_generate_v4(),
  title        text not null,
  description  text not null,
  published_at timestamptz not null default now(),
  notify_users boolean not null default true
);

-- ── user_feature_reads ───────────────────────────────────────────
create table if not exists user_feature_reads (
  user_id           uuid not null references users(id) on delete cascade,
  feature_update_id uuid not null references feature_updates(id) on delete cascade,
  read_at           timestamptz not null default now(),
  primary key (user_id, feature_update_id)
);

-- ================================================================
-- In-place column additions for databases created before these
-- columns existed. `create table if not exists` above is a no-op on
-- an existing table, so new columns must also be added explicitly.
-- `add column if not exists` makes this safe to re-run.
-- ================================================================

alter table stream_platforms add column if not exists live_chat_id  text;
alter table stream_platforms add column if not exists live_video_id text;
alter table stream_comments  enable row level security;

-- analytics_overview filters on stream_id AND timestamp together. The two
-- single-column indexes above force Postgres to pick one and filter the rest
-- by hand, or to bitmap-and them. One composite index ordered the same way as
-- the predicate lets it seek straight to the range, which is the difference
-- between a scan and a lookup once a busy account has months of metrics.
create index if not exists idx_metrics_stream_ts on stream_metrics(stream_id, timestamp);

-- Comment ingestion upserts on (platform, platform_comment_id) on every poll
-- of every platform of every live stream — the hottest write path in the
-- system. The unique constraint already provides this index; named here so
-- it is not "optimised away" by someone reading the table definition later.

-- The birthday cron needs "whose birthday is today", which no index on `dob`
-- can answer — the year differs for every row. Storing the month and day as
-- generated columns makes it a plain indexed equality lookup instead of a
-- full scan plus a filter in application code. Immutable and therefore
-- indexable because `dob` is a date, not a timestamptz.
alter table users add column if not exists birth_month smallint
  generated always as (extract(month from dob)::smallint) stored;
alter table users add column if not exists birth_day smallint
  generated always as (extract(day from dob)::smallint) stored;
create index if not exists idx_users_birthday on users(birth_month, birth_day)
  where dob is not null;

-- Supports the re-engagement cron, which filters on a "last activity"
-- timestamp across the whole users table.
--
-- The matching index for the trial cron lives in migrate_v9_performance.sql,
-- not here: it covers users.trial_expires_at, which migrate_v3.sql adds. A
-- fresh database runs this file first, so naming that column here would abort
-- the migration on a column that does not exist yet.
create index if not exists idx_users_last_stream on users(last_stream_ended_at)
  where last_stream_ended_at is not null;

-- Per-user lookups that currently have no supporting index. Both are read on
-- every billing dashboard load and every admin user detail view.
create index if not exists idx_invoices_user      on invoices(user_id, created_at desc);
create index if not exists idx_subscriptions_user on subscriptions(user_id);

-- streams list view orders by created_at within a user; idx_streams_user_status
-- covers the filter but not the sort, so Postgres still has to sort the result.
create index if not exists idx_streams_user_created on streams(user_id, created_at desc);

-- ================================================================
-- Server-side aggregation functions
-- ================================================================
-- analytics_overview used to be defined here, taking uuid[] stream ids. It
-- now takes a user id and does the ownership join itself, and lives in
-- migrate_v9_performance.sql alongside the other aggregation functions.
--
-- Not left here as the old signature: this file is safe to re-run, so a
-- re-run after v9 would recreate the uuid[] version as a second overload
-- and leave two functions of the same name for PostgREST to choose between.
-- v9 drops that signature if an earlier install created it.

-- ================================================================
-- Row Level Security (RLS)
-- ================================================================
-- Enable RLS on all user-owned tables so the anon key cannot
-- access another user's data even if passed directly to Supabase.

alter table users               enable row level security;
alter table sessions            enable row level security;
alter table otp_codes           enable row level security;
alter table onboarding_responses enable row level security;
alter table platform_connections enable row level security;
alter table streams             enable row level security;
alter table stream_platforms    enable row level security;
alter table recordings          enable row level security;
alter table stream_metrics      enable row level security;
alter table platform_analytics  enable row level security;
alter table video_edits         enable row level security;
alter table video_publishes     enable row level security;
alter table subscriptions       enable row level security;
alter table invoices            enable row level security;
alter table feedback            enable row level security;
alter table user_feature_reads  enable row level security;

-- NOTE: The backend uses the SERVICE ROLE key which bypasses RLS.
-- These policies apply when using the ANON key (e.g. Supabase Realtime).
create policy "users: own row" on users for all using (auth.uid() = id);
create policy "sessions: own"  on sessions for all using (auth.uid() = user_id);
create policy "streams: own"   on streams for all using (auth.uid() = user_id);
create policy "recordings: own" on recordings for all using (auth.uid() = user_id);

-- ================================================================
-- Supabase Storage Buckets
-- ================================================================
-- Run these separately in Supabase Dashboard → Storage OR via API.
-- (Cannot be done via SQL editor in all project tiers)

-- insert into storage.buckets (id, name, public) values ('recordings', 'recordings', false);
-- insert into storage.buckets (id, name, public) values ('thumbnails', 'thumbnails', true);
-- insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
