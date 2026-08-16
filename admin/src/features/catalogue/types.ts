/**
 * The price list, as GET /api/payments/config returns it.
 *
 * Transcribed from `planList()` in backend/src/services/payments/plans.js. Every
 * derived figure — price per minute, months, saving — is computed THERE and
 * read here, never recomputed: an admin panel that does its own pricing
 * arithmetic is a second source of truth, and the two disagree the first time
 * a plan changes.
 */

export type PlanKind = 'pack' | 'subscription';

interface PlanBase {
  code: string;
  kind: PlanKind;
  labelAr: string;
  labelEn: string;
  /** Integer piastres — 100 EGP is 10000. */
  amountCents: number;
  amountEgp: number;
  popular: boolean;
  /** Total minutes the purchase is worth, over its whole life. */
  minutes: number;
  pricePerMinuteEgp: number;
}

/** Bought whenever, stacks without limit, never expires. */
export interface PackPlan extends PlanBase {
  kind: 'pack';
  grantSeconds: number;
  neverExpires: true;
}

/** A monthly allowance of minutes, granted per 30-day cycle. Not unlimited. */
export interface SubscriptionPlan extends PlanBase {
  kind: 'subscription';
  days: number;
  months: number;
  /** Seconds granted per 30-day cycle. */
  cycleSeconds: number;
  minutesPerMonth: number;
  /** Always false: cycle minutes expire with the cycle. */
  rollsOver: boolean;
  savingPct: number;
  monthlyEquivalentEgp: number;
}

export type CataloguePlan = PackPlan | SubscriptionPlan;

/**
 * The free trial, as the paywall states it.
 *
 * Not a plan, but it belongs beside the prices: it is the headline figure on
 * the pricing page ("the first 10 minutes are free"), it lives in app_settings
 * where an operator changes it without a deploy, and it is the one number on
 * this screen they can actually move. Reading it from the same response as the
 * prices is what stops the panel from printing a trial length that stopped
 * being true the last time someone edited a setting.
 */
export interface CatalogueTrial {
  seconds: number;
  /** Floored, like every minute figure shown to anyone. */
  minutes: number;
}

export interface CatalogueResponse {
  provider: string;
  /** False while EasyKash has no credentials — nothing can actually be bought. */
  enabled: boolean;
  /** True when the gateway is stubbed for testing; a paid row is then not money. */
  mock: boolean;
  currency: string;
  trial: CatalogueTrial;
  plans: CataloguePlan[];
}

export function isPack(plan: CataloguePlan): plan is PackPlan {
  return plan.kind === 'pack';
}
