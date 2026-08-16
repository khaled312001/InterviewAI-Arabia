import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';

export interface AiUsageLog {
  id: string;
  userId: string | null;
  provider: string;
  model: string;
  feature: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** null = the call predates cost tracking. Never render it as free. */
  costMicroUsd: number | null;
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

export interface UsageBucket {
  calls: number;
  failures: number;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Calls in this bucket whose cost was never recorded. */
  unpricedCalls: number;
}

export interface AiUsageSummary extends UsageBucket {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  avgLatencyMs: number | null;
  maxLatencyMs: number;
}

export interface DailyPoint {
  day: string;
  calls: number;
  failures: number;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AiUsageResponse {
  logs: AiUsageLog[];
  page: number;
  limit: number;
  total: number;
  range: { from: string; to: string };
  summary: AiUsageSummary;
  byProvider: Array<UsageBucket & { provider: string }>;
  byFeature: Array<UsageBucket & { feature: string }>;
  daily: DailyPoint[];
}

export interface AiUsageParams {
  page: number;
  limit: number;
  days: number;
  provider: string;
  feature: string;
  status: 'all' | 'success' | 'error';
}

export const RANGE_OPTIONS = [
  { value: 1, label: 'آخر ٢٤ ساعة' },
  { value: 7, label: 'آخر ٧ أيام' },
  { value: 30, label: 'آخر ٣٠ يومًا' },
  { value: 90, label: 'آخر ٩٠ يومًا' },
] as const;

export function useAiUsageQuery(params: AiUsageParams) {
  return useQuery({
    queryKey: qk.aiUsage.list(params as unknown as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<AiUsageResponse>('/admin/ai-usage', {
        signal,
        params: {
          page: params.page,
          limit: params.limit,
          days: params.days,
          provider: params.provider || undefined,
          feature: params.feature || undefined,
          status: params.status === 'all' ? undefined : params.status,
        },
      });
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

/** micro-USD -> USD, for chart axes and StatCard values. */
export const microToUsd = (micro: number) => micro / 1_000_000;

/**
 * The exact `feature` values written by backend/src/services/ai/index.js.
 * An unknown key falls through to the raw string rather than being hidden —
 * a new feature must be visible the day it starts spending tokens.
 */
export const FEATURE_LABEL_AR: Record<string, string> = {
  evaluate: 'تقييم إجابة',
  meeting_turn: 'دور في مقابلة',
  interview_eval: 'تقييم مقابلة',
  cv_summary: 'ملخّص السيرة الذاتية',
};

export const featureLabel = (key: string) => FEATURE_LABEL_AR[key] ?? key;
