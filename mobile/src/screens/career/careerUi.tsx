/**
 * Pieces every career screen shares: the filter chip, the job row, the ATS
 * report, error wording and a cross-platform confirm.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, Pressable, Alert, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useAppTheme } from '../../theme/useTheme';
import { Text, Card, Badge } from '../../components';
import { relativeTime } from '../mainShared';
import {
  type JobCard, type AtsReport, type CareerErrorKind,
  countryName, salaryLabel, percentTone, errorKind,
} from './careerApi';

/* ------------------------------------------------------------- chip */

export const Chip = React.memo(function Chip({
  label, active, onPress, icon,
}: { label: string; active: boolean; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  const theme = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        {
          minHeight: theme.layout.control.sm,
          paddingHorizontal: theme.spacing.lg,
          borderRadius: theme.radii.pill,
          borderWidth: theme.layout.hairline,
          borderColor: active ? theme.colors.primary : theme.colors.border,
          backgroundColor: active ? theme.colors.primary : theme.colors.surface,
          opacity: pressed ? 0.75 : 1,
          gap: theme.spacing.xs,
        },
      ]}
    >
      {icon ? <Ionicons name={icon} size={16} color={active ? theme.colors.textOnBrand : theme.colors.textSecondary} /> : null}
      <Text role="bodySm" weight="bold" tone={active ? 'onBrand' : 'secondary'} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
});

/* ---------------------------------------------------------- job row */

export const JobRow = React.memo(function JobRow({ job, onPress }: { job: JobCard; onPress: (job: JobCard) => void }) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const press = useCallback(() => onPress(job), [onPress, job]);
  const place = [job.city, countryName(job.country, i18n.language)].filter(Boolean).join(i18n.language === 'ar' ? '، ' : ', ')
    || (job.workplace === 'remote' ? t('career.anywhere') : job.location || '');
  const pay = salaryLabel(job.salary);

  return (
    <Card onPress={press} padding="md" accessibilityLabel={`${job.title} — ${job.company}`}>
      <View style={[styles.row, { gap: theme.spacing.md, alignItems: 'flex-start' }]}>
        <View
          style={[styles.logo, {
            width: theme.layout.avatar.md, height: theme.layout.avatar.md,
            borderRadius: theme.radii.md, backgroundColor: theme.colors.primaryMuted,
          }]}
        >
          <Text role="h4" weight="bold" tone="primary">{(job.company || '?').trim().charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.grow}>
          <View style={[styles.row, { gap: theme.spacing.sm, alignItems: 'flex-start' }]}>
            <Text role="body" weight="bold" numberOfLines={2} flex>{job.title}</Text>
            {job.match ? <Badge tone={percentTone(job.match.score)} size="md" label={t('career.matchLabel', { score: job.match.score })} /> : null}
          </View>
          <Text role="bodySm" tone="secondary" numberOfLines={1}>{job.company}{place ? ` · ${place}` : ''}</Text>
          <View style={[styles.wrap, { gap: theme.spacing.xs, marginTop: theme.spacing.xs }]}>
            {job.live ? <Badge tone="danger" icon="radio-outline" label={t('career.live.badge')} /> : null}
            {job.workplace ? <Badge tone={job.workplace === 'remote' ? 'success' : 'neutral'} label={t(`career.workplace.${job.workplace}`)} /> : null}
            {job.seniority ? <Badge label={t(`career.level.${job.seniority}`)} /> : null}
            {pay ? <Badge tone="accent" label={pay} /> : null}
            {job.tracked ? <Badge tone="primary" icon="bookmark" label={t(`career.apps.status.${job.tracked}`)} /> : null}
          </View>
          {job.match && job.match.missing.length ? (
            <Text role="caption" tone="muted" numberOfLines={1} style={{ marginTop: theme.spacing.xs }}>
              {t('career.missing', { skills: job.match.missing.join('، ') })}
            </Text>
          ) : null}
          <Text role="micro" tone="muted" style={{ marginTop: theme.spacing.xxs }}>
            {[relativeTime(job.postedAt, t), job.sourceName].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
    </Card>
  );
});

