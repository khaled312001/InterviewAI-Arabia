import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid2';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CreditCardRounded from '@mui/icons-material/CreditCardRounded';
import PaidRounded from '@mui/icons-material/PaidRounded';
import ReceiptLongRounded from '@mui/icons-material/ReceiptLongRounded';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { GridColDef } from '@mui/x-data-grid';

import { DataTable } from '../components/common/DataTable';
import { PageHeader } from '../components/common/PageHeader';
import { StatCard } from '../components/common/StatCard';
import { StatusChip } from '../components/common/StatusChip';
import { Money } from '../components/common/Money';
import { Mono } from '../components/common/Mono';
import { RelativeTime } from '../components/common/RelativeTime';
import { chipCol, dateCol, moneyCol, textCol } from '../lib/columns';
import { countAr, type CountForms } from '../lib/format';
import { api } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { useDebouncedValue } from '../lib/hooks/useDebouncedValue';
import { useServerPagination } from '../lib/hooks/useServerPagination';
import { CataloguePanel } from '../features/catalogue/CataloguePanel';
import { planLabel, useCatalogue } from '../features/catalogue/api';

interface Payment {
  id: string;
  userId: string;
  subscriptionId: string | null;
  provider: string;
  reference: string;
  providerTxnId: string | null;
  planCode: string | null;
  amountCents: number;
  currency: string;
  status: string;
  method: string | null;
  failureReason: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  createdAt: string | null;
  user?: { id: string; email: string | null; name: string | null };
}

/** Flattened for the grid — the column factories read flat fields. */
interface PaymentRow extends Payment {
  userEmail: string | null;
}

interface StatusBucket {
  count: number;
  amountMinor: number;
}

interface PaymentsResponse {
  payments: Payment[];
  page: number;
  limit: number;
  total: number;
  summary: {
    byStatus: Record<string, StatusBucket>;
    paidMinor: number;
    paidCount: number;
    refundedMinor: number;
    refundedCount: number;
    netMinor: number;
    currencies: string[];
  };
}

/** Arabic agreement for "عملية" — see countAr in lib/format.ts. */
const PAYMENT_FORMS: CountForms = {
  one: 'عملية واحدة',
  two: 'عمليتان',
  few: 'عمليات',
  many: 'عملية',
};

const STATUS_OPTIONS = [
  { value: '', label: 'كل الحالات' },
  { value: 'paid', label: 'مدفوع' },
  { value: 'pending', label: 'قيد الانتظار' },
  { value: 'failed', label: 'فشل' },
  { value: 'refunded', label: 'مسترد' },
  { value: 'expired', label: 'منتهي' },
];

