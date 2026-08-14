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
import { notifications } from '../notifications/notifications.service';
import {
  CURRENCY, PREMIUM_PRICE_KOBO, MONTHS_PER_CYCLE, WAITLIST_DISCOUNT_PCT,
  WAITLIST_DISCOUNT_MONTHS, applyWaitlistDiscount, nairaFmt, type BillingCycle,
} from '../../config/pricing';

const emailService = new EmailService();
const PS = 'https://api.paystack.co';
const psH = () => ({ Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` });

const PLANS = {
  premium_monthly: { name: 'Premium Monthly', amount: PREMIUM_PRICE_KOBO.monthly, currency: CURRENCY },
  premium_annual:  { name: 'Premium Annual',  amount: PREMIUM_PRICE_KOBO.annual,  currency: CURRENCY },
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
      async (_req, reply) => {
        // Static pricing table — no DB access, same bytes for everyone.
        reply.header('Cache-Control', 'private, max-age=3600');
        return sendSuccess(reply, Object.entries(PLANS).map(([id, p]) => ({
          id, ...p, amountFormatted: `₦${(p.amount / 100).toLocaleString('en-NG')}`,
        })));
      });

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

      // ── Resolve the discount, if one was supplied ────────────────
      //
      // This is the whole point of the discountCode field, and it used to be
      // dropped on the floor: the code was written into Paystack metadata and
      // never read, so `amount` was always full price. A waitlist member could
      // type a valid code, see it accepted, and still be charged in full.
      //
      // Validation is strict and the failures are loud. A code that cannot be
      // honoured must stop checkout, not silently charge full price — the user
      // is about to pay, and the number they were shown has to be the number
      // they are charged.
      // Annotated `number`, not inferred: PREMIUM_PRICE_KOBO is `as const`, so
      // inference would pin this to the literal union of the two list prices
      // and reject every discounted amount.
      let amount: number = cfg.amount;
      let discount: {
        id: string; code: string; pct: number; kobo: number; monthsLeftAfter: number;
      } | null = null;

      if (discountCode) {
        const code = discountCode.toUpperCase();
        const { data: dc } = await supabaseAdmin
          .from('discount_codes').select('*').eq('code', code).maybeSingle();

        if (!dc)                                  throw new AppError('That discount code is not valid.', 404, 'INVALID_CODE');
        if (dc.is_used)                           throw new AppError('That discount code has already been used.', 409, 'CODE_USED');
        if (new Date(dc.expires_at) < new Date()) throw new AppError('That discount code has expired.', 410, 'CODE_EXPIRED');
        // Codes are minted per waitlist member and bound to their user_id. An
        // unbound code would be a bearer token anyone could guess at, so a
        // NULL owner is rejected rather than treated as "open to all".
        if (dc.user_id !== u.id)                  throw new AppError('That discount code belongs to another account.', 403, 'CODE_NOT_YOURS');

        if (dc.discount_type === 'first_month_free') {
          // Nothing to charge — that code is redeemed at /redeem-code, which
          // grants the month outright. Sending a ₦0 transaction to Paystack
          // would fail, and charging full price would swallow the reward.
          throw new AppError(
            'That code gives you a free month — redeem it from your billing page instead of paying here.',
            422, 'CODE_IS_FREE_MONTH',
          );
        }

        const pct = dc.discount_pct ?? WAITLIST_DISCOUNT_PCT;
        const d   = applyWaitlistDiscount(billingCycle as BillingCycle, WAITLIST_DISCOUNT_MONTHS);
        amount    = d.amountKobo;
        discount  = {
          id: dc.id, code: dc.code, pct,
          kobo: d.discountKobo, monthsLeftAfter: d.monthsLeftAfter,
        };
      } else {
        // No code supplied — but the entitlement may already be running.
        //
        // The offer is "5% off your first 6 months", and a monthly subscriber
        // pays six times to get there. The code is consumed by the first
        // charge, so every renewal after it would be full price if we only
        // ever looked at codes. The remaining months live on the subscription
        // and are honoured here without the user re-entering anything.
        const { data: sub } = await supabaseAdmin
          .from('subscriptions')
          .select('discount_cycles_remaining, discount_pct, discount_code')
          .eq('user_id', u.id).maybeSingle();

        const left = sub?.discount_cycles_remaining ?? 0;
        if (left > 0) {
          const d = applyWaitlistDiscount(billingCycle as BillingCycle, left);
          amount  = d.amountKobo;
          discount = {
            id: '', code: sub?.discount_code ?? '', pct: sub?.discount_pct ?? WAITLIST_DISCOUNT_PCT,
            kobo: d.discountKobo, monthsLeftAfter: d.monthsLeftAfter,
          };
        }
      }

      const body: Record<string, unknown> = {
        email: profile?.email ?? u.email, amount, currency: cfg.currency, reference,
        callback_url: `${urls.payment}/callback`,
        metadata: {
          userId: u.id, plan, billingCycle, paymentMethod,
          discountCode:      discount?.code ?? null,
          // Carried through so the webhook can settle the redemption without
          // re-deriving the arithmetic from an amount that may have been
          // altered in flight.
          discountCodeId:    discount?.id ?? null,
          discountPct:       discount?.pct ?? null,
          discountCyclesLeft: discount?.monthsLeftAfter ?? null,
        },
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
        sendSuccess(reply, {
          paystackAuthUrl: resp.data.data.authorization_url,
          reference, paymentMethod,
          // Echo the real figures back. The client displayed a price before
          // calling; this is what will actually be charged.
          amount, amountFormatted: nairaFmt(amount),
          discount: discount && {
            code: discount.code, pct: discount.pct,
            amountOff: discount.kobo, amountOffFormatted: nairaFmt(discount.kobo),
          },
        });
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
      if (dc.user_id !== u.id) throw new AppError('This code does not belong to your account', 403);

      const pct   = dc.discount_pct ?? WAITLIST_DISCOUNT_PCT;
      const label = dc.discount_type === 'first_month_free'
        ? '1 Month FREE — Premium on us'
        : `${pct}% off your first ${WAITLIST_DISCOUNT_MONTHS} months`;

      // Quote the actual figures for both cycles, so the payment page can show
      // the discounted total before the user commits rather than describing
      // the offer in prose and hoping the charge matches.
      const preview = dc.discount_type === 'first_month_free' ? null : {
        monthly: applyWaitlistDiscount('monthly', WAITLIST_DISCOUNT_MONTHS),
        annual:  applyWaitlistDiscount('annual',  WAITLIST_DISCOUNT_MONTHS),
      };

      sendSuccess(reply, {
        valid: true,
        code: dc.code,
        discountType: dc.discount_type,
        label,
        discountPct:  pct,
        freeMonths:   dc.free_months,
        expiresAt:    dc.expires_at,
        preview: preview && {
          monthly: { amount: preview.monthly.amountKobo, formatted: nairaFmt(preview.monthly.amountKobo), off: nairaFmt(preview.monthly.discountKobo) },
          annual:  { amount: preview.annual.amountKobo,  formatted: nairaFmt(preview.annual.amountKobo),  off: nairaFmt(preview.annual.discountKobo) },
        },
      });
    });

    // ── Redeem a waitlist code directly — no payment required ───────
    //
    // "first_month_free"  → grants 1 month of Premium (30 days), ₦0
    // "six_month_pct"     → the discount only applies at checkout via Paystack,
    //                       so we route those to /payment instead of redeeming here.
    //
    r.post('/redeem-code', {
      schema: {
        tags: ['Billing'],
        summary: 'Redeem a waitlist "first_month_free" code directly — activates Premium with no payment',
        description: 'Only works for first_month_free codes. Percentage-discount codes must go through the Paystack checkout flow.',
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
      // Strict ownership: waitlist codes are always bound to a user_id at mint
      // time, so an unbound code is not "available to anyone" — it is a code
      // nobody should be able to spend.
      if (dc.user_id !== u.id)                    throw new AppError('This code does not belong to your account', 403);

      // Only first_month_free grants Premium outright — percentage codes reduce
      // a real charge and so have to go through Paystack.
      if (dc.discount_type !== 'first_month_free') {
        throw new AppError(
          `This code gives ${dc.discount_pct ?? WAITLIST_DISCOUNT_PCT}% off your first ${WAITLIST_DISCOUNT_MONTHS} months and must be applied at checkout. Use it on the payment page.`,
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

      // 4. Claim the code FIRST, atomically.
      //
      // Ordering matters: this used to grant Premium and then mark the code
      // used, so two requests arriving together both passed the is_used check
      // and both granted a month. Claiming first — with `.eq('is_used', false)`
      // as a compare-and-swap — means the loser matches zero rows and stops
      // here, before anything has been granted. The cost of failing this way
      // round is a code burnt with no grant, which the steps below cannot
      // trigger: they are writes to our own tables, not calls that can decline.
      const { data: claimed } = await supabaseAdmin
        .from('discount_codes')
        .update({ is_used: true, used_at: now.toISOString() })
        .eq('id', dc.id)
        .eq('user_id', u.id)
        .eq('is_used', false)
        .select('id');

      if (!claimed?.length) throw new AppError('This code has already been used', 409);

      // 5. Upsert subscription
      await supabaseAdmin.from('subscriptions').upsert({
        id:                   uuidv4(),
        user_id:              u.id,
        plan:                 'premium',
        billing_cycle:        'monthly',
        status:               'active',
        current_period_start: now.toISOString(),
        current_period_end:   periodEnd.toISOString(),
      }, { onConflict: 'user_id' });

      // 6. Upgrade user plan
      await supabaseAdmin
        .from('users')
        .update({ plan: 'premium', updated_at: now.toISOString() })
        .eq('id', u.id);

      // 7. Create a ₦0 invoice for audit trail
      await supabaseAdmin.from('invoices').insert({
        id:         uuidv4(),
        user_id:    u.id,
        amount:     0,
        currency:   'NGN',
        status:     'paid',
        created_at: now.toISOString(),
        notes:      `Waitlist reward code redeemed: ${code}`,
      });

      // 8. Send confirmation email (reuse admin-granted email — same message)
      if (currentUser?.email) {
        await emailService.sendAdminGrantedPremiumEmail(
          currentUser.email,
          currentUser.full_name ?? '',
          'monthly',
          periodEnd.toISOString()
        ).catch(() => {}); // non-fatal
      }

      void notifications.notify({
        userId: u.id,
        type:   'billing',
        title:  'Premium unlocked',
        body:   'Your waitlist month is active. Your next 6 months also carry 5% off.',
        link:   '/dashboard/billing',
      });

      sendSuccess(reply, {
        plan:      'premium',
        periodEnd: periodEnd.toISOString(),
        daysGranted: 30,
        message:   'Premium activated — your first month is on us.',
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

    // ── Settle the discount code, if this charge carried one ──────
    //
    // Redemption happens here rather than at /subscribe because a code must be
    // consumed when money actually moves. Burning it at checkout — which is
    // what /plans/apply-discount used to do — destroys the reward for anyone
    // who abandons the Paystack page or whose card declines.
    //
    // The `.eq('is_used', false)` turns the update into a compare-and-swap:
    // Postgres serialises the two writers, the loser matches zero rows, and we
    // learn which we were from the returned row count. Without it, two
    // concurrent charges could each read is_used=false and both redeem.
    let discountCyclesLeft = 0;
    let discountPct: number | null = null;
    if (meta.discountCodeId) {
      const { data: claimed } = await supabaseAdmin
        .from('discount_codes')
        .update({
          is_used: true, used_at: new Date().toISOString(),
          redeemed_by_reference: ref,
        })
        .eq('id', meta.discountCodeId)
        .eq('user_id', userId)
        .eq('is_used', false)
        .select('id');

      // Won the race, or this is a webhook replay of the charge that already
      // redeemed it — either way the discount belongs to this reference.
      const { data: mine } = claimed?.length
        ? { data: true }
        : await supabaseAdmin.from('discount_codes')
            .select('id').eq('id', meta.discountCodeId)
            .eq('redeemed_by_reference', ref).maybeSingle()
            .then(r => ({ data: !!r.data }));

      if (mine) {
        discountPct        = meta.discountPct ? Number(meta.discountPct) : null;
        discountCyclesLeft = meta.discountCyclesLeft ? Number(meta.discountCyclesLeft) : 0;
      }
    }

    await supabaseAdmin.from('subscriptions').upsert({
      id: uuidv4(), user_id: userId, plan: 'premium', billing_cycle: bc, status: 'active',
      current_period_start: new Date().toISOString(), current_period_end: end.toISOString(),
      discount_cycles_remaining: discountCyclesLeft,
      discount_pct:  discountPct,
      discount_code: meta.discountCode ?? null,
    }, { onConflict: 'user_id' });
    await supabaseAdmin.from('users').update({ plan: 'premium' }).eq('id', userId);
    await supabaseAdmin.from('invoices').insert({ id: uuidv4(), user_id: userId, amount: data.amount as number, currency: 'NGN', status: 'paid', paystack_reference: ref });
    const { data: p } = await supabaseAdmin.from('users').select('email').eq('id', userId).single();
    if (p) {
      // The charge payload already carries the card and channel Paystack used,
      // so the receipt can name it without a second API call. `authorization`
      // is absent for some channels, hence the optional reads.
      const auth = (data.authorization ?? {}) as Record<string, unknown>;
      await emailService.sendReceiptEmail(p.email, {
        amount: data.amount as number,
        reference: ref,
        plan: 'Premium',
        billingCycle: bc,
        cardBrand: (auth.brand as string) ?? (auth.card_type as string) ?? null,
        cardLast4: (auth.last4 as string) ?? null,
        channel: (data.channel as string) ?? null,
        paidAt: (data.paid_at as string) ?? null,
        nextBillingDate: end.toISOString(),
      });
    }

    // The receipt goes to their inbox; this is what they see in the product.
    // It matters more here than elsewhere because the upgrade completes on
    // Paystack's redirect, so the tab that started the purchase is often no
    // longer the tab that finds out it worked.
    void notifications.notify({
      userId,
      type:  'billing',
      title: 'Premium is active',
      body:  `Your ${bc} subscription is live. Multistreaming, comment replies and AI editing are unlocked.`,
      link:  '/dashboard/billing',
    });
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