import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import CreditCardRounded from '@mui/icons-material/CreditCardRounded';
import FlagRounded from '@mui/icons-material/FlagRounded';
import PeopleRounded from '@mui/icons-material/PeopleRounded';
import PersonAddRounded from '@mui/icons-material/PersonAddRounded';
import PlayCircleRounded from '@mui/icons-material/PlayCircleRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import SmartToyRounded from '@mui/icons-material/SmartToyRounded';
import SpaceDashboardRounded from '@mui/icons-material/SpaceDashboardRounded';
import RateReviewRounded from '@mui/icons-material/RateReviewRounded';
import WorkspacePremiumRounded from '@mui/icons-material/WorkspacePremiumRounded';
import { Link as RouterLink } from 'react-router-dom';

import { BarChartRtl } from '../components/charts/BarChartRtl';
import { LineChartRtl } from '../components/charts/LineChartRtl';
import { chartHeight } from '../components/charts/chartTheme';
import { DateRangeControl } from '../components/common/DateRangeControl';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { Num } from '../components/common/Num';
import { PageHeader } from '../components/common/PageHeader';
import { SectionCard } from '../components/common/SectionCard';
import { ChartSkeleton, ListSkeleton } from '../components/common/Skeletons';
import { StatCard } from '../components/common/StatCard';
import { StatusChip } from '../components/common/StatusChip';
import {
  deltaRatio,
  useAttention,
  useOverview,
  usePopularCategories,
  useTimeseries,
  type AttentionResponse,
} from '../features/analytics/api';
import { formatNumber, formatYmd, formatYmdShort, LOCALE, TIMEZONE } from '../lib/format';
import { useDateRange } from '../lib/hooks/useDateRange';

const DELTA_LABEL = 'مقارنة بالفترة السابقة';

interface AttentionItem {
  key: keyof AttentionResponse['attention'];
  label: string;
  href: string;
  icon: React.ReactNode;
  actionLabel: string;
}

/**
 * Every entry links to the page that can act on it. The backend omits the keys
 * the current role may not act on, so this list is filtered by presence — a
 * count is never shown without somewhere to resolve it.
 */
const ATTENTION_ITEMS: AttentionItem[] = [
  {
    key: 'unresolvedReports',
    label: 'بلاغات قيد المراجعة',
    href: '/reports',
    icon: <FlagRounded />,
    actionLabel: 'مراجعة البلاغات',
  },
  {
    key: 'failedAiCalls24h',
    label: 'استدعاءات ذكاء اصطناعي فاشلة خلال ٢٤ ساعة',
    href: '/ai-usage',
    icon: <SmartToyRounded />,
    actionLabel: 'فحص السجل',
  },
  {
    key: 'expiringSubscriptions7d',
    label: 'اشتراكات تنتهي خلال ٧ أيام',
    href: '/subscriptions',
    icon: <CreditCardRounded />,
    actionLabel: 'عرض الاشتراكات',
  },
];

