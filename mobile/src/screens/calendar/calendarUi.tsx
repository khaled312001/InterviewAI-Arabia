/**
 * Pieces the calendar screens share: the entrance animation, the date strip,
 * the time picker, the success mark and opening a join link.
 *
 * No native date picker is installed, so the pickers here are built from the
 * app's own controls. That is also what makes them behave identically on web,
 * Android and iOS, in both directions.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Linking, Platform } from 'react-native';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAppTheme } from '../../theme/useTheme';
import { Text } from '../../components';
import { formatDayShort, formatTime, sameDay } from './calendarApi';

/* ------------------------------------------------------------ fade in */

/** Fade + short rise, staggered by index. Reduced motion collapses it to one frame. */
export function FadeIn({ index = 0, children, style }: { index?: number; children: React.ReactNode; style?: any }) {
  const theme = useAppTheme();
  return (
    <MotiView
      style={style}
      from={{ opacity: 0, translateY: theme.motion.reduced ? 0 : theme.spacing.md }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{
        type: 'timing',
        duration: theme.motion.duration.slow,
        delay: Math.min(index, 8) * theme.motion.stagger,
      }}
    >
      {children}
    </MotiView>
  );
}

/* ---------------------------------------------------------- icon bubble */

export function IconBubble({
  name, tone = 'primary', size = 44,
}: { name: keyof typeof Ionicons.glyphMap; tone?: 'primary' | 'accent' | 'success' | 'danger' | 'neutral'; size?: number }) {
  const theme = useAppTheme();
  const bg = {
    primary: theme.colors.primaryMuted,
    accent: theme.colors.accentMuted,
    success: theme.colors.successMuted,
    danger: theme.colors.dangerMuted,
    neutral: theme.colors.surfaceSunken,
  }[tone];
  const fg = {
    primary: theme.colors.primary,
    accent: theme.colors.accentText,
    success: theme.colors.success,
    danger: theme.colors.danger,
    neutral: theme.colors.textSecondary,
  }[tone];
  return (
    <View style={[styles.center, { width: size, height: size, borderRadius: theme.radii.md, backgroundColor: bg }]}>
      <Ionicons name={name} size={Math.round(size * 0.5)} color={fg} />
    </View>
  );
}

/* ---------------------------------------------------------- date strip */

/**
 * The next `days` days as a horizontal strip of tappable tiles. `allowNone`
 * puts a "No date" tile first (for tasks, where a date is optional).
 */
export function DateStrip({
  value, onChange, days = 30, allowNone = false, noneLabel,
}: {
  value: Date | null;
  onChange: (d: Date | null) => void;
  days?: number;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const list = useMemo(() => {
    const now = new Date();
    return Array.from({ length: days }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
  }, [days]);

  const tile = (key: string, active: boolean, onPress: () => void, top: string, mid: string, bottom: string, label: string) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.dateTile,
        {
          width: 64,
          paddingVertical: theme.spacing.sm,
          borderRadius: theme.radii.md,
          borderWidth: 1,
          borderColor: active ? theme.colors.primary : theme.colors.border,
          backgroundColor: active ? theme.colors.primary : theme.colors.surface,
          transform: [{ scale: pressed ? 0.95 : 1 }],
        },
      ]}
    >
      <Text role="micro" tone={active ? 'onBrand' : 'muted'} numberOfLines={1}>{top}</Text>
      <Text role="h4" weight="bold" tone={active ? 'onBrand' : 'default'} numberOfLines={1}>{mid}</Text>
      <Text role="micro" tone={active ? 'onBrand' : 'secondary'} numberOfLines={1}>{bottom}</Text>
    </Pressable>
  );

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.xxs }}>
      {allowNone
        ? tile('none', value === null, () => onChange(null), '', '—', noneLabel || '', noneLabel || '')
        : null}
      {list.map((d, i) => {
        const f = formatDayShort(d, i18n.language);
        const top = i === 0 ? t('calendar.today') : i === 1 ? t('calendar.tomorrow') : f.weekday;
        return tile(
          d.toDateString(),
          value ? sameDay(value, d) : false,
          () => onChange(d),
          top,
          f.day,
          f.month,
          `${top} ${f.day} ${f.month}`,
        );
      })}
    </ScrollView>
  );
}

/* ---------------------------------------------------------- time picker */

const QUICK_TIMES: Array<[number, number]> = [[9, 0], [10, 0], [11, 0], [12, 0], [13, 0], [14, 0], [15, 0], [16, 0], [17, 0]];

