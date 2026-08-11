/**
 * Pricing for display. Mirrors backend/src/config/pricing.ts.
 * ─────────────────────────────────────────────────────────────────
 * The backend decides what a customer is actually charged; this file only
 * decides what they are shown. They must agree, and for a long time they did
 * not: the marketing page said ₦15,000/mo while the API charged ₦5,000, and
 * both the pricing page and the payment page advertised a "15% off" annual
 * plan that no code anywhere applied.
 *
 * Naira here, not kobo — this side never talks to Paystack. Anything that
 * needs the charged amount should read it from the `/billing/subscribe`
 * response, which echoes the real figure back.
 */

export const PREMIUM_PRICE = {
  monthly: 15_000,
  annual:  180_000,      // 15,000 × 12 — deliberately no annual discount
} as const;

export type BillingCycle = keyof typeof PREMIUM_PRICE;

/** Waitlist-only reward. Nobody who signs up normally is issued a code. */
export const WAITLIST_DISCOUNT_PCT    = 5;
export const WAITLIST_DISCOUNT_MONTHS = 6;

/** "₦15,000" */
export const naira = (amount: number): string => `₦${amount.toLocaleString('en-NG')}`;
