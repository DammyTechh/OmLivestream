-- ════════════════════════════════════════════════════════════════════
--  v14 — analytics aggregation that means what it says
-- ════════════════════════════════════════════════════════════════════
--
-- Two problems, one cause: stream_metrics.viewers is a *level* (how many
-- people are watching right now), and v9's analytics_overview aggregated it
-- with sum().
--
-- Summing a level produces a number with no meaning. Ten viewers who stay
-- for three hours, sampled every thirty seconds, sum to 3,600 — and that
-- figure was labelled "Total views" on the dashboard. Sample the same
-- audience twice as often and it doubles. It is not a view count; it is a
-- count of samples multiplied by an average, and it grows with polling
-- frequency rather than with anything the broadcaster did.
--
-- The honest aggregate of a level is max() — the peak concurrent audience.
-- The honest source of a total view count is the platform's own reported
-- figure, which is why total views now comes from platform_analytics, where
-- the sampler records what YouTube and Facebook actually say after a
-- broadcast ends.
--
-- Impressions are gone from the read path. No live API we hold a token for
-- reports them: YouTube keeps impressions behind youtubeAnalytics, which
-- needs a scope this app does not request and does not cover live data. The
-- column stays for compatibility and stays at zero, but nothing displays it
-- any more — a card that reads 0 forever is a bug report waiting to happen.

-- ── platform_analytics: one row per user, platform and day ──
--
-- The rollup accumulates into the current day's row so three streams in one
-- day add up rather than producing three rows the charts would draw as three
-- separate points. Enforced here so two streams ending at the same moment
-- cannot create a duplicate.
--
-- A daily row's recorded_at is the UTC midnight that starts its day, not the
-- moment the rollup happened. That makes the day itself the key, so the index
-- below is a plain column list.
--
-- The obvious spelling — unique on (user_id, platform, period,
-- (recorded_at::date)) — is rejected: casting timestamptz to date reads the
-- session's TimeZone, so it is STABLE rather than IMMUTABLE and Postgres will
-- not build an index on it (SQLSTATE 42P17). Wrapping it as
-- ((recorded_at at time zone 'UTC')::date) would be immutable and would work,
-- but then the stored timestamp and the indexed day are two different notions
-- of "when", and every reader has to know which one it is looking at.
--
-- No new index on (user_id, recorded_at) — migrate.sql:183 already has one,
-- and none on stream_metrics: the write path is the hottest in the schema and
-- migrate.sql:281 already covers (stream_id, timestamp), which is what both
-- read queries filter on.
create unique index if not exists uq_platform_analytics_daily
  on platform_analytics(user_id, platform, period, recorded_at);

-- ── rollup_platform_analytics ──
--
-- One statement, because the app's version was a select-then-update-or-insert
-- and two streams ending in the same second could both read "no row yet" and
-- both insert. The unique index above would then reject the loser, and the
-- rollup logs a warning and drops that broadcast's views on the floor.
--
-- Arithmetic on conflict is why this is an RPC and not a PostgREST upsert:
-- upsert replaces the columns it is given, and what is wanted here is
-- addition. Passing the day as a timestamptz and truncating it here means a
-- caller cannot miss the key by a few milliseconds and create a second row
-- for the same day.
create or replace function rollup_platform_analytics(
  p_user_id     uuid,
  p_platform    text,
  p_day         timestamptz,
  p_views       integer,
  p_engagement  integer
)
returns void
language sql
as $$
  insert into platform_analytics (
    user_id, platform, period, total_views, total_engagement, recorded_at
  )
  values (
    p_user_id, p_platform, 'daily', p_views, p_engagement,
    date_trunc('day', p_day at time zone 'UTC') at time zone 'UTC'
  )
  on conflict (user_id, platform, period, recorded_at) do update set
    total_views      = platform_analytics.total_views      + excluded.total_views,
    total_engagement = platform_analytics.total_engagement + excluded.total_engagement;
$$;

