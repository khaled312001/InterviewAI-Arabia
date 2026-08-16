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
import MoreTimeRounded from '@mui/icons-material/MoreTimeRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import HourglassBottomRounded from '@mui/icons-material/HourglassBottomRounded';
import VolunteerActivismRounded from '@mui/icons-material/VolunteerActivismRounded';
import type { GridColDef } from '@mui/x-data-grid';

import { DataTable } from '../components/common/DataTable';
import { PageHeader } from '../components/common/PageHeader';
import { StatCard } from '../components/common/StatCard';
import { StatusChip } from '../components/common/StatusChip';
import { Mono } from '../components/common/Mono';
import { RelativeTime } from '../components/common/RelativeTime';
import { Can } from '../components/common/Guard';
import { useConfirm } from '../components/common/ConfirmDialog';
import { useToast } from '../components/common/ToastProvider';
import { chipCol, dateCol, textCol, actionsCol } from '../lib/columns';
import { can, effectivePlan } from '../lib/permissions';
import { formatAbsolute } from '../lib/format';
import { useAuth } from '../store/auth';
import { useDebouncedValue } from '../lib/hooks/useDebouncedValue';
import { useServerPagination } from '../lib/hooks/useServerPagination';
import { useRevokeSubscription, useSubscriptions } from '../features/subscriptions/api';
import { GrantSubscriptionDrawer } from '../features/subscriptions/GrantSubscriptionDrawer';
import { ExtendSubscriptionDrawer } from '../features/subscriptions/ExtendSubscriptionDrawer';
import { CataloguePanel } from '../features/catalogue/CataloguePanel';
import { planLabel, useCatalogue } from '../features/catalogue/api';
import type { Subscription } from '../features/subscriptions/types';

/** Flattened for the grid — the column factories read flat fields, not paths. */
interface SubscriptionRow extends Subscription {
  userEmail: string | null;
  /**
   * The account's *effective* plan, from the joined mirror. It is on the grid so
   * a revoke can be seen to have landed: if a cancelled row left the user marked
   * premium, this column would say so instead of the page implying success.
   */
  entitlement: 'free' | 'premium' | 'premium_expired';
}

const STATUS_OPTIONS = [
  { value: '', label: 'كل الحالات' },
  { value: 'active', label: 'نشط' },
  { value: 'pending', label: 'قيد الانتظار' },
  { value: 'cancelled', label: 'ملغي' },
  { value: 'expired', label: 'منتهي' },
  { value: 'refunded', label: 'مسترد' },
];

const PROVIDER_OPTIONS = [
  { value: '', label: 'كل المصادر' },
  { value: 'manual', label: 'منح يدوية' },
  { value: 'easykash', label: 'EasyKash' },
  { value: 'paymob', label: 'Paymob' },
  { value: 'google_play', label: 'Google Play' },
];

/** Only a live subscription can be revoked; the rest are already terminal. */
const REVOCABLE = new Set(['active', 'pending']);

/**
 * Extending anything but an active row would move a date the user does not
 * benefit from — the mirror is derived from active rows only. Re-granting is a
 * new subscription, not a resurrection.
 */
const EXTENDABLE = new Set(['active']);

function isManual(row: Pick<Subscription, 'provider'>): boolean {
  return row.provider === 'manual';
}

function providerTooltip(row: Subscription): string {
  return isManual(row)
    ? 'منحة يدوية من لوحة التحكم — لا توجد عملية دفع خلفها ولا تُحتسب ضمن الإيرادات'
    : 'اشتراك مدفوع عبر بوابة الدفع';
}