export function DashboardPage() {
  const rangeState = useDateRange('30d');
  const { range, error: rangeError } = rangeState;
  // An out-of-bounds custom range is caught here rather than sent to a server
  // that would only answer 400.
  const enabled = !rangeError;

  const overviewQ = useOverview(range, { enabled });
  const seriesQ = useTimeseries(range, { enabled });
  const categoriesQ = usePopularCategories(range, { enabled });
  const attentionQ = useAttention();

  const o = overviewQ.data;
  const busy =
    overviewQ.isFetching || seriesQ.isFetching || categoriesQ.isFetching || attentionQ.isFetching;

  const refreshAll = () => {
    void overviewQ.refetch();
    void seriesQ.refetch();
    void categoriesQ.refetch();
    void attentionQ.refetch();
  };

  const statLoading = overviewQ.isLoading;
  const statError = overviewQ.isError;

  const points = seriesQ.data?.points ?? [];
  const seriesIsFlat = points.every((p) => !p.signups && !p.sessions && !p.answers);

  const categoryRows = categoriesQ.data?.rows ?? [];
  const categoryData = categoryRows.map((r) => ({
    // Neutral latin keys; the Arabic name is passed as the series `name`.
    name: r.category.nameAr,
    sessions: r.sessions,
  }));

  const attention = attentionQ.data?.attention;
  const visibleAttention = ATTENTION_ITEMS.filter((item) => attention?.[item.key] !== undefined);
  const attentionTotal = visibleAttention.reduce((sum, item) => sum + (attention?.[item.key] ?? 0), 0);

  const header = (
    <PageHeader
      title="اللوحة الرئيسية"
      description="نظرة عامة على النشاط والاشتراكات خلال المدى المحدد."
      icon={<SpaceDashboardRounded />}
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

  // With the queries held back, every section below would otherwise render its
  // "no data" state and blame the data for what is a bad range.
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

      {/* Needs your attention — the counts that should pull an operator away
          from the dashboard, each linked to the page that resolves it. */}
      <SectionCard
        title="يحتاج انتباهك"
        description={
          attentionQ.data
            ? `آخر فحص: ${new Intl.DateTimeFormat(LOCALE, { timeStyle: 'short', timeZone: TIMEZONE }).format(new Date(attentionQ.data.checkedAt))}`
            : undefined
        }
        dense
      >
        {attentionQ.isLoading ? (
          <ListSkeleton rows={2} />
        ) : attentionQ.isError ? (
          <ErrorState
            error={attentionQ.error}
            variant="inline"
            title="تعذّر تحميل قائمة التنبيهات"
            onRetry={() => void attentionQ.refetch()}
          />
        ) : attentionTotal === 0 ? (
          <Stack direction="row" alignItems="center" gap={1} sx={{ color: 'success.main', py: 0.5 }}>
            <CheckCircleRounded fontSize="small" />
            <Typography variant="body2" color="text.secondary">
              لا شيء يحتاج انتباهك الآن.
            </Typography>
          </Stack>
        ) : (
          <Stack divider={<Divider flexItem />}>
            {visibleAttention.map((item) => {
              const count = attention?.[item.key] ?? 0;
              return (
                <Stack
                  key={item.key}
                  direction={{ xs: 'column', sm: 'row' }}
                  alignItems={{ sm: 'center' }}
                  gap={1.5}
                  sx={{ py: 1.25 }}
                >
                  <Box
                    sx={{
                      display: 'grid',
                      placeItems: 'center',
                      color: count > 0 ? 'warning.main' : 'text.disabled',
                    }}
                  >
                    {item.icon}
                  </Box>
                  <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }}>
                    {item.label}
                  </Typography>
                  <StatusChip
                    kind="custom"
                    value={String(count)}
                    label={formatNumber(count, 'int')}
                    tone={count > 0 ? 'warning' : 'neutral'}
                  />
                  <Button
                    size="small"
                    variant="text"
                    component={RouterLink}
                    to={item.href}
                    disabled={count === 0}
                  >
                    {item.actionLabel}
                  </Button>
                </Stack>
              );
            })}
          </Stack>
        )}
      </SectionCard>

      <Grid container spacing={{ xs: 2, md: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
          <StatCard
            index={0}
            label="إجمالي المستخدمين"
            value={o?.totals?.users}
            icon={<PeopleRounded />}
            tone="brand"
            href="/users"
            loading={statLoading}
            error={statError}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
          <StatCard
            index={1}
            label="المشتركون المميزون"
            value={o?.totals?.premiumUsers}
            icon={<WorkspacePremiumRounded />}
            tone="gold"
            // Entitlement, not the plan column — see features/analytics/api.ts.
            hint={
              o
                ? `نسبة التحويل ${formatNumber(o.totals.conversionRate, 'percent')}${
                    o.totals.premiumExpired ? ` · ${formatNumber(o.totals.premiumExpired, 'int')} منتهي` : ''
                  }`
                : undefined
            }
            loading={statLoading}
            error={statError}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
          <StatCard
            index={2}
            label="مستخدمون جدد"
            value={o?.current?.newUsers}
            icon={<PersonAddRounded />}
            tone="info"
            delta={
              o ? withLabel(deltaRatio(o.current.newUsers, o.previous.newUsers)) : undefined
            }
            loading={statLoading}
            error={statError}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
          <StatCard
            index={3}
            label="الجلسات"
            value={o?.current?.sessions}
            icon={<PlayCircleRounded />}
            tone="brand"
            delta={o ? withLabel(deltaRatio(o.current.sessions, o.previous.sessions)) : undefined}
            loading={statLoading}
            error={statError}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
          <StatCard
            index={4}
            label="الإجابات"
            value={o?.current?.answers}
            icon={<RateReviewRounded />}
            tone="success"
            delta={o ? withLabel(deltaRatio(o.current.answers, o.previous.answers)) : undefined}
            loading={statLoading}
            error={statError}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
          <StatCard
            index={5}
            label="مستخدمون نشطون"
            value={o?.current?.activeUsers}
            icon={<PeopleRounded />}
            tone="gold"
            hint="من بدأوا جلسة خلال المدى"
            loading={statLoading}
            error={statError}
          />
        </Grid>
      </Grid>

      {/* Today, on the product's own day boundary. The backend reports whether
          it could bucket with the named zone, and that qualification is shown
          rather than quietly dropped. */}
      <SectionCard
        title="اليوم"
        description={
          o ? `${formatYmd(o.today.date)} — بتوقيت القاهرة، وهو حدّ اليوم المستخدم في حصص الاستخدام.` : undefined
        }
        actions={
          o && !o.range.exactTimezone ? (
            <Tooltip title="خادم قاعدة البيانات لا يملك جداول المناطق الزمنية، فتم استخدام إزاحة ثابتة. قد يختلف حدّ اليوم بساعة عند تغيّر التوقيت الصيفي.">
              <span>
                <StatusChip kind="custom" value="approx" label="تقريبي" tone="warning" />
              </span>
            </Tooltip>
          ) : undefined
        }
        dense
      >
        {overviewQ.isError ? (
          <ErrorState
            error={overviewQ.error}
            variant="inline"
            title="تعذّر تحميل أرقام اليوم"
            onRetry={() => void overviewQ.refetch()}
          />
        ) : (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            gap={{ xs: 1.5, sm: 4 }}
            divider={<Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />}
          >
            {[
              { label: 'جلسات اليوم', value: o?.today?.sessions },
              { label: 'مستخدمون نشطون', value: o?.today?.activeUsers },
              { label: 'تسجيلات جديدة', value: o?.today?.newUsers },
            ].map((item) => (
              <Stack key={item.label} gap={0.25}>
                <Typography variant="caption" color="text.secondary">
                  {item.label}
                </Typography>
                {overviewQ.isLoading ? (
                  // A '—' while loading reads as "no data"; a skeleton reads as
                  // "not yet".
                  <Skeleton height={30} width={72} />
                ) : (
                  <Num value={item.value} variant="h4" />
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </SectionCard>

      <SectionCard
        title="النشاط اليومي"
        description="تسجيلات وجلسات وإجابات لكل يوم داخل المدى المحدد."
      >
        {seriesQ.isLoading ? (
          <ChartSkeleton />
        ) : seriesQ.isError ? (
          <ErrorState
            error={seriesQ.error}
            variant="block"
            title="تعذّر تحميل بيانات النشاط"
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
              { dataKey: 'signups', name: 'تسجيلات' },
            ]}
          />
        )}
      </SectionCard>

      {/* Guarded independently of the overview: a failed category request used
          to render empty axes indistinguishable from "no data". */}
      <SectionCard
        title="الأقسام الأكثر استخدامًا"
        description="عدد الجلسات لكل قسم داخل المدى المحدد."
        actions={
          <Button size="small" variant="text" component={RouterLink} to="/analytics">
            تفاصيل الأقسام
          </Button>
        }
      >
        {categoriesQ.isLoading ? (
          <ChartSkeleton />
        ) : categoriesQ.isError ? (
          <ErrorState
            error={categoriesQ.error}
            variant="block"
            title="تعذّر تحميل بيانات الأقسام"
            onRetry={() => void categoriesQ.refetch()}
          />
        ) : categoryData.length === 0 ? (
          <EmptyState
            variant="filtered"
            size="sm"
            title="لا توجد جلسات في هذه الفترة"
            description="لن تظهر الأقسام هنا قبل أن يبدأ المستخدمون جلسات تدريب."
          />
        ) : (
          <BarChartRtl
            data={categoryData}
            categoryKey="name"
            height={chartHeight}
            series={[{ dataKey: 'sessions', name: 'جلسات' }]}
          />
        )}
      </SectionCard>
    </>
  );
}

/** deltaRatio returns undefined when there is no baseline; StatCard then shows
 *  no delta at all rather than a meaningless ∞%. */
function withLabel(value: number | undefined) {
  return value === undefined ? undefined : { value, label: DELTA_LABEL, goodWhen: 'up' as const };
}
