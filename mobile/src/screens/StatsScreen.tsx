import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { api } from '../api/client';
import { useAppTheme, useDirection } from '../theme/useTheme';
import { accentForCategory, scoreColor, scoreTone } from '../theme/tokens';
import {
  Screen, Text, Card, Badge, SectionHeader, EmptyState, ScoreRing, ScoreBar,
  Skeleton, SkeletonCard,
} from '../components';
import {
  answerCount, categoryIcon, categoryName, relativeTime, sessionAverage,
  sessionCountLabel, type CategoryLike, type SessionLike,
} from './mainShared';

/** Enough sessions for a meaningful trend without a second round-trip. */
const TREND_LIMIT = 50;
const TREND_POINTS = 10;

/**
 * Floor for a trend bar, as a percentage of the chart height.
 *
 * A 0.0 score would otherwise render as a zero-height bar — indistinguishable
 * from "no session at all", which is the opposite of what it means. This is a
 * chart-geometry ratio, not a spacing value, so it has no token equivalent.
 */
const MIN_BAR_PERCENT = 6;

interface StatsResponse {
  totalSessions: number;
  totalAnswers: number;
  averageScore: number;
  categoryBreakdown: {
    categoryId: number;
    _count?: { _all?: number };
    _avg?: { totalScore?: number };
  }[];
}

interface BreakdownRow {
  categoryId: number;
  category: CategoryLike | null;
  sessions: number;
  /** 0–10 average per answer, or null when it cannot be derived. */
  average: number | null;
}

/* ------------------------------------------------------------------ *
 * Per-category row
 * ------------------------------------------------------------------ */

const CategoryStatRow = React.memo(function CategoryStatRow({
  row, language, last,
}: { row: BreakdownRow; language: string; last: boolean }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [barWidth, setBarWidth] = useState(0);

  const accent = accentForCategory(row.categoryId);
  const name = categoryName(row.category, language, `#${row.categoryId}`);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    setBarWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev));
  }, []);

  return (
    <View
      // Grouped so a screen reader announces the field, its session count and
      // its score as one item instead of three disconnected fragments.
      accessible
      accessibilityLabel={[
        name,
        sessionCountLabel(row.sessions, t),
        row.average === null ? t('stats.noScoreYet') : row.average.toFixed(1),
      ].join(' — ')}
      style={{
        padding: theme.spacing.lg,
        gap: theme.spacing.sm,
        borderBottomWidth: last ? 0 : theme.layout.hairline,
        borderBottomColor: theme.colors.divider,
      }}
    >
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <View
          style={[
            styles.iconWrap,
            {
              width: theme.layout.avatar.md,
              height: theme.layout.avatar.md,
              borderRadius: theme.radii.md,
              backgroundColor: accent.bg,
            },
          ]}
        >
          <Ionicons
            name={categoryIcon(row.category?.icon)}
            size={theme.layout.icon.md}
            color={accent.fg}
          />
        </View>

        <View style={styles.grow}>
          <Text role="body" weight="bold" numberOfLines={1}>{name}</Text>
          <Text role="caption" tone="muted" numberOfLines={1}>
            {sessionCountLabel(row.sessions, t)}
          </Text>
        </View>

        {row.average === null ? (
          <Badge tone="neutral" label={t('stats.noScoreYet')} />
        ) : (
          <Badge tone={scoreTone(row.average)} size="md" label={row.average.toFixed(1)} />
        )}
      </View>

      {row.average !== null ? (
        <View onLayout={onLayout}>
          {barWidth > 0 ? <ScoreBar score={row.average} width={barWidth} /> : null}
        </View>
      ) : null}
    </View>
  );
});

/* ------------------------------------------------------------------ *
 * Progress-over-time bars
 * ------------------------------------------------------------------ */

