-- ─────────────────────────────────────────────────────────────────
-- v12 — in-app notifications
--
-- Run AFTER migrate_v11_social_identities.sql.
--
-- The dashboard has shipped a notification bell since the first release. It
-- polls GET /notifications every 60 seconds, and that endpoint has never
-- existed — the call 404s into a silent catch, so the bell renders "You're
-- all caught up" permanently and no user has ever seen a notification. This
-- migration adds the storage the endpoint needs.
--
-- Delivery is Socket.io plus the browser Notification API rather than Web
-- Push. Web Push needs VAPID keys and a service worker to reach a browser
-- that has no tab open; the events here (your stream went live, a viewer
-- replied) matter while the user is actually using the dashboard, and the
-- socket connection is already authenticated and running. Rows persist so the
-- bell can show what arrived while a tab was closed.
-- ─────────────────────────────────────────────────────────────────

create table if not exists notifications (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references users(id) on delete cascade,

  -- Matches the TYPE_META map the bell already renders. A type outside this
  -- set falls back to the 'system' icon client-side, but the constraint keeps
  -- a typo from reaching the UI in the first place.
  type       text not null check (type in ('stream','platform','billing','system','ai','promo')),
  title      text not null,
  body       text not null,
  -- Relative dashboard path. Nullable: not every notification is actionable.
  link       text,

  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- The bell's only query: this user's rows, newest first. Partial on unread
-- for the badge count, which runs on the same 60-second cadence for every
-- signed-in user and is the more frequent of the two.
create index if not exists idx_notifications_user_created
  on notifications(user_id, created_at desc);
create index if not exists idx_notifications_unread
  on notifications(user_id) where read_at is null;

-- RLS on with no policy, matching otp_codes and social_identities. Every read
-- and write here goes through the service role, which bypasses RLS; the empty
-- policy set means a leaked anon key reaches nothing. Adding a permissive
-- policy would be strictly worse than none.
alter table notifications enable row level security;

-- ── Retention ────────────────────────────────────────────────────
-- Notifications are disposable. Without a bound this table grows forever for
-- every user who never opens the bell, and it is the one table whose row
-- count scales with activity rather than with customers. The daily cron in
-- src/jobs deletes read rows after 30 days and everything after 90.

-- ── Verify ───────────────────────────────────────────────────────
-- select type, count(*) from notifications group by type;
