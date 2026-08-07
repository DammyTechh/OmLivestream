import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../../config/supabase';
import { NotFoundError, AppError } from '../../utils/errors';
import { EmailService } from '../email/email.service';
import type { UserStatus } from '../../types/database';

const emailService = new EmailService();

export class AdminUsersService {

  // ── User list with filters ──────────────────────────────────────
  async listUsers(opts: {
    page: number;
    limit: number;
    search?: string;
    plan?: string;
    status?: string;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
  }) {
    let query = supabaseAdmin
      .from('users')
      .select('id,email,full_name,plan,status,is_verified,created_at,last_stream_ended_at', { count: 'exact' });

    if (opts.search) {
      query = query.or(`email.ilike.%${opts.search}%,full_name.ilike.%${opts.search}%`);
    }
    if (opts.plan) query = query.eq('plan', opts.plan);
    if (opts.status) query = query.eq('status', opts.status);

    const sortCol = opts.sortBy ?? 'created_at';
    const sortDir = opts.sortDir ?? 'desc';
    query = query.order(sortCol, { ascending: sortDir === 'asc' });
    query = query.range((opts.page - 1) * opts.limit, opts.page * opts.limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  // ── Get single user with full profile ──────────────────────────
  async getUserDetail(userId: string) {
    const [
      { data: user },
      { data: subscription },
      { data: streams, count: streamCount },
      { data: invoices },
      { data: loginLogs },
      { data: platforms },
    ] = await Promise.all([
      supabaseAdmin.from('users').select('*').eq('id', userId).single(),
      supabaseAdmin.from('subscriptions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).single(),
      supabaseAdmin.from('streams').select('id,title,status,started_at,ended_at', { count: 'exact' }).eq('user_id', userId).order('created_at', { ascending: false }).limit(5),
      supabaseAdmin.from('invoices').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
      supabaseAdmin.from('login_logs').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
      supabaseAdmin.from('platform_connections').select('platform,status,platform_username,connected_at').eq('user_id', userId),
    ]);

    if (!user) throw new NotFoundError('User');

    return {
      user,
      subscription: subscription ?? null,
      recentStreams: streams ?? [],
      totalStreams: streamCount ?? 0,
      invoices: invoices ?? [],
      loginHistory: loginLogs ?? [],
      platforms: platforms ?? [],
    };
  }

  // ── Flag user ───────────────────────────────────────────────────
  async flagUser(userId: string, reason: string, adminId: string) {
    await this.requireUser(userId);
    await supabaseAdmin.from('users')
      .update({ status: 'flagged', updated_at: new Date().toISOString() })
      .eq('id', userId);

    await supabaseAdmin.from('admin_audit_logs').insert({
      id: uuidv4(), admin_id: adminId, action: 'flag_user',
      target_user_id: userId, notes: reason, created_at: new Date().toISOString(),
    });
  }

  // ── Suspend user ────────────────────────────────────────────────
  async suspendUser(userId: string, reason: string, adminId: string) {
    await this.requireUser(userId);
    await supabaseAdmin.from('users')
      .update({ status: 'suspended', updated_at: new Date().toISOString() })
      .eq('id', userId);

    // Invalidate all user sessions
    await supabaseAdmin.from('sessions').delete().eq('user_id', userId);

    await supabaseAdmin.from('admin_audit_logs').insert({
      id: uuidv4(), admin_id: adminId, action: 'suspend_user',
      target_user_id: userId, notes: reason, created_at: new Date().toISOString(),
    });
  }

  // ── Ban user ────────────────────────────────────────────────────
  async banUser(userId: string, reason: string, adminId: string) {
    await this.requireUser(userId);
    await supabaseAdmin.from('users')
      .update({ status: 'banned', updated_at: new Date().toISOString() })
      .eq('id', userId);

    await supabaseAdmin.from('sessions').delete().eq('user_id', userId);

    await supabaseAdmin.from('admin_audit_logs').insert({
      id: uuidv4(), admin_id: adminId, action: 'ban_user',
      target_user_id: userId, notes: reason, created_at: new Date().toISOString(),
    });
  }

  // ── Restore user ────────────────────────────────────────────────
  async restoreUser(userId: string, adminId: string) {
    await this.requireUser(userId);
    await supabaseAdmin.from('users')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', userId);

    await supabaseAdmin.from('admin_audit_logs').insert({
      id: uuidv4(), admin_id: adminId, action: 'restore_user',
      target_user_id: userId, notes: 'Account restored by admin', created_at: new Date().toISOString(),
    });
  }

  // ── Manual premium grant ─────────────────────────────────────────
  // Used when user pays outside the app (bank transfer, cash, etc.)
  async grantPremium(payload: {
    userId: string;
    billingCycle: 'monthly' | 'annual';
    notes: string;
    adminId: string;
  }) {
    const { data: user } = await supabaseAdmin
      .from('users').select('id,email,full_name').eq('id', payload.userId).single();
    if (!user) throw new NotFoundError('User');

    const now = new Date();
    const periodEnd = new Date(now);
    payload.billingCycle === 'annual'
      ? periodEnd.setFullYear(periodEnd.getFullYear() + 1)
      : periodEnd.setMonth(periodEnd.getMonth() + 1);

    // Upsert subscription
    await supabaseAdmin.from('subscriptions').upsert({
      id: uuidv4(),
      user_id: payload.userId,
      plan: 'premium',
      billing_cycle: payload.billingCycle,
      status: 'active',
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
    }, { onConflict: 'user_id' });

    // Upgrade user plan
    await supabaseAdmin.from('users')
      .update({ plan: 'premium', updated_at: now.toISOString() })
      .eq('id', payload.userId);

    // Create invoice record for audit trail
    await supabaseAdmin.from('invoices').insert({
      id: uuidv4(),
      user_id: payload.userId,
      amount: 0,
      currency: 'NGN',
      status: 'paid',
      paystack_reference: `ADMIN_GRANT_${uuidv4().slice(0, 8).toUpperCase()}`,
      receipt_url: null,
    });

    // Audit log
    await supabaseAdmin.from('admin_audit_logs').insert({
      id: uuidv4(),
      admin_id: payload.adminId,
      action: 'grant_premium',
      target_user_id: payload.userId,
      notes: payload.notes,
      created_at: now.toISOString(),
    });

    // Email user about their new premium access
    await emailService.sendAdminGrantedPremiumEmail(
      user.email,
      user.full_name ?? 'Creator',
      payload.billingCycle,
      periodEnd.toISOString()
    );
  }

  // ── Revoke premium ───────────────────────────────────────────────
  async revokePremium(userId: string, reason: string, adminId: string) {
    await supabaseAdmin.from('subscriptions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('status', 'active');

    await supabaseAdmin.from('users')
      .update({ plan: 'free', updated_at: new Date().toISOString() })
      .eq('id', userId);

    await supabaseAdmin.from('admin_audit_logs').insert({
      id: uuidv4(), admin_id: adminId, action: 'revoke_premium',
      target_user_id: userId, notes: reason, created_at: new Date().toISOString(),
    });
  }

  // ── Suspicious device detection ──────────────────────────────────
  async getSuspiciousLogins(opts: { page: number; limit: number }) {
    const { data, error, count } = await supabaseAdmin
      .from('login_logs')
      .select(`
        *,
        users(id, email, full_name, status)
      `, { count: 'exact' })
      .eq('risk_level', 'high')
      .order('created_at', { ascending: false })
      .range((opts.page - 1) * opts.limit, opts.page * opts.limit - 1);

    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  // ── Multi-account detection (same device, different emails) ──────
  /**
   * Device fingerprints seen on more than one account.
   *
   * This previously selected the entire login_logs table — every login by
   * every user, each with a joined users row — grouped it into an object in
   * Node, and then paginated the result with Array.slice. Three consequences:
   * asking for page 1 cost exactly as much as asking for page 50; the cost
   * grew with total login history rather than with the number of suspects;
   * and a busy month of logins could exhaust the heap on a small instance.
   *
   * The grouping, the >1 filter, the ordering and the pagination now all
   * happen in Postgres, so what crosses the wire is one page of suspects.
   */
  async getMultiAccountSuspects(opts: { page: number; limit: number }) {
    const { data, error } = await supabaseAdmin.rpc('admin_multi_account_suspects', {
      p_limit:  opts.limit,
      p_offset: (opts.page - 1) * opts.limit,
    });

    if (error) throw error;

    const result = (data ?? { total: 0, data: [] }) as {
      total: number;
      data: {
        fingerprint: string;
        userCount: number;
        users: { id: string; email: string; name: string; status: string }[];
      }[];
    };

    return {
      data: (result.data ?? []).map(r => ({
        fingerprint: r.fingerprint,
        users:       r.users ?? [],
      })),
      total: Number(result.total ?? 0),
    };
  }

  // ── Delete user account ──────────────────────────────────────────
  async deleteUser(userId: string, adminId: string) {
    // Cascades via FK on delete
    await supabaseAdmin.from('users').delete().eq('id', userId);
    await supabaseAdmin.from('admin_audit_logs').insert({
      id: uuidv4(), admin_id: adminId, action: 'delete_user',
      target_user_id: userId, notes: 'User account deleted', created_at: new Date().toISOString(),
    });
  }

  private async requireUser(userId: string) {
    const { data } = await supabaseAdmin.from('users').select('id').eq('id', userId).single();
    if (!data) throw new NotFoundError('User');
  }
}
