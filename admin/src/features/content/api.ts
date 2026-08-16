import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { runSequential } from '../../lib/bulk';
import { parseApiError } from '../../lib/errors';
import { countAr, formatNumber, QUESTION_FORMS } from '../../lib/format';
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

/**
 * The row-level activate/deactivate toggle — the same one-field PATCH the
 * questions grid has always had. Without it the only way to take a category
 * off the app was to open the drawer, find the switch and save the whole form,
 * which is why "deactivate instead of delete" was advice nobody followed.
 */
export function useToggleCategory() {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.patch(`/admin/categories/${id}`, { isActive }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: qk.categories.list() });
      // A deactivated category changes the label the questions grid renders.
      qc.invalidateQueries({ queryKey: ['admin', 'questions'] });
      toast.success(vars.isActive ? 'تم تفعيل القسم' : 'تم إيقاف القسم');
    },
    // Run from inside a ConfirmDialog, which keeps itself open and shows the
    // reason. Declaring onError at all is what stops the global mutationCache
    // from raising a second toast for the same failure.
    onError: () => {},
  });
}

/**
 * Reordering. `sortOrder` was editable only by typing a number into the drawer,
 * against a list the operator could see but not manipulate.
 *
 * `ordered` is the whole list in its desired final order. Positions are then
 * renumbered index*10 and only the rows whose number actually changes are
 * PATCHed — so the common case (swap two neighbours) is two requests, while a
 * list that was seeded with duplicate or zero sort orders is normalised once
 * and stays unambiguous afterwards. GET /admin/categories orders by
 * `sort_order ASC, id ASC`, so ties resolve by id and a plain value swap
 * between two rows that share a number would have moved nothing at all.
 */
export function useReorderCategories() {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async (ordered: AdminCategory[]) => {
      const changed = ordered
        .map((category, index) => ({ category, sortOrder: index * 10 }))
        .filter(({ category, sortOrder }) => category.sortOrder !== sortOrder);

      const outcome = await runSequential(changed, ({ category, sortOrder }) =>
        api.patch(`/admin/categories/${category.id}`, { sortOrder }),
      );
      return outcome;
    },
    onSuccess: (outcome) => {
      qc.invalidateQueries({ queryKey: qk.categories.list() });
      if (outcome.failed.length > 0) {
        // Half a reorder is a real state, not a no-op — say so instead of
        // reporting success over a list that is now in neither order.
        toast.error(
          `تعذّر حفظ الترتيب بالكامل: ${parseApiError(outcome.failed[0].error).messageAr}`,
        );
        return;
      }
      toast.success('تم تحديث الترتيب');
    },
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
    queryKey: qk.questions.list(params),
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

/**
 * The row-level activate/deactivate toggle — a PATCH of one field.
 *
 * `errorsHandledByCaller` is for the call sites that run it inside a
 * ConfirmDialog (the reports queue deactivating a reported question): the
 * dialog already stays open and reports the failure, and defining onError here
 * is what suppresses the global mutationCache toast that would duplicate it.
 * The plain grid toggle leaves it off and relies on that global floor.
 */
export function useToggleQuestion({ errorsHandledByCaller = false } = {}) {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/admin/questions/${id}`, { isActive }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'questions'] });
      toast.success(vars.isActive ? 'تم تفعيل السؤال' : 'تم إيقاف السؤال');
    },
    ...(errorsHandledByCaller ? { onError: () => {} } : null),
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

/* --------------------------- bulk questions --------------------------- */

export type QuestionBulkAction = 'activate' | 'deactivate' | 'delete';

const BULK_DONE_AR: Record<QuestionBulkAction, string> = {
  activate: 'تم تفعيل',
  deactivate: 'تم إيقاف',
  delete: 'تم حذف',
};

/**
 * Activate / deactivate / delete the ticked rows. The backend has no bulk
 * mutation endpoint, so this is one request per row, run in order and reported
 * honestly: partial success is announced with the count that actually took and
 * the reason the first failure gave, because "تم" over a half-applied batch is
 * the one outcome an operator cannot recover from.
 */
export function useBulkQuestions() {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: QuestionBulkAction }) =>
      runSequential(ids, (id) =>
        action === 'delete'
          ? api.delete(`/admin/questions/${id}`)
          : api.patch(`/admin/questions/${id}`, { isActive: action === 'activate' }),
      ),
    onSuccess: (outcome, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'questions'] });
      // Deleting rows moves questionCount on the categories grid.
      if (vars.action === 'delete') qc.invalidateQueries({ queryKey: qk.categories.list() });

      const total = vars.ids.length;
      const verb = BULK_DONE_AR[vars.action];
      if (outcome.failed.length === 0) {
        toast.success(`${verb} ${countAr(total, QUESTION_FORMS)}`);
        return;
      }
      const reason = parseApiError(outcome.failed[0].error).messageAr;
      toast.warning(
        `${verb} ${formatNumber(outcome.done.length)} من ${formatNumber(total)} — تعذّر الباقي: ${reason}`,
      );
    },
    // runSequential swallows the per-row rejections and reports them above, so
    // this only silences the global mutationCache floor for the batch itself.
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
