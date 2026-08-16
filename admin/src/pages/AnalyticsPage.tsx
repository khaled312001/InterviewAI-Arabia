import { useMemo } from 'react';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid2';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import PlayCircleRounded from '@mui/icons-material/PlayCircleRounded';
import QueryStatsRounded from '@mui/icons-material/QueryStatsRounded';
import StarRateRounded from '@mui/icons-material/StarRateRounded';
import TrendingUpRounded from '@mui/icons-material/TrendingUpRounded';
import type { GridColDef } from '@mui/x-data-grid';

import { LineChartRtl } from '../components/charts/LineChartRtl';
import { PieChartRtl } from '../components/charts/PieChartRtl';
import { DataTable } from '../components/common/DataTable';
import { DateRangeControl } from '../components/common/DateRangeControl';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { PageHeader } from '../components/common/PageHeader';
import { SectionCard } from '../components/common/SectionCard';
import { ChartSkeleton } from '../components/common/Skeletons';
import { StatCard } from '../components/common/StatCard';
import { chipCol, numCol, textCol } from '../lib/columns';
import { deltaRatio, useOverview, usePopularCategories, useTimeseries } from '../features/analytics/api';
import { formatNumber, formatYmd, formatYmdShort } from '../lib/format';
import { useDateRange } from '../lib/hooks/useDateRange';

/** ai_score is anchored 0–10 by the evaluation rubric (services/ai/prompts.js). */
const SCORE_MAX = 10;

interface CategoryPerfRow {
  id: number;
  name: string;
  isPremium: boolean;
  sessions: number;
  users: number;
  scoredAnswers: number;
  avgScore: number | null;
}

const CATEGORY_COLUMNS: GridColDef<CategoryPerfRow>[] = [
  textCol<CategoryPerfRow>({ field: 'name', headerName: 'القسم', flex: 1, minWidth: 160 }),
  chipCol<CategoryPerfRow>({ field: 'isPremium', headerName: 'الوصول', kind: 'categoryAccess', width: 110 }),
  numCol<CategoryPerfRow>({ field: 'sessions', headerName: 'الجلسات', width: 110 }),
  numCol<CategoryPerfRow>({ field: 'users', headerName: 'المستخدمون', width: 120 }),
  numCol<CategoryPerfRow>({ field: 'scoredAnswers', headerName: 'إجابات مُقيَّمة', width: 130 }),
  // A section with no scored answers shows '—', never a 0 that reads as
  // "everyone scored zero".
  numCol<CategoryPerfRow>({
    field: 'avgScore',
    headerName: `متوسط التقييم (من ${SCORE_MAX})`,
    width: 170,
    format: 'decimal',
    digits: 1,
  }),
];

