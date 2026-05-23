import { z } from 'zod';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticateAdmin, requireRole, getAdminUser } from '../../middleware/admin';
import { AdminAuthService } from './admin.auth.service';
import { adminBroadcastRoutes } from './admin.broadcast.routes';
import { AdminUsersService } from './admin.users.service';
import { AdminAnalyticsService } from './admin.analytics.service';
import { sendSuccess, sendCreated, sendNoContent, paginateMeta } from '../../utils/response';

const authSvc      = new AdminAuthService();
const usersSvc     = new AdminUsersService();
const analyticsSvc = new AdminAnalyticsService();

// ── Schemas ────────────────────────────────────────────────────────
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const paginationSchema = z.object({ page: z.coerce.number().min(1).default(1), limit: z.coerce.number().min(1).max(100).default(20) });
const flagSchema = z.object({ reason: z.string().min(3).max(500) });
const grantSchema = z.object({ billingCycle: z.enum(['monthly', 'annual']), notes: z.string().min(3).max(500) });
const createAdminSchema = z.object({ email: z.string().email(), password: z.string().min(8), full_name: z.string().min(2), role: z.enum(['admin', 'support']) });
const dateRangeSchema = z.object({
  from: z.string().datetime().default(() => new Date(Date.now() - 30 * 86_400_000).toISOString()),
  to:   z.string().datetime().default(() => new Date().toISOString()),
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
});

