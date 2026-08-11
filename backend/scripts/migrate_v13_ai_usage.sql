-- ─────────────────────────────────────────────────────────────────
-- v13 — AI usage accounting and conversation history
--
-- Run AFTER migrate_v12_notifications.sql.
--
-- Every OpenAI call the platform makes is billed to us, and until now nothing
-- recorded who caused it. That matters in two directions: there was no way to
-- see which accounts drive the spend, and no way to enforce a per-user daily
-- cap because there was no number to compare against.
--
-- Cost is stored per row rather than derived at read time. Prices change, and
-- a report that re-derives last quarter's spend from today's price list is
-- wrong in a way nobody notices.
-- ─────────────────────────────────────────────────────────────────

create table if not exists ai_usage (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references users(id) on delete cascade,

  -- Which surface spent it: 'chat', 'title', 'video-edit'. Free text rather
  -- than a check constraint — a new AI feature should not need a migration
  -- before it can account for itself.
  feature           text not null,
  model             text not null,

  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens      integer not null default 0,

  -- USD at the time of the call. numeric, not float: this gets summed into
  -- money figures, and float addition drifts.
  cost_usd          numeric(12,6) not null default 0,

  created_at        timestamptz not null default now()
);

-- The daily-cap check: one user's rows since midnight. Same index serves the
-- per-user spend report.
create index if not exists idx_ai_usage_user_created
  on ai_usage(user_id, created_at desc);

-- Admin-side: spend by feature over a window, without scanning per user.
create index if not exists idx_ai_usage_created
  on ai_usage(created_at desc);

-- RLS on with no policy, matching notifications and otp_codes. All access is
-- via the service role, which bypasses RLS; an empty policy set means a
-- leaked anon key reaches nothing.
alter table ai_usage enable row level security;

-- ── Conversation history ─────────────────────────────────────────
--
-- The assistant used to be stateless: the client sent back its own copy of
-- the transcript on every turn. That made the conversation only as
-- trustworthy as the caller — anyone could rewrite what "the assistant
-- previously said" and steer the next answer with it — and meant the thread
-- was lost the moment the page reloaded.

create table if not exists ai_messages (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references users(id) on delete cascade,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

-- The only query: this user's last N turns, newest first.
create index if not exists idx_ai_messages_user_created
  on ai_messages(user_id, created_at desc);

alter table ai_messages enable row level security;

-- Retention is handled by the daily cron in src/jobs, which drops messages
-- older than 30 days. Nothing replays a conversation that old — only the
-- last 10 turns are ever sent to the model.

-- ── Verify ───────────────────────────────────────────────────────
-- select feature, count(*), sum(total_tokens), round(sum(cost_usd), 4)
--   from ai_usage group by feature order by 4 desc;
-- select role, count(*) from ai_messages group by role;