export function AnalyticsPage() {
  const rangeState = useDateRange('30d');
  const { range, error: rangeError } = rangeState;
  const enabled = !rangeError;

  // Same hooks, same query keys as the dashboard — the two pages share one
  // cache entry per endpoint instead of fetching the same data twice.
  const overviewQ = useOverview(range, { enabled });
  const seriesQ = useTimeseries(range, { enabled });
  const categoriesQ = usePopularCategories(range, { enabled });

  const o = overviewQ.data;
  const busy = overviewQ.isFetching || seriesQ.isFetching || categoriesQ.isFetching;

  const refreshAll = () => {
    void overviewQ.refetch();
    void seriesQ.refetch();
    void categoriesQ.refetch();
  };

  const points = seriesQ.data?.points ?? [];
  const seriesIsFlat = points.every((p) => !p.signups && !p.sessions && !p.answers);
  const hasAnyScore = points.some((p) => p.avgScore !== null);

  // Three real segments: free, entitled premium, and rows still flagged
  // 'premium' whose entitlement lapsed — the last is invisible in a two-slice
  // free/premium split, and it is the one that costs money.
  const planData = useMemo(() => {
    if (!o) return [];
    const free = Math.max(0, o.totals.users - o.totals.premiumUsers - o.totals.premiumExpired);
    return [
      { name: 'مجاني', value: free },
      { name: 'مميز نشط', value: o.totals.premiumUsers },
      { name: 'مميز منتهي', value: o.totals.premiumExpired },
    ].filter((d) => d.value > 0);
  }, [o]);

  const categoryRows = useMemo<CategoryPerfRow[]>(
    () =>
      (categoriesQ.data?.rows ?? []).map((r) => ({
        id: r.category.id,
        name: r.category.nameAr,
        isPremium: r.category.isPremium,
        sessions: r.sessions,
        users: r.users,
        scoredAnswers: r.scoredAnswers,
        avgScore: r.avgScore,
      })),
    [categoriesQ.data],
  );

  const statLoading = overviewQ.isLoading;
  const statError = overviewQ.isError;

  const header = (
    <PageHeader
      title="التحليلات"
      description="أداء المحتوى وتوزيع الخطط واتجاه النشاط خلال المدى المحدد."
      icon={<QueryStatsRounded />}
      actions={
        <>
          <DateRangeControl value={rangeState} />
          <Button
            variant="outlined"
            startIcon={<RefreshRounded />}
            onClick={refreshAll}
            disabled={busy || !enabled}
          >
            تحديث
          </Button>
        </>
      }
    />
  );

  // Held-back queries must not be reported as "no data" — see DashboardPage.
  if (rangeError) {
    return (
      <>
        {header}
        <ErrorState variant="inline" title="المدى الزمني غير صالح" description={rangeError} />
      </>
    );
  }

  return (
    <>
      {header}

      <Grid container spacing={{ xs: 2, md: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={0}
            label={`متوسط التقييم (من ${SCORE_MAX})`}
            // format='raw' so the decimal survives; countUp is skipped for it.
            value={
              o
                ? o.current.avgScore === null
                  ? undefined
                  : formatNumber(o.current.avgScore, 'decimal', 1)
                : undefined
            }
            format="raw"
            icon={<StarRateRounded />}
            tone="gold"
            hint={
              o && o.current.avgScore === null
                ? 'لا توجد إجابات مُقيَّمة في هذه الفترة'
                : o
                  ? `على ${formatNumber(o.current.scoredAnswers, 'int')} إجابة مُقيَّمة`
                  : undefined
            }
            loading={statLoading}
            error={statError}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={1}
            label="الجلسات"
            value={o?.current?.sessions}
            icon={<PlayCircleRounded />}
            tone="brand"
            delta={
              o
                ? wrapDelta(deltaRatio(o.current.sessions, o.previous.sessions))
                : undefined
            }
            loading={statLoading}
            error={statError}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={2}
            label="مستخدمون نشطون"
            value={o?.current?.activeUsers}
            icon={<GroupsRounded />}
            tone="info"
            delta={
              o
                ? wrapDelta(deltaRatio(o.current.activeUsers, o.previous.activeUsers))
                : undefined
            }
            loading={statLoading}
            error={statError}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={3}
            label="معدل التحويل"
            value={o?.totals?.conversionRate}
            format="percent"
            icon={<TrendingUpRounded />}
            tone="success"
            hint="مشتركون مميزون فعليون ÷ إجمالي المستخدمين"
            loading={statLoading}
            error={statError}
          />
        </Grid>
      </Grid>

      <SectionCard
        title="اتجاه النشاط"
        description="الجلسات والإجابات والمستخدمون النشطون لكل يوم."
      >
        {seriesQ.isLoading ? (
          <ChartSkeleton />
        ) : seriesQ.isError ? (
          <ErrorState
            error={seriesQ.error}
            variant="block"
            title="تعذّر تحميل بيانات الاتجاه"
            onRetry={() => void seriesQ.refetch()}
          />
        ) : seriesIsFlat ? (
          <EmptyState
            variant="filtered"
            size="sm"
            title="لا يوجد نشاط في هذه الفترة"
            description="جرّب مدى زمنيًا أوسع."
          />
        ) : (
          <LineChartRtl
            data={points}
            categoryKey="date"
            tickFormatter={formatYmdShort}
            labelFormatter={(v) => formatYmd(v)}
            series={[
              { dataKey: 'sessions', name: 'جلسات' },
              { dataKey: 'answers', name: 'إجابات' },
              { dataKey: 'activeUsers', name: 'مستخدمون نشطون' },
            ]}
          />
        )}
      </SectionCard>

      <SectionCard
        title="متوسط التقييم اليومي"
        description={`متوسط درجة الإجابات لكل يوم، من ${SCORE_MAX}. الأيام بلا إجابات مُقيَّمة تظهر كفجوة، لا كصفر.`}
      >
        {seriesQ.isLoading ? (
          <ChartSkeleton />
        ) : seriesQ.isError ? (
          <ErrorState
            error={seriesQ.error}
            variant="block"
            title="تعذّر تحميل بيانات التقييم"
            onRetry={() => void seriesQ.refetch()}
          />
        ) : !hasAnyScore ? (
          <EmptyState
            variant="filtered"
            size="sm"
            title="لا توجد إجابات مُقيَّمة في هذه الفترة"
            description="يظهر هذا الرسم بعد أن يقيّم الذكاء الاصطناعي إجابات المستخدمين."
          />
        ) : (
          <LineChartRtl
            data={points}
            categoryKey="date"
            showLegend={false}
            yDomain={[0, SCORE_MAX]}
            tickFormatter={formatYmdShort}
            labelFormatter={(v) => formatYmd(v)}
            // connectNulls stays false: bridging a day with no scored answers
            // would draw a trend that was never measured.
            series={[{ dataKey: 'avgScore', name: 'متوسط التقييم' }]}
          />
        )}
      </SectionCard>

      <Grid container spacing={{ xs: 2, md: 3 }}>
        <Grid size={{ xs: 12, md: 5 }}>
          <SectionCard
            title="توزيع الخطط"
            description="إجمالي الحسابات حسب الاشتراك الفعلي، وليس حسب عمود الخطة وحده."
          >
            {overviewQ.isLoading ? (
              <ChartSkeleton />
            ) : overviewQ.isError ? (
              <ErrorState
                error={overviewQ.error}
                variant="block"
                title="تعذّر تحميل توزيع الخطط"
                onRetry={() => void overviewQ.refetch()}
              />
            ) : planData.length === 0 ? (
              <EmptyState size="sm" title="لا يوجد مستخدمون بعد" />
            ) : (
              <PieChartRtl data={planData} />
            )}
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          {/* DataTable owns its own Card, so the heading goes in its toolbar
              rather than in a SectionCard wrapper that would double the border. */}
          <DataTable<CategoryPerfRow>
            rows={categoryRows}
            columns={CATEGORY_COLUMNS}
            query={categoriesQ}
            // A complete, bounded top-N — no footer, but client sorting works
            // because every row is already here.
            paginationMode="none"
            toolbar={
              <Stack gap={0.25}>
                <Typography variant="h6">أداء الأقسام</Typography>
                <Typography variant="body2" color="text.secondary">
                  {categoriesQ.data
                    ? `أعلى ${formatNumber(Math.min(categoriesQ.data.limit, categoryRows.length), 'int')} قسمًا حسب عدد الجلسات داخل المدى.`
                    : 'الأقسام مرتبة حسب عدد الجلسات داخل المدى.'}
                </Typography>
              </Stack>
            }
            empty={{
              variant: 'filtered',
              title: 'لا توجد جلسات في هذه الفترة',
              description: 'لن تظهر الأقسام هنا قبل أن يبدأ المستخدمون جلسات تدريب.',
            }}
            errorTitle="تعذّر تحميل أداء الأقسام"
          />
        </Grid>
      </Grid>
    </>
  );
}

function wrapDelta(value: number | undefined) {
  return value === undefined
    ? undefined
    : { value, label: 'مقارنة بالفترة السابقة', goodWhen: 'up' as const };
}
