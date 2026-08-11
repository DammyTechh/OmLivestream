import { z } from 'zod';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { getAuthUser } from '../../utils/jwt';
import { sendSuccess } from '../../utils/response';
import { supabaseAdmin } from '../../config/supabase';
import { PlansService, PLAN_LIMITS, buildUpgradePopup } from './plans.service';
import { AppError } from '../../utils/errors';
import { PREMIUM_PRICING_PUBLIC, nairaFmt, WAITLIST_DISCOUNT_MONTHS, WAITLIST_DISCOUNT_PCT } from '../../config/pricing';

const plansSvc = new PlansService();

const applyDiscountSchema = z.object({
  code: z.string().min(3).max(32).toUpperCase(),
});

export async function plansRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  /**
   * GET /plans/my-plan
   * Returns current plan, trial status, limits, and upgrade popup config.
   * Frontend calls this on dashboard load and before going live.
   */
  fastify.get('/my-plan', {
    schema: {
      tags: ['Plans'],
      summary: 'Get current plan, trial status, limits, and upgrade popup config',
      description: `
Returns everything the frontend needs to:
- Show the user's current plan and trial countdown
- Enforce limits before they try to stream
- Display the upgrade popup at the right moment

**popup.show** — whether to display the upgrade modal  
**popup.dismissible** — trial warnings are dismissible; hard limit blocks are not
      `.trim(),
      security: [{ bearerAuth: [] }],
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u = getAuthUser(req);
    // One read, not two. The popup is derived from the same plan state, and
    // this endpoint runs on every dashboard load for every user.
    const info  = await plansSvc.getEffectivePlan(u.id);
    const popup = buildUpgradePopup(info);
    sendSuccess(reply, { ...info, popup });
  });

  /**
   * GET /plans/all
   * Returns all plans with limits — used for pricing page and upgrade modal.
   */
  fastify.get('/all', {
    schema: {
      tags: ['Plans'],
      summary: 'All plans with limits — use for pricing page',
      security: [{ bearerAuth: [] }],
    },
  }, async (_req, reply) => {
    const plans = Object.entries(PLAN_LIMITS).map(([plan, limits]) => ({
      plan,
      ...limits,
      // Annual carries no savings badge: it is twelve monthly payments taken
      // at once, priced identically. The previous `savingsPct: 17` was quoting
      // a discount that does not exist.
      pricing: plan === 'premium'
        ? { monthly: PREMIUM_PRICING_PUBLIC.monthly, annual: PREMIUM_PRICING_PUBLIC.annual }
        : { monthly: null, annual: null },
    }));
    // Derived entirely from a compile-time constant — identical for every
    // user and every request. `private` because the response travels with an
    // Authorization header and must not land in a shared proxy cache, even
    // though the body happens to carry nothing user-specific.
    reply.header('Cache-Control', 'private, max-age=3600');
    sendSuccess(reply, plans);
  });

  /**
   * POST /plans/apply-discount
   * Check a discount code and describe what it is worth. Read-only.
   *
   * The name is kept for the clients already calling it, but the behaviour is
   * corrected: this used to set `is_used: true` while granting absolutely
   * nothing — no discount was applied to any charge anywhere — so a waitlist
   * member who pasted their code here destroyed the reward and then paid full
   * price. It also wrote `user_id: u.id` onto the row, which let any caller
   * claim a code belonging to someone else simply by knowing it.
   *
   * A code is now consumed in exactly one place per type: the Paystack
   * `charge.success` handler for percentage codes, and `/billing/redeem-code`
   * for free-month codes. Both consume it only when the benefit is actually
   * delivered.
   */
  fastify.post('/apply-discount', {
    schema: {
      tags: ['Plans'],
      summary: 'Check a discount code and preview its value — does not consume the code',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['code'],
        properties: { code: { type: 'string', description: 'Discount code (case-insensitive)' } },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u    = getAuthUser(req);
    const { code } = applyDiscountSchema.parse(req.body);

    const { data: discount } = await supabaseAdmin
      .from('discount_codes')
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (!discount) throw new AppError('Invalid discount code', 404, 'INVALID_CODE');
    if (discount.is_used) throw new AppError('This discount code has already been used', 409, 'CODE_USED');
    // Codes are bound to a user when minted, so an unowned code is not a
    // public one — it is one nobody is entitled to spend.
    if (discount.user_id !== u.id) throw new AppError('This code is not valid for your account', 403);
    if (new Date(discount.expires_at) < new Date()) throw new AppError('This discount code has expired', 410, 'CODE_EXPIRED');

    const pct = discount.discount_pct ?? WAITLIST_DISCOUNT_PCT;

    sendSuccess(reply, {
      code:         discount.code,
      discountType: discount.discount_type,
      discountPct:  pct,
      freeMonths:   discount.free_months,
      expiresAt:    discount.expires_at,
      message:      discount.discount_type === 'first_month_free'
        ? 'Your first month is free — redeem it from your billing page.'
        : `${pct}% off your first ${WAITLIST_DISCOUNT_MONTHS} months — enter this code at checkout.`,
    }, 'Discount code is valid');
  });
}
