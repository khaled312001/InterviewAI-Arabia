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
    overview: () => ['admin', 'analytics', 'overview'] as const,
    popularCategories: () => ['admin', 'analytics', 'popular-categories'] as const,
  },
  users: {
    list: (params: Record<string, unknown>) => ['admin', 'users', 'list', params] as const,
    sessions: (id: string) => ['admin', 'users', id, 'sessions'] as const,
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
    list: () => ['admin', 'admins', 'list'] as const,
  },
  audit: {
    list: (params: Record<string, unknown>) => ['admin', 'audit', 'list', params] as const,
  },
} as const;
