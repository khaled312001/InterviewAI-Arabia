import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { useToast } from '../../components/common/ToastProvider';
import type {
  AdminUser,
  PlanFilter,
  StatusFilter,
  UserCreateInput,
  UserCreateResponse,
  UserPatch,
  UserSession,
  UserStats,
} from './types';

export interface UserListParams {
  page: number;
  limit: number;
  q?: string;
  plan?: PlanFilter;
  status?: StatusFilter;
}

interface UserListResponse {
  users: AdminUser[];
  page: number;
  limit: number;
  total: number;
}

/** Drops empty filters so the query key (and the URL) stay stable. */
function clean<T extends object>(params: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined));
}

export function useUsers(params: UserListParams) {
  const query = clean(params);
  return useQuery({
    queryKey: qk.users.list(query),
    queryFn: async () => (await api.get<UserListResponse>('/admin/users', { params: query })).data,
    // Rows stay mounted while a page change or a filter refetch is in flight.
    placeholderData: (previous) => previous,
  });
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: qk.users.detail(id ?? ''),
    queryFn: async () =>
      (await api.get<{ user: AdminUser; stats: UserStats }>(`/admin/users/${id}`)).data,
    enabled: Boolean(id),
  });
}

export function useUserSessions(id: string | undefined, params: { page: number; limit: number }) {
  return useQuery({
    queryKey: qk.users.sessions(id ?? '', params),
    queryFn: async () =>
      (
        await api.get<{ sessions: UserSession[]; total: number }>(`/admin/users/${id}/sessions`, {
          params,
        })
      ).data,
    enabled: Boolean(id),
    placeholderData: (previous) => previous,
  });
}

/**
 * Create an account by hand (POST /admin/users, super_admin only).
 *
 * Deliberately does NOT close the drawer on success: the response carries the
 * one and only copy of the temporary password, so the caller keeps it and
 * swaps the form for the hand-off panel. Closing here would destroy it.
 */
export function useCreateUser() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (body: UserCreateInput) =>
      (await api.post<UserCreateResponse>('/admin/users', body)).data,
    onSuccess: () => {
      // No toast: the drawer's result panel is the confirmation, and a
      // success snackbar over it would compete with the password.
      qc.invalidateQueries({ queryKey: qk.users.all() });
    },
    // Rendered next to the email field (409 EMAIL_TAKEN) or in the drawer's
    // alert; defining onError suppresses the global mutationCache toast.
    onError: () => {},
  });
}

/** The detail drawer's save. Errors render inline in FormDrawer's alert. */
export function useSaveUser(onDone: () => void) {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async ({ id, ...body }: UserPatch & { id: string }) =>
      (await api.patch(`/admin/users/${id}`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.users.all() });
      toast.success('تم حفظ بيانات المستخدم');
      onDone();
    },
    // Surfaced by ApiErrorAlert inside the drawer; defining onError at all is
    // what suppresses the global mutationCache toast.
    onError: () => {},
  });
}

export function useSetUserDisabled() {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ id, isDisabled }: { id: string; isDisabled: boolean }) =>
      api.patch(`/admin/users/${id}`, { isDisabled }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: qk.users.all() });
      toast.success(vars.isDisabled ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب');
    },
    // Rethrown so ConfirmDialog keeps itself open and shows the reason.
    onError: () => {},
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
    onSuccess: (_data, id) => {
      // Dropped, not invalidated: refetching the detail of a row we just
      // deleted would answer 404 and flash an error on the way out.
      qc.removeQueries({ queryKey: qk.users.detail(id) });
      qc.invalidateQueries({ queryKey: qk.users.list({}), exact: false });
      toast.success('تم حذف الحساب نهائيًا');
    },
    onError: () => {},
  });
}
