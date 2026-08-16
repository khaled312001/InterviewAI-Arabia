/**
 * The catalogue — time packs and subscriptions.
 *
 * Prices live here rather than in the route so the mobile paywall, the landing
 * page, the admin dashboard and the checkout call all read the same numbers.
 * An earlier build hardcoded them in three places and they drifted.
 *
 * TWO PRODUCT KINDS NOW, and they are priced on different axes: a pack is
 * priced per MINUTE, a subscription per MONTH. The old planList() computed one
 * `savingPct` by dividing by `days`, which for a pack is a division by zero
 * dressed up as a discount — hence the branch below.
 *
 * Amounts are integer piastres: 100 EGP is 10000, never 100.00.
 * Grants are integer seconds: 60 minutes is 3600, never 60.
 */

export const PLANS = {
  /* ------------------------------- time packs -------------------------------
   * Bought whenever, stack without limit, NEVER expire. That last property is
   * the pack's real selling point for the occasional user, and it is the reason
   * these seconds live in the perpetual bucket.
   * ------------------------------------------------------------------------ */
  pack_20m: {
    code: 'pack_20m', kind: 'pack',
    labelAr: 'باقة ٢٠ دقيقة', labelEn: '20 Minutes',
    amountCents: 4000,            // 40.00 EGP → 2.00 EGP/min
    grantSeconds: 1200,
    popular: false,
  },
  pack_60m: {
    code: 'pack_60m', kind: 'pack',
    labelAr: 'باقة ٦٠ دقيقة', labelEn: '60 Minutes',
    amountCents: 10000,           // 100.00 EGP → 1.67 EGP/min  ← the anchor
    grantSeconds: 3600,
    popular: true,
  },
  pack_180m: {
    code: 'pack_180m', kind: 'pack',
    labelAr: 'باقة ٣ ساعات', labelEn: '3 Hours',
    amountCents: 25000,           // 250.00 EGP → 1.39 EGP/min
    grantSeconds: 10800,
    popular: false,
  },

  /* ----------------------------- subscriptions -----------------------------
   * A monthly ALLOWANCE of minutes, not unlimited — and the allowance is the
   * whole point. At 150 EGP for 300 minutes a subscriber's minutes cost 0.50
   * EGP against ~1.67 EGP in the pack: a 3.3x better rate, which is a strong,
   * honest, checkable reason to subscribe. Worst case a subscriber burns every
   * minute and costs roughly what they paid — zero margin, never a loss, always
   * knowable. "Unlimited" at a per-second COGS has no worst case at all: one
   * retained user running four hours a day would wipe out the margin of two
   * dozen others, and an existing subscriber cannot be repriced.
   *
   * Real usage sits far below the cap, so 300 minutes FEELS unlimited while
   * being capped. `subscription_cycle_seconds` moves it without a deploy —
   * raising an allowance is a promotion, cutting one is churn, so it starts low.
   * ------------------------------------------------------------------------ */
  monthly: {
    code: 'monthly', kind: 'subscription',
    labelAr: 'اشتراك شهري', labelEn: 'Monthly',
    amountCents: 15000,           // 150.00 EGP
    days: 30,
    cycleSeconds: 18000,          // 300 min per 30-day cycle → 0.50 EGP/min
    popular: false,
  },
  quarterly: {
    code: 'quarterly', kind: 'subscription',
    labelAr: 'اشتراك ربع سنوي', labelEn: 'Quarterly',
    amountCents: 39900,           // 399.00 EGP — 11% off monthly
    days: 90,
    // The SAME 300 minutes, granted per 30-day cycle rather than up front.
    // Granting the whole quarter at once would let a subscriber front-load 900
    // minutes into week one and cancel.
    cycleSeconds: 18000,
    popular: false,
  },
};

/**
 * Retired codes.
 *
 * THE YEARLY PLAN IS GONE. It is kept resolvable — and only resolvable — so
 * that receipts, subscription history and the admin panel can still render a
 * name for the rows that already exist instead of printing `undefined`. It is
 * absent from `planList()` and from `purchasablePlan()`, so nothing can buy it
 * and no replayed checkout can activate it.
 *
 * `yearly_legacy` is what migration 002 renames the surviving seed/demo rows
 * to. The rename is what makes the retirement enforceable: 'yearly' no longer
 * exists anywhere purchasable, and 'yearly_legacy' is obviously not a product.
 */
