import { useMemo } from 'react';
import Grid from '@mui/material/Grid2';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import SmartToyRounded from '@mui/icons-material/SmartToyRounded';
import PaidRounded from '@mui/icons-material/PaidRounded';
import BoltRounded from '@mui/icons-material/BoltRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import TimerOutlined from '@mui/icons-material/TimerOutlined';
import DataUsageRounded from '@mui/icons-material/DataUsageRounded';
import type { GridColDef } from '@mui/x-data-grid';
import { useSearchParams } from 'react-router-dom';

import { PageHeader } from '../components/common/PageHeader';
import { SectionCard } from '../components/common/SectionCard';
import { StatCard } from '../components/common/StatCard';
import { DataTable } from '../components/common/DataTable';
import { ChartSkeleton, StatGridSkeleton } from '../components/common/Skeletons';
import { ErrorState } from '../components/common/ErrorState';
import { BarChartRtl } from '../components/charts/BarChartRtl';
import { chartHeight } from '../components/charts/chartTheme';
import { dateCol, numCol, moneyCol, chipCol, textCol } from '../lib/columns';
import { formatNumber } from '../lib/format';
import { useServerPagination } from '../lib/hooks/useServerPagination';
import {
  useAiUsageQuery,
  microToUsd,
  featureLabel,
  RANGE_OPTIONS,
  type AiUsageLog,
  type AiUsageParams,
} from '../features/aiUsage/api';
import { UsageBreakdown, type BreakdownRow } from '../features/aiUsage/UsageBreakdown';

type StatusFilter = AiUsageParams['status'];

const isStatus = (v: string | null): v is StatusFilter =>
  v === 'all' || v === 'success' || v === 'error';

