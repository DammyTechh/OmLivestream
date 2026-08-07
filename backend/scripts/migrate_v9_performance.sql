-- ================================================================
-- OmliveStream — Migration v9: performance
-- ================================================================
-- Run AFTER migrate.sql, migrate_v2.sql and migrate_v3.sql.
--
-- Everything here replaces work that was being done in Node: either a
-- count-per-metric round trip, or a full table transferred over the wire
-- to be summed or grouped in JavaScript. Both patterns cost time
-- proportional to total table size rather than to the size of the answer,
-- which is what made the admin dashboard slower every week.
--
-- Safe to re-run.

-- ── Indexes that depend on columns added by later migrations ─────
-- Lives here rather than in migrate.sql because trial_expires_at is added
-- by migrate_v3.sql; naming it in the base migration aborts a fresh install.
create index if not exists idx_users_trial on users(plan, trial_expires_at);

-- Multi-account detection groups login_logs by device_fingerprint. The
-- existing index on fingerprint alone still has to visit the heap for
-- user_id; including it lets the grouping run index-only.
create index if not exists idx_login_logs_fp_user
  on login_logs(device_fingerprint, user_id)
  where device_fingerprint is not null;

-- The broadcast worker's drain loop asks for "the next 50 rows of this
-- broadcast that are still pending, by id" once per batch. migrate_v4.sql
-- indexes broadcast_id and status separately, which makes that a bitmap-and
-- plus a sort on every pass. This index matches the query exactly, so each
-- batch is a short index scan that stops after 50 rows — and because sent
-- rows leave the index, the scan does not get slower as the campaign
-- progresses.
create index if not exists idx_broadcast_logs_pending
  on broadcast_logs(broadcast_id, id)
  where status = 'pending';

-- ================================================================
-- admin_dashboard_stats — one round trip for the whole KPI header
-- ================================================================
-- Was 17 separate queries: 13 `count(*)` head requests plus 4 that pulled
-- every matching invoice row into Node to sum `amount`. The counts are
-- now `count(*) filter (...)`, so each table is scanned once for all of
-- its metrics instead of once per metric, and the sums never leave
-- Postgres.
--
-- Window boundaries are computed in UTC here, where the old code used the
-- Node process's local timezone. On Render (UTC) that is identical; it also
-- stops the numbers shifting with the server's TZ setting.
create or replace function admin_dashboard_stats()
returns json
language sql
stable
as $$
  with bounds as (
    select now() - interval '7 days'    as week_start,
           date_trunc('month', now())   as month_start
  ),
  u as (
    select
      count(*)                                                   as total,
      count(*) filter (where status = 'active')                   as active,
      count(*) filter (where plan   = 'premium')                  as premium,
      count(*) filter (where status = 'flagged')                  as flagged,
      count(*) filter (where status = 'suspended')                as suspended,
      count(*) filter (where status = 'banned')                   as banned,
      count(*) filter (where created_at >= b.week_start)          as new_week,
      count(*) filter (where created_at >= b.month_start)         as new_month
    from users, bounds b
    group by b.week_start, b.month_start
  ),
  s as (
    select count(*)                                as total,
           count(*) filter (where status = 'live') as live
    from streams
  ),
  i as (
    select
      coalesce(sum(amount) filter (where status = 'paid'), 0)     as revenue_total,
      coalesce(sum(amount) filter (
        where status = 'paid' and created_at >= b.month_start), 0) as revenue_month,
      coalesce(sum(amount) filter (where status = 'pending'), 0)  as revenue_pending,
      coalesce(sum(amount) filter (where status = 'failed'), 0)   as revenue_failed,
      count(*) filter (where status = 'pending')                  as count_pending,
      count(*) filter (where status = 'failed')                   as count_failed
    from invoices, bounds b
    group by b.month_start
  ),
  sub as (
    select
      count(*)                                                   as total,
      count(*) filter (where status = 'active')                  as active,
      count(*) filter (
        where status = 'cancelled' and updated_at >= b.month_start) as cancelled_month
    from subscriptions, bounds b
    group by b.month_start
  )
  select json_build_object(
    'users', json_build_object(
      'total',        coalesce(u.total, 0),
      'active',       coalesce(u.active, 0),
      'premium',      coalesce(u.premium, 0),
      'flagged',      coalesce(u.flagged, 0),
      'suspended',    coalesce(u.suspended, 0),
      'banned',       coalesce(u.banned, 0),
      'newThisWeek',  coalesce(u.new_week, 0),
      'newThisMonth', coalesce(u.new_month, 0)
    ),
    'streams', json_build_object(
      'total', coalesce(s.total, 0),
      'live',  coalesce(s.live, 0)
    ),
    'revenue', json_build_object(
      'total',     coalesce(i.revenue_total, 0),
      'thisMonth', coalesce(i.revenue_month, 0),
      'pending',   coalesce(i.revenue_pending, 0),
      'failed',    coalesce(i.revenue_failed, 0)
    ),
    'subscriptions', json_build_object(
      'total',              coalesce(sub.total, 0),
      'active',             coalesce(sub.active, 0),
      'cancelledThisMonth', coalesce(sub.cancelled_month, 0)
    ),
    'payments', json_build_object(
      'pending', coalesce(i.count_pending, 0),
      'failed',  coalesce(i.count_failed, 0)
    )
  )
  -- LEFT JOINs on true: an empty table makes its CTE return zero rows, and a
  -- plain cross join would then collapse the whole result to NULL. On a brand
  -- new deployment every one of these is empty.
  from            (select 1) one
  left join u   on true
  left join s   on true
  left join i   on true
  left join sub on true;
