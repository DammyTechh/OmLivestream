/**
 * OmliveStream pricing — the single source of truth.
 * ─────────────────────────────────────────────────────────────────
 * Everything that quotes a price (the pricing page, the payment page,
 * `GET /billing/plans`, `GET /plans/all`, the Paystack charge) must derive
 * from this file. Before it existed the number lived in four places and
 * three of them disagreed: the marketing page advertised ₦15,000/mo while
 * `/billing/subscribe` charged ₦5,000. Every one of those was a real charge
 * against a real card, so a display bug here is a billing bug.
 *
 * All amounts are in KOBO, because that is what Paystack takes. Naira × 100.
 * `nairaFmt` is the only place that converts back for display.
 */

export const CURRENCY = 'NGN' as const;

/** Premium, in kobo. Annual is 12 × monthly — there is deliberately no annual discount. */
export const PREMIUM_PRICE_KOBO = {
  monthly: 1_500_000,        // ₦15,000 / month
  annual:  18_000_000,       // ₦180,000 / year  (15,000 × 12)
} as const;

export type BillingCycle = keyof typeof PREMIUM_PRICE_KOBO;

/** Months of service one charge of each cycle covers. */
export const MONTHS_PER_CYCLE: Record<BillingCycle, number> = {
  monthly: 1,
  annual:  12,
};

// ── Waitlist reward ───────────────────────────────────────────────
//
// These are the *only* discounts the product offers, and they are reachable
// only by people who joined the waitlist before launch: codes are minted in
// `WaitlistService.grantWaitlistReward`, which runs solely when a new user's
// email matches a `waitlist` row. Someone who signs up normally is never
// issued one, and every redemption path requires the code to be bound to the
// caller's own user_id — so an ordinary signup has no route to a discount.

/** Percent off each of the first `WAITLIST_DISCOUNT_MONTHS` months. */
export const WAITLIST_DISCOUNT_PCT = 5;

/** How many months of Premium the percentage discount covers. */
export const WAITLIST_DISCOUNT_MONTHS = 6;

/** Free months granted by a `first_month_free` code. */
export const WAITLIST_FREE_MONTHS = 1;

/**
 * Apply the waitlist percentage discount to one charge.
 *
 * The offer is worded "5% off your first 6 months" — unambiguous on a monthly
 * plan, meaningless on an annual one, since an annual charge is a single
 * payment covering twelve. Rather than quietly giving annual buyers 5% off all
 * twelve (more than promised) or refusing them the reward (less), this
 * discounts the six months' worth of value inside the charge and consumes the
 * whole entitlement, so both cycles receive exactly the same ₦ benefit.
 *
 * Returns the amount actually payable plus how many discounted months remain
 * afterwards, which the caller persists on the subscription.
 */
export function applyWaitlistDiscount(
  cycle: BillingCycle,
  monthsRemaining: number,
): { amountKobo: number; discountKobo: number; monthsLeftAfter: number } {
  const full        = PREMIUM_PRICE_KOBO[cycle];
  const monthsInBuy = MONTHS_PER_CYCLE[cycle];
  const monthsUsed  = Math.max(0, Math.min(monthsRemaining, monthsInBuy));

  if (monthsUsed === 0) return { amountKobo: full, discountKobo: 0, monthsLeftAfter: 0 };

  // Price the discount off the monthly rate so a part-discounted annual term is
  // computed from months, not from a fraction of the annual total. Rounded
  // down: never charge a rounding error to the customer's disadvantage.
  const discount = Math.floor(
    PREMIUM_PRICE_KOBO.monthly * monthsUsed * (WAITLIST_DISCOUNT_PCT / 100),
  );

  return {
    amountKobo:      full - discount,
    discountKobo:    discount,
    monthsLeftAfter: monthsRemaining - monthsUsed,
  };
}

/** ₦-formatted display string for a kobo amount, e.g. 1_500_000 → "₦15,000". */
export function nairaFmt(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG')}`;
}

/** Shape returned by the two public "list the plans" endpoints. */
export const PREMIUM_PRICING_PUBLIC = {
  monthly: {
    amount:    PREMIUM_PRICE_KOBO.monthly,
    formatted: `${nairaFmt(PREMIUM_PRICE_KOBO.monthly)}/mo`,
  },
  annual: {
    amount:    PREMIUM_PRICE_KOBO.annual,
    formatted: `${nairaFmt(PREMIUM_PRICE_KOBO.annual)}/yr`,
  },
} as const;
