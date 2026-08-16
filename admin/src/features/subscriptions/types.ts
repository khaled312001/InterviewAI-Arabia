/**
 * Shapes returned by the /admin/subscriptions routes in
 * backend/src/routes/admin.js. Every field here was read off that file — the
 * grid used to select columns migration 001 had renamed, so the transcription
 * is deliberate rather than remembered.
 */

export type SubscriptionStatus = 'pending' | 'active' | 'expired' | 'cancelled' | 'refunded';
export type PaymentProvider = 'easykash' | 'paymob' | 'google_play' | 'manual';

/** The joined account. `plan`/`premiumUntil` are the entitlement mirror. */
export interface SubscriptionUser {
  id: string;
  email: string | null;
  name: string | null;
  plan: string | null;
  premiumUntil: string | null;
}

export interface Subscription {
  id: string;
  userId: string;
  provider: PaymentProvider | string;
  providerRef: string | null;
  planCode: string | null;
  status: SubscriptionStatus | string;
  autoRenew: boolean;
  startedAt: string | null;
  expiresAt: string | null;
  cancelledAt: string | null;
  createdAt: string | null;
  user?: SubscriptionUser;
}

export interface SubscriptionsResponse {
  subscriptions: Subscription[];
  page: number;
  limit: number;
  total: number;
  summary: {
    byStatus: Partial<Record<SubscriptionStatus, number>> & Record<string, number>;
    total: number;
    expiringIn7Days: number;
  };
}

export interface SubscriptionListParams {
  page: number;
  limit: number;
  q?: string;
  status?: string;
  provider?: string;
  userId?: string;
}

/**
 * POST /admin/subscriptions. Exactly one of `days` | `expiresAt` — the server
 * answers GRANT_DURATION_REQUIRED when both or neither arrive.
 */
export interface GrantBody {
  userId: string;
  days?: number;
  expiresAt?: string;
  planCode?: string;
  /** 3..300 chars, required: a manual grant with no stated reason is unauditable. */
  reason: string;
}

/** PATCH /admin/subscriptions/:id. `extendDays` XOR `expiresAt`. */
export interface SubscriptionPatch {
  extendDays?: number;
  expiresAt?: string;
  planCode?: string;
  autoRenew?: boolean;
  reason: string;
}

/**
 * Every write returns the re-derived mirror, so the UI can state the outcome
 * from the server's truth instead of guessing it. `stillCovered` is what stops
 * a revoke from being reported as a downgrade when another paid row survives.
 */
export interface MutationResult {
  subscription: Subscription;
  supersededIds?: string[];
  stillCovered?: boolean;
  user: { id: string; plan: string; premiumUntil: string | null };
}
