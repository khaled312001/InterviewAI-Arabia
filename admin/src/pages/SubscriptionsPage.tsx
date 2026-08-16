import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid2';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CardMembershipRounded from '@mui/icons-material/CardMembershipRounded';
import CancelScheduleSendRounded from '@mui/icons-material/CancelScheduleSendRounded';
import EventBusyRounded from '@mui/icons-material/EventBusyRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import HourglassBottomRounded from '@mui/icons-material/HourglassBottomRounded';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GridColDef } from '@mui/x-data-grid';

import { DataTable } from '../components/common/DataTable';
import { PageHeader } from '../components/common/PageHeader';
import { StatCard } from '../components/common/StatCard';
import { StatusChip } from '../components/common/StatusChip';
import { Mono } from '../components/common/Mono';
import { RelativeTime } from '../components/common/RelativeTime';
import { useConfirm } from '../components/common/ConfirmDialog';
import { useToast } from '../components/common/ToastProvider';
import { chipCol, dateCol, textCol, actionsCol } from '../lib/columns';
import { api } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { can } from '../lib/permissions';
import { useAuth } from '../store/auth';
import { useDebouncedValue } from '../lib/hooks/useDebouncedValue';
import { useServerPagination } from '../lib/hooks/useServerPagination';

interface SubscriptionUser {
  id: string;
  email: string | null;
  name: string | null;
  plan: string | null;
  premiumUntil: string | null;
}

interface Subscription {
  id: string;
  userId: string;
  provider: string;
  providerRef: string | null;
  planCode: string | null;
  status: string;
  autoRenew: boolean;
  startedAt: string | null;
  expiresAt: string | null;
  cancelledAt: string | null;
  createdAt: string | null;
  user?: SubscriptionUser;
}

/** Flattened for the grid — the column factories read flat fields, not paths. */
interface SubscriptionRow extends Subscription {
  userEmail: string | null;
}

interface SubscriptionsResponse {
  subscriptions: Subscription[];
  page: number;
  limit: number;
  total: number;
  summary: {
    byStatus: Record<string, number>;
    total: number;
    expiringIn7Days: number;
  };
}

const STATUS_OPTIONS = [
  { value: '', label: 'كل الحالات' },
  { value: 'active', label: 'نشط' },
  { value: 'pending', label: 'قيد الانتظار' },
  { value: 'cancelled', label: 'ملغي' },
  { value: 'expired', label: 'منتهي' },
  { value: 'refunded', label: 'مسترد' },
];

/** Only a live subscription can be cancelled; the rest are already terminal. */
const CANCELLABLE = new Set(['active', 'pending']);