function TrendChart({ points }: { points: { score: number; date: string | null }[] }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { isRTL } = useDirection();

  // Chronological left-to-right in LTR, right-to-left in RTL, so "later" always
  // means "further along the reading direction".
  const ordered = isRTL ? [...points].reverse() : points;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View
        style={[
          styles.chart,
          { height: theme.spacing['7xl'], gap: theme.spacing.xs },
        ]}
      >
        {ordered.map((p, i) => {
          const pct = Math.max(MIN_BAR_PERCENT, Math.round((p.score / 10) * 100));
          return (
            <View key={`${p.date ?? i}-${i}`} style={styles.chartCol}>
              {/* Height is static (percentage heights do not animate reliably
                  on Reanimated's web renderer); the entrance is a fade+rise. */}
              <MotiView
                from={{ opacity: 0, translateY: theme.spacing.sm }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{
                  type: 'timing',
                  duration: theme.motion.duration.normal,
                  delay: i * theme.motion.stagger,
                }}
                accessibilityRole="image"
                accessibilityLabel={t('stats.sessionScore', {
                  date: relativeTime(p.date, t),
                  score: p.score.toFixed(1),
                })}
                style={{
                  width: '100%',
                  height: `${pct}%`,
                  borderRadius: theme.radii.xs,
                  backgroundColor: scoreColor(p.score, theme),
                }}
              />
            </View>
          );
        })}
      </View>

      <View style={styles.axis}>
        <Text role="micro" tone="muted">{isRTL ? t('stats.newest') : t('stats.oldest')}</Text>
        <Text role="micro" tone="muted">{isRTL ? t('stats.oldest') : t('stats.newest')}</Text>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function StatsScreen() {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [categories, setCategories] = useState<(CategoryLike & { id: number })[]>([]);
  const [sessions, setSessions] = useState<SessionLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const firstFocus = useRef(true);

  const load = useCallback(async () => {
    setFailed(false);
    // `/user/stats` returns categoryBreakdown keyed by id only — the category
    // names live on `/categories`, so the join happens here. Without it this
    // screen rendered "قسم #5" as a heading, which is what it used to do.
    const [statsRes, catsRes, sessionsRes] = await Promise.allSettled([
      api.get('/user/stats'),
      api.get('/categories'),
      api.get('/sessions', { params: { limit: TREND_LIMIT } }),
    ]);

    if (statsRes.status === 'fulfilled') setStats(statsRes.value.data);
    else setFailed(true);

    if (catsRes.status === 'fulfilled') setCategories(catsRes.value.data.categories ?? []);
    if (sessionsRes.status === 'fulfilled') setSessions(sessionsRes.value.data.sessions ?? []);

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) { firstFocus.current = false; return; }
      load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const categoryById = useMemo(() => {
    const map = new Map<number, CategoryLike & { id: number }>();
    for (const c of categories) map.set(Number(c.id), c);
    return map;
  }, [categories]);

  /**
   * Per-answer averages, derived from the sessions we already have.
   *
   * `categoryBreakdown._avg.totalScore` is the mean of each session's *summed*
   * score, so a category practised in long sessions scores 40 while the same
   * performance in short ones scores 14 — it is not on the 0–10 scale a
   * ScoreBar expects. Recomputing from totalScore ÷ answers gives a real
   * rating. See the API-gap note in the report.
   */
  const averageByCategory = useMemo(() => {
    const totals = new Map<number, { score: number; answers: number }>();
    for (const s of sessions) {
      const id = Number(s.category?.id ?? s.categoryId ?? NaN);
      const answers = answerCount(s);
      if (!Number.isFinite(id) || answers === 0) continue;
      const bucket = totals.get(id) ?? { score: 0, answers: 0 };
      bucket.score += Number(s.totalScore ?? 0);
      bucket.answers += answers;
      totals.set(id, bucket);
    }
    const out = new Map<number, number>();
    totals.forEach((v, id) => {
      out.set(id, Math.max(0, Math.min(10, v.score / v.answers)));
    });
    return out;
  }, [sessions]);

  const breakdown: BreakdownRow[] = useMemo(() => {
    const rows = (stats?.categoryBreakdown ?? []).map((b) => {
      const id = Number(b.categoryId);
      return {
        categoryId: id,
        category: categoryById.get(id) ?? null,
        sessions: Number(b._count?._all ?? 0),
        average: averageByCategory.has(id) ? (averageByCategory.get(id) as number) : null,
      };
    });
    // Strongest first — the ranking is the point of the section.
    return rows.sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
  }, [stats, categoryById, averageByCategory]);

  const trend = useMemo(() => {
    return sessions
      .filter((s) => answerCount(s) > 0)
      .slice(0, TREND_POINTS)
      .reverse()
      .map((s) => ({ score: sessionAverage(s), date: s.startedAt ?? null }));
  }, [sessions]);

  const average = Math.max(0, Math.min(10, Number(stats?.averageScore ?? 0)));
  const strongest = breakdown.find((r) => r.average !== null && r.average > 0) ?? null;

  const goHome = useCallback(() => navigation.navigate('Home'), [navigation]);

  /* ----------------------------- loading ---------------------------- */

  if (loading) {
    return (
      <Screen scroll wide contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing['2xl'] }}>
        <View style={{ gap: theme.spacing.sm }}>
          <Skeleton width="45%" height={theme.typography.scale.h2.fontSize} />
          <Skeleton width="70%" height={theme.typography.scale.bodySm.fontSize} />
        </View>
        <SkeletonCard lines={3} height={theme.spacing['7xl'] * 2} />
        <SkeletonCard lines={2} height={theme.spacing['7xl'] + theme.spacing['5xl']} />
        <SkeletonCard lines={4} height={theme.spacing['7xl'] * 2 + theme.spacing['3xl']} />
      </Screen>
    );
  }

  /* ------------------------------ error ----------------------------- */

  if (failed && !stats) {
    return (
      <Screen scroll refreshing={refreshing} onRefresh={onRefresh}>
        <EmptyState
          tone="danger"
          icon="cloud-offline-outline"
          title={t('common.loadErrorTitle')}
          description={t('common.loadErrorBody')}
          actionLabel={t('common.retry')}
          onAction={onRefresh}
        />
      </Screen>
    );
  }

  /* ------------------------------ empty ----------------------------- */

  if (!stats || stats.totalSessions === 0) {
    return (
      <Screen scroll refreshing={refreshing} onRefresh={onRefresh} contentStyle={{ paddingTop: theme.spacing.lg }}>
        <Text role="h2" weight="bold">{t('stats.title')}</Text>
        <EmptyState
          icon="stats-chart-outline"
          title={t('stats.emptyTitle')}
          description={t('stats.emptyBody')}
          actionLabel={t('stats.emptyAction')}
          onAction={goHome}
        />
      </Screen>
    );
  }

  /* ------------------------------ render ---------------------------- */

  return (
    <Screen
      scroll
      wide
      refreshing={refreshing}
      onRefresh={onRefresh}
      contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing['2xl'] }}
    >
      <View>
        <Text role="h2" weight="bold">{t('stats.title')}</Text>
        <Text role="bodySm" tone="muted" style={{ marginTop: theme.spacing.xxs }}>
          {t('stats.subtitle')}
        </Text>
      </View>

      {/* Overall score — the one dominant element on the screen. */}
      <MotiView
        from={{ opacity: 0, translateY: theme.spacing.md }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: theme.motion.duration.slow }}
      >
        <Card padding="lg">
          <View style={[styles.row, { gap: theme.spacing.xl }]}>
            <ScoreRing
              score={average}
              size={theme.layout.avatar.xl}
              label={t('stats.outOfTen')}
            />

            {/* The ring owns the score; this column deliberately never repeats
                the number, so the eye lands on exactly one figure. */}
            <View style={[styles.grow, { gap: theme.spacing.lg }]}>
              <Text role="h4" weight="bold">{t('stats.averageScore')}</Text>

              <View style={[styles.row, { gap: theme.spacing.xl }]}>
                <View>
                  <Text role="caption" tone="muted">{t('stats.totalSessions')}</Text>
                  <Text role="h3" weight="bold">{stats.totalSessions}</Text>
                </View>
                <View>
                  <Text role="caption" tone="muted">{t('stats.totalAnswers')}</Text>
                  <Text role="h3" weight="bold">{stats.totalAnswers}</Text>
                </View>
              </View>
            </View>
          </View>

          {strongest ? (
            <View
              style={{
                marginTop: theme.spacing.lg,
                paddingTop: theme.spacing.md,
                borderTopWidth: theme.layout.hairline,
                borderTopColor: theme.colors.divider,
              }}
            >
              <View style={[styles.row, { gap: theme.spacing.sm }]}>
                <Ionicons name="trophy" size={theme.layout.icon.sm} color={theme.colors.accent} />
                <Text role="caption" tone="muted" flex numberOfLines={1}>
                  {t('stats.strongest')}
                </Text>
                <Text role="caption" weight="bold" numberOfLines={1}>
                  {categoryName(strongest.category, i18n.language, `#${strongest.categoryId}`)}
                </Text>
              </View>
            </View>
          ) : null}
        </Card>
      </MotiView>

      {/* Progress over time */}
      {trend.length >= 2 ? (
        <View>
          <SectionHeader title={t('stats.progress')} subtitle={t('stats.progressSubtitle')} />
          <Card padding="lg">
            <TrendChart points={trend} />
          </Card>
        </View>
      ) : null}

      {/* Per-category breakdown */}
      <View>
        <SectionHeader title={t('stats.breakdown')} subtitle={t('stats.breakdownSubtitle')} />
        {breakdown.length === 0 ? (
          <Card padding="none">
            <EmptyState
              compact
              icon="pie-chart-outline"
              title={t('stats.emptyTitle')}
              description={t('stats.emptyBody')}
              actionLabel={t('stats.emptyAction')}
              onAction={goHome}
            />
          </Card>
        ) : (
          <Card padding="none">
            {breakdown.map((row, i) => (
              <CategoryStatRow
                key={row.categoryId}
                row={row}
                language={i18n.language}
                last={i === breakdown.length - 1}
              />
            ))}
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  chart: { flexDirection: 'row', alignItems: 'flex-end' },
  chartCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
});
