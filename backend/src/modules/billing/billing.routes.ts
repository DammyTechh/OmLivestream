import axios from 'axios';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabaseAdmin } from '../../config/supabase';
import { env, urls } from '../../config/env';
import { authenticate, validatePaystackWebhook } from '../../middleware/auth';
import { getAuthUser } from '../../utils/jwt';
import { sendSuccess } from '../../utils/response';
import { AppError, PaymentError } from '../../utils/errors';
import { EmailService } from '../email/email.service';

const emailService = new EmailService();
const PS = 'https://api.paystack.co';
const psH = () => ({ Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` });

const PLANS = {
  premium_monthly: { name: 'Premium Monthly', amount: 500000,  currency: 'NGN' },
  premium_annual:  { name: 'Premium Annual',  amount: 5000000, currency: 'NGN' },
};

const subscribeSchema = z.object({
  plan:          z.literal('premium'),
  billingCycle:  z.enum(['monthly', 'annual']),
  paymentMethod: z.enum(['card', 'google_pay']).default('card'),
  discountCode:  z.string().trim().max(64).optional(),
});

export async function billingRoutes(fastify: FastifyInstance): Promise<void> {

  // Paystack webhook (public — validated by HMAC-SHA512)
  fastify.post('/webhooks/paystack', {
    schema: { tags: ['Billing'], summary: 'Paystack webhook — internal' },
    preHandler: [validatePaystackWebhook],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    await handlePaystackEvent(
      (req.body as { event: string }).event,
      (req.body as { data: Record<string, unknown> }).data
    );
    sendSuccess(reply, null, 'ok');
  });

  fastify.register(async (r) => {
    r.addHook('preHandler', authenticate);

    // Plans
    r.get('/plans', { schema: { tags: ['Billing'], summary: 'Subscription plans + pricing', security: [{ bearerAuth: [] }] } },
      async (_req, reply) => sendSuccess(reply, Object.entries(PLANS).map(([id, p]) => ({
        id, ...p, amountFormatted: `₦${(p.amount / 100).toLocaleString('en-NG')}`,
      }))));

    // Subscribe — card or Google Pay
    r.post('/subscribe', {
      schema: {
        tags: ['Billing'],
        summary: 'Initialise Paystack payment — card or Google Pay',
        description: '**paymentMethod: `card`** → standard Paystack checkout. **`google_pay`** → Google Pay sheet on mobile (biometric auth, no manual card entry). Card data never reaches OmliveStream servers.',
        security: [{ bearerAuth: [] }],
        body: { type: 'object', required: ['plan','billingCycle'],
          properties: {
            plan: { type: 'string', enum: ['premium'] },
            billingCycle: { type: 'string', enum: ['monthly','annual'] },
            paymentMethod: { type: 'string', enum: ['card','google_pay'], default: 'card' },
            discountCode: { type: 'string', maxLength: 64 },
          } },
      },
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const u = getAuthUser(req);
      const { plan, billingCycle, paymentMethod, discountCode } = subscribeSchema.parse(req.body);
      const planKey   = `premium_${billingCycle}` as keyof typeof PLANS;
      const cfg       = PLANS[planKey];
      const reference = `omls_${u.id.slice(0,8)}_${Date.now()}`;
      const { data: profile } = await supabaseAdmin.from('users').select('email').eq('id', u.id).single();

      const body: Record<string, unknown> = {
        email: profile?.email ?? u.email, amount: cfg.amount, currency: cfg.currency, reference,
        callback_url: `${urls.payment}/callback`,
        metadata: { userId: u.id, plan, billingCycle, paymentMethod, discountCode: discountCode || null },
      };

      if (paymentMethod === 'google_pay') {
        body.channels = ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer'];
        body.metadata = { ...(body.metadata as object), preferred_channel: 'google_pay' };
      }

      const secret = env.PAYSTACK_SECRET_KEY;
      if (!secret || secret === 'sk_live_your_secret_key' || secret === 'sk_test_your_secret_key' || secret.length < 20) {
        req.log.error('PAYSTACK_SECRET_KEY is not configured — payment cannot proceed');
        throw new PaymentError(
          'Payments are temporarily unavailable. Please try again later or contact support@omlivestream.com.'
        );
      }

      try {
        const resp = await axios.post(`${PS}/transaction/initialize`, body, { headers: psH() });
        if (!resp.data.status) throw new PaymentError('We couldn\'t start your payment. Please try again.');
        sendSuccess(reply, { paystackAuthUrl: resp.data.data.authorization_url, reference, paymentMethod });
      } catch (err: any) {
        if (err?.response?.status === 401) {
          req.log.error({ paystackErr: err.response?.data }, 'Paystack 401 — check PAYSTACK_SECRET_KEY');
          throw new PaymentError(
            'Payments are temporarily unavailable. Please try again later or contact support@omlivestream.com.'
          );
        }
        if (err?.response?.status >= 400 && err?.response?.status < 500) {
          const msg = err.response?.data?.message || 'Your payment could not be processed.';
          throw new PaymentError(msg);
        }
        if (err instanceof PaymentError) throw err;
        req.log.error({ err }, 'Paystack init failed');
        throw new PaymentError('We couldn\'t start your payment right now. Please try again in a moment.');
      }
    });

    // User payment dashboard
    r.get('/dashboard', {
      schema: { tags: ['Billing'], summary: 'Full user payment dashboard — plan, subscription, invoices, spending', security: [{ bearerAuth: [] }] },
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const u = getAuthUser(req);
      const [{ data: sub }, { data: invoices }, { data: user }] = await Promise.all([
        supabaseAdmin.from('subscriptions').select('*').eq('user_id', u.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.from('invoices').select('*').eq('user_id', u.id).order('created_at', { ascending: false }).limit(24),
        supabaseAdmin.from('users').select('plan').eq('id', u.id).single(),
      ]);
      const totalSpend = (invoices ?? []).filter(i => i.status === 'paid').reduce((s,i) => s + i.amount, 0);
      sendSuccess(reply, {
        currentPlan: user?.plan ?? 'free',
        subscription: sub ? {
          ...sub,
          daysRemaining: sub.current_period_end
            ? Math.max(0, Math.ceil((new Date(sub.current_period_end).getTime() - Date.now()) / 86_400_000))
            : null,
        } : null,
        invoices: invoices ?? [],
        totalSpend,
        totalSpendFormatted: `₦${(totalSpend / 100).toLocaleString('en-NG')}`,
      });
    });

    // Invoice history
    r.get('/invoices', { schema: { tags: ['Billing'], summary: 'Invoice history', security: [{ bearerAuth: [] }] } },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const u = getAuthUser(req);
        const { data } = await supabaseAdmin.from('invoices').select('*').eq('user_id', u.id).order('created_at', { ascending: false });
        sendSuccess(reply, data ?? []);
      });

    // ── Validate a discount / waitlist code ─────────────────────────
    const validateCodeSchema = z.object({ code: z.string().min(1).max(64).trim().toUpperCase() });

    r.post('/validate-code', {
      schema: {
        tags: ['Billing'],
        summary: 'Validate a waitlist / promo discount code',
        description: 'Check if a code is valid, unexpired, and belongs to this user. Returns discount details so the frontend can display the offer before checkout.',
        security: [{ bearerAuth: [] }],
        body: { type: 'object', required: ['code'], properties: { code: { type: 'string' } } },
      },
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const u = getAuthUser(req);
      const { code } = validateCodeSchema.parse(req.body);

      const { data: dc } = await supabaseAdmin
        .from('discount_codes')
        .select('*')
        .eq('code', code)
        .maybeSingle();

      if (!dc) throw new AppError('Code not found or invalid', 404);
      if (dc.is_used) throw new AppError('This code has already been used', 409);
      if (new Date(dc.expires_at) < new Date()) throw new AppError('This code has expired', 410);
      if (dc.user_id && dc.user_id !== u.id) throw new AppError('This code does not belong to your account', 403);

      const label = dc.discount_type === 'first_month_free'
        ? '1 Month FREE — Premium on us'
        : `${dc.discount_pct}% off your first 6 months`;

      sendSuccess(reply, {
        valid: true,
        code: dc.code,
        discountType: dc.discount_type,
        label,
        discountPct:  dc.discount_pct,
        freeMonths:   dc.free_months,
        expiresAt:    dc.expires_at,
      });
    });

    // ── Redeem a waitlist code directly — no payment required ───────
    //
    // "first_month_free"  → grants 1 month of Premium (30 days), ₦0
    // "six_month_50pct"   → the discount only applies at checkout via Paystack,
    //                       so we route those to /payment instead of redeeming here.
    //
    r.post('/redeem-code', {
      schema: {
        tags: ['Billing'],
        summary: 'Redeem a waitlist "first_month_free" code directly — activates Premium with no payment',
        description: 'Only works for first_month_free codes. 50%-off codes must go through the Paystack checkout flow.',
        security: [{ bearerAuth: [] }],
        body: { type: 'object', required: ['code'], properties: { code: { type: 'string' } } },
      },
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const u = getAuthUser(req);
      const { code } = validateCodeSchema.parse(req.body);

      // 1. Fetch & validate the code
      const { data: dc } = await supabaseAdmin
        .from('discount_codes')
        .select('*')
        .eq('code', code)
        .maybeSingle();

      if (!dc)                                    throw new AppError('Code not found or invalid', 404);
      if (dc.is_used)                             throw new AppError('This code has already been used', 409);
      if (new Date(dc.expires_at) < new Date())   throw new AppError('This code has expired', 410);
      if (dc.user_id && dc.user_id !== u.id)      throw new AppError('This code does not belong to your account', 403);

      // Only first_month_free can be redeemed for free — 50% codes need Paystack
      if (dc.discount_type !== 'first_month_free') {
        throw new AppError(
          'This code gives 50% off your first 6 months and must be applied at checkout. Use it on the payment page.',
          422
        );
      }

      // 2. Check if already premium
      const { data: currentUser } = await supabaseAdmin
        .from('users')
        .select('plan, email, full_name')
        .eq('id', u.id)
        .single();

      if (currentUser?.plan === 'premium') {
        throw new AppError('Your account is already on the Premium plan', 409);
      }

      // 3. Calculate premium period — 1 month (30 days)
      const now     = new Date();
      const periodEnd = new Date(now);
      periodEnd.setDate(periodEnd.getDate() + 30);

      // 4. Upsert subscription
      await supabaseAdmin.from('subscriptions').upsert({
        id:                   uuidv4(),
        user_id:              u.id,
        plan:                 'premium',
        billing_cycle:        'monthly',
        status:               'active',
        current_period_start: now.toISOString(),
        current_period_end:   periodEnd.toISOString(),
      }, { onConflict: 'user_id' });

      // 5. Upgrade user plan
      await supabaseAdmin
        .from('users')
        .update({ plan: 'premium', updated_at: now.toISOString() })
        .eq('id', u.id);

      // 6. Create a ₦0 invoice for audit trail
      await supabaseAdmin.from('invoices').insert({
        id:         uuidv4(),
        user_id:    u.id,
        amount:     0,
        currency:   'NGN',
        status:     'paid',
        created_at: now.toISOString(),
        notes:      `Waitlist reward code redeemed: ${code}`,
      });

      // 7. Mark code as used
      await supabaseAdmin
        .from('discount_codes')
        .update({ is_used: true, used_at: now.toISOString() })
        .eq('code', code);

      // 8. Send confirmation email (reuse admin-granted email — same message)
      if (currentUser?.email) {
        await emailService.sendAdminGrantedPremiumEmail(
          currentUser.email,
          currentUser.full_name ?? '',
          'monthly',
          periodEnd.toISOString()
        ).catch(() => {}); // non-fatal
      }

      sendSuccess(reply, {
        plan:      'premium',
        periodEnd: periodEnd.toISOString(),
        daysGranted: 30,
        message:   'Premium activated! Enjoy 1 month on us 🎉',
      }, 'Premium activated successfully');
    });

    // ── Get all reward codes for this user ──────────────────────────
    r.get('/my-codes', {
      schema: {
        tags: ['Billing'],
        summary: "Fetch the user's waitlist reward / promo codes",
        security: [{ bearerAuth: [] }],
      },
    }, async (req: FastifyRequest, reply: FastifyReply) => {
      const u = getAuthUser(req);
      const { data } = await supabaseAdmin
        .from('discount_codes')
        .select('code, discount_type, discount_pct, free_months, is_used, used_at, expires_at, created_at')
        .eq('user_id', u.id)
        .order('created_at', { ascending: true });

      sendSuccess(reply, data ?? []);
    });

    // Cancel
    r.post('/cancel', { schema: { tags: ['Billing'], summary: 'Cancel subscription at period end', security: [{ bearerAuth: [] }] } },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const u = getAuthUser(req);
        const { data: sub } = await supabaseAdmin.from('subscriptions').select('*').eq('user_id', u.id).eq('status','active').single();
        if (!sub) throw new AppError('No active subscription', 404);
        if (sub.paystack_subscription_code)
          await axios.post(`${PS}/subscription/disable`, { code: sub.paystack_subscription_code, token: sub.paystack_customer_code }, { headers: psH() }).catch(()=>{});
        await supabaseAdmin.from('subscriptions').update({ status:'cancelled', updated_at: new Date().toISOString() }).eq('id', sub.id);
        const { data: p } = await supabaseAdmin.from('users').select('email').eq('id', u.id).single();
        if (p) await emailService.sendCancellationEmail(p.email, sub.current_period_end);
        sendSuccess(reply, null, 'Subscription cancelled — Premium continues until period end');
      });

    // Active sessions
    r.get('/security/sessions', { schema: { tags: ['Billing'], summary: 'List all active sessions / devices', security: [{ bearerAuth: [] }] } },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const u = getAuthUser(req);
        const { data } = await supabaseAdmin.from('sessions')
          .select('id,ip_address,user_agent,last_seen_at,created_at,expires_at')
          .eq('user_id', u.id).gt('expires_at', new Date().toISOString()).order('last_seen_at', { ascending: false });
        sendSuccess(reply, data ?? []);
      });

    // Revoke single session
    r.delete('/security/sessions/:id', { schema: { tags: ['Billing'], summary: 'Log out a specific device', security: [{ bearerAuth: [] }] } },
      async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const u = getAuthUser(req);
        await supabaseAdmin.from('sessions').delete().eq('id', req.params.id).eq('user_id', u.id);
        sendSuccess(reply, null, 'Session revoked');
      });

    // Revoke all other sessions
    r.post('/security/revoke-all-sessions', { schema: { tags: ['Billing'], summary: 'Log out all other devices', security: [{ bearerAuth: [] }] } },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const u = getAuthUser(req);
        await supabaseAdmin.from('sessions').delete().eq('user_id', u.id);
        sendSuccess(reply, null, 'All sessions revoked');
      });
  });
}

async function handlePaystackEvent(event: string, data: Record<string, unknown>): Promise<void> {
  const meta = (data.metadata ?? {}) as Record<string, string>;
  const userId = meta.userId;

  if (event === 'charge.success' && userId) {
    const ref = data.reference as string;
    const { data: existing } = await supabaseAdmin.from('invoices').select('id').eq('paystack_reference', ref).maybeSingle();
    if (existing) return;
    const bc = (meta.billingCycle ?? 'monthly') as 'monthly' | 'annual';
    const end = new Date();
    bc === 'annual' ? end.setFullYear(end.getFullYear() + 1) : end.setMonth(end.getMonth() + 1);
    await supabaseAdmin.from('subscriptions').upsert({ id: uuidv4(), user_id: userId, plan: 'premium', billing_cycle: bc, status: 'active', current_period_start: new Date().toISOString(), current_period_end: end.toISOString() }, { onConflict: 'user_id' });
    await supabaseAdmin.from('users').update({ plan: 'premium' }).eq('id', userId);
    await supabaseAdmin.from('invoices').insert({ id: uuidv4(), user_id: userId, amount: data.amount as number, currency: 'NGN', status: 'paid', paystack_reference: ref });
    const { data: p } = await supabaseAdmin.from('users').select('email').eq('id', userId).single();
    if (p) await emailService.sendReceiptEmail(p.email, { amount: data.amount as number, reference: ref, plan: 'Premium', billingCycle: bc });
  }
  if (event === 'subscription.create' && userId) {
    await supabaseAdmin.from('subscriptions').update({ paystack_subscription_code: data.subscription_code as string, paystack_customer_code: ((data.customer ?? {}) as Record<string,string>).customer_code, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('status', 'active');
  }
  if (event === 'subscription.disable') {
    await supabaseAdmin.from('subscriptions').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('paystack_subscription_code', data.subscription_code as string);
  }
  if (event === 'invoice.payment_failed') {
    const code = ((data.subscription ?? {}) as Record<string,string>).subscription_code;
    if (code) await supabaseAdmin.from('subscriptions').update({ status: 'past_due', updated_at: new Date().toISOString() }).eq('paystack_subscription_code', code);
  }
  if (event === 'invoice.create' && userId) {
    const { data: sub } = await supabaseAdmin.from('subscriptions').select('current_period_end,plan').eq('user_id', userId).single();
    const { data: p } = await supabaseAdmin.from('users').select('email').eq('id', userId).single();
    if (p && sub) await emailService.sendRenewalEmail(p.email, sub.current_period_end, sub.plan);
  }
}