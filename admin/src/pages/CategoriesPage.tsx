import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import CategoryRounded from '@mui/icons-material/CategoryRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import ListAltRounded from '@mui/icons-material/ListAltRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import ToggleOffRounded from '@mui/icons-material/ToggleOffRounded';
import ToggleOnRounded from '@mui/icons-material/ToggleOnRounded';
import type { GridColDef } from '@mui/x-data-grid';

import { PageHeader } from '../components/common/PageHeader';
import { DataTable } from '../components/common/DataTable';
import { Can } from '../components/common/Guard';
import { Mono } from '../components/common/Mono';
import { Num } from '../components/common/Num';
import { StatusChip } from '../components/common/StatusChip';
import { useConfirm } from '../components/common/ConfirmDialog';
import { chipCol, numCol, textCol, actionsCol } from '../lib/columns';
import { formatNumber } from '../lib/format';
import { useServerPagination } from '../lib/hooks/useServerPagination';
import { useQueryParamState } from '../lib/hooks/useQueryParamState';
import { can } from '../lib/permissions';
import { useAuth } from '../store/auth';

import { CategoryFormDrawer } from '../features/content/CategoryFormDrawer';
import {
  useCategories,
  useDeleteCategory,
  useReorderCategories,
  useToggleCategory,
} from '../features/content/api';
import type { AdminCategory } from '../features/content/types';