export function SubscriptionsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const role = useAuth((s) => s.admin?.role);
  const canRevoke = can(role, 'subscriptions.revoke');
  const canExtend = can(role, 'subscriptions.extend');

  const { paginationModel, onPaginationModelChange, page, pageSize, reset } = useServerPagination();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [granting, setGranting] = useState(false);
  const [extending, setExtending] = useState<Subscription | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  const params = useMemo(
    () => ({
      page,
      limit: pageSize,
      ...(debouncedSearch ? { q: debouncedSearch } : null),
      ...(status ? { status } : null),
      ...(provider ? { provider } : null),
    }),
    [page, pageSize, debouncedSearch, status, provider],
  );

  const query = useSubscriptions(params);
  const revoke = useRevokeSubscription();
  // The live price list, so a plan chip carries the name the customer was
  // shown. Codes it does not contain — `yearly_legacy`, `manual`, an old
  // Google-Play code — fall back to StatusChip's static map, which still has to
  // describe them because they are real rows the catalogue deliberately dropped.
  const catalogue = useCatalogue();

  /**
   * The revoke reports the server's own answer, not an assumption. The response
   * carries the re-derived mirror, so when another paid subscription still
   * covers the user this says "still premium" rather than claiming a downgrade
   * that did not happen — and when it does not, it names the downgrade.
   */
  async function requestRevoke(row: SubscriptionRow) {
    const who = row.userEmail ?? 'هذا المستخدم';
    const expires = row.expiresAt ? formatAbsolute(new Date(row.expiresAt)) : 'غير محدد';

    await confirm({
      title: 'إلغاء الاشتراك؟',
      description: `سيتم إنهاء اشتراك ${who} (${
        planLabel(catalogue.data?.plans, row.planCode) ?? row.planCode ?? 'خطة غير محددة'
      }) الذي ينتهي في ${expires} فورًا.`,
      tone: 'danger',
      confirmLabel: 'إلغاء الاشتراك',
      cancelLabel: 'تراجع',
      consequences: [
        'يعود المستخدم إلى الخطة المجانية فورًا، ما لم يغطّه اشتراك نشط آخر.',
        isManual(row)
          ? 'هذه منحة يدوية — لم تُدفع أي أموال، فلا يوجد ما يُسترد.'
          : 'لن يتم إرجاع أي مبالغ عبر البوابة؛ لاسترداد المبلغ فعليًا نفّذ ذلك من لوحة تحكم المزوّد.',
        'لا يُحذف السجل — يُحفظ كاشتراك ملغي لأنه الدليل على المبلغ المدفوع.',
      ],
      prompt: {
        label: 'سبب الإلغاء',
        placeholder: 'يظهر في سجل التدقيق',
        required: true,
        minLength: 3,
        maxLength: 300,
        multiline: true,
        helperText: 'إلزامي — يُحفظ في سجل التدقيق مع اسمك',
      },
      // Runs inside the dialog so a refusal is seen in context; the dialog
      // stays open on failure instead of vanishing over a silent error.
      onConfirm: async (reason) => {
        const result = await revoke.mutateAsync({ id: row.id, reason });
        if (result.stillCovered && result.user.premiumUntil) {
          toast.warning(
            `أُلغي الاشتراك — لكن ${who} ما زال مميزًا حتى ${formatAbsolute(
              new Date(result.user.premiumUntil),
            )} باشتراك آخر`,
          );
        } else {
          toast.success(`أُلغي الاشتراك وعاد ${who} إلى الخطة المجانية`);
        }
      },
    });
  }

  const rows = useMemo<SubscriptionRow[]>(
    () =>
      (query.data?.subscriptions ?? []).map((s) => ({
        ...s,
        userEmail: s.user?.email ?? null,
        entitlement: effectivePlan(s.user),
      })),
    [query.data],
  );

  const summary = query.data?.summary;
  const failed = query.isError;
  const busy = revoke.isPending;

  const columns = useMemo<GridColDef<SubscriptionRow>[]>(() => {
    const base: GridColDef<SubscriptionRow>[] = [
      textCol<SubscriptionRow>({
        field: 'userEmail',
        headerName: 'المستخدم',
        flex: 1,
        minWidth: 220,
        mono: true,
      }),
      chipCol<SubscriptionRow>({
        field: 'planCode',
        headerName: 'الخطة',
        kind: 'planCode',
        width: 140,
        getLabel: (row) => planLabel(catalogue.data?.plans, row.planCode),
        tooltip: (row) =>
          row.planCode && !catalogue.data?.plans.some((p) => p.code === row.planCode)
            ? 'خطة لم تعد معروضة للبيع — الصف قائم ويعمل حتى تاريخ انتهائه'
            : undefined,
      }),
      chipCol<SubscriptionRow>({
        field: 'provider',
        headerName: 'المصدر',
        kind: 'paymentProvider',
        width: 130,
        tooltip: providerTooltip,
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
      chipCol<SubscriptionRow>({
        field: 'entitlement',
        headerName: 'وصول الحساب',
        kind: 'plan',
        width: 130,
        getValue: (row) => row.entitlement,
        tooltip: (row) =>
          row.user?.premiumUntil
            ? `صلاحية الحساب حتى ${formatAbsolute(new Date(row.user.premiumUntil))}`
            : 'لا يوجد وصول مميز على الحساب',
      }),
      dateCol<SubscriptionRow>({ field: 'startedAt', headerName: 'البداية', width: 150 }),
      dateCol<SubscriptionRow>({ field: 'expiresAt', headerName: 'الانتهاء', mode: 'both', width: 160 }),
    ];

    // The action column is not rendered at all for a role that can do neither —
    // an always-empty column is just noise.
    if (!canRevoke && !canExtend) return base;

    return [
      ...base,
      actionsCol<SubscriptionRow>({
        width: 190,
        render: (row) => (
          <>
            {canExtend && EXTENDABLE.has(row.status) && (
              <Tooltip title="تمديد الاشتراك">
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<MoreTimeRounded />}
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      setExtending(row);
                    }}
                  >
                    تمديد
                  </Button>
                </span>
              </Tooltip>
            )}
            {canRevoke && REVOCABLE.has(row.status) && (
              <Tooltip title="إلغاء الاشتراك">
                <span>
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    startIcon={<CancelScheduleSendRounded />}
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void requestRevoke(row);
                    }}
                  >
                    إلغاء
                  </Button>
                </span>
              </Tooltip>
            )}
          </>
        ),
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRevoke, canExtend, busy, query.data, catalogue.data]);

  const filtersActive = Boolean(debouncedSearch || status || provider);

  return (
    <>
      <PageHeader
        title="الاشتراكات"
        // Packs deliberately do not appear here. Buying minutes creates a
        // Payment and a ledger entry and no subscription row — it is not
        // recurring access — so an operator looking for a pack purchase on this
        // page would find nothing and conclude the payment failed.
        description="اشتراكات المنصّة المتجددة — الحالة، الخطة، المصدر، وتاريخ الانتهاء. باقات الدقائق ليست اشتراكات وتظهر في صفحة المدفوعات وفي رصيد المستخدم."
        icon={<CardMembershipRounded />}
        actions={
          <Can action="subscriptions.grant">
            <Button startIcon={<VolunteerActivismRounded />} onClick={() => setGranting(true)}>
              منح اشتراك
            </Button>
          </Can>
        }
      />

      <Grid container spacing={{ xs: 2, md: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={0}
            label="اشتراكات نشطة"
            value={summary?.byStatus?.active ?? 0}
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
            value={summary?.byStatus?.cancelled ?? 0}
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

      <CataloguePanel />

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
            <TextField
              select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                reset();
              }}
              label="المصدر"
              helperText="«منح يدوية» تعني اشتراكات مُنحت من هنا بلا دفع"
              sx={{ maxWidth: { sm: 220 } }}
            >
              {PROVIDER_OPTIONS.map((o) => (
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
                description: 'جرّب مصطلح بحث أو حالة أو مصدرًا مختلفًا.',
                action: (
                  <Button
                    variant="text"
                    onClick={() => {
                      setSearch('');
                      setStatus('');
                      setProvider('');
                      reset();
                    }}
                  >
                    مسح عوامل التصفية
                  </Button>
                ),
              }
            : {
                title: 'لا توجد اشتراكات بعد',
                description:
                  'سيظهر هنا كل اشتراك بمجرد إتمام أول عملية دفع ناجحة — أو عند منح اشتراك يدويًا.',
                icon: <CardMembershipRounded />,
                action: can(role, 'subscriptions.grant') ? (
                  <Button startIcon={<VolunteerActivismRounded />} onClick={() => setGranting(true)}>
                    منح اشتراك
                  </Button>
                ) : undefined,
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
                <StatusChip
                  kind="planCode"
                  value={row.planCode}
                  label={planLabel(catalogue.data?.plans, row.planCode)}
                />
                <StatusChip
                  kind="paymentProvider"
                  value={row.provider}
                  tooltip={providerTooltip(row)}
                />
                <StatusChip kind="plan" value={row.entitlement} />
              </Stack>
              <Stack direction="row" gap={1} alignItems="center">
                <Typography variant="caption" color="text.secondary">
                  ينتهي
                </Typography>
                <RelativeTime value={row.expiresAt} mode="both" variant="caption" />
              </Stack>
              <Stack direction="row" gap={1} flexWrap="wrap">
                {canExtend && EXTENDABLE.has(row.status) && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<MoreTimeRounded />}
                    disabled={busy}
                    onClick={() => setExtending(row)}
                  >
                    تمديد
                  </Button>
                )}
                {canRevoke && REVOCABLE.has(row.status) && (
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    startIcon={<CancelScheduleSendRounded />}
                    disabled={busy}
                    onClick={() => void requestRevoke(row)}
                  >
                    إلغاء الاشتراك
                  </Button>
                )}
              </Stack>
            </Stack>
          </Box>
        )}
      />

      <GrantSubscriptionDrawer open={granting} onClose={() => setGranting(false)} />
      <ExtendSubscriptionDrawer
        open={Boolean(extending)}
        subscription={extending}
        onClose={() => setExtending(null)}
      />
    </>
  );
}
