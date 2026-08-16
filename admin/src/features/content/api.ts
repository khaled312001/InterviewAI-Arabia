import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { useToast } from '../../components/common/ToastProvider';
import type { AdminCategory, AdminQuestion, CategoryInput, QuestionInput } from './types';

/* ----------------------------- categories ----------------------------- */

/**
 * GET /api/admin/categories returns the complete list (there is no server
 * pagination and none is needed — the table is tens of rows), plus the two
 * counts the delete confirmation needs. Both content pages share this one key,
 * so opening Questions after Categories costs no second request.
 */
export function useCategories() {
  return useQuery({
    queryKey: qk.categories.list(),
    queryFn: async () => {
      const { data } = await api.get<{ categories: AdminCategory[] }>('/admin/categories');
      return data.categories;
    },
  });
}

export function useSaveCategory(onDone: () => void) {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async ({ id, ...body }: CategoryInput & { id?: number }) => {
      if (id) return (await api.patch(`/admin/categories/${id}`, body)).data;
      return (await api.post('/admin/categories', body)).data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: qk.categories.list() });
      // A renamed or deactivated category changes what the questions grid shows.
      qc.invalidateQueries({ queryKey: ['admin', 'questions'] });
      toast.success(vars.id ? 'تم حفظ القسم' : 'تم إنشاء القسم');
      onDone();
    },
    // Errors are surfaced inline by FormDrawer's ApiErrorAlert; the global
    // mutationCache toast is suppressed by defining onError at all.
    onError: () => {},
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/categories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.categories.list() });
      qc.invalidateQueries({ queryKey: ['admin', 'questions'] });
      toast.success('تم حذف القسم');
    },
    // Rethrown so ConfirmDialog keeps the dialog open and shows the reason
    // (e.g. CATEGORY_IN_USE) in context.
    onError: () => {},
  });
}

/* ----------------------------- questions ------------------------------ */

export interface QuestionListParams {
  page: number;
  limit: number;
  categoryId?: string;
  difficulty?: string;
  isActive?: string;
  q?: string;
}

export function useQuestions(params: QuestionListParams) {
  return useQuery({
    queryKey: qk.questions.list(params as unknown as Record<string, unknown>),
    queryFn: async () => {
      const { data } = await api.get<{ questions: AdminQuestion[]; total: number }>(
        '/admin/questions',
        { params },
      );
      return data;
    },
    // Rows stay on screen while a filter change refetches.
    placeholderData: (previous) => previous,
  });
}

export function useSaveQuestion(onDone: () => void) {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async ({ id, ...body }: QuestionInput & { id?: string }) => {
      if (id) return (await api.patch(`/admin/questions/${id}`, body)).data;
      return (await api.post('/admin/questions', body)).data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'questions'] });
      qc.invalidateQueries({ queryKey: qk.categories.list() }); // questionCount moved
      toast.success(vars.id ? 'تم حفظ السؤال' : 'تم إنشاء السؤال');
      onDone();
    },
    onError: () => {},
  });
}

/** The row-level activate/deactivate toggle — a PATCH of one field. */
export function useToggleQuestion() {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/admin/questions/${id}`, { isActive }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'questions'] });
      toast.success(vars.isActive ? 'تم تفعيل السؤال' : 'تم إيقاف السؤال');
    },
  });
}

export function useDeleteQuestion() {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (id: string) => api.delete(`/admin/questions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'questions'] });
      qc.invalidateQueries({ queryKey: qk.categories.list() });
      toast.success('تم حذف السؤال');
    },
    onError: () => {},
  });
}

export function useBulkImportQuestions(onDone: (count: number) => void) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (questions: QuestionInput[]) => {
      const { data } = await api.post<{ count: number }>('/admin/questions/bulk', { questions });
      return data.count;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['admin', 'questions'] });
      qc.invalidateQueries({ queryKey: qk.categories.list() });
      onDone(count);
    },
    // The drawer renders per-row failures itself; a toast cannot carry them.
    onError: () => {},
  });
}
