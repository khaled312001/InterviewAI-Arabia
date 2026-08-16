import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import QuestionAnswerRounded from '@mui/icons-material/QuestionAnswerRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import TextField from '@mui/material/TextField';
import ToggleOffRounded from '@mui/icons-material/ToggleOffRounded';
import ToggleOnRounded from '@mui/icons-material/ToggleOnRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import type { GridColDef, GridRowId } from '@mui/x-data-grid';

import { PageHeader } from '../components/common/PageHeader';
import { DataTable } from '../components/common/DataTable';
import { ErrorState } from '../components/common/ErrorState';
import { Can } from '../components/common/Guard';
import { Mono } from '../components/common/Mono';
import { Num } from '../components/common/Num';
import { StatusChip } from '../components/common/StatusChip';
import { useConfirm } from '../components/common/ConfirmDialog';
import { chipCol, dateCol, numCol, textCol, actionsCol } from '../lib/columns';
import { countAr, formatNumber, QUESTION_FORMS } from '../lib/format';
import { useServerPagination } from '../lib/hooks/useServerPagination';
import { useQueryParamState } from '../lib/hooks/useQueryParamState';
import { useDebouncedValue } from '../lib/hooks/useDebouncedValue';
import { can } from '../lib/permissions';
import { useAuth } from '../store/auth';

import { BulkImportDrawer } from '../features/content/BulkImportDrawer';
import { QuestionFormDrawer } from '../features/content/QuestionFormDrawer';
import {
  useBulkQuestions,
  useCategories,
  useDeleteQuestion,
  useQuestions,
  useToggleQuestion,
} from '../features/content/api';
import { DIFFICULTIES, DIFFICULTY_LABEL_AR } from '../features/content/types';
import type { AdminQuestion } from '../features/content/types';

