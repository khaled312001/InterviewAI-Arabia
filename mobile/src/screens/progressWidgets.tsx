/**
 * Progress pieces shared by Home, Stats and Profile.
 *
 * All three read the same `activity` block from the progress store, so the
 * streak on Home can never disagree with the streak on Stats. Every number
 * here comes from the server — nothing is counted on the device.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { MotiView } from 'moti';

import { useAppTheme } from '../theme/useTheme';
import { Card, Text } from '../components';
import { WEEKLY_GOAL_DAYS, type Activity, type StatsResponse } from '../store/progress';
import { dayCountLabel, sessionCountLabel } from './mainShared';

/** Weekday indexes (0 = Sunday) of the last seven days, oldest first, today last. */
export function lastSevenWeekdays(now = new Date()): number[] {
  const today = now.getDay();
  return [6, 5, 4, 3, 2, 1, 0].map((back) => (today - back + 7) % 7);
}

function useWeekdayNames() {
  const { t } = useTranslation();
  const short = t('home.weekdaysShort', { returnObjects: true }) as unknown;
  const long = t('home.weekdays', { returnObjects: true }) as unknown;
  return {
    short: Array.isArray(short) ? (short as string[]) : [],
    long: Array.isArray(long) ? (long as string[]) : [],
  };
}

/* ------------------------------------------------------------------ *
 * Seven days as dots
 *
 * Laid out oldest → today along the READING direction: the row flips with
 * the root `direction`, so in Arabic today sits at the left end, where a
 * right-to-left reader's eye finishes.
 * ------------------------------------------------------------------ */

