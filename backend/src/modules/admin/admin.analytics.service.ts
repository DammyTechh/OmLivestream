import { supabaseAdmin } from '../../config/supabase';

export class AdminAnalyticsService {

  // ── Dashboard KPIs ───────────────────────────────────────────────
  async getDashboardStats() {
    const now = new Date();
    const startOfWeek  = new Date(now); startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
    const startOfYear  = new Date(now.getFullYear(), 0, 1);

    const [
      { count: totalUsers },
      { count: activeUsers },
      { count: premiumUsers },
      { count: flaggedUsers },
      { count: suspendedUsers },
      { count: bannedUsers },
      { count: totalStreams },
      { count: liveStreams },
      { count: newUsersThisWeek },
      { count: newUsersThisMonth },
      { data: revenueData },
      { data: revenueThisMonth },
      { data: pendingPayments },
      { data: failedPayments },
      { count: totalSubscriptions },
      { count: activeSubscriptions },
      { count: cancelledThisMonth },
    ] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('plan', 'premium'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('status', 'flagged'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('status', 'suspended'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('status', 'banned'),
      supabaseAdmin.from('streams').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('streams').select('*', { count: 'exact', head: true }).eq('status', 'live'),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).gte('created_at', startOfWeek.toISOString()),
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).gte('created_at', startOfMonth.toISOString()),
      supabaseAdmin.from('invoices').select('amount').eq('status', 'paid'),
      supabaseAdmin.from('invoices').select('amount').eq('status', 'paid').gte('created_at', startOfMonth.toISOString()),
      supabaseAdmin.from('invoices').select('amount, created_at').eq('status', 'pending'),
      supabaseAdmin.from('invoices').select('amount, created_at').eq('status', 'failed'),
      supabaseAdmin.from('subscriptions').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabaseAdmin.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'cancelled').gte('updated_at', startOfMonth.toISOString()),
    ]);

    const totalRevenue      = (revenueData      ?? []).reduce((s, r) => s + r.amount, 0);
    const revenueThisMonthN = (revenueThisMonth ?? []).reduce((s, r) => s + r.amount, 0);
    const pendingRevenue    = (pendingPayments   ?? []).reduce((s, r) => s + r.amount, 0);
    const failedRevenue     = (failedPayments    ?? []).reduce((s, r) => s + r.amount, 0);

    return {
      users: {
        total: totalUsers ?? 0,
        active: activeUsers ?? 0,
        premium: premiumUsers ?? 0,
        flagged: flaggedUsers ?? 0,
        suspended: suspendedUsers ?? 0,
        banned: bannedUsers ?? 0,
        newThisWeek: newUsersThisWeek ?? 0,
        newThisMonth: newUsersThisMonth ?? 0,
      },
      streams: {
        total: totalStreams ?? 0,
        live: liveStreams ?? 0,
      },
      revenue: {
        total: totalRevenue,
        thisMonth: revenueThisMonthN,
        pending: pendingRevenue,
        failed: failedRevenue,
        totalFormatted: `₦${(totalRevenue / 100).toLocaleString('en-NG')}`,
        thisMonthFormatted: `₦${(revenueThisMonthN / 100).toLocaleString('en-NG')}`,
      },
      subscriptions: {
        total: totalSubscriptions ?? 0,
        active: activeSubscriptions ?? 0,
        cancelledThisMonth: cancelledThisMonth ?? 0,
      },
      payments: {
        pending: pendingPayments?.length ?? 0,
        failed: failedPayments?.length ?? 0,
      },
    };
  }

  // ── Revenue chart (daily for a date range) ───────────────────────
  async getRevenueChart(from: string, to: string, groupBy: 'day' | 'week' | 'month' = 'day') {
    const { data, error } = await supabaseAdmin
      .from('invoices')
      .select('amount, created_at, status, currency')
      .eq('status', 'paid')
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Group by period
    const groups: Record<string, number> = {};
    for (const inv of data ?? []) {
      const d = new Date(inv.created_at);
      let key: string;
      if (groupBy === 'month') {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      } else if (groupBy === 'week') {
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        key = weekStart.toISOString().slice(0, 10);
      } else {
        key = d.toISOString().slice(0, 10);
      }
      groups[key] = (groups[key] ?? 0) + inv.amount;
    }

    return Object.entries(groups).map(([date, amount]) => ({
      date,
      amount,
      formatted: `₦${(amount / 100).toLocaleString('en-NG')}`,
    }));
  }

  // ── User growth chart ────────────────────────────────────────────
  async getUserGrowthChart(from: string, to: string) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('created_at, plan')
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const groups: Record<string, { total: number; free: number; premium: number }> = {};
    for (const u of data ?? []) {
      const key = new Date(u.created_at).toISOString().slice(0, 10);
      if (!groups[key]) groups[key] = { total: 0, free: 0, premium: 0 };
      groups[key].total++;
      u.plan === 'premium' ? groups[key].premium++ : groups[key].free++;
    }

    return Object.entries(groups).map(([date, counts]) => ({ date, ...counts }));
  }

  // ── Subscription breakdown ───────────────────────────────────────
  async getSubscriptionBreakdown() {
    const [
      { count: monthly },
      { count: annual },
      { count: active },
      { count: cancelled },
      { count: pastDue },
    ] = await Promise.all([
      supabaseAdmin.from('subscriptions').select('*', { count: 'exact', head: true }).eq('billing_cycle', 'monthly').eq('status', 'active'),
      supabaseAdmin.from('subscriptions').select('*', { count: 'exact', head: true }).eq('billing_cycle', 'annual').eq('status', 'active'),
      supabaseAdmin.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabaseAdmin.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'cancelled'),
      supabaseAdmin.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'past_due'),
    ]);

    return { monthly: monthly ?? 0, annual: annual ?? 0, active: active ?? 0, cancelled: cancelled ?? 0, pastDue: pastDue ?? 0 };
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
  async getPlatformStats() {
    const { data } = await supabaseAdmin
      .from('platform_connections')
      .select('platform, status');

    const stats: Record<string, { total: number; connected: number }> = {};
    for (const conn of data ?? []) {
      if (!stats[conn.platform]) stats[conn.platform] = { total: 0, connected: 0 };
      stats[conn.platform].total++;
      if (conn.status === 'connected') stats[conn.platform].connected++;
    }
    return stats;
  }
}
