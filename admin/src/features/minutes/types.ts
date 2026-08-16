/**
 * Shapes returned by the minute-balance routes in backend/src/routes/admin.js
 * (`GET|POST /admin/users/:id/minutes`), which in turn return `balanceSnapshot()`
 * and `ledgerFor()` from services/billing/minutes.js.
 *
 * Everything is SECONDS. Minutes are a display unit and appear only where a
 * human types or reads one — storing or passing the display unit is how a
 * charge gets rounded twice.
 */

/** enum TimeLedgerKind in schema.prisma. */
export type LedgerKind =
  | 'trial_grant'
  | 'purchase'
  | 'subscription_grant'
  | 'promo_grant'
  | 'admin_grant'
  | 'consumption'
  | 'refund'
  | 'expiry'
  | 'adjustment';

/** enum TimeBucket. Perpetual minutes never expire; subscription ones do. */
export type TimeBucket = 'perpetual' | 'subscription';

export interface MinuteBalance {
  /** Perpetual: trial, purchased packs, admin grants. Never expires. */
  balanceSeconds: number;
  /** The CURRENT cycle allowance — already zeroed by the server if it lapsed. */
  subSeconds: number;
  subExpiresAt: string | null;
  /** Reserved by live meetings. A hold, not a spend. */
  heldSeconds: number;
  /** subSeconds + balanceSeconds − heldSeconds. What the user can start with. */
  availableSeconds: number;
  /** availableSeconds rounded DOWN to whole minutes, exactly as the app shows. */
  minutesRemaining: number;
  trialGranted: boolean;
  trialSeconds: number;
  plan: 'free' | 'premium';
  premiumUntil: string | null;
  /** app_settings.meeting_low_water_seconds — where the app warns the user. */
  lowWaterSeconds: number;
}

export interface LedgerEntry {
  id: string;
  kind: LedgerKind | string;
  bucket: TimeBucket | string;
  /** SIGNED: positive grants, negative consumption. */
  seconds: number;
  /** floor(|seconds| / 60) — the server's own rounding, not ours. */
  minutes: number;
  /** perpetual + subscription as they stood immediately after this row. */
  balanceAfterSeconds: number;
  meetingSessionId: string | null;
  paymentId: string | null;
  note: string | null;
  createdAt: string;
}

export interface MinutesResponse {
  balance: MinuteBalance;
  /** Newest first, capped at 100 by the server. */
  entries: LedgerEntry[];
}

/**
 * POST /admin/users/:id/minutes. `minutes` is signed: positive credits,
 * negative deducts, zero is refused. `amountEgp` records money that changed
 * hands off-platform and is meaningless on a deduction.
 */
export interface MinutesAdjustBody {
  minutes: number;
  /** 3..300 chars, required in both directions: a silent balance change is unauditable. */
  reason: string;
  amountEgp?: number;
}

export interface MinutesAdjustResult {
  ok: true;
  direction: 'credit' | 'deduct';
  requestedSeconds: number;
  /**
   * What actually landed. A deduction is clamped at the perpetual balance, so
   * this is smaller than requested when the minutes were already spent — the UI
   * must report THIS, not the request.
   */
  appliedSeconds: number;
  unappliedSeconds: number;
  /** The manual Payment row's reference. null on a deduction — nothing was sold. */
  reference: string | null;
  balance: MinuteBalance;
}