function Stepper({ label, onMinus, onPlus, minusLabel, plusLabel }: {
  label: string; onMinus: () => void; onPlus: () => void; minusLabel: string; plusLabel: string;
}) {
  const theme = useAppTheme();
  const btn = (icon: keyof typeof Ionicons.glyphMap, onPress: () => void, a11y: string) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={6}
      style={({ pressed }) => [
        styles.center,
        {
          width: 40, height: 40, borderRadius: theme.radii.pill,
          backgroundColor: pressed ? theme.colors.primaryBorder : theme.colors.primaryMuted,
          transform: [{ scale: pressed ? 0.92 : 1 }],
        },
      ]}
    >
      <Ionicons name={icon} size={20} color={theme.colors.primary} />
    </Pressable>
  );
  return (
    <View style={[styles.center, { gap: theme.spacing.xs }]}>
      {btn('chevron-up', onPlus, plusLabel)}
      <Text role="micro" tone="muted">{label}</Text>
      {btn('chevron-down', onMinus, minusLabel)}
    </View>
  );
}

/** Hour and minute (5-minute steps) with a big readout and quick picks. */
export function TimePicker({ hour, minute, onChange }: { hour: number; minute: number; onChange: (h: number, m: number) => void }) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const at = new Date(2000, 0, 1, hour, minute);
  const stepMinute = (delta: number) => {
    const total = (hour * 60 + minute + delta + 1440) % 1440;
    onChange(Math.floor(total / 60), total % 60);
  };

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={[styles.row, { justifyContent: 'center', gap: theme.spacing['2xl'] }]}>
        <Stepper
          label={t('calendar.schedule.hour')}
          onPlus={() => onChange((hour + 1) % 24, minute)}
          onMinus={() => onChange((hour + 23) % 24, minute)}
          plusLabel={`${t('calendar.schedule.hour')} ${t('calendar.schedule.later')}`}
          minusLabel={`${t('calendar.schedule.hour')} ${t('calendar.schedule.earlier')}`}
        />
        <MotiView
          key={`${hour}:${minute}`}
          from={{ opacity: theme.motion.reduced ? 1 : 0.4, scale: theme.motion.reduced ? 1 : 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'timing', duration: theme.motion.duration.fast }}
          style={[styles.center, {
            minWidth: 132,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.sm,
            borderRadius: theme.radii.lg,
            backgroundColor: theme.colors.surfaceSunken,
          }]}
        >
          <Text role="h1" weight="bold" accessibilityLiveRegion="polite">{formatTime(at, i18n.language)}</Text>
        </MotiView>
        <Stepper
          label={t('calendar.schedule.minute')}
          onPlus={() => stepMinute(5)}
          onMinus={() => stepMinute(-5)}
          plusLabel={`${t('calendar.schedule.minute')} ${t('calendar.schedule.later')}`}
          minusLabel={`${t('calendar.schedule.minute')} ${t('calendar.schedule.earlier')}`}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.xs }}>
        {QUICK_TIMES.map(([h, m]) => {
          const active = h === hour && m === minute;
          return (
            <Pressable
              key={`${h}:${m}`}
              onPress={() => onChange(h, m)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.center,
                {
                  minHeight: 36,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radii.pill,
                  borderWidth: theme.layout.hairline,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  backgroundColor: active ? theme.colors.primary : theme.colors.surface,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Text role="caption" weight="bold" tone={active ? 'onBrand' : 'secondary'}>
                {formatTime(new Date(2000, 0, 1, h, m), i18n.language)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/* ---------------------------------------------------------- success mark */

export function SuccessMark({ icon = 'checkmark' }: { icon?: keyof typeof Ionicons.glyphMap }) {
  const theme = useAppTheme();
  return (
    <MotiView
      from={{ opacity: 0, scale: theme.motion.reduced ? 1 : 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={theme.motion.reduced
        ? { type: 'timing', duration: theme.motion.duration.fast }
        : { type: 'spring', ...theme.motion.easing.spring }}
      style={[styles.center, {
        width: 76, height: 76, borderRadius: 38,
        backgroundColor: theme.colors.successMuted,
        alignSelf: 'center',
      }]}
    >
      <Ionicons name={icon} size={40} color={theme.colors.success} />
    </MotiView>
  );
}

/* ---------------------------------------------------------- pulse dot */

/** A small "live" dot for an event that is happening now. */
export function PulseDot({ color }: { color: string }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.center, { width: 12, height: 12 }]}>
      {theme.motion.reduced ? null : (
        <MotiView
          from={{ opacity: 0.6, scale: 1 }}
          animate={{ opacity: 0, scale: 2.2 }}
          transition={{ type: 'timing', duration: 1400, loop: true, repeatReverse: false }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: 6, backgroundColor: color }]}
        />
      )}
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

/* ------------------------------------------------------------ join link */

/**
 * Open a meeting link. On a phone, Linking hands it to the Meet / Zoom /
 * Teams app when one is installed — an in-app browser would not.
 */
export async function openJoinLink(url: string): Promise<void> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  await Linking.openURL(url);
}

/** Re-run `fn` every `ms` while mounted — for "starts in N min" labels. */
export function useTicker(ms: number): number {
  const [tick, setTick] = React.useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    ref.current = setInterval(() => setTick((n) => n + 1), ms);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [ms]);
  return tick;
}

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  grow: { flex: 1, minWidth: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
  dateTile: { alignItems: 'center', justifyContent: 'center' },
});
