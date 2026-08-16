export type UserPlan = 'free' | 'premium';

/** The row shape GET /api/admin/users returns (one row per user). */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  language: 'ar' | 'en';
  plan: UserPlan;
  /**
   * RETIRED. Migration 002 replaced the daily question quota with the minute
   * balance, and nothing reads either column any more — they survive only so a
   * rolled-back backend still boots, and migration 003 drops them. They are
   * still typed because GET /admin/users keeps returning them; no view renders
   * them, and none should. The live figure is `GET /admin/users/:id/minutes`.
   */
  dailyQuestionsUsed: number;
  lastResetDate: string | null;
  /** The column entitlement is actually gated on — not `plan`. */
  premiumUntil: string | null;
  isDisabled: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UserStats {
  sessionsCount: number;
  completedCount: number;
  answersCount: number;
  /** null when the user has never answered — never a fabricated 0. */
  avgScore: number | null;
  lastSessionAt: string | null;
  subscriptionsCount: number;
}

export interface UserSession {
  id: string;
  kind: 'practice' | 'meeting';
  /** SUM of the answer scores — divide by answersCount for a comparable value. */
  totalScore: number;
  startedAt: string;
  endedAt: string | null;
  categoryId: number;
  category: { id: number; nameAr: string; nameEn: string; icon: string | null };
  answersCount: number;
}

/** Every field PATCH /api/admin/users/:id accepts. */
export interface UserPatch {
  name?: string;
  plan?: UserPlan;
  /** ISO-8601, or null to clear. Mandatory when plan becomes 'premium'. */
  premiumUntil?: string | null;
  isDisabled?: boolean;
  /**
   * Free text (3..300) stored on the subscription the backend grants or extends
   * behind an entitlement change, and in the audit row. REQUIRED whenever
   * `plan` or `premiumUntil` is sent — the server answers REASON_REQUIRED
   * otherwise, exactly as POST /admin/subscriptions does.
   */
  reason?: string;
}

/**
 * Every field POST /api/admin/users accepts. Deliberately has no plan or
 * premiumUntil: the backend keeps a single writer for the premium mirror, so
 * entitlement is granted after the account exists, from the edit drawer.
 */
export interface UserCreateInput {
  email: string;
  name: string;
  language: 'ar' | 'en';
  phone?: string;
}

/**
 * The 201 body. `temporaryPassword` exists in this response and nowhere else —
 * no GET returns it and no audit row holds it, so it is shown once and lost.
 */
export interface UserCreateResponse {
  user: AdminUser;
  temporaryPassword: string;
}

/** `details` on a 409 EMAIL_TAKEN — the account that already owns the address. */
export interface EmailTakenDetails {
  userId: string;
}

export type PlanFilter = '' | 'free' | 'premium' | 'premium_expired';
export type StatusFilter = '' | 'active' | 'disabled';