const TAG = 'Admin';
const SUPER = [requireRole('super_admin')];
const ALL_ADMIN = [requireRole('super_admin', 'admin', 'support')];
const ADMIN_ONLY = [requireRole('super_admin', 'admin')];

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {

  // ══ Public admin auth (no bearer needed) ══════════════════════
  fastify.post('/auth/login', {
    schema: {
      tags: [TAG], summary: 'Admin login — returns admin JWT tokens',
      body: { type: 'object', required: ['email','password'], properties: { email: { type: 'string' }, password: { type: 'string' } } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { email, password } = loginSchema.parse(req.body);
    const result = await authSvc.login(email, password, req.ip, req.headers['user-agent'] ?? '');
    sendSuccess(reply, result);
  });

  fastify.post('/auth/refresh', {
    schema: { tags: [TAG], summary: 'Refresh admin access token' },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    sendSuccess(reply, await authSvc.refresh(refreshToken));
  });

  // ══ All routes below require admin JWT ═════════════════════════
  fastify.register(async (r) => {
    r.addHook('preHandler', authenticateAdmin);

    // ── Admin auth ─────────────────────────────────────────────────
    r.post('/auth/logout', { schema: { tags: [TAG], summary: 'Admin logout', security: [{ bearerAuth: [] }] } },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const { refreshToken } = refreshSchema.parse(req.body);
        const admin = getAdminUser(req);
        await authSvc.logout(admin.sub, refreshToken);
        sendNoContent(reply);
      });

    r.get('/auth/me', { schema: { tags: [TAG], summary: 'Get current admin profile', security: [{ bearerAuth: [] }] } },
      async (req: FastifyRequest, reply: FastifyReply) => {
        sendSuccess(reply, getAdminUser(req));
      });

    // ── Create admin (super admin only) ────────────────────────────
    r.post('/admins', {
      schema: { tags: [TAG], summary: 'Create new admin user (super_admin only)', security: [{ bearerAuth: [] }] },
      preHandler: SUPER,
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const body = createAdminSchema.parse(req.body);
      sendCreated(reply, await authSvc.createAdmin(body), 'Admin user created');
    });

    // ══ Dashboard ═════════════════════════════════════════════════
    r.get('/dashboard', {
      schema: { tags: [TAG], summary: 'Admin dashboard — KPIs: users, revenue, subscriptions, streams', security: [{ bearerAuth: [] }] },
    }, async (_req, reply) => {
      sendSuccess(reply, await analyticsSvc.getDashboardStats());
    });

    // ══ Revenue & charts ═══════════════════════════════════════════
    r.get('/charts/revenue', {
      schema: { tags: [TAG], summary: 'Revenue chart data grouped by day/week/month', security: [{ bearerAuth: [] }] },
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { from, to, groupBy } = dateRangeSchema.parse(req.query);
      sendSuccess(reply, await analyticsSvc.getRevenueChart(from, to, groupBy));
    });

    r.get('/charts/user-growth', {
      schema: { tags: [TAG], summary: 'User growth chart (daily new signups)', security: [{ bearerAuth: [] }] },
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { from, to } = dateRangeSchema.parse(req.query);
      sendSuccess(reply, await analyticsSvc.getUserGrowthChart(from, to));
    });

    r.get('/charts/subscriptions', {
      schema: { tags: [TAG], summary: 'Subscription breakdown — monthly vs annual, active vs cancelled', security: [{ bearerAuth: [] }] },
    }, async (_req, reply) => {
      sendSuccess(reply, await analyticsSvc.getSubscriptionBreakdown());
    });

    r.get('/charts/platforms', {
      schema: { tags: [TAG], summary: 'Platform usage stats across all users', security: [{ bearerAuth: [] }] },
    }, async (_req, reply) => {
      sendSuccess(reply, await analyticsSvc.getPlatformStats());
    });

    // ══ Payments ══════════════════════════════════════════════════
    r.get('/payments', {
      schema: {
        tags: [TAG], summary: 'All payments with status filter', security: [{ bearerAuth: [] }],
        querystring: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, status: { type: 'string', enum: ['paid','pending','failed'] }, from: { type: 'string' }, to: { type: 'string' } } },
      },
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const q = { ...paginationSchema.parse(req.query), ...(req.query as Record<string, string>) };
      const { data, total } = await analyticsSvc.listPayments({ page: Number(q.page), limit: Number(q.limit), status: (q as { status?: string }).status, from: (q as { from?: string }).from, to: (q as { to?: string }).to });
      sendSuccess(reply, data, undefined, 200, paginateMeta(total, Number(q.page), Number(q.limit)));
    });

    r.get('/subscriptions', {
      schema: { tags: [TAG], summary: 'All subscriptions with status filter', security: [{ bearerAuth: [] }] },
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const q = paginationSchema.parse(req.query);
      const status = (req.query as { status?: string }).status;
      const { data, total } = await analyticsSvc.listSubscriptions({ ...q, status });
      sendSuccess(reply, data, undefined, 200, paginateMeta(total, q.page, q.limit));
    });

    // ══ User management ═══════════════════════════════════════════
    r.get('/users', {
      schema: {
        tags: [TAG], summary: 'List all users with search, plan and status filters', security: [{ bearerAuth: [] }],
        querystring: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, search: { type: 'string' }, plan: { type: 'string', enum: ['free','premium'] }, status: { type: 'string', enum: ['active','flagged','suspended','banned'] }, sortBy: { type: 'string' }, sortDir: { type: 'string', enum: ['asc','desc'] } } },
      },
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as Record<string, string>;
      const { data, total } = await usersSvc.listUsers({ page: Number(q.page ?? 1), limit: Number(q.limit ?? 20), search: q.search, plan: q.plan, status: q.status, sortBy: q.sortBy, sortDir: q.sortDir as 'asc' | 'desc' });
      sendSuccess(reply, data, undefined, 200, paginateMeta(total, Number(q.page ?? 1), Number(q.limit ?? 20)));
    });

    r.get('/users/:id', {
      schema: { tags: [TAG], summary: 'Get full user profile — subscription, streams, invoices, login history', security: [{ bearerAuth: [] }] },
    }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      sendSuccess(reply, await usersSvc.getUserDetail(req.params.id));
    });

    r.post('/users/:id/flag', {
      schema: { tags: [TAG], summary: 'Flag a user for review', security: [{ bearerAuth: [] }], preHandler: ADMIN_ONLY,
        body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } } },
    }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const admin = getAdminUser(req); const { reason } = flagSchema.parse(req.body);
      await usersSvc.flagUser(req.params.id, reason, admin.sub);
      sendSuccess(reply, null, 'User flagged');
    });

    r.post('/users/:id/suspend', {
      schema: { tags: [TAG], summary: 'Suspend a user — all sessions invalidated', security: [{ bearerAuth: [] }],
        body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } } },
      preHandler: ADMIN_ONLY,
    }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const admin = getAdminUser(req); const { reason } = flagSchema.parse(req.body);
      await usersSvc.suspendUser(req.params.id, reason, admin.sub);
      sendSuccess(reply, null, 'User suspended');
    });

    r.post('/users/:id/ban', {
      schema: { tags: [TAG], summary: 'Ban a user permanently', security: [{ bearerAuth: [] }] },
      preHandler: SUPER,
    }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const admin = getAdminUser(req); const { reason } = flagSchema.parse(req.body);
      await usersSvc.banUser(req.params.id, reason, admin.sub);
      sendSuccess(reply, null, 'User banned');
    });

    r.post('/users/:id/restore', {
      schema: { tags: [TAG], summary: 'Restore a flagged/suspended/banned user', security: [{ bearerAuth: [] }] },
      preHandler: ADMIN_ONLY,
    }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const admin = getAdminUser(req);
      await usersSvc.restoreUser(req.params.id, admin.sub);
      sendSuccess(reply, null, 'User restored to active');
    });

    r.delete('/users/:id', {
      schema: { tags: [TAG], summary: 'Permanently delete user and all data', security: [{ bearerAuth: [] }] },
      preHandler: SUPER,
    }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const admin = getAdminUser(req);
      await usersSvc.deleteUser(req.params.id, admin.sub);
      sendNoContent(reply);
    });

    // ══ Premium grant / revoke ════════════════════════════════════
    r.post('/users/:id/grant-premium', {
      schema: {
        tags: [TAG],
        summary: 'Manually grant Premium to a user (e.g. off-platform payment)',
        description: 'Grants Premium access, creates an audit trail invoice, and sends an automatic email to the user confirming their new subscription.',
        security: [{ bearerAuth: [] }],
        body: { type: 'object', required: ['billingCycle','notes'], properties: {
          billingCycle: { type: 'string', enum: ['monthly','annual'], description: 'How long to grant (monthly = 30 days, annual = 365 days)' },
          notes: { type: 'string', description: 'Reason for manual grant (e.g. "Paid via bank transfer Ref: XYZ")' },
        } },
      },
      preHandler: ADMIN_ONLY,
    }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const admin = getAdminUser(req);
      const { billingCycle, notes } = grantSchema.parse(req.body);
      await usersSvc.grantPremium({ userId: req.params.id, billingCycle, notes, adminId: admin.sub });
      sendSuccess(reply, null, 'Premium granted — confirmation email sent to user');
    });

    r.post('/users/:id/revoke-premium', {
      schema: { tags: [TAG], summary: 'Revoke Premium from a user', security: [{ bearerAuth: [] }],
        body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } } },
      preHandler: ADMIN_ONLY,
    }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const admin = getAdminUser(req); const { reason } = flagSchema.parse(req.body);
      await usersSvc.revokePremium(req.params.id, reason, admin.sub);
      sendSuccess(reply, null, 'Premium revoked');
    });

    // ══ Security & device intelligence ════════════════════════════
    r.get('/security/suspicious-logins', {
      schema: { tags: [TAG], summary: 'High-risk login attempts across all users', security: [{ bearerAuth: [] }] },
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const q = paginationSchema.parse(req.query);
      const { data, total } = await usersSvc.getSuspiciousLogins(q);
      sendSuccess(reply, data, undefined, 200, paginateMeta(total, q.page, q.limit));
    });

    r.get('/security/multi-account', {
      schema: {
        tags: [TAG],
        summary: 'Multi-account suspects — same device fingerprint used with different emails',
        description: 'Detects users who have logged in from the same device with different accounts, indicating possible multi-accounting or fraud.',
        security: [{ bearerAuth: [] }],
      },
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const q = paginationSchema.parse(req.query);
      const { data, total } = await usersSvc.getMultiAccountSuspects(q);
      sendSuccess(reply, data, undefined, 200, paginateMeta(total, q.page, q.limit));
    });

    // ══ Broadcasts ════════════════════════════════════════════════
    r.register(adminBroadcastRoutes, { prefix: '/broadcasts' });

    // ══ Audit log ═════════════════════════════════════════════════
    r.get('/audit-log', {
      schema: { tags: [TAG], summary: 'Admin action audit log — all admin actions with timestamps', security: [{ bearerAuth: [] }] },
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const q = paginationSchema.parse(req.query);
      const { data, total } = await analyticsSvc.getAuditLog(q);
      sendSuccess(reply, data, undefined, 200, paginateMeta(total, q.page, q.limit));
    });
  });
}
