-- ════════════════════════════════════════════════════════════════════
--  v16 — post-broadcast feedback
-- ════════════════════════════════════════════════════════════════════
--
-- A short prompt shown once a broadcast ends or is cancelled: a 1–5 rating,
-- optional tags for what went wrong, and free text. The point is to catch
-- problems while the experience is still fresh — someone whose stream dropped
-- frames will say so in the thirty seconds after ending it and never again.
--
-- Design notes:
--
--   • `stream_id` is nullable and ON DELETE SET NULL. Feedback outlives the
--     broadcast it came from: deleting an old stream (or a user pruning their
--     history) must not silently delete the complaint that explains why they
--     left. The rating is still useful without the stream row.
--
--   • One row per stream per user, via a unique index rather than an upsert in
--     application code. The modal can be shown again after a network failure
--     without risking a duplicate, and a retry updates rather than inserts.
--
--   • `issues` is a text[] of short slugs, not free prose, so the common
--     failure modes are countable. `comment` carries anything that doesn't fit.
--
--   • `ended_reason` distinguishes a broadcast that finished normally from one
--     the creator cancelled — those two populations rate very differently and
--     averaging them together hides the signal.
--
-- Safe to run repeatedly.

create table if not exists stream_feedback (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id)   on delete cascade,
  stream_id     uuid              references streams(id) on delete set null,
  rating        smallint not null check (rating between 1 and 5),
  issues        text[]   not null default '{}',
  comment       text,
  ended_reason  text     not null default 'ended' check (ended_reason in ('ended', 'cancelled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One piece of feedback per broadcast per person; a resubmit updates it.
create unique index if not exists stream_feedback_user_stream_uniq
  on stream_feedback (user_id, stream_id)
  where stream_id is not null;

-- The two reads this table gets: "recent feedback" and "this user's history".
create index if not exists stream_feedback_created_idx on stream_feedback (created_at desc);
create index if not exists stream_feedback_user_idx    on stream_feedback (user_id, created_at desc);

comment on table stream_feedback is
  'Post-broadcast ratings and comments, collected when a stream ends or is cancelled.';

-- Row-level security: a creator may write and read only their own feedback.
-- Admin reads go through the service role, which bypasses RLS.
alter table stream_feedback enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'stream_feedback' and policyname = 'own_feedback'
  ) then
    create policy own_feedback on stream_feedback
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