export function QuestionsPage() {
  const role = useAuth((s) => s.admin?.role);
  const canWrite = can(role, 'questions.write');
  const canDelete = can(role, 'questions.delete');
  const confirm = useConfirm();

  const { paginationModel, onPaginationModelChange, page, pageSize } = useServerPagination();
  const [categoryId, setCategoryId] = useQueryParamState('categoryId');
  const [difficulty, setDifficulty] = useQueryParamState('difficulty');
  const [status, setStatus] = useQueryParamState('status');
  const [urlQuery, setUrlQuery] = useQueryParamState('q');

  // Typing stays local; only the settled value reaches the URL and the request.
  const [search, setSearch] = useState(urlQuery);
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debouncedSearch !== urlQuery) setUrlQuery(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const [editing, setEditing] = useState<AdminQuestion | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const categoriesQ = useCategories();
  const categories = useMemo(() => categoriesQ.data ?? [], [categoriesQ.data]);

  const questionsQ = useQuestions({
    page,
    limit: pageSize,
    ...(categoryId ? { categoryId } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(status ? { isActive: status } : {}),
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
  });

  const toggle = useToggleQuestion();
  const remove = useDeleteQuestion();
  const bulk = useBulkQuestions();

  const filtersActive = Boolean(categoryId || difficulty || status || debouncedSearch);
  function clearFilters() {
    setCategoryId('');
    setDifficulty('');
    setStatus('');
    setSearch('');
    setUrlQuery('');
  }

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(row: AdminQuestion) {
    setEditing(row);
    setFormOpen(true);
  }

  async function askDelete(row: AdminQuestion) {
    await confirm({
      title: 'حذف السؤال؟',
      description: row.questionAr,
      tone: 'danger',
      confirmLabel: 'حذف نهائي',
      consequences: [
        'لا يمكن التراجع عن الحذف.',
        row.usageCount > 0
          ? `طُرح هذا السؤال ${row.usageCount} مرة — الإجابات المرتبطة به ستفقد ارتباطها بالسؤال.`
          : 'لم يُطرح هذا السؤال على أي مستخدم بعد.',
        'لإخفائه دون فقدان أي بيانات، أوقفه بدلًا من حذفه.',
      ],
      onConfirm: () => remove.mutateAsync(row.id),
    });
  }

  /**
   * The ticked rows, resolved back to the objects on the current page — the
   * confirmation has to name what is about to change, and an id names nothing.
   */
  function selectedRows(ids: GridRowId[]): AdminQuestion[] {
    const wanted = new Set(ids.map(String));
    return (questionsQ.data?.questions ?? []).filter((q) => wanted.has(q.id));
  }

  /** Up to five of the affected questions, so the dialog is specific. */
  function preview(rows: AdminQuestion[]): string[] {
    return rows.slice(0, 5).map((row, i) => {
      const text = row.questionAr.length > 70 ? `${row.questionAr.slice(0, 70)}…` : row.questionAr;
      return `${i + 1}. ${text}`;
    });
  }

  async function bulkSetActive(ids: GridRowId[], isActive: boolean, clear: () => void) {
    const rows = selectedRows(ids);
    if (rows.length === 0) return;
    const alreadyThere = rows.filter((r) => r.isActive === isActive).length;

    const ok = await confirm({
      title: `${isActive ? 'تفعيل' : 'إيقاف'} ${countAr(rows.length, QUESTION_FORMS)}؟`,
      confirmLabel: isActive ? 'تفعيل' : 'إيقاف',
      tone: isActive ? 'default' : 'danger',
      consequences: [
        isActive
          ? 'ستعود هذه الأسئلة للظهور في جلسات التدريب.'
          : 'لن تُطرح هذه الأسئلة على أي مستخدم بعد الآن — الإجابات السابقة تبقى كما هي.',
        alreadyThere > 0
          ? `${formatNumber(alreadyThere)} منها ${isActive ? 'مفعّل' : 'موقوف'} بالفعل ولن يتغيّر.`
          : 'التغيير يسري فورًا على التطبيق.',
        ...preview(rows),
      ],
      onConfirm: () =>
        bulk.mutateAsync({ ids: rows.map((r) => r.id), action: isActive ? 'activate' : 'deactivate' }),
    });
    if (ok) clear();
  }

  async function bulkDelete(ids: GridRowId[], clear: () => void) {
    const rows = selectedRows(ids);
    if (rows.length === 0) return;
    const used = rows.filter((r) => r.usageCount > 0).length;

    const ok = await confirm({
      title: `حذف ${countAr(rows.length, QUESTION_FORMS)} نهائيًا؟`,
      description: 'الحذف نهائي ولا يمكن التراجع عنه.',
      tone: 'danger',
      confirmLabel: 'حذف نهائي',
      // Typing the count is the gate: a bulk delete is the one action here
      // where a misclick cannot be undone from anywhere in the product.
      requireTypedConfirmation: String(rows.length),
      consequences: [
        used > 0
          ? `${formatNumber(used)} من الأسئلة المحدّدة طُرحت على مستخدمين — إجاباتهم ستفقد ارتباطها بالسؤال.`
          : 'لم يُطرح أي من هذه الأسئلة على مستخدم بعد.',
        'لإخفائها دون فقدان أي بيانات، أوقفها بدلًا من حذفها.',
        ...preview(rows),
      ],
      onConfirm: () => bulk.mutateAsync({ ids: rows.map((r) => r.id), action: 'delete' }),
    });
    if (ok) clear();
  }

  const columns: GridColDef<AdminQuestion>[] = useMemo(() => {
    const base: GridColDef<AdminQuestion>[] = [
      { ...textCol<AdminQuestion>({ field: 'id', headerName: '#', width: 90, mono: true }), sortable: false },
      {
        ...textCol<AdminQuestion>({ field: 'categoryId', headerName: 'القسم', width: 150 }),
        sortable: false,
        renderCell: ({ row }) => (
          <Typography variant="body2" noWrap>
            {row.category?.nameAr ?? '—'}
          </Typography>
        ),
      },
      {
        ...textCol<AdminQuestion>({ field: 'questionAr', headerName: 'السؤال (عربي)', flex: 1.2, minWidth: 260 }),
        sortable: false,
      },
      {
        ...textCol<AdminQuestion>({ field: 'questionEn', headerName: 'English', flex: 1, minWidth: 220 }),
        sortable: false,
        renderCell: ({ row }) => <Mono value={row.questionEn} variant="body2" />,
      },
      { ...chipCol<AdminQuestion>({ field: 'difficulty', headerName: 'الصعوبة', kind: 'difficulty', width: 110 }) },
      { ...numCol<AdminQuestion>({ field: 'usageCount', headerName: 'مرات الطرح', width: 120 }), sortable: false },
      { ...chipCol<AdminQuestion>({ field: 'isActive', headerName: 'الحالة', kind: 'active', width: 110 }) },
      { ...dateCol<AdminQuestion>({ field: 'createdAt', headerName: 'أُضيف', width: 150 }), sortable: false },
    ];

    if (!canWrite && !canDelete) return base;

    return [
      ...base,
      actionsCol<AdminQuestion>({
        width: 132,
        render: (row) => (
          <>
            {canWrite && (
              <>
                <Tooltip title="تعديل">
                  <IconButton size="small" onClick={() => openEdit(row)} aria-label="تعديل">
                    <EditRounded fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={row.isActive ? 'إيقاف السؤال' : 'تفعيل السؤال'}>
                  <span>
                    <IconButton
                      size="small"
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate({ id: row.id, isActive: !row.isActive })}
                      aria-label={row.isActive ? 'إيقاف' : 'تفعيل'}
                    >
                      {row.isActive ? (
                        <ToggleOnRounded fontSize="small" color="success" />
                      ) : (
                        <ToggleOffRounded fontSize="small" />
                      )}
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            )}
            {canDelete && (
              <Tooltip title="حذف">
                <IconButton size="small" onClick={() => askDelete(row)} aria-label="حذف">
                  <DeleteOutlineRounded fontSize="small" color="error" />
                </IconButton>
              </Tooltip>
            )}
          </>
        ),
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, canDelete, toggle.isPending]);

  // Categories drive the filter, the picker and the importer, so a failed
  // category fetch is a page-level failure, not a silently empty select.
  if (categoriesQ.isError) {
    return (
      <>
        <PageHeader title="الأسئلة" icon={<QuestionAnswerRounded />} />
        <ErrorState
          error={categoriesQ.error}
          title="تعذّر تحميل الأقسام"
          description="بنك الأسئلة يحتاج قائمة الأقسام لعرض السؤال في سياقه."
          onRetry={() => categoriesQ.refetch()}
          variant="page"
        />
      </>
    );
  }

  const total = questionsQ.data?.total;

  const toolbar = (
    <Stack direction={{ xs: 'column', md: 'row' }} gap={1.5} alignItems={{ md: 'center' }}>
      <TextField
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="ابحث في نص السؤال…"
        sx={{ maxWidth: { md: 280 } }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRounded fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
      />
      <TextField
        select
        label="القسم"
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        sx={{ maxWidth: { md: 200 } }}
      >
        <MenuItem value="">كل الأقسام</MenuItem>
        {categories.map((c) => (
          <MenuItem key={c.id} value={String(c.id)}>
            {c.nameAr}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="الصعوبة"
        value={difficulty}
        onChange={(e) => setDifficulty(e.target.value)}
        sx={{ maxWidth: { md: 160 } }}
      >
        <MenuItem value="">كل المستويات</MenuItem>
        {DIFFICULTIES.map((d) => (
          <MenuItem key={d} value={d}>
            {DIFFICULTY_LABEL_AR[d]}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="الحالة"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        sx={{ maxWidth: { md: 160 } }}
      >
        <MenuItem value="">الكل</MenuItem>
        <MenuItem value="true">مفعّل</MenuItem>
        <MenuItem value="false">موقوف</MenuItem>
      </TextField>
      <Box sx={{ flexGrow: 1 }} />
      {filtersActive && (
        <Button variant="text" color="inherit" onClick={clearFilters}>
          مسح عوامل التصفية
        </Button>
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader
        title="الأسئلة"
        description="بنك الأسئلة الذي تُبنى منه جلسات التدريب."
        icon={<QuestionAnswerRounded />}
        meta={
          total !== undefined ? (
            <Chip
              size="small"
              variant="outlined"
              label={
                <>
                  {filtersActive ? 'نتائج التصفية: ' : 'إجمالي الأسئلة: '}
                  <Num value={total} />
                </>
              }
            />
          ) : undefined
        }
        actions={
          <Can action="questions.write">
            {/* Every question needs a category, so with none the two actions
                are disabled — the tooltip says why rather than leaving a dead
                button. */}
            <Tooltip title={categories.length === 0 ? 'أنشئ قسمًا أولًا من صفحة الأقسام' : ''}>
              <span>
                <Button
                  variant="outlined"
                  startIcon={<UploadFileRounded />}
                  onClick={() => setImportOpen(true)}
                  disabled={categories.length === 0}
                  fullWidth
                >
                  استيراد مجمّع
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={categories.length === 0 ? 'أنشئ قسمًا أولًا من صفحة الأقسام' : ''}>
              <span>
                <Button
                  startIcon={<AddRounded />}
                  onClick={openCreate}
                  disabled={categories.length === 0}
                  fullWidth
                >
                  سؤال جديد
                </Button>
              </span>
            </Tooltip>
          </Can>
        }
      />

      <DataTable<AdminQuestion>
        rows={questionsQ.data?.questions}
        columns={columns}
        getRowId={(row) => row.id}
        query={questionsQ}
        paginationModel={paginationModel}
        onPaginationModelChange={onPaginationModelChange}
        rowCount={total}
        toolbar={toolbar}
        // Selection is offered only to a role that can act on it; the bar below
        // would otherwise be a row of controls the backend refuses.
        checkboxSelection={canWrite || canDelete}
        selectionActions={(ids, clear) => (
          <>
            <Typography variant="body2" fontWeight={600}>
              محدَّد: <Num value={ids.length} variant="body2" />
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            {canWrite && (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={bulk.isPending}
                  onClick={() => void bulkSetActive(ids, true, clear)}
                >
                  تفعيل
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={bulk.isPending}
                  onClick={() => void bulkSetActive(ids, false, clear)}
                >
                  إيقاف
                </Button>
              </>
            )}
            {canDelete && (
              <Button
                size="small"
                variant="text"
                color="error"
                disabled={bulk.isPending}
                onClick={() => void bulkDelete(ids, clear)}
              >
                حذف
              </Button>
            )}
            <Button size="small" variant="text" color="inherit" onClick={clear} disabled={bulk.isPending}>
              إلغاء التحديد
            </Button>
          </>
        )}
        empty={
          filtersActive
            ? {
                variant: debouncedSearch ? 'search' : 'filtered',
                query: debouncedSearch || undefined,
                title: 'لا توجد أسئلة مطابقة',
                description: 'جرّب توسيع نطاق البحث أو إزالة بعض عوامل التصفية.',
                action: (
                  <Button variant="outlined" onClick={clearFilters}>
                    مسح عوامل التصفية
                  </Button>
                ),
              }
            : {
                title: 'بنك الأسئلة فارغ',
                description:
                  categories.length === 0
                    ? 'أنشئ قسمًا أولًا من صفحة الأقسام، ثم أضف إليه الأسئلة.'
                    : 'أضف أول سؤال، أو استورد دفعة كاملة من ملف JSON.',
                action: canWrite && categories.length > 0 ? (
                  <Button startIcon={<AddRounded />} onClick={openCreate}>
                    سؤال جديد
                  </Button>
                ) : undefined,
              }
        }
        renderMobileCard={(row) => (
          <Stack gap={1} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Typography variant="body2" fontWeight={600}>
              {row.questionAr}
            </Typography>
            <Mono value={row.questionEn} variant="caption" />
            <Stack direction="row" gap={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              <StatusChip kind="difficulty" value={row.difficulty} />
              <StatusChip kind="active" value={row.isActive} />
              <Chip size="small" variant="outlined" label={row.category?.nameAr ?? '—'} />
            </Stack>
            {canWrite && (
              <Stack direction="row" gap={1}>
                <Button size="small" variant="outlined" onClick={() => openEdit(row)}>
                  تعديل
                </Button>
                {canDelete && (
                  <Button size="small" variant="text" color="error" onClick={() => askDelete(row)}>
                    حذف
                  </Button>
                )}
              </Stack>
            )}
          </Stack>
        )}
      />

      {canWrite && (
        <>
          <QuestionFormDrawer
            open={formOpen}
            question={editing}
            categories={categories}
            defaultCategoryId={categoryId ? Number(categoryId) : undefined}
            onClose={() => setFormOpen(false)}
          />
          <BulkImportDrawer
            open={importOpen}
            categories={categories}
            onClose={() => setImportOpen(false)}
          />
        </>
      )}
    </>
  );
}