export function SubscriptionsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const role = useAuth((s) => s.admin?.role);
  const canCancel = can(role, 'subscriptions.cancel');

  const { paginationModel, onPaginationModelChange, page, pageSize, reset } = useServerPagination();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);

  const params = useMemo(
    () => ({
      page,
      limit: pageSize,
      ...(debouncedSearch ? { q: debouncedSearch } : null),
      ...(status ? { status } : null),
    }),
    [page, pageSize, debouncedSearch, status],
  );

  const query = useQuery<SubscriptionsResponse>({
    queryKey: qk.subscriptions.list(params),
    queryFn: async () => (await api.get('/admin/subscriptions', { params })).data,
    // Rows stay on screen while the next page loads, so paging never blanks.
    placeholderData: keepPreviousData,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/admin/subscriptions/${id}/cancel`),
    onSuccess: (_res, id) => {
      const row = query.data?.subscriptions.find((s) => s.id === id);
      toast.success(
        row?.user?.email ? `تم إلغاء اشتراك ${row.user.email}` : 'تم إلغاء الاشتراك',
      );
      qc.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });
      // The cancel writes users.plan/premium_until, so any user view is stale.
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    // ConfirmDialog surfaces the failure while its dialog is still open.
    // Declaring onError here suppresses the duplicate global toast from
    // queryClient's MutationCache.
    onError: () => {},
  });

  async function requestCancel(row: SubscriptionRow) {
    await confirm({
      title: 'إلغاء الاشتراك؟',
      description: `سيتم إنهاء اشتراك ${row.user?.email ?? 'هذا المستخدم'} فورًا.`,
      tone: 'danger',
      confirmLabel: 'إلغاء الاشتراك',
      cancelLabel: 'تراجع',
      consequences: [
        'لن يتم إرجاع أي مبالغ عبر بوابة الدفع — هذا الإجراء لا يحرّك أموالًا.',
        'يعود المستخدم إلى الخطة المجانية فورًا، ما لم يغطّه اشتراك نشط آخر.',
        'لاسترداد المبلغ فعليًا، نفّذ ذلك من لوحة تحكم EasyKash.',
      ],
      onConfirm: () => cancel.mutateAsync(row.id),
    });
  }

  const rows = useMemo<SubscriptionRow[]>(
    () =>
      (query.data?.subscriptions ?? []).map((s) => ({
        ...s,
        userEmail: s.user?.email ?? null,
      })),
    [query.data],
  );

  const summary = query.data?.summary;
  const failed = query.isError;

  const columns = useMemo<GridColDef<SubscriptionRow>[]>(() => {
    const base: GridColDef<SubscriptionRow>[] = [
      textCol<SubscriptionRow>({
        field: 'userEmail',
        headerName: 'المستخدم',
        flex: 1,
        minWidth: 220,
        mono: true,
      }),
      chipCol<SubscriptionRow>({ field: 'planCode', headerName: 'الخطة', kind: 'planCode', width: 120 }),
      chipCol<SubscriptionRow>({
        field: 'provider',
        headerName: 'المزوّد',
        kind: 'paymentProvider',
        width: 130,
      }),
      chipCol<SubscriptionRow>({
        field: 'status',
        headerName: 'الحالة',
        kind: 'subscription',
        width: 130,
        tooltip: (row) =>
          row.status === 'cancelled' && row.cancelledAt
            ? 'أُلغي من لوحة التحكم — لم يُسترد أي مبلغ عبر البوابة'
            : undefined,
      }),
      dateCol<SubscriptionRow>({ field: 'startedAt', headerName: 'البداية', width: 150 }),
      dateCol<SubscriptionRow>({ field: 'expiresAt', headerName: 'الانتهاء', mode: 'both', width: 160 }),
    ];

    // The action column is not rendered at all for a role that cannot cancel —
    // an always-empty column is just noise.
    if (!canCancel) return base;

    return [
      ...base,
      actionsCol<SubscriptionRow>({
        width: 120,
        render: (row) =>
          CANCELLABLE.has(row.status) ? (
            <Tooltip title="إلغاء الاشتراك">
              <span>
                <Button
                  size="small"
                  color="error"
                  variant="outlined"
                  startIcon={<CancelScheduleSendRounded />}
                  disabled={cancel.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    void requestCancel(row);
                  }}
                >
                  إلغاء
                </Button>
              </span>
            </Tooltip>
          ) : null,
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCancel, cancel.isPending, query.data]);

  const filtersActive = Boolean(debouncedSearch || status);

  return (
    <>
      <PageHeader
        title="الاشتراكات"
        description="كل اشتراكات المنصّة — الحالة، الخطة، وتاريخ الانتهاء."
        icon={<CardMembershipRounded />}
      />

      <Grid container spacing={{ xs: 2, md: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={0}
            label="اشتراكات نشطة"
            value={summary?.byStatus.active ?? 0}
            icon={<TaskAltRounded />}
            tone="success"
            loading={query.isLoading}
            error={failed}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={1}
            label="تنتهي خلال ٧ أيام"
            value={summary?.expiringIn7Days ?? 0}
            icon={<HourglassBottomRounded />}
            tone="warning"
            hint="اشتراكات نشطة تقترب من الانتهاء"
            loading={query.isLoading}
            error={failed}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={2}
            label="ملغاة"
            value={summary?.byStatus.cancelled ?? 0}
            icon={<EventBusyRounded />}
            tone="neutral"
            loading={query.isLoading}
            error={failed}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={3}
            label="إجمالي الاشتراكات"
            value={summary?.total ?? 0}
            icon={<CardMembershipRounded />}
            tone="brand"
            loading={query.isLoading}
            error={failed}
          />
        </Grid>
      </Grid>

      <DataTable<SubscriptionRow>
        rows={rows}
        columns={columns}
        query={query}
        paginationModel={paginationModel}
        onPaginationModelChange={onPaginationModelChange}
        rowCount={query.data?.total}
        errorTitle="تعذّر تحميل الاشتراكات"
        toolbar={
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}>
            <TextField
              placeholder="ابحث بالبريد أو الاسم أو مرجع المزوّد…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                reset();
              }}
              sx={{ maxWidth: { sm: 340 } }}
            />
            <TextField
              select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                reset();
              }}
              label="الحالة"
              sx={{ maxWidth: { sm: 200 } }}
            >
              {STATUS_OPTIONS.map((o) => (
                <MenuItem key={o.value || 'all'} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        }
        empty={
          filtersActive
            ? {
                variant: 'search',
                query: debouncedSearch || undefined,
                title: 'لا اشتراكات مطابقة',
                description: 'جرّب مصطلح بحث أو حالة مختلفة.',
                action: (
                  <Button
                    variant="text"
                    onClick={() => {
                      setSearch('');
                      setStatus('');
                      reset();
                    }}
                  >
                    مسح عوامل التصفية
                  </Button>
                ),
              }
            : {
                title: 'لا توجد اشتراكات بعد',
                description: 'سيظهر هنا كل اشتراك بمجرد إتمام أول عملية دفع ناجحة.',
                icon: <CardMembershipRounded />,
              }
        }
        renderMobileCard={(row) => (
          <Box sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
            <Stack gap={1}>
              <Stack direction="row" alignItems="center" gap={1} justifyContent="space-between">
                <Mono value={row.userEmail} variant="body2" />
                <StatusChip kind="subscription" value={row.status} />
              </Stack>
              <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                <StatusChip kind="planCode" value={row.planCode} />
                <StatusChip kind="paymentProvider" value={row.provider} />
              </Stack>
              <Stack direction="row" gap={1} alignItems="center">
                <Typography variant="caption" color="text.secondary">
                  ينتهي
                </Typography>
                <RelativeTime value={row.expiresAt} mode="both" variant="caption" />
              </Stack>
              {canCancel && CANCELLABLE.has(row.status) && (
                <Button
                  size="small"
                  color="error"
                  variant="outlined"
                  startIcon={<CancelScheduleSendRounded />}
                  disabled={cancel.isPending}
                  onClick={() => void requestCancel(row)}
                >
                  إلغاء الاشتراك
                </Button>
              )}
            </Stack>
          </Box>
        )}
      />
    </>
  );
}
