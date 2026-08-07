import { z } from 'zod';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { getAuthUser } from '../../utils/jwt';
import { sendSuccess } from '../../utils/response';
import { supabaseAdmin } from '../../config/supabase';
import { PlansService, PLAN_LIMITS, buildUpgradePopup } from './plans.service';
import { AppError } from '../../utils/errors';

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
      pricing: plan === 'premium'
        ? { monthly: { amount: 500000, formatted: '₦5,000/mo' }, annual: { amount: 5000000, formatted: '₦50,000/yr', savingsPct: 17 } }
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
   * Apply a discount code (waitlist reward or promo).
   */
  fastify.post('/apply-discount', {
    schema: {
      tags: ['Plans'],
      summary: 'Apply a discount code — waitlist reward or promo',
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
    if (discount.user_id && discount.user_id !== u.id) throw new AppError('This code is not valid for your account', 403);
    if (new Date(discount.expires_at) < new Date()) throw new AppError('This discount code has expired', 410, 'CODE_EXPIRED');

    // Mark as used and assign to user
    await supabaseAdmin.from('discount_codes').update({
      is_used: true, used_at: new Date().toISOString(), user_id: u.id,
    }).eq('id', discount.id);

    sendSuccess(reply, {
      discountType: discount.discount_type,
      discountPct:  discount.discount_pct,
      freeMonths:   discount.free_months,
      message:      discount.discount_type === 'first_month_free'
        ? 'Your first month is free — use this code at checkout.'
        : `${discount.discount_pct}% off your first 6 months — apply at checkout.`,
    }, 'Discount code applied');
  });
}