export function WeekDots({ days }: { days: number[] }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const names = useWeekdayNames();
  const weekdays = lastSevenWeekdays();
  const size = theme.layout.touchTarget - theme.spacing.md;

  return (
    <View style={[styles.row, { justifyContent: 'space-between' }]}>
      {days.map((n, i) => {
        const active = n > 0;
        const today = i === days.length - 1;
        const dayName = names.long[weekdays[i]] ?? '';
        return (
          <View
            key={i}
            style={[styles.dayCol, { gap: theme.spacing.xs }]}
            accessible
            accessibilityLabel={t(active ? 'home.dayActive' : 'home.dayIdle', { day: dayName })}
          >
            <MotiView
              from={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'timing', duration: theme.motion.duration.normal, delay: i * theme.motion.stagger }}
              style={[
                styles.dot,
                {
                  width: size,
                  height: size,
                  borderRadius: theme.radii.pill,
                  backgroundColor: active ? theme.colors.primary : theme.colors.surfaceSunken,
                  borderWidth: today ? 2 : 0,
                  borderColor: active ? theme.colors.primaryBorder : theme.colors.primary,
                },
              ]}
            >
              {active ? (
                <Ionicons name="checkmark" size={theme.layout.icon.sm} color={theme.colors.textOnBrand} />
              ) : null}
            </MotiView>
            <Text
              role="micro"
              weight={today ? 'bold' : 'regular'}
              tone={today ? 'primary' : 'muted'}
              align="center"
            >
              {names.short[weekdays[i]] ?? ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Home: streak + weekly goal
 * ------------------------------------------------------------------ */

export function StreakCard({ activity, onPress }: { activity: Activity; onPress?: () => void }) {
  const theme = useAppTheme();
  const { t } = useTranslation();

  const streak = activity.streakDays;
  const hint = activity.practicedToday
    ? t('home.streakDoneToday')
    : streak > 0 ? t('home.streakKeepAlive') : t('home.streakStart');
  const goalDone = activity.activeDaysThisWeek >= WEEKLY_GOAL_DAYS;
  const goalRatio = Math.min(1, activity.activeDaysThisWeek / WEEKLY_GOAL_DAYS);

  return (
    <Card
      padding="md"
      onPress={onPress}
      accessibilityLabel={`${t('home.streakTitle')}: ${streak > 0 ? dayCountLabel(streak, t) : t('home.streakNone')}`}
      accessibilityHint={hint}
    >
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <View
          style={[
            styles.center,
            {
              width: theme.layout.avatar.md,
              height: theme.layout.avatar.md,
              borderRadius: theme.radii.md,
              backgroundColor: streak > 0 ? theme.colors.accentMuted : theme.colors.surfaceSunken,
            },
          ]}
        >
          <Ionicons
            name={streak > 0 ? 'flame' : 'flame-outline'}
            size={theme.layout.icon.lg}
            color={streak > 0 ? theme.colors.accent : theme.colors.textMuted}
          />
        </View>

        {/* The best run sits UNDER the value, not beside it: beside it, the
            zero-streak headline «ابدأ سلسلتك اليوم» was cut to «ابدأ سلسلتك الي..». */}
        <View style={styles.grow}>
          <Text role="caption" tone="muted">{t('home.streakTitle')}</Text>
          <Text role="h3" weight="bold" numberOfLines={2}>
            {streak > 0 ? dayCountLabel(streak, t) : t('home.streakNone')}
          </Text>
          {activity.bestStreakDays > streak ? (
            <Text role="caption" tone="secondary" numberOfLines={1}>
              {t('home.bestStreak', { label: dayCountLabel(activity.bestStreakDays, t) })}
            </Text>
          ) : null}
        </View>
      </View>

      <Text role="bodySm" tone="secondary" style={{ marginTop: theme.spacing.sm }}>
        {hint}
      </Text>

      <View
        style={{
          marginTop: theme.spacing.md,
          paddingTop: theme.spacing.md,
          borderTopWidth: theme.layout.hairline,
          borderTopColor: theme.colors.divider,
          gap: theme.spacing.md,
        }}
      >
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <Ionicons
            name={goalDone ? 'trophy' : 'flag-outline'}
            size={theme.layout.icon.sm}
            color={goalDone ? theme.colors.accent : theme.colors.primary}
          />
          <Text role="caption" weight="bold" flex numberOfLines={1}>{t('home.weekGoal')}</Text>
          <Text role="caption" tone={goalDone ? 'success' : 'muted'} numberOfLines={1}>
            {goalDone
              ? t('home.weekGoalDone')
              : t('home.weekGoalProgress', { done: activity.activeDaysThisWeek, goal: WEEKLY_GOAL_DAYS })}
          </Text>
        </View>

        {/* Goal bar: the dots say which days, the bar says how far. */}
        <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }}>
          <View
            style={{
              width: `${Math.round(goalRatio * 100)}%`,
              height: '100%',
              borderRadius: 3,
              backgroundColor: goalDone ? theme.colors.success : theme.colors.primary,
            }}
          />
        </View>

        <WeekDots days={activity.lastSevenDays} />
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Stats: sessions per day, with the count on each bar
 * ------------------------------------------------------------------ */

export function WeekBars({ days }: { days: number[] }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const names = useWeekdayNames();
  const weekdays = lastSevenWeekdays();
  const max = Math.max(1, ...days);
  const chartHeight = theme.spacing['6xl'];

  return (
    <View style={[styles.row, { alignItems: 'flex-end', gap: theme.spacing.sm }]}>
      {days.map((n, i) => {
        const today = i === days.length - 1;
        const pct = n > 0 ? Math.max(12, Math.round((n / max) * 100)) : 4;
        return (
          <View
            key={i}
            style={[styles.dayCol, { gap: theme.spacing.xs }]}
            accessible
            accessibilityLabel={`${names.long[weekdays[i]] ?? ''}: ${sessionCountLabel(n, t)}`}
          >
            <Text role="micro" weight="bold" tone={n > 0 ? 'default' : 'disabled'} align="center">
              {n}
            </Text>
            <View style={{ height: chartHeight, width: '100%', justifyContent: 'flex-end' }}>
              <MotiView
                from={{ opacity: 0, translateY: theme.spacing.sm }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'timing', duration: theme.motion.duration.normal, delay: i * theme.motion.stagger }}
                style={{
                  height: `${pct}%`,
                  width: '100%',
                  borderRadius: theme.radii.xs,
                  backgroundColor: n > 0
                    ? (today ? theme.colors.accent : theme.colors.primary)
                    : theme.colors.surfaceSunken,
                }}
              />
            </View>
            <Text role="micro" tone={today ? 'primary' : 'muted'} weight={today ? 'bold' : 'regular'} align="center">
              {names.short[weekdays[i]] ?? ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Stats: the three activity figures
 * ------------------------------------------------------------------ */

export function ActivityFigures({ activity }: { activity: Activity }) {
  const theme = useAppTheme();
  const { t } = useTranslation();

  const figures = [
    { icon: 'flame' as const, color: theme.colors.accent, label: t('stats.currentStreak'), value: dayCountLabel(activity.streakDays, t) },
    { icon: 'ribbon' as const, color: theme.colors.primary, label: t('stats.bestStreak'), value: dayCountLabel(activity.bestStreakDays, t) },
    { icon: 'calendar' as const, color: theme.colors.success, label: t('stats.thisWeek'), value: sessionCountLabel(activity.sessionsThisWeek, t) },
  ];

  return (
    <View style={[styles.row, { gap: theme.spacing.sm, alignItems: 'stretch' }]}>
      {figures.map((f) => (
        <View
          key={f.label}
          accessible
          accessibilityLabel={`${f.label}: ${f.value}`}
          style={[
            styles.figure,
            {
              padding: theme.spacing.md,
              borderRadius: theme.radii.md,
              backgroundColor: theme.colors.surfaceAlt,
              gap: theme.spacing.xs,
            },
          ]}
        >
          <Ionicons name={f.icon} size={theme.layout.icon.md} color={f.color} />
          <Text role="bodySm" weight="bold" numberOfLines={1} adjustsFontSizeToFit>{f.value}</Text>
          <Text role="micro" tone="muted" numberOfLines={2}>{f.label}</Text>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Profile: sessions · average · streak
 * ------------------------------------------------------------------ */

export function ProgressSummary({ stats, onPress }: { stats: StatsResponse; onPress?: () => void }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const average = Math.max(0, Math.min(10, Number(stats.averageScore ?? 0)));
  const streak = stats.activity?.streakDays ?? 0;

  const tiles = [
    { label: t('profile.statSessions'), value: String(stats.totalSessions ?? 0) },
    { label: t('profile.statAverage'), value: stats.totalAnswers > 0 ? average.toFixed(1) : '—' },
    { label: t('profile.statStreak'), value: String(streak) },
  ];

  return (
    <Card padding="md" onPress={onPress} accessibilityLabel={t('profile.viewStats')}>
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        {tiles.map((tile, i) => (
          <View
            key={tile.label}
            style={[
              styles.grow,
              styles.center,
              {
                paddingVertical: theme.spacing.xs,
                borderStartWidth: i === 0 ? 0 : theme.layout.hairline,
                borderStartColor: theme.colors.divider,
              },
            ]}
          >
            <Text role="h3" weight="bold">{tile.value}</Text>
            <Text role="caption" tone="muted" numberOfLines={1}>{tile.label}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  dayCol: { flex: 1, alignItems: 'center' },
  dot: { alignItems: 'center', justifyContent: 'center' },
  figure: { flex: 1 },
});
