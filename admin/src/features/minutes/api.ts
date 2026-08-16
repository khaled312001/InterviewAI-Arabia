import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import type { MinutesAdjustBody, MinutesAdjustResult, MinutesResponse } from './types';

/**
 * GET /admin/users/:id/minutes — the balance and the statement behind it.
 *
 * Readable by every admin role: "where did my minutes go?" lands on support,
 * and answering it must not require the role that can also change the balance.
 */
export function useUserMinutes(userId: string | undefined) {
  return useQuery<MinutesResponse>({
    queryKey: qk.minutes.byUser(userId ?? ''),
    queryFn: async ({ signal }) =>
      (await api.get<MinutesResponse>(`/admin/users/${userId}/minutes`, { signal })).data,
    enabled: Boolean(userId),
  });
}

/**
 * POST /admin/users/:id/minutes — credit or deduct.
 *
 * Nothing is optimistic. This moves a customer's balance, and the server clamps
 * a deduction at what is actually left, so the only honest number to show
 * afterwards is the one the response carries. The user detail query is
 * invalidated too: a credit writes a `provider='manual'` Payment row, which the
 * account's payment history and the revenue summary both read.
 */
export function useAdjustMinutes(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<MinutesAdjustResult, unknown, MinutesAdjustBody>({
    mutationFn: async (body) =>
      (await api.post<MinutesAdjustResult>(`/admin/users/${userId}/minutes`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.minutes.all() });
      qc.invalidateQueries({ queryKey: qk.users.all() });
      qc.invalidateQueries({ queryKey: qk.payments.all() });
    },
    // Declaring onError at all is what suppresses the global mutationCache
    // toast; the drawer renders the failure inline, above the fields.
    onError: () => {},
  });
}