$$;
-- ================================================================
-- analytics_overview — replaces the uuid[] version from migrate.sql
-- ================================================================
-- The old signature took an array of stream ids, which the route built by
-- first querying `streams ... limit(500)`. That capped a heavy user's
-- analytics at an arbitrary 500 streams — unordered, so which 500 was up to
-- the planner — and reported the truncated total as if it were complete.
--
-- Taking the user id instead does the ownership join inside Postgres: no
-- truncation, no second round trip, and no request carrying 500 UUIDs.
--
-- Dropped explicitly rather than replaced: the parameter types differ, so
-- `create or replace` would leave both versions installed as overloads and
-- PostgREST would have to guess which one an RPC call meant.
drop function if exists analytics_overview(uuid[], timestamptz, timestamptz);

create or replace function analytics_overview(
  p_user_id uuid,
  p_from    timestamptz,
  p_to      timestamptz
)
returns table(platform text, total_views bigint, total_impressions bigint, total_comments bigint)
language sql
stable
as $$
  select
    sm.platform,
    coalesce(sum(sm.viewers), 0)::bigint        as total_views,
    coalesce(sum(sm.impressions), 0)::bigint    as total_impressions,
    coalesce(sum(sm.comments_count), 0)::bigint as total_comments
  from stream_metrics sm
  join streams st on st.id = sm.stream_id
  where st.user_id = p_user_id
    and sm.timestamp >= p_from
    and sm.timestamp <= p_to
  group by sm.platform;
$$;

-- ================================================================
-- stream_metrics_series — downsampled chart data for one stream
-- ================================================================
-- The route was reading raw rows with `limit(2000)`. A three-hour stream
-- across eight platforms emits a row every few seconds — on the order of
-- 17,000 rows — so 2,000 covered roughly the first twenty minutes and the
-- chart rendered that as the whole broadcast. Truncating a time series from
-- the front is worse than aggregating it: the graph looked complete and was
-- wrong.
--
-- Bucketing to a fixed interval bounds the row count by stream *duration*
-- rather than by sample rate, and returns the full span at a resolution a
-- chart can actually draw. Viewers are averaged within a bucket because
-- concurrent viewers is a level, not a total; impressions and comments are
-- summed because they are counts.
create or replace function stream_metrics_series(
  p_stream_id      uuid,
  p_bucket_seconds integer default 30
)
returns table(
  bucket      timestamptz,
  platform    text,
  viewers     integer,
  impressions bigint,
  comments    bigint,
  bitrate     integer
)
language sql
stable
as $$
  select
    to_timestamp(
      floor(extract(epoch from sm.timestamp) / greatest(p_bucket_seconds, 1))
      * greatest(p_bucket_seconds, 1)
    )                                            as bucket,
    sm.platform,
    round(avg(sm.viewers))::integer              as viewers,
    sum(sm.impressions)::bigint                  as impressions,
    sum(sm.comments_count)::bigint               as comments,
    round(avg(sm.bitrate_kbps))::integer         as bitrate
  from stream_metrics sm
  where sm.stream_id = p_stream_id
  group by 1, sm.platform
  order by 1, sm.platform;
$$;

-- ================================================================
-- admin_subscription_breakdown — five counts, one scan
-- ================================================================
create or replace function admin_subscription_breakdown()
returns json
language sql
stable
as $$
  select json_build_object(
    'monthly',   count(*) filter (where billing_cycle = 'monthly' and status = 'active'),
    'annual',    count(*) filter (where billing_cycle = 'annual'  and status = 'active'),
    'active',    count(*) filter (where status = 'active'),
    'cancelled', count(*) filter (where status = 'cancelled'),
    'pastDue',   count(*) filter (where status = 'past_due')
  )
  from subscriptions;