-- ── analytics_overview, corrected ──
--
-- Returns three numbers per platform, each from the source that can actually
-- support it:
--
--   total_views    the platform's own view count, summed over the days in
--                  range. Recorded once per stream at rollup, so summing
--                  daily rows is summing distinct broadcasts, not resampling
--                  the same one.
--   peak_viewers   the highest concurrent audience seen in the window. A max
--                  of maxes, so it is the true peak across every stream in
--                  range rather than the sum of their individual peaks.
--   total_comments comments ingested. Each metrics row holds the delta since
--                  the previous sample, so this sums to an exact total.
--
-- A full outer join, because the two sides can legitimately be lopsided: a
-- stream still running has metrics but no rollup yet, and a stream whose
-- chat was never reachable has a rollup but no comment counts.
drop function if exists analytics_overview(uuid, timestamptz, timestamptz);

create or replace function analytics_overview(
  p_user_id uuid,
  p_from    timestamptz,
  p_to      timestamptz
)
returns table(
  platform       text,
  total_views    bigint,
  peak_viewers   bigint,
  total_comments bigint
)
language sql
stable
as $$
  with live as (
    select
      sm.platform,
      coalesce(max(sm.viewers), 0)::bigint        as peak_viewers,
      coalesce(sum(sm.comments_count), 0)::bigint as total_comments
    from stream_metrics sm
    join streams st on st.id = sm.stream_id
    where st.user_id = p_user_id
      and sm.timestamp >= p_from
      and sm.timestamp <= p_to
    group by sm.platform
  ),
  rolled as (
    select
      pa.platform,
      coalesce(sum(pa.total_views), 0)::bigint as total_views
    from platform_analytics pa
    where pa.user_id = p_user_id
      and pa.period = 'daily'
      -- Daily rows are anchored to the UTC midnight that starts their day, so
      -- the lower bound is widened to that day's start. Comparing a
      -- day-anchored row against a mid-afternoon `from` would drop the whole
      -- of the earliest day: "last 30 days" computed at 14:00 would silently
      -- report 29.
      and pa.recorded_at >= date_trunc('day', p_from at time zone 'UTC') at time zone 'UTC'
      and pa.recorded_at <= p_to
    group by pa.platform
  )
  select
    coalesce(l.platform, r.platform)   as platform,
    coalesce(r.total_views, 0)         as total_views,
    coalesce(l.peak_viewers, 0)        as peak_viewers,
    coalesce(l.total_comments, 0)      as total_comments
  from live l
  full outer join rolled r on r.platform = l.platform;
$$;

-- ── stream_metrics_series, without the column nothing fills ──
--
-- v9's version returned sum(sm.impressions) alongside the real numbers. The
-- write path never sets that column, so the series carried a bigint of zeros
-- through the RPC, over the wire and into the response, where the route then
-- had to remember not to map it. Dropped for the same reason as everywhere
-- else: a number nothing produces is not data.
--
-- Bucketing and the averaging of viewers are unchanged — viewers is a level,
-- so it is averaged within a bucket; comments are per-tick deltas, so they
-- are summed.
drop function if exists stream_metrics_series(uuid, integer);

create or replace function stream_metrics_series(
  p_stream_id      uuid,
  p_bucket_seconds integer default 30
)
returns table(
  bucket   timestamptz,
  platform text,
  viewers  integer,
  comments bigint,
  bitrate  integer
)
language sql
stable
as $$
  select
    to_timestamp(
      floor(extract(epoch from sm.timestamp) / greatest(p_bucket_seconds, 1))
      * greatest(p_bucket_seconds, 1)
    )                                    as bucket,
    sm.platform,
    round(avg(sm.viewers))::integer      as viewers,
    sum(sm.comments_count)::bigint       as comments,
    round(avg(sm.bitrate_kbps))::integer as bitrate
  from stream_metrics sm
  where sm.stream_id = p_stream_id
  group by 1, sm.platform
  order by 1, sm.platform;
$$;

-- ── Discard the numbers produced by the old aggregation ──
--
-- Any platform_analytics row written before this migration came from a
-- pipeline that had no writer, so in a live database there are none. This is
-- here for the case of a database seeded by hand during development, where
-- leaving the rows would mix invented totals into a chart that is now
-- supposed to be real.
--
-- Commented out rather than run: it is a delete, and it should be a
-- decision, not a side effect of applying a migration.
--
--   delete from platform_analytics where recorded_at < now();
--   delete from stream_metrics;
