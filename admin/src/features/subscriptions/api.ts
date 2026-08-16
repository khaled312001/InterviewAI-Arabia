import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import type { AdminUser } from '../users/types';
import type {
  GrantBody,
  MutationResult,
  Subscription,
  SubscriptionListParams,
  SubscriptionPatch,
  SubscriptionsResponse,
} from './types';

/** Drops empty filters so the query key (and the request) stay stable. */
function clean<T extends object>(params: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null),
  );
}

/**
 * Everything a subscription write moves:
 *  - the subscription rows themselves,
 *  - users.plan / users.premium_until, which the server re-derives in the same
 *    transaction, so every user view is stale the moment this returns,
 *  - the premium counts on the dashboard and analytics cards.
 * Nothing here is optimistic: these are financial and account actions, so the
 * table is refetched and shows the server's answer.
 */
function invalidateEntitlement(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: qk.subscriptions.all() });
  qc.invalidateQueries({ queryKey: qk.users.all() });
  qc.invalidateQueries({ queryKey: qk.analytics.all() });
}

export function useSubscriptions(params: SubscriptionListParams) {
  const query = clean(params);
  return useQuery<SubscriptionsResponse>({
    queryKey: qk.subscriptions.list(query),
    queryFn: async () => (await api.get('/admin/subscriptions', { params: query })).data,
    // Rows stay on screen while the next page loads, so paging never blanks.
    placeholderData: keepPreviousData,
  });
}

/**
 * The grant drawer's user picker. GET /admin/users is readable by every admin
 * role and already supports `q`, so no new endpoint is needed — and the row it
 * returns carries `premiumUntil`, which is what the drawer previews the
 * extension against without a second request.
 */
export function useUserSearch(q: string, enabled: boolean) {
  return useQuery<{ users: AdminUser[]; total: number }>({
    queryKey: qk.users.list({ q, limit: 10, page: 1, picker: true }),
    queryFn: async () =>
      (await api.get('/admin/users', { params: { q, page: 1, limit: 10 } })).data,
    enabled: enabled && q.trim().length > 0,
    placeholderData: keepPreviousData,
  });
}

/** The rows behind one account, for a per-user view of what covers them. */
export function useUserSubscriptions(userId: string | undefined) {
  return useQuery<{ subscriptions: Subscription[] }>({
    queryKey: qk.subscriptions.byUser(userId ?? ''),
    queryFn: async () => (await api.get(`/admin/users/${userId}/subscriptions`)).data,
    enabled: Boolean(userId),
  });
}

/** POST /admin/subscriptions — creates a real provider='manual' row, no Payment. */
export function useGrantSubscription() {
  const qc = useQueryClient();
  return useMutation<MutationResult, unknown, GrantBody>({
    mutationFn: async (body) => (await api.post('/admin/subscriptions', body)).data,
    onSuccess: () => invalidateEntitlement(qc),
    // Declaring onError at all is what suppresses the global mutationCache
    // toast; the drawer renders the failure inline, next to the field.
    onError: () => {},
  });
}

/** PATCH /admin/subscriptions/:id — extend or correct. Never rewrites `provider`. */
export function useUpdateSubscription() {
  const qc = useQueryClient();
  return useMutation<MutationResult, unknown, SubscriptionPatch & { id: string }>({
    mutationFn: async ({ id, ...body }) =>
      (await api.patch(`/admin/subscriptions/${id}`, body)).data,
    onSuccess: () => invalidateEntitlement(qc),
    onError: () => {},
  });
}

/**
 * DELETE /admin/subscriptions/:id — revoke. The row is cancelled, not deleted:
 * it is the ledger entry explaining money the customer can still see on their
 * statement. The response carries the re-derived mirror, so the page reports
 * whether the user actually lost premium instead of assuming it.
 */
export function useRevokeSubscription() {
  const qc = useQueryClient();
  return useMutation<MutationResult, unknown, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }) =>
      (await api.delete(`/admin/subscriptions/${id}`, { data: reason ? { reason } : {} })).data,
    onSuccess: () => invalidateEntitlement(qc),
    onError: () => {},
  });
}
