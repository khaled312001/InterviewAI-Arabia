import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';

export type ReportStatusFilter = 'all' | 'open' | 'resolved';

export interface ReportQuestion {
  id: string | null;
  text: string | null;
  /** 'meeting' answers have no row in `questions`; the prompt came from the
   *  answer itself. Rendering them identically would hide that. */
  source: 'catalogue' | 'meeting';
}

export interface ReportAnswer {
  id: string;
  userAnswer: string | null;
  aiScore: number | null;
  answeredAt: string | null;
  sessionId: string | null;
  sessionKind: 'practice' | 'meeting' | null;
  question: ReportQuestion;
}

export interface AdminReport {
  id: string;
  answerId: string;
  reporterId: string;
  reason: string;
  resolved: boolean;
  createdAt: string;
  answer: ReportAnswer;
  reporter: { id: string; email: string | null; name: string | null };
}

export interface ReportsResponse {
  reports: AdminReport[];
  page: number;
  limit: number;
  total: number;
  /** Unresolved across the whole table, not just this page — feeds the nav badge. */
  openCount: number;
}

export interface ReportsParams {
  page: number;
  limit: number;
  status: ReportStatusFilter;
  q: string;
}

export function useReportsQuery(params: ReportsParams) {
  return useQuery({
    queryKey: qk.reports.list(params as unknown as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<ReportsResponse>('/admin/reports', {
        signal,
        params: {
          page: params.page,
          limit: params.limit,
          status: params.status === 'all' ? undefined : params.status,
          q: params.q || undefined,
        },
      });
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

export function useResolveReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, resolved }: { id: string; resolved: boolean }) => {
      const { data } = await api.post(`/admin/reports/${id}/resolve`, { resolved });
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'reports'] });
    },
  });
}

/**
 * The unresolved count for the sidebar badge. Cheap because it rides the same
 * endpoint the page uses; `limit: 1` keeps the payload to one row.
 */
export function useUnresolvedReportsCount(enabled: boolean) {
  const query = useQuery({
    queryKey: qk.reports.list({ badge: true }),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<ReportsResponse>('/admin/reports', {
        signal,
        params: { page: 1, limit: 1, status: 'open' },
      });
      return data.openCount;
    },
    enabled,
    staleTime: 60_000,
  });
  return query.data ?? 0;
}
