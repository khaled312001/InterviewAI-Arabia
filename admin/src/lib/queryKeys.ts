/**
 * One key per endpoint. Dashboard and Analytics share qk.analytics.overview(),
 * which is what removes the double-fetch they used to cause with two
 * differently-spelled keys for the same request.
 */

/**
 * A params bag. Deliberately `object`, not `Record<string, unknown>`: an
 * interface (UserListParams, DateRange, …) has no index signature and is
 * rejected by that type, which forced every call site into a cast.
 */
export type QueryParams = object;

export const qk = {
  auth: {
    me: () => ['admin', 'auth', 'me'] as const,
  },
  analytics: {
    /** Prefix: a grant or a revoke changes the premium counts every card reads. */
    all: () => ['admin', 'analytics'] as const,
    overview: (range: QueryParams) => ['admin', 'analytics', 'overview', range] as const,
    popularCategories: (range: QueryParams) =>
      ['admin', 'analytics', 'popular-categories', range] as const,
    timeseries: (range: QueryParams) => ['admin', 'analytics', 'timeseries', range] as const,
    attention: () => ['admin', 'analytics', 'attention'] as const,
  },
  users: {
    /** Prefix every user query shares, so one mutation invalidates all of them. */
    all: () => ['admin', 'users'] as const,
    list: (params: QueryParams) => ['admin', 'users', 'list', params] as const,
    detail: (id: string) => ['admin', 'users', id, 'detail'] as const,
    sessions: (id: string, params: QueryParams) =>
      ['admin', 'users', id, 'sessions', params] as const,
  },
  questions: {
    list: (params: QueryParams) => ['admin', 'questions', 'list', params] as const,
  },
  categories: {
    list: () => ['admin', 'categories', 'list'] as const,
  },
  subscriptions: {
    /** Prefix every subscription query shares — one mutation invalidates all. */
    all: () => ['admin', 'subscriptions'] as const,
    list: (params: QueryParams) => ['admin', 'subscriptions', 'list', params] as const,
    /** GET /admin/users/:id/subscriptions — the rows behind one account. */
    byUser: (userId: string) => ['admin', 'subscriptions', 'user', userId] as const,
  },
  minutes: {
    /** Prefix: a grant or a deduction invalidates every minute view at once. */
    all: () => ['admin', 'minutes'] as const,
    /** GET /admin/users/:id/minutes — the balance and the statement behind it. */
    byUser: (userId: string) => ['admin', 'minutes', 'user', userId] as const,
  },
  payments: {
    /**
     * Prefix shared by every payment query. A manual minute credit writes a
     * Payment row, so it has to invalidate the payments list — and the list key
     * carries its filters, so `list({})` is a different key from the one the
     * page is actually using. Only a real prefix matches them all.
     */
    all: () => ['admin', 'payments'] as const,
    list: (params: QueryParams) => ['admin', 'payments', 'list', params] as const,
  },
  /**
   * GET /api/payments/config — the price list itself, not an admin resource.
   * Namespaced outside `admin` because it is the same public catalogue the
   * mobile paywall reads: the panel must show what a customer is offered, not a
   * second copy of it that can disagree.
   */
  catalogue: {
    all: () => ['catalogue'] as const,
  },
  aiUsage: {
    list: (params: QueryParams) => ['admin', 'ai-usage', 'list', params] as const,
  },
  reports: {
    list: (params: QueryParams) => ['admin', 'reports', 'list', params] as const,
  },
  settings: {
    all: () => ['admin', 'settings'] as const,
  },
  integrations: {
    all: () => ['admin', 'integrations'] as const,
  },
  /**
   * Push. `all()` is a real prefix because one send moves two views at once:
   * it appends to the history and it can retire dead tokens, which changes the
   * device counts the compose form quotes as its reach.
   */
  push: {
    all: () => ['admin', 'push'] as const,
    overview: () => ['admin', 'push', 'overview'] as const,
    notifications: (params: QueryParams) => ['admin', 'push', 'notifications', params] as const,
  },
  admins: {
    all: () => ['admin', 'admins'] as const,
    list: (params: QueryParams) => ['admin', 'admins', 'list', params] as const,
  },
  audit: {
    list: (params: QueryParams) => ['admin', 'audit', 'list', params] as const,
  },
} as const;
