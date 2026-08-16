import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import type { DateRange } from '../../lib/hooks/useDateRange';

/**
 * Both /  and /analytics read the same endpoints through these hooks, so they
 * share one query key per endpoint and the two pages never double-fetch the
 * same request under differently-spelled keys.
 */

export interface RangeMeta {
  from: string;
  to: string;
  days: number;
  timezone: string;
  /** false ⇒ the server bucketed with a fixed UTC offset because MySQL has no
   *  named-timezone tables; a DST change inside the window may shift one
   *  boundary by an hour. Surfaced to the reader, never hidden. */
  exactTimezone: boolean;
}

export interface OverviewResponse {
  range: RangeMeta;
  totals: {
    users: number;
    /** Entitlement, not the `plan` column — matches services/quota.js. */
    premiumUsers: number;
    premiumExpired: number;
    conversionRate: number;
  };
  current: {
    newUsers: number;
    sessions: number;
    answers: number;
    activeUsers: number;
    /** null when nothing was scored in the window. Never 0. */
    avgScore: number | null;
    scoredAnswers: number;
  };
  previous: {
    newUsers: number;
    sessions: number;
    answers: number;
    activeUsers: number;
  };
  today: {
    date: string;
    newUsers: number;
    sessions: number;
    activeUsers: number;
  };
}

export interface CategoryRow {
  category: { id: number; nameAr: string; nameEn: string; icon: string | null; isPremium: boolean };
  sessions: number;
  users: number;
  scoredAnswers: number;
  avgScore: number | null;
}

export interface PopularCategoriesResponse {
  range: RangeMeta;
  limit: number;
  rows: CategoryRow[];
}

export interface TimeseriesPoint {
  date: string;
  signups: number;
  sessions: number;
  activeUsers: number;
  answers: number;
  avgScore: number | null;
}

export interface TimeseriesResponse {
  range: RangeMeta;
  points: TimeseriesPoint[];
}

export interface AttentionResponse {
  /** Keys the current admin's role is not allowed to act on are absent — the
   *  backend omits them rather than sending a number with no reachable page. */
  attention: {
    unresolvedReports?: number;
    failedAiCalls24h?: number;
    expiringSubscriptions7d?: number;
  };
  checkedAt: string;
}

/** `enabled` lets a page hold every request until the range is valid, instead
 *  of firing one the server will reject. */
interface Options {
  enabled?: boolean;
}

export function useOverview(range: DateRange, { enabled = true }: Options = {}) {
  return useQuery({
    queryKey: qk.analytics.overview(range),
    enabled,
    queryFn: async () =>
      (await api.get<OverviewResponse>('/admin/analytics/overview', { params: range })).data,
  });
}

export function usePopularCategories(range: DateRange, { enabled = true }: Options = {}) {
  return useQuery({
    queryKey: qk.analytics.popularCategories(range),
    enabled,
    queryFn: async () =>
      (
        await api.get<PopularCategoriesResponse>('/admin/analytics/popular-categories', {
          params: range,
        })
      ).data,
  });
}

export function useTimeseries(range: DateRange, { enabled = true }: Options = {}) {
  return useQuery({
    queryKey: qk.analytics.timeseries(range),
    enabled,
    queryFn: async () =>
      (await api.get<TimeseriesResponse>('/admin/analytics/timeseries', { params: range })).data,
  });
}

export function useAttention({ enabled = true }: Options = {}) {
  return useQuery({
    queryKey: qk.analytics.attention(),
    enabled,
    queryFn: async () => (await api.get<AttentionResponse>('/admin/analytics/attention')).data,
  });
}

/**
 * Percentage change vs the previous window. Returns undefined when there is no
 * baseline — a jump from 0 has no meaningful percentage, and rendering one
 * (or an Infinity) would be an invented figure.
 */
export function deltaRatio(current: number | undefined, previous: number | undefined) {
  if (current === undefined || previous === undefined || previous === 0) return undefined;
  return (current - previous) / previous;
}
