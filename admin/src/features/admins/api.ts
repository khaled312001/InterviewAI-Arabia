import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { useToast } from '../../components/common/ToastProvider';
import type { AdminRole } from '../../store/auth';

export interface AdminAccount {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminCreateInput {
  email: string;
  name: string;
  password: string;
  role: AdminRole;
}

export interface AdminPatchInput {
  id: string;
  name?: string;
  role?: AdminRole;
  isActive?: boolean;
  /** Optional reset; omitted when the field is left blank. */
  password?: string;
}

export function useAdmins(params: { page: number; limit: number }) {
  return useQuery({
    queryKey: qk.admins.list(params),
    queryFn: async () =>
      (await api.get<{ admins: AdminAccount[]; total: number }>('/admin/admins', { params })).data,
    placeholderData: (previous) => previous,
  });
}

export function useCreateAdmin(onDone: () => void) {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async (body: AdminCreateInput) => (await api.post('/admin/admins', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.admins.all() });
      toast.success('تم إنشاء حساب المدير');
      onDone();
    },
    // FormDrawer renders the reason inline (409 duplicate email, weak password).
    onError: () => {},
  });
}

export function useSaveAdmin(onDone: () => void) {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async ({ id, ...body }: AdminPatchInput) =>
      (await api.patch(`/admin/admins/${id}`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.admins.all() });
      toast.success('تم حفظ بيانات المدير');
      onDone();
    },
    onError: () => {},
  });
}

/** The row-level activate/deactivate toggle, run from inside a confirmation. */
export function useSetAdminActive() {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/admin/admins/${id}`, { isActive }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: qk.admins.all() });
      toast.success(vars.isActive ? 'تم تفعيل الحساب' : 'تم تعطيل الحساب');
    },
    onError: () => {},
  });
}

export function useDeleteAdmin() {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (id: string) => api.delete(`/admin/admins/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.admins.all() });
      toast.success('تم حذف حساب المدير');
    },
    onError: () => {},
  });
}