export const LEGACY_PLANS = {
  yearly: {
    code: 'yearly', kind: 'subscription', retired: true,
    labelAr: 'سنوي (متوقف)', labelEn: 'Yearly (retired)',
    amountCents: 120000, days: 365, cycleSeconds: 18000,
  },
  yearly_legacy: {
    code: 'yearly_legacy', kind: 'subscription', retired: true,
    labelAr: 'سنوي (متوقف)', labelEn: 'Yearly (retired)',
    amountCents: 120000, days: 365, cycleSeconds: 18000,
  },
};

/** Pack codes, offered in the 402 body so the client can render the paywall. */
export const PACK_CODES = Object.values(PLANS)
  .filter((p) => p.kind === 'pack')
  .map((p) => p.code);

/** Resolves anything that has ever existed — for rendering history. */
export function getPlan(code) {
  return PLANS[code] || LEGACY_PLANS[code] || null;
}

/**
 * The ONLY resolver checkout and the webhook may use.
 *
 * getPlan() resolving a retired code must never imply it is for sale: the
 * webhook calls this one, so a replayed callback for an old yearly checkout
 * finds nothing to activate.
 */
export function purchasablePlan(code) {
  const p = PLANS[code];
  return p && !p.retired ? p : null;
}

/** Every code that may be bought — the checkout schema's enum. */
export const PURCHASABLE_CODES = Object.keys(PLANS);

export function planList() {
  return Object.values(PLANS).map((p) => {
    const base = { ...p, amountEgp: p.amountCents / 100 };

    if (p.kind === 'pack') {
      const minutes = p.grantSeconds / 60;
      return {
        ...base,
        minutes,
        neverExpires: true,
        pricePerMinuteEgp: Number((p.amountCents / 100 / minutes).toFixed(2)),
      };
    }

    // Compared per MONTH, not per day. The customer compares a quarter against
    // three payments of 150, so must we; a per-day basis inflates the headline
    // and disagrees with the figure printed on the marketing site.
    const months = Math.round(p.days / PLANS.monthly.days);
    const minutesPerMonth = p.cycleSeconds / 60;
    const minutes = minutesPerMonth * months;
    const savingPct = Math.round((1 - p.amountCents / (PLANS.monthly.amountCents * months)) * 100);
    return {
      ...base,
      months,
      minutesPerMonth,
      minutes,
      // Allowance minutes do NOT roll over. Say so above the fold on the
      // paywall — an unstated expiry is a support ticket with a deadline.
      rollsOver: false,
      pricePerMinuteEgp: Number((p.amountCents / 100 / minutes).toFixed(2)),
      savingPct: savingPct > 0 ? savingPct : 0,
      monthlyEquivalentEgp: Number((p.amountCents / 100 / months).toFixed(2)),
    };
  });
}

/**
 * Seconds a subscription grants per 30-day cycle.
 *
 * An ACTIVE subscription whose plan code is not in the catalogue — the renamed
 * `yearly_legacy` demo rows — falls back to the monthly allowance rather than
 * being special-cased or orphaned. Those accounts keep working and lapse
 * naturally at their own expiry through expireSubscriptions().
 */
export function cycleSecondsFor(planCode) {
  const plan = getPlan(planCode);
  return plan?.cycleSeconds ?? PLANS.monthly.cycleSeconds;
}

/**
 * Compute the new expiry when a payment succeeds.
 *
 * Two bugs this fixes:
 * 1. The old code stamped `expiresAt` at CHECKOUT time. A user who opened the
 *    payment page and paid an hour later lost that hour, and one who never paid
 *    still had a row claiming future access.
 * 2. Renewals overwrote the expiry instead of extending it, so renewing early
 *    destroyed whatever time was left on the current subscription.
 */
export function computeExpiry({ currentExpiresAt, days, now = new Date() }) {
  const base = currentExpiresAt && currentExpiresAt > now ? currentExpiresAt : now;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}
