/**
 * Subscription catalogue.
 *
 * Prices live here rather than in the route so the mobile paywall, the admin
 * dashboard, and the checkout call all read the same numbers. The old build
 * hardcoded 29/249 EGP inside payments.js while SubscriptionScreen.tsx
 * hardcoded its own copy — they could and did drift.
 *
 * Amounts are integer piastres. `29 EGP` is 2900, never 29.00.
 */

export const PLANS = {
  monthly: {
    code: 'monthly',
    labelAr: 'شهري',
    labelEn: 'Monthly',
    amountCents: 14900,     // 149.00 EGP
    days: 30,
    popular: false,
  },
  quarterly: {
    code: 'quarterly',
    labelAr: 'ربع سنوي',
    labelEn: 'Quarterly',
    amountCents: 39900,     // 399.00 EGP — 11% off monthly
    days: 90,
    popular: false,
  },
  yearly: {
    code: 'yearly',
    labelAr: 'سنوي',
    labelEn: 'Yearly',
    amountCents: 119900,    // 1199.00 EGP — 33% off monthly
    days: 365,
    popular: true,
  },
};

export function getPlan(code) {
  return PLANS[code] || null;
}

export function planList() {
  const monthlyPerDay = PLANS.monthly.amountCents / PLANS.monthly.days;
  return Object.values(PLANS).map((p) => {
    const perDay = p.amountCents / p.days;
    const savingPct = Math.round((1 - perDay / monthlyPerDay) * 100);
    return {
      ...p,
      amountEgp: p.amountCents / 100,
      /** Percentage saved versus paying monthly — 0 for the monthly plan. */
      savingPct: savingPct > 0 ? savingPct : 0,
      monthlyEquivalentEgp: Number(((perDay * 30) / 100).toFixed(2)),
    };
  });
}

/**
 * Compute the new expiry when a payment succeeds.
 *
 * Two bugs this fixes:
 * 1. The old code stamped `expiresAt` at CHECKOUT time. A user who opened the
 *    payment page and paid an hour later lost that hour, and one who never
 *    paid still had a row claiming future access.
 * 2. Renewals overwrote the expiry instead of extending it, so renewing early
 *    destroyed whatever time was left on the current subscription.
 */
export function computeExpiry({ currentExpiresAt, days, now = new Date() }) {
  const base = currentExpiresAt && currentExpiresAt > now ? currentExpiresAt : now;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}