export function PaymentsPage() {
  const { paginationModel, onPaginationModelChange, page, pageSize, reset } = useServerPagination();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);

  const params = useMemo(
    () => ({
      page,
      limit: pageSize,
      ...(debouncedSearch ? { q: debouncedSearch } : null),
      ...(status ? { status } : null),
      ...(from ? { from } : null),
      ...(to ? { to } : null),
    }),
    [page, pageSize, debouncedSearch, status, from, to],
  );

  const query = useQuery<PaymentsResponse>({
    queryKey: qk.payments.list(params),
    queryFn: async () => (await api.get('/admin/payments', { params })).data,
    placeholderData: keepPreviousData,
  });

  // Names the plan a row was bought under. Rows predating a catalogue change —
  // and `manual_minutes`, which is not a product at all — fall back to
  // StatusChip's static map rather than to a dash.
  const catalogue = useCatalogue();

  const rows = useMemo<PaymentRow[]>(
    () =>
      (query.data?.payments ?? []).map((p) => ({
        ...p,
        userEmail: p.user?.email ?? null,
      })),
    [query.data],
  );

  const summary = query.data?.summary;
  const failed = query.isError;

  // The summary sums amount_cents across whatever rows matched. If the matched
  // rows span currencies that sum is meaningless, so say so instead of
  // printing a confident total in the wrong unit.
  const currencies = summary?.currencies ?? [];
  const mixedCurrency = currencies.length > 1;
  const currency = (currencies[0] ?? 'EGP') as 'EGP' | 'USD';

  const failedBucket = summary?.byStatus?.failed;
  const pendingBucket = summary?.byStatus?.pending;

  const columns = useMemo<GridColDef<PaymentRow>[]>(
    () => [
      textCol<PaymentRow>({
        field: 'reference',
        headerName: 'المرجع',
        width: 190,
        mono: true,
        copyable: true,
        maxChars: 18,
      }),
      textCol<PaymentRow>({
        field: 'userEmail',
        headerName: 'المستخدم',
        flex: 1,
        minWidth: 200,
        mono: true,
      }),
      chipCol<PaymentRow>({
        field: 'planCode',
        headerName: 'الخطة',
        kind: 'planCode',
        width: 150,
        getLabel: (row) => planLabel(catalogue.data?.plans, row.planCode),
        tooltip: (row) =>
          row.planCode === 'manual_minutes'
            ? 'دقائق أُضيفت يدويًا من صفحة المستخدم — سجل يوثّق بيعًا تم خارج المنصّة'
            : undefined,
      }),
      moneyCol<PaymentRow>({
        field: 'amountCents',
        headerName: 'المبلغ',
        unit: 'minor',
        currency: 'EGP',
        currencyField: 'currency',
        width: 130,
      }),
      chipCol<PaymentRow>({
        field: 'status',
        headerName: 'الحالة',
        kind: 'payment',
        width: 130,
        // The reason a payment failed is the whole point of looking at a
        // failed payment, so it rides on the chip rather than being dropped.
        tooltip: (row) => row.failureReason ?? undefined,
      }),
      chipCol<PaymentRow>({
        field: 'provider',
        headerName: 'المزوّد',
        kind: 'paymentProvider',
        width: 130,
      }),
      textCol<PaymentRow>({ field: 'method', headerName: 'الوسيلة', width: 120 }),
      dateCol<PaymentRow>({ field: 'createdAt', headerName: 'أُنشئ', width: 150 }),
      dateCol<PaymentRow>({ field: 'paidAt', headerName: 'دُفع', mode: 'both', width: 160 }),
    ],
    [catalogue.data],
  );

  const filtersActive = Boolean(debouncedSearch || status || from || to);

  function clearFilters() {
    setSearch('');
    setStatus('');
    setFrom('');
    setTo('');
    reset();
  }

  return (
    <>
      <PageHeader
        title="المدفوعات"
        // Two things create a row here now: a gateway purchase, and a manual
        // minute credit made from a user's page (provider = «يدوي»). Naming
        // both stops the second from reading as revenue nobody can account for.
        description="سجل عمليات الدفع — عمليات البوابة والإضافات اليدوية للدقائق — وملخّص الإيراد."
        icon={<CreditCardRounded />}
        meta={
          mixedCurrency ? (
            <StatusChip
              kind="custom"
              value="mixed"
              label={`الإجماليات تجمع عملات مختلفة: ${currencies.join('، ')}`}
              tone="warning"
            />
          ) : undefined
        }
      />

      <Grid container spacing={{ xs: 2, md: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={0}
            label="صافي الإيراد"
            value={summary ? summary.netMinor / 100 : undefined}
            format="money"
            currency={currency}
            icon={<PaidRounded />}
            tone="success"
            hint={
              mixedCurrency
                ? 'يجمع أكثر من عملة — راجع التفاصيل'
                : 'المدفوعات الناجحة، بعد استبعاد المستردّ'
            }
            loading={query.isLoading}
            error={failed}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={1}
            label="عمليات ناجحة"
            value={summary?.paidCount}
            icon={<ReceiptLongRounded />}
            tone="brand"
            loading={query.isLoading}
            error={failed}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={2}
            label="مستردّ"
            value={summary ? summary.refundedMinor / 100 : undefined}
            format="money"
            currency={currency}
            icon={<ReplayRounded />}
            tone="info"
            // countAr, not a raw interpolation: `${n} عملية` printed a Latin
            // numeral inside Arabic copy and got the agreement wrong for every
            // n between 3 and 10, which is most of them.
            hint={summary ? countAr(summary.refundedCount, PAYMENT_FORMS) : undefined}
            loading={query.isLoading}
            error={failed}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={3}
            label="فاشلة أو معلّقة"
            value={(failedBucket?.count ?? 0) + (pendingBucket?.count ?? 0)}
            icon={<ErrorOutlineRounded />}
            tone="warning"
            hint="محاولات لم تكتمل"
            loading={query.isLoading}
            error={failed}
          />
        </Grid>
      </Grid>

      <CataloguePanel />

      <DataTable<PaymentRow>
        rows={rows}
        columns={columns}
        query={query}
        paginationModel={paginationModel}
        onPaginationModelChange={onPaginationModelChange}
        rowCount={query.data?.total}
        errorTitle="تعذّر تحميل المدفوعات"
        toolbar={
          <Stack direction={{ xs: 'column', md: 'row' }} gap={1.5} alignItems={{ md: 'center' }}>
            <TextField
              placeholder="ابحث بالبريد أو المرجع…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                reset();
              }}
              sx={{ maxWidth: { md: 280 } }}
            />
            <TextField
              select
              label="الحالة"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                reset();
              }}
              sx={{ maxWidth: { md: 170 } }}
            >
              {STATUS_OPTIONS.map((o) => (
                <MenuItem key={o.value || 'all'} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              type="date"
              label="من"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                reset();
              }}
              // A date input always shows its own placeholder, so the label
              // must stay shrunk or the two overlap.
              InputLabelProps={{ shrink: true }}
              sx={{ maxWidth: { md: 170 } }}
            />
            <TextField
              type="date"
              label="إلى"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                reset();
              }}
              InputLabelProps={{ shrink: true }}
              sx={{ maxWidth: { md: 170 } }}
            />
            {filtersActive && (
              <Button variant="text" onClick={clearFilters}>
                مسح
              </Button>
            )}
          </Stack>
        }
        empty={
          filtersActive
            ? {
                variant: 'search',
                query: debouncedSearch || undefined,
                title: 'لا مدفوعات مطابقة',
                description: 'جرّب مدى تاريخ أو حالة مختلفة.',
                action: (
                  <Button variant="text" onClick={clearFilters}>
                    مسح عوامل التصفية
                  </Button>
                ),
              }
            : {
                title: 'لا توجد مدفوعات بعد',
                description: 'سيظهر هنا كل طلب دفع بمجرد أن يبدأ مستخدم عملية شراء.',
                icon: <CreditCardRounded />,
              }
        }
        renderMobileCard={(row) => (
          <Box sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
            <Stack gap={1}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Money
                  amount={row.amountCents}
                  unit="minor"
                  currency={row.currency as 'EGP' | 'USD'}
                  variant="h6"
                />
                <StatusChip
                  kind="payment"
                  value={row.status}
                  tooltip={row.failureReason ?? undefined}
                />
              </Stack>
              <Mono value={row.userEmail} variant="body2" />
              <Mono value={row.reference} variant="caption" maxChars={24} copyable />
              <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                <StatusChip
                  kind="planCode"
                  value={row.planCode}
                  label={planLabel(catalogue.data?.plans, row.planCode)}
                />
                <StatusChip kind="paymentProvider" value={row.provider} />
              </Stack>
              {row.failureReason && (
                <Typography variant="caption" color="error.main">
                  {row.failureReason}
                </Typography>
              )}
              <RelativeTime value={row.paidAt ?? row.createdAt} mode="both" variant="caption" />
            </Stack>
          </Box>
        )}
      />
    </>
  );
}
