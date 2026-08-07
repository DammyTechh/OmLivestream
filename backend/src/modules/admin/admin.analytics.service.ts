import { supabaseAdmin } from '../../config/supabase';
import { logger } from '../../config/logger';

/** Kobo → "₦1,234". Paystack amounts are minor units throughout. */
const naira = (kobo: number): string =>
  `₦${(kobo / 100).toLocaleString('en-NG')}`;

interface DashboardStats {
  users: {
    total: number; active: number; premium: number; flagged: number;
    suspended: number; banned: number; newThisWeek: number; newThisMonth: number;
  };
  streams: { total: number; live: number };
  revenue: { total: number; thisMonth: number; pending: number; failed: number };
  subscriptions: { total: number; active: number; cancelledThisMonth: number };
  payments: { pending: number; failed: number };
}

export class AdminAnalyticsService {

  // ── Dashboard KPIs ───────────────────────────────────────────────
  /**
   * The whole KPI header in a single round trip.
   *
   * This was 17 concurrent queries: 13 `count: 'exact', head: true` calls —
   * each of which is a full scan, since Postgres cannot answer a filtered
   * count from an index alone — plus 4 that selected every matching invoice
   * and summed `amount` in JavaScript. Concurrency hid the cost at small
   * scale but not the growth: the four sums transferred every invoice ever
   * issued, so the dashboard got slower with each month of trading.
   *
   * admin_dashboard_stats() scans each table once for all of its metrics
   * using `count(*) filter (...)` and returns a single JSON row.
   */
  async getDashboardStats() {
    const { data, error } = await supabaseAdmin.rpc('admin_dashboard_stats');

    if (error || !data) {
      // Surfaced rather than swallowed: an empty dashboard reads as "no
      // users, no revenue", which is indistinguishable from a real zero.
      logger.error({ err: error }, 'admin_dashboard_stats RPC failed — run migrate_v9_performance.sql');
      throw error ?? new Error('Dashboard stats unavailable');
    }

    const s = data as DashboardStats;

    return {
      ...s,
      revenue: {
        ...s.revenue,
        totalFormatted:     naira(s.revenue.total),
        thisMonthFormatted: naira(s.revenue.thisMonth),
      },
    };
  }

  // ── Revenue chart (daily for a date range) ───────────────────────
  /**
   * Bucketing moved into date_trunc. The JS version pulled every paid
   * invoice in the range to build what is at most a few hundred points.
   */
  async getRevenueChart(from: string, to: string, groupBy: 'day' | 'week' | 'month' = 'day') {
    const { data, error } = await supabaseAdmin.rpc('admin_revenue_chart', {
      p_from: from, p_to: to, p_group_by: groupBy,
    });

    if (error) throw error;

    return (data as { bucket: string; amount: number }[] ?? []).map(r => ({
      date:      r.bucket,
      amount:    Number(r.amount),
      formatted: naira(Number(r.amount)),
    }));
  }

  // ── User growth chart ────────────────────────────────────────────
  async getUserGrowthChart(from: string, to: string) {
    const { data, error } = await supabaseAdmin.rpc('admin_user_growth', {
      p_from: from, p_to: to,
    });

    if (error) throw error;

    return (data as { bucket: string; total: number; free: number; premium: number }[] ?? [])
      .map(r => ({
        date:    r.bucket,
        // bigint arrives as a string over PostgREST for values past 2^53;
        // Number() keeps the response shape numeric either way.
        total:   Number(r.total),
        free:    Number(r.free),
        premium: Number(r.premium),
      }));
  }

  // ── Subscription breakdown ───────────────────────────────────────
  /** Five filtered counts over the same table — one scan, not five. */
  async getSubscriptionBreakdown() {
    const { data, error } = await supabaseAdmin.rpc('admin_subscription_breakdown');
    if (error) throw error;

    const d = (data ?? {}) as Record<string, number>;
    return {
      monthly:   Number(d.monthly   ?? 0),
      annual:    Number(d.annual    ?? 0),
      active:    Number(d.active    ?? 0),
      cancelled: Number(d.cancelled ?? 0),
      pastDue:   Number(d.pastDue   ?? 0),
    };
  }

  // ── All payments with filters ────────────────────────────────────
  async listPayments(opts: { page: number; limit: number; status?: string; from?: string; to?: string }) {
    let query = supabaseAdmin
      .from('invoices')
      .select('*, users(id, email, full_name)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (opts.status) query = query.eq('status', opts.status);
    if (opts.from)   query = query.gte('created_at', opts.from);
    if (opts.to)     query = query.lte('created_at', opts.to);
    query = query.range((opts.page - 1) * opts.limit, opts.page * opts.limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  // ── All subscriptions with filters ──────────────────────────────
  async listSubscriptions(opts: { page: number; limit: number; status?: string }) {
    let query = supabaseAdmin
      .from('subscriptions')
      .select('*, users(id, email, full_name, plan)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (opts.status) query = query.eq('status', opts.status);
    query = query.range((opts.page - 1) * opts.limit, opts.page * opts.limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  // ── Admin audit log ──────────────────────────────────────────────
  async getAuditLog(opts: { page: number; limit: number }) {
    const { data, error, count } = await supabaseAdmin
      .from('admin_audit_logs')
      .select('*, admin_users(email, full_name), users:target_user_id(email, full_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((opts.page - 1) * opts.limit, opts.page * opts.limit - 1);

    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  // ── Platform usage stats ─────────────────────────────────────────
  /**
   * Counted in Postgres. The JS tally read every connection row — up to
   * eight per user — to produce two integers per platform.
   *
   * Still keyed by platform name in the response so the frontend contract
   * is unchanged.
   */
  async getPlatformStats() {
    const { data, error } = await supabaseAdmin.rpc('admin_platform_stats');
    if (error) throw error;

    const rows = (data as { platform: string; total: number; connected: number }[]) ?? [];
    const stats: Record<string, { total: number; connected: number }> = {};
    for (const r of rows) {
      stats[r.platform] = { total: Number(r.total), connected: Number(r.connected) };
    }
    return stats;
  }
}
