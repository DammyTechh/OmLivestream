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
  created_at       timestamptz not null default now()
);
create index if not exists idx_sp_stream on stream_platforms(stream_id);

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
