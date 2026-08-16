/**
 * One key per endpoint. Dashboard and Analytics share qk.analytics.overview(),
 * which is what removes the double-fetch they used to cause with two
 * differently-spelled keys for the same request.
 */
export const qk = {
  auth: {
    me: () => ['admin', 'auth', 'me'] as const,
  },
  analytics: {
    overview: (range: Record<string, unknown>) => ['admin', 'analytics', 'overview', range] as const,
    popularCategories: (range: Record<string, unknown>) =>
      ['admin', 'analytics', 'popular-categories', range] as const,
    timeseries: (range: Record<string, unknown>) => ['admin', 'analytics', 'timeseries', range] as const,
    attention: () => ['admin', 'analytics', 'attention'] as const,
  },
  users: {
    /** Prefix every user query shares, so one mutation invalidates all of them. */
    all: () => ['admin', 'users'] as const,
    list: (params: Record<string, unknown>) => ['admin', 'users', 'list', params] as const,
    detail: (id: string) => ['admin', 'users', id, 'detail'] as const,
    sessions: (id: string, params: Record<string, unknown>) =>
      ['admin', 'users', id, 'sessions', params] as const,
  },
  questions: {
    list: (params: Record<string, unknown>) => ['admin', 'questions', 'list', params] as const,
  },
  categories: {
    list: () => ['admin', 'categories', 'list'] as const,
  },
  subscriptions: {
    list: (params: Record<string, unknown>) => ['admin', 'subscriptions', 'list', params] as const,
  },
  payments: {
    list: (params: Record<string, unknown>) => ['admin', 'payments', 'list', params] as const,
  },
  aiUsage: {
    list: (params: Record<string, unknown>) => ['admin', 'ai-usage', 'list', params] as const,
  },
  reports: {
    list: (params: Record<string, unknown>) => ['admin', 'reports', 'list', params] as const,
  },
  settings: {
    all: () => ['admin', 'settings'] as const,
  },
  integrations: {
    all: () => ['admin', 'integrations'] as const,
  },
  admins: {
    all: () => ['admin', 'admins'] as const,
    list: (params: Record<string, unknown>) => ['admin', 'admins', 'list', params] as const,
  },
  audit: {
    list: (params: Record<string, unknown>) => ['admin', 'audit', 'list', params] as const,
  },
} as const;