/* ------------------------------------------------------- ATS report */

export function AtsReportView({ report }: { report: AtsReport }) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const ar = i18n.language === 'ar';
  const order = { high: 0, medium: 1, low: 2 } as const;
  const checks = [...report.checks].sort((a, b) => Number(a.ok) - Number(b.ok) || order[a.severity] - order[b.severity]);
  const tone = percentTone(report.score);

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Card padding="lg">
        <View style={[styles.row, { gap: theme.spacing.lg }]}>
          <View style={[styles.scoreBox, {
            width: 76, height: 76, borderRadius: 38,
            backgroundColor: theme.colors[`${tone}Muted` as const],
          }]}
          >
            <Text role="h2" weight="bold" tone={tone}>{report.score}</Text>
          </View>
          <View style={styles.grow}>
            <Text role="caption" tone="muted">{t('career.ats.title')}</Text>
            <Text role="h4" weight="bold">{t(`career.ats.grade.${report.grade}`)}</Text>
          </View>
        </View>
      </Card>

      {report.keywords ? (
        <Card padding="lg">
          <Text role="body" weight="bold">{`${t('career.ats.keywords')} — ${report.keywords.coverage}%`}</Text>
          {report.keywords.missing.length || report.keywords.termsMissing.length ? (
            <>
              <Text role="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>{t('career.ats.missingKw')}</Text>
              <View style={[styles.wrap, { gap: theme.spacing.xs, marginTop: theme.spacing.xs }]}>
                {report.keywords.missing.map((s) => <Badge key={s.key} tone="danger" label={s.label} />)}
                {report.keywords.termsMissing.map((s) => <Badge key={s} tone="danger" label={s} />)}
              </View>
            </>
          ) : null}
          {report.keywords.matched.length ? (
            <>
              <Text role="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>{t('career.ats.foundKw')}</Text>
              <View style={[styles.wrap, { gap: theme.spacing.xs, marginTop: theme.spacing.xs }]}>
                {report.keywords.matched.map((s) => <Badge key={s.key} tone="success" label={s.label} />)}
              </View>
            </>
          ) : null}
        </Card>
      ) : null}

      <Card padding="lg">
        <Text role="body" weight="bold" style={{ marginBottom: theme.spacing.sm }}>{t('career.ats.checks')}</Text>
        {checks.map((c) => (
          <View key={c.id} style={[styles.row, { gap: theme.spacing.sm, alignItems: 'flex-start', paddingVertical: theme.spacing.xs }]}>
            <Ionicons
              name={c.ok ? 'checkmark-circle' : c.severity === 'high' ? 'close-circle' : 'alert-circle'}
              size={20}
              color={c.ok ? theme.colors.success : c.severity === 'high' ? theme.colors.danger : theme.colors.warning}
            />
            <View style={styles.grow}>
              <Text role="bodySm">{ar ? c.message.ar : c.message.en}</Text>
              {!c.ok && c.tip ? <Text role="caption" tone="muted">{ar ? c.tip.ar : c.tip.en}</Text> : null}
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

/* ------------------------------------------------------------ errors */

/**
 * The line to show for a failed career call, and whether it was the balance —
 * in which case the screen offers the way to top up instead of "try again".
 */
export function useCareerError() {
  const { t } = useTranslation();
  return useCallback((e: unknown): { kind: CareerErrorKind; message: string } => {
    const kind = errorKind(e);
    return { kind, message: t(`career.errors.${kind}`) };
  }, [t]);
}

/** Native Alert or the browser's confirm — RN-web's Alert has no buttons. */
export function confirmAsk(message: string, confirmLabel: string, cancelLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' ? window.confirm(message) : false);
  }
  return new Promise((resolve) => {
    Alert.alert('', message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  grow: { flex: 1, minWidth: 0 },
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  logo: { alignItems: 'center', justifyContent: 'center' },
  scoreBox: { alignItems: 'center', justifyContent: 'center' },
});