export function CategoriesPage() {
  const role = useAuth((s) => s.admin?.role);
  const canWrite = can(role, 'categories.write');
  const canDelete = can(role, 'categories.delete');
  // The /questions route itself is gated to super_admin + content_editor, which
  // is exactly the questions.write set — so the cross-link uses that action to
  // avoid offering a link that lands on a 403 page.
  const canOpenQuestions = can(role, 'questions.write');

  const confirm = useConfirm();
  const navigate = useNavigate();

  const [search, setSearch] = useQueryParamState('q');
  const { paginationModel, onPaginationModelChange } = useServerPagination();
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const categoriesQ = useCategories();
  const remove = useDeleteCategory();
  const toggle = useToggleCategory();
  const reorder = useReorderCategories();

  // Already in the app's own order (sort_order ASC, id ASC) — the order the
  // reorder buttons below manipulate.
  const all = useMemo(() => categoriesQ.data ?? [], [categoriesQ.data]);

  // GET /admin/categories returns the complete list, so filtering and paging in
  // the browser is honest here — nothing was truncated server-side.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (c) =>
        c.nameAr.toLowerCase().includes(needle) ||
        c.nameEn.toLowerCase().includes(needle) ||
        (c.icon ?? '').toLowerCase().includes(needle),
    );
  }, [all, search]);

  const pageRows = useMemo(() => {
    const start = paginationModel.page * paginationModel.pageSize;
    return filtered.slice(start, start + paginationModel.pageSize);
  }, [filtered, paginationModel]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(row: AdminCategory) {
    setEditing(row);
    setFormOpen(true);
  }

  /**
   * Moves a category one slot and writes the whole resulting order (the hook
   * PATCHes only the rows whose number actually changes). Search is the one
   * state where this is refused: the list on screen is then not the list being
   * renumbered, so "up" would not mean what it looks like.
   */
  function move(row: AdminCategory, delta: -1 | 1) {
    const index = all.findIndex((c) => c.id === row.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= all.length) return;
    const next = [...all];
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate(next);
  }

  function toggleActive(row: AdminCategory) {
    return confirm({
      title: row.isActive ? `إيقاف قسم «${row.nameAr}»؟` : `تفعيل قسم «${row.nameAr}»؟`,
      confirmLabel: row.isActive ? 'إيقاف' : 'تفعيل',
      tone: row.isActive ? 'danger' : 'default',
      consequences: row.isActive
        ? [
            'يختفي القسم من التطبيق فورًا ولن يستطيع أحد بدء جلسة منه.',
            `تبقى أسئلته (${formatNumber(row.questionCount)}) وجلساته المسجّلة كما هي.`,
            'يمكن إعادة تفعيله في أي وقت.',
          ]
        : ['سيظهر القسم للمستخدمين مرة أخرى بأسئلته الحالية.'],
      onConfirm: () => toggle.mutateAsync({ id: row.id, isActive: !row.isActive }),
    });
  }

  async function askDelete(row: AdminCategory) {
    await confirm({
      title: `حذف قسم «${row.nameAr}»؟`,
      description: 'الحذف نهائي ولا يمكن التراجع عنه.',
      tone: 'danger',
      confirmLabel: 'حذف نهائي',
      requireTypedConfirmation: row.nameEn,
      consequences: [
        row.questionCount > 0
          ? `سيتم حذف ${row.questionCount} سؤالًا داخل هذا القسم نهائيًا.`
          : 'لا توجد أسئلة داخل هذا القسم.',
        'سيختفي القسم من التطبيق فورًا.',
        'إن أردت إخفاءه مع الاحتفاظ بمحتواه، أوقفه بدلًا من حذفه.',
      ],
      onConfirm: () => remove.mutateAsync(row.id),
    });
  }

  const columns: GridColDef<AdminCategory>[] = useMemo(() => {
    // Sorting is off everywhere: the grid can only sort the rows it holds, and
    // it holds one page. The list already arrives in the order the app uses
    // (sortOrder ASC), which is the order that actually matters here.
    const base: GridColDef<AdminCategory>[] = [
      { ...textCol<AdminCategory>({ field: 'id', headerName: '#', width: 70, mono: true }), sortable: false },
      {
        ...textCol<AdminCategory>({ field: 'nameAr', headerName: 'الاسم (عربي)', flex: 1, minWidth: 160 }),
        sortable: false,
      },
      {
        ...textCol<AdminCategory>({ field: 'nameEn', headerName: 'Name (EN)', flex: 1, minWidth: 160 }),
        sortable: false,
        renderCell: ({ row }) => <Mono value={row.nameEn} variant="body2" />,
      },
      {
        ...textCol<AdminCategory>({ field: 'icon', headerName: 'الأيقونة', width: 130 }),
        sortable: false,
        renderCell: ({ row }) => <Mono value={row.icon} variant="body2" />,
      },
      {
        // isPremium is a boolean; StatusChip's `plan` map keys on the plan name,
        // so the value is mapped rather than passed through chipCol.
        ...chipCol<AdminCategory>({ field: 'isPremium', headerName: 'الوصول', kind: 'plan', width: 110 }),
        renderCell: ({ row }) => (
          <StatusChip
            kind="plan"
            value={row.isPremium ? 'premium' : 'free'}
            tooltip={row.isPremium ? 'متاح للمشتركين فقط' : 'متاح لكل المستخدمين'}
          />
        ),
      },
      chipCol<AdminCategory>({ field: 'isActive', headerName: 'الحالة', kind: 'active', width: 110 }),
      { ...numCol<AdminCategory>({ field: 'sortOrder', headerName: 'الترتيب', width: 100 }), sortable: false },
      { ...numCol<AdminCategory>({ field: 'questionCount', headerName: 'الأسئلة', width: 110 }), sortable: false },
      { ...numCol<AdminCategory>({ field: 'sessionCount', headerName: 'الجلسات', width: 110 }), sortable: false },
    ];

    if (!canWrite && !canDelete && !canOpenQuestions) return base;

    const busy = reorder.isPending || toggle.isPending;

    return [
      ...base,
      actionsCol<AdminCategory>({
        width: canWrite ? 250 : 140,
        render: (row) => {
          const index = all.findIndex((c) => c.id === row.id);
          const reorderBlocked = Boolean(search.trim());
          return (
          <>
            {canWrite && (
              <>
                <Tooltip
                  title={
                    reorderBlocked
                      ? 'امسح البحث أولًا — الترتيب يسري على القائمة كاملة'
                      : 'تحريك لأعلى'
                  }
                >
                  <span>
                    <IconButton
                      size="small"
                      disabled={busy || reorderBlocked || index <= 0}
                      onClick={() => move(row, -1)}
                      aria-label="تحريك لأعلى"
                    >
                      <ArrowUpwardRounded fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip
                  title={
                    reorderBlocked
                      ? 'امسح البحث أولًا — الترتيب يسري على القائمة كاملة'
                      : 'تحريك لأسفل'
                  }
                >
                  <span>
                    <IconButton
                      size="small"
                      disabled={busy || reorderBlocked || index < 0 || index >= all.length - 1}
                      onClick={() => move(row, 1)}
                      aria-label="تحريك لأسفل"
                    >
                      <ArrowDownwardRounded fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={row.isActive ? 'إيقاف القسم' : 'تفعيل القسم'}>
                  <span>
                    <IconButton
                      size="small"
                      disabled={busy}
                      onClick={() => void toggleActive(row)}
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
            {canOpenQuestions && (
              <Tooltip title="عرض أسئلة القسم">
                <IconButton
                  size="small"
                  onClick={() => navigate(`/questions?categoryId=${row.id}`)}
                  aria-label="عرض الأسئلة"
                >
                  <ListAltRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {canWrite && (
              <Tooltip title="تعديل">
                <IconButton size="small" onClick={() => openEdit(row)} aria-label="تعديل">
                  <EditRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {canDelete && (
              <Tooltip
                title={
                  row.sessionCount > 0
                    ? 'لا يمكن الحذف: للقسم جلسات مسجّلة — أوقفه بدلًا من ذلك'
                    : 'حذف'
                }
              >
                <span>
                  <IconButton
                    size="small"
                    disabled={row.sessionCount > 0}
                    onClick={() => askDelete(row)}
                    aria-label="حذف"
                  >
                    <DeleteOutlineRounded
                      fontSize="small"
                      color={row.sessionCount > 0 ? 'disabled' : 'error'}
                    />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </>
          );
        },
      }),
    ];
    // `all` and `search` are read inside the cell renderers, so a stale closure
    // would move the wrong row — they belong in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, canDelete, canOpenQuestions, all, search, reorder.isPending, toggle.isPending]);

  const activeCount = all.filter((c) => c.isActive).length;

  const toolbar = (
    <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} alignItems={{ sm: 'center' }}>
      <TextField
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="ابحث بالاسم أو الأيقونة…"
        sx={{ maxWidth: { sm: 320 } }}
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
      <Box sx={{ flexGrow: 1 }} />
      {search && (
        <Button variant="text" color="inherit" onClick={() => setSearch('')}>
          مسح البحث
        </Button>
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader
        title="الأقسام"
        description="أقسام المقابلات التي يختار منها المستخدم قبل بدء الجلسة."
        icon={<CategoryRounded />}
        meta={
          categoriesQ.data ? (
            <>
              <Chip
                size="small"
                variant="outlined"
                label={
                  <>
                    الأقسام: <Num value={all.length} />
                  </>
                }
              />
              <Chip
                size="small"
                variant="outlined"
                label={
                  <>
                    المفعّلة: <Num value={activeCount} />
                  </>
                }
              />
            </>
          ) : undefined
        }
        actions={
          <Can action="categories.write">
            <Button startIcon={<AddRounded />} onClick={openCreate}>
              قسم جديد
            </Button>
          </Can>
        }
      />

      <DataTable<AdminCategory>
        rows={categoriesQ.data ? pageRows : undefined}
        columns={columns}
        query={categoriesQ}
        paginationModel={paginationModel}
        onPaginationModelChange={onPaginationModelChange}
        rowCount={filtered.length}
        toolbar={toolbar}
        errorTitle="تعذّر تحميل الأقسام"
        empty={
          search
            ? {
                variant: 'search',
                query: search,
                title: 'لا توجد أقسام مطابقة',
                action: (
                  <Button variant="outlined" onClick={() => setSearch('')}>
                    مسح البحث
                  </Button>
                ),
              }
            : {
                title: 'لا توجد أقسام بعد',
                description: 'القسم هو ما يختاره المستخدم قبل بدء المقابلة — أنشئ أول قسم للبدء.',
                action: canWrite ? (
                  <Button startIcon={<AddRounded />} onClick={openCreate}>
                    قسم جديد
                  </Button>
                ) : undefined,
              }
        }
        renderMobileCard={(row) => (
          <Stack gap={1} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Typography variant="body2" fontWeight={700}>
              {row.nameAr}
            </Typography>
            <Mono value={row.nameEn} variant="caption" />
            <Stack direction="row" gap={0.75} sx={{ flexWrap: 'wrap' }}>
              <StatusChip kind="active" value={row.isActive} />
              <StatusChip kind="plan" value={row.isPremium ? 'premium' : 'free'} />
              <Chip
                size="small"
                variant="outlined"
                label={
                  <>
                    <Num value={row.questionCount} /> سؤال
                  </>
                }
              />
            </Stack>
            {canWrite && (
              <Stack direction="row" gap={1} sx={{ flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" onClick={() => openEdit(row)}>
                  تعديل
                </Button>
                <Button
                  size="small"
                  variant="text"
                  disabled={toggle.isPending}
                  onClick={() => void toggleActive(row)}
                >
                  {row.isActive ? 'إيقاف' : 'تفعيل'}
                </Button>
                {canDelete && row.sessionCount === 0 && (
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
        <CategoryFormDrawer
          open={formOpen}
          category={editing}
          categories={all}
          onClose={() => setFormOpen(false)}
        />
      )}
    </>
  );
}