export function AIUsagePage() {
  const [params, setParams] = useSearchParams();
  const { paginationModel, onPaginationModelChange, page, pageSize, reset } = useServerPagination();

  const days = Number(params.get('days')) || 7;
  const provider = params.get('provider') ?? '';
  const feature = params.get('feature') ?? '';
  const statusParam = params.get('status');
  const status: StatusFilter = isStatus(statusParam) ? statusParam : 'all';

  const query = useAiUsageQuery({ page, limit: pageSize, days, provider, feature, status });
  const data = query.data;
  const summary = data?.summary;
  const failed = query.isError;

  function setParam(key: string, value: string) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value) p.set(key, value);
        else p.delete(key);
        p.set('page', '1');
        return p;
      },
      { replace: true },
    );
    reset();
  }

  // A total built partly from calls that never recorded a cost is an estimate,
  // and has to say so.
  const hasUnpriced = (summary?.unpricedCalls ?? 0) > 0;
  const costUsd = summary ? microToUsd(summary.costMicroUsd) : undefined;
  const failureRate =
    summary && summary.calls > 0 ? summary.failures / summary.calls : summary ? 0 : undefined;

  const dailyData = useMemo(
    () =>
      (data?.daily ?? []).map((d) => ({
        day: d.day.slice(5), // MM-DD; the year is implied by the range control
        calls: d.calls,
        failures: d.failures,
        costUsd: Number(microToUsd(d.costMicroUsd).toFixed(4)),
      })),
    [data?.daily],
  );

  const providerRows = useMemo<BreakdownRow[]>(
    () => (data?.byProvider ?? []).map((r) => ({ ...r, key: r.provider, label: r.provider })),
    [data?.byProvider],
  );

  const featureRows = useMemo<BreakdownRow[]>(
    () => (data?.byFeature ?? []).map((r) => ({ ...r, key: r.feature, label: featureLabel(r.feature) })),
    [data?.byFeature],
  );

  const columns = useMemo<GridColDef<AiUsageLog>[]>(
    () => [
      dateCol<AiUsageLog>({ field: 'createdAt', headerName: 'التاريخ', width: 150 }),
      textCol<AiUsageLog>({ field: 'provider', headerName: 'المزوّد', width: 110, mono: true }),
      textCol<AiUsageLog>({ field: 'model', headerName: 'النموذج', width: 180, mono: true }),
      {
        field: 'feature',
        headerName: 'الغرض',
        width: 150,
        align: 'left',
        headerAlign: 'left',
        renderCell: ({ value }) => (
          <Typography variant="body2" noWrap>
            {featureLabel(value as string)}
          </Typography>
        ),
      },
      numCol<AiUsageLog>({ field: 'inputTokens', headerName: 'مُدخل', width: 100 }),
      numCol<AiUsageLog>({ field: 'outputTokens', headerName: 'مُخرج', width: 100 }),
      numCol<AiUsageLog>({ field: 'cacheReadTokens', headerName: 'من الذاكرة', width: 110 }),
      // The real per-call charge, not a rate card re-applied to every provider.
      moneyCol<AiUsageLog>({
        field: 'costMicroUsd',
        headerName: 'التكلفة',
        width: 130,
        unit: 'micro',
        currency: 'USD',
      }),
      numCol<AiUsageLog>({ field: 'latencyMs', headerName: 'الزمن', width: 100, format: 'ms' }),
      chipCol<AiUsageLog>({ field: 'success', headerName: 'الحالة', kind: 'aiResult', width: 110 }),
      {
        field: 'errorMessage',
        headerName: 'الخطأ',
        flex: 1,
        minWidth: 160,
        sortable: false,
        align: 'left',
        headerAlign: 'left',
        renderCell: ({ value }) =>
          value ? (
            <Tooltip title={value as string}>
              <Typography variant="body2" color="error.main" noWrap>
                {value as string}
              </Typography>
            </Tooltip>
          ) : (
            <Typography variant="body2" color="text.disabled">
              —
            </Typography>
          ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="استخدام الذكاء الاصطناعي"
        description="التكلفة الفعلية المسجّلة لكل مكالمة، حسب المزوّد والغرض."
        icon={<SmartToyRounded />}
        actions={
          <Stack direction="row" gap={1} flexWrap="wrap">
            <TextField
              select
              value={days}
              onChange={(e) => setParam('days', e.target.value)}
              sx={{ minWidth: 150 }}
              label="المدة"
            >
              {RANGE_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              value={provider}
              onChange={(e) => setParam('provider', e.target.value)}
              sx={{ minWidth: 140 }}
              label="المزوّد"
            >
              <MenuItem value="">كل المزوّدين</MenuItem>
              {(data?.byProvider ?? []).map((p) => (
                <MenuItem key={p.provider} value={p.provider}>
                  {p.provider}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              value={feature}
              onChange={(e) => setParam('feature', e.target.value)}
              sx={{ minWidth: 160 }}
              label="الغرض"
            >
              <MenuItem value="">كل الأغراض</MenuItem>
              {(data?.byFeature ?? []).map((f) => (
                <MenuItem key={f.feature} value={f.feature}>
                  {featureLabel(f.feature)}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              value={status}
              onChange={(e) => setParam('status', e.target.value)}
              sx={{ minWidth: 130 }}
              label="النتيجة"
            >
              <MenuItem value="all">الكل</MenuItem>
              <MenuItem value="success">ناجحة</MenuItem>
              <MenuItem value="error">فاشلة</MenuItem>
            </TextField>
          </Stack>
        }
      />

      {query.isLoading ? (
        <StatGridSkeleton count={5} />
      ) : (
        <Grid container spacing={{ xs: 2, md: 3 }}>
          <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2.4 }}>
            <StatCard
              index={0}
              label="عدد المكالمات"
              value={summary?.calls}
              icon={<BoltRounded />}
              error={failed}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2.4 }}>
            <StatCard
              index={1}
              label="التكلفة الفعلية"
              value={costUsd}
              format="money"
              currency="USD"
              precision={costUsd !== undefined && costUsd >= 1 ? 2 : 4}
              tone="gold"
              icon={<PaidRounded />}
              error={failed}
              countUp={false}
              hint={
                hasUnpriced
                  ? `تقديري — ${summary?.unpricedCalls} مكالمة بلا تكلفة مسجّلة`
                  : 'مجموع ما سُجّل فعليًا لكل مكالمة'
              }
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2.4 }}>
            <StatCard
              index={2}
              label="الرموز (مُدخل / مُخرج)"
              value={summary ? summary.inputTokens + summary.outputTokens : undefined}
              format="compact"
              icon={<DataUsageRounded />}
              error={failed}
              hint={
                summary
                  ? `${summary.cacheReadTokens.toLocaleString('ar-EG')} من الذاكرة`
                  : undefined
              }
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2.4 }}>
            <StatCard
              index={3}
              label="نسبة الفشل"
              value={failureRate}
              format="percent"
              tone={summary && summary.failures > 0 ? 'error' : 'success'}
              icon={<ErrorOutlineRounded />}
              error={failed}
              countUp={false}
              hint={summary ? `${summary.failures} من ${summary.calls}` : undefined}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2.4 }}>
            <StatCard
              index={4}
              label="متوسط الزمن"
              // Pre-formatted: a bare number here reads as a count, not as time.
              value={
                summary?.avgLatencyMs === null || summary?.avgLatencyMs === undefined
                  ? undefined
                  : formatNumber(summary.avgLatencyMs, 'ms')
              }
              format="raw"
              icon={<TimerOutlined />}
              error={failed}
              hint={
                summary?.maxLatencyMs
                  ? `الأقصى ${formatNumber(summary.maxLatencyMs, 'ms')}`
                  : undefined
              }
            />
          </Grid>
        </Grid>
      )}

      <Grid container spacing={{ xs: 2, md: 3 }}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SectionCard
            title="المكالمات يوميًا"
            description="بتوقيت القاهرة — حدود اليوم كما يحسبها التطبيق."
          >
            {query.isLoading ? (
              <ChartSkeleton height={chartHeight.md} />
            ) : failed ? (
              <ErrorState error={query.error} onRetry={() => query.refetch()} variant="block" />
            ) : dailyData.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ paddingBlock: 6, textAlign: 'center' }}>
                لا توجد مكالمات في هذه المدة.
              </Typography>
            ) : (
              <BarChartRtl
                data={dailyData}
                categoryKey="day"
                showLegend
                series={[
                  { dataKey: 'calls', name: 'مكالمات' },
                  { dataKey: 'failures', name: 'فاشلة' },
                ]}
              />
            )}
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <SectionCard title="التكلفة يوميًا" description="بالدولار الأمريكي.">
            {query.isLoading ? (
              <ChartSkeleton height={chartHeight.md} />
            ) : failed ? (
              <ErrorState error={query.error} onRetry={() => query.refetch()} variant="block" />
            ) : dailyData.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ paddingBlock: 6, textAlign: 'center' }}>
                لا توجد تكلفة مسجّلة في هذه المدة.
              </Typography>
            ) : (
              <BarChartRtl
                data={dailyData}
                categoryKey="day"
                yWidth={72}
                series={[{ dataKey: 'costUsd', name: 'التكلفة (دولار)' }]}
              />
            )}
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <SectionCard title="حسب المزوّد" description="حصة كل مزوّد من التكلفة.">
            {query.isLoading ? (
              <ChartSkeleton height={200} />
            ) : failed ? (
              <ErrorState error={query.error} onRetry={() => query.refetch()} variant="block" />
            ) : (
              <UsageBreakdown rows={providerRows} emptyTitle="لا توجد مكالمات في هذه المدة" />
            )}
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <SectionCard title="حسب الغرض" description="أي ميزة في المنتج تُنفق الرموز.">
            {query.isLoading ? (
              <ChartSkeleton height={200} />
            ) : failed ? (
              <ErrorState error={query.error} onRetry={() => query.refetch()} variant="block" />
            ) : (
              <UsageBreakdown rows={featureRows} emptyTitle="لا توجد مكالمات في هذه المدة" />
            )}
          </SectionCard>
        </Grid>
      </Grid>

      <DataTable<AiUsageLog>
        rows={data?.logs}
        columns={columns}
        query={query}
        paginationModel={paginationModel}
        onPaginationModelChange={onPaginationModelChange}
        rowCount={data?.total}
        getRowId={(r) => r.id}
        empty={{
          title: 'لا توجد مكالمات مسجّلة',
          description: 'غيّر المدة أو أزل عوامل التصفية.',
          icon: <SmartToyRounded />,
        }}
      />

      {hasUnpriced && !query.isLoading && !failed && (
        <Typography variant="caption" color="text.secondary">
          بعض المكالمات سُجّلت قبل تفعيل حساب التكلفة، وتظهر تكلفتها «—» بدل صفر، فلا تُحتسب ضمن
          الإجمالي.
        </Typography>
      )}
    </>
  );
}