$$;

-- ================================================================
-- admin_platform_stats — connection counts per platform
-- ================================================================
-- Was: select every row of platform_connections and tally them in a JS
-- loop. With 5k users across 8 platforms that is up to 40k rows crossing
-- the wire to produce roughly sixteen integers.
-- Every column below is qualified with its table alias. RETURNS TABLE names
-- are OUT parameters and share a namespace with column names inside the body,
-- so a bare `platform` here is ambiguous against platform_connections.platform.
-- An alias cannot refer to a parameter, which removes the ambiguity outright.
create or replace function admin_platform_stats()
returns table(platform text, total bigint, connected bigint)
language sql
stable
as $$
  select pc.platform,
         count(*)                                        as total,
         count(*) filter (where pc.status = 'connected') as connected
  from platform_connections pc
  group by pc.platform
  order by pc.platform;
$$;

-- ================================================================
-- admin_revenue_chart — paid invoice totals bucketed by period
-- ================================================================
-- date_trunc does the bucketing that a JS loop was doing over every
-- invoice in the range. p_group_by is validated against a fixed list
-- rather than interpolated, so it cannot carry SQL.
-- Columns qualified with their alias: the RETURNS TABLE output column is
-- also named `amount`, and a bare reference would be ambiguous.
create or replace function admin_revenue_chart(
  p_from     timestamptz,
  p_to       timestamptz,
  p_group_by text default 'day'
)
returns table(bucket date, amount bigint)
language sql
stable
as $$
  select date_trunc(
           case p_group_by when 'month' then 'month'
                           when 'week'  then 'week'
                           else 'day' end,
           inv.created_at
         )::date            as bucket,
         sum(inv.amount)::bigint as amount
  from invoices inv
  where inv.status = 'paid'
    and inv.created_at >= p_from
    and inv.created_at <= p_to
  group by 1
  order by 1;
$$;

-- ================================================================
-- admin_user_growth — signups per day, split by plan
-- ================================================================
create or replace function admin_user_growth(
  p_from timestamptz,
  p_to   timestamptz
)
returns table(bucket date, total bigint, free bigint, premium bigint)
language sql
stable
as $$
  select u.created_at::date                          as bucket,
         count(*)                                   as total,
         count(*) filter (where u.plan <> 'premium') as free,
         count(*) filter (where u.plan =  'premium') as premium
  from users u
  where u.created_at >= p_from
    and u.created_at <= p_to
  group by 1
  order by 1;
$$;

-- ================================================================
-- admin_multi_account_suspects — one device, several accounts
-- ================================================================
-- Was: the entire login_logs table with a joined users row for each,
-- grouped in Node, then paginated with Array.slice — so page 1 and page 50
-- did exactly the same amount of work, and that work grew with every
-- login anyone ever made.
--
-- Returns the suspect groups already ordered and paginated, plus the full
-- group count so the caller can render pagination without a second pass.
-- Returns one JSON object holding both the page and the overall group count.
-- A `count(*) over ()` window column cannot carry the total here: when the
-- requested offset is past the end, the function returns no rows at all and
-- the total would vanish with them, making "page 5 of 3" indistinguishable
-- from "no suspects found".
create or replace function admin_multi_account_suspects(
  p_limit  integer default 20,
  p_offset integer default 0
)
returns json
language sql
stable
as $$
  with groups as (
    select l.device_fingerprint    as fp,
           count(distinct l.user_id) as n
    from login_logs l
    where l.device_fingerprint is not null
    group by l.device_fingerprint
    having count(distinct l.user_id) > 1
  ),
  page as (
    select g.fp, g.n
    from groups g
    order by g.n desc, g.fp
    limit p_limit offset p_offset
  )
  select json_build_object(
    'total', (select count(*) from groups),
    'data',  coalesce((
      select json_agg(json_build_object(
               'fingerprint', p.fp,
               'userCount',   p.n,
               'users', (
                 select json_agg(json_build_object(
                          'id',     u.id,
                          'email',  u.email,
                          'name',   coalesce(u.full_name, ''),
                          'status', u.status)
                        order by u.email)
                 from (select distinct l2.user_id
                       from login_logs l2
                       where l2.device_fingerprint = p.fp) d
                 join users u on u.id = d.user_id
               ))
             order by p.n desc, p.fp)
      from page p
    ), '[]'::json)
  );
$$;
