import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useAppTheme } from '../../theme/useTheme';
import { Screen, Text, Card, Badge, Button, EmptyState, SkeletonCard } from '../../components';
import {
  careerApi, openExternal, countryName, salaryLabel, percentTone,
  type JobDetail, type JobCard, type MatchResult, type AtsReport, type AppStatus,
} from './careerApi';
import { JobRow, AtsReportView, useCareerError, styles } from './careerUi';
import { relativeTime } from '../mainShared';

export function JobDetailScreen({ route, navigation }: any) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const describe = useCareerError();
  const jobId: string = route.params?.jobId;

  const [job, setJob] = useState<JobDetail | null>(null);
  const [similar, setSimilar] = useState<JobCard[]>([]);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [busy, setBusy] = useState<'track' | 'ats' | null>(null);
  const [ats, setAts] = useState<AtsReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFailed(null);
      const d = await careerApi.job(jobId);
      setJob(d.job);
      setSimilar(d.similar);
      setMatch(d.match);
      navigation.setOptions({ title: d.job.company });
      // Tracked already? The list is small; one call answers it.
      careerApi.applications()
        .then((a) => setStatus(a.applications.find((x) => x.jobId === jobId)?.status ?? null))
        .catch(() => {});
    } catch (e) {
      setFailed(describe(e).message);
    }
  }, [jobId, navigation, describe]);

  useEffect(() => { load(); }, [load]);

  const track = useCallback(async (next: AppStatus) => {
    setBusy('track');
    setNotice(null);
    try {
      const a = await careerApi.track({ jobId, status: next });
      setStatus(a.status);
    } catch (e) {
      setNotice(describe(e).message);
    } finally {
      setBusy(null);
    }
  }, [jobId, describe]);

  const apply = useCallback(async () => {
    if (!job) return;
    await openExternal(job.applyUrl || job.url);
    // Opening the listing is the moment to start tracking it.
    if (!status) track('saved');
  }, [job, status, track]);

  const runAts = useCallback(async () => {
    setBusy('ats');
    setNotice(null);
    try {
      setAts(await careerApi.ats({ jobId }));
    } catch (e) {
      const err = describe(e);
      if (err.kind === 'profile') navigation.navigate('CvBuilder');
      else setNotice(err.message);
    } finally {
      setBusy(null);
    }
  }, [jobId, describe, navigation]);

  if (failed) {
    return (
      <Screen>
        <EmptyState icon="briefcase-outline" tone="danger" title={failed} actionLabel={t('common.retry')} onAction={load} />
      </Screen>
    );
  }
  if (!job) {
    return <Screen contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.md }}><SkeletonCard height={140} /><SkeletonCard height={260} /></Screen>;
  }

  const place = [job.city, countryName(job.country, i18n.language)].filter(Boolean).join(', ')
    || (job.workplace === 'remote' ? t('career.anywhere') : job.location || '');
  const pay = salaryLabel(job.salary);
  const rtlText = job.language === 'ar';

  return (
    <Screen scroll contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: theme.spacing['3xl'] }}>
      <Card padding="lg">
        <Text role="h3" weight="bold">{job.title}</Text>
        <Text role="body" tone="secondary" style={{ marginTop: theme.spacing.xxs }}>{job.company}{place ? ` · ${place}` : ''}</Text>
        <View style={[styles.wrap, { gap: theme.spacing.xs, marginTop: theme.spacing.sm }]}>
          {job.workplace ? <Badge tone={job.workplace === 'remote' ? 'success' : 'neutral'} label={t(`career.workplace.${job.workplace}`)} /> : null}
          {job.seniority ? <Badge label={t(`career.level.${job.seniority}`)} /> : null}
          {pay ? <Badge tone="accent" label={pay} /> : null}
          {status ? <Badge tone="primary" icon="bookmark" label={t(`career.apps.status.${status}`)} /> : null}
        </View>
        <Text role="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
          {[relativeTime(job.postedAt, t), t('career.source', { name: job.sourceName })].filter(Boolean).join(' · ')}
        </Text>
        {!job.isActive ? <Text role="bodySm" tone="warning" style={{ marginTop: theme.spacing.sm }}>{t('career.closed')}</Text> : null}

        <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.lg }}>
          <Button title={t('career.apply')} onPress={apply} fullWidth
            iconRight={<Ionicons name="open-outline" size={18} color={theme.colors.textOnBrand} />} />
          <Text role="micro" tone="muted" align="center">{t('career.applyHint')}</Text>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <View style={styles.grow}>
              <Button
                title={status ? t('career.saved') : t('career.save')}
                variant="outline"
                fullWidth
                loading={busy === 'track'}
                disabled={Boolean(status)}
                onPress={() => track('saved')}
              />
            </View>
            <View style={styles.grow}>
              <Button
                title={status && status !== 'saved' ? t('career.applied') : t('career.markApplied')}
                variant="secondary"
                fullWidth
                disabled={Boolean(status && status !== 'saved')}
                loading={busy === 'track'}
                onPress={() => track('applied')}
              />
            </View>
          </View>
        </View>
        {notice ? <Text role="bodySm" tone="danger" style={{ marginTop: theme.spacing.sm }}>{notice}</Text> : null}
      </Card>

      {match ? (
        <Card padding="lg">
          <View style={[styles.row, { gap: theme.spacing.md }]}>
            <Text role="h4" weight="bold" flex>{t('career.fitTitle')}</Text>
            <Badge size="md" tone={percentTone(match.score)} label={t('career.matchLabel', { score: match.score })} />
          </View>
          <View style={[styles.wrap, { gap: theme.spacing.sm, marginTop: theme.spacing.sm }]}>
            {(['skills', 'title', 'level', 'location'] as const).map((k) => (
              <Text key={k} role="caption" tone="secondary">{`${t(`career.breakdown.${k}`)} ${match.breakdown[k]}%`}</Text>
            ))}
          </View>
          {match.matched.length ? (
            <>
              <Text role="caption" tone="muted" style={{ marginTop: theme.spacing.md }}>{t('career.matchedSkills')}</Text>
              <View style={[styles.wrap, { gap: theme.spacing.xs, marginTop: theme.spacing.xs }]}>
                {match.matched.map((s) => <Badge key={s.key} tone="success" label={s.label} />)}
              </View>
            </>
          ) : null}
          {match.missing.length ? (
            <>
              <Text role="caption" tone="muted" style={{ marginTop: theme.spacing.md }}>{t('career.missingSkills')}</Text>
              <View style={[styles.wrap, { gap: theme.spacing.xs, marginTop: theme.spacing.xs }]}>
                {match.missing.map((s) => <Badge key={s.key} tone="danger" label={s.label} />)}
              </View>
            </>
          ) : null}
        </Card>
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        <Button title={t('career.tailor')} variant="accent" fullWidth
          iconLeft={<Ionicons name="sparkles" size={18} color={theme.colors.textOnBrand} />}
          onPress={() => navigation.navigate('Tailor', { jobId, title: job.title })} />
        <Button title={t('career.checkAts')} variant="outline" fullWidth loading={busy === 'ats'} onPress={runAts} />
        <Button title={t('assist.forThisJob')} variant="secondary" fullWidth
          iconLeft={<Ionicons name="ear" size={18} color={theme.colors.primary} />}
          onPress={() => navigation.navigate('AssistSetup', { jobId, title: job.title })} />
        <Button title={t('calendar.actions.schedule')} variant="outline" fullWidth
          iconLeft={<Ionicons name="calendar-outline" size={18} color={theme.colors.primary} />}
          onPress={() => navigation.navigate('ScheduleInterview', { kind: 'interview', jobId, company: job.company, role: job.title, title: `${job.title} — ${job.company}` })} />
        <Button title={t('calendar.actions.prepTask')} variant="ghost" fullWidth
          iconLeft={<Ionicons name="checkbox-outline" size={18} color={theme.colors.primary} />}
          onPress={() => navigation.navigate('PrepTask', { jobId, company: job.company, role: job.title, title: `${job.title} — ${job.company}` })} />
        <Button title={t('career.practice')} variant="ghost" fullWidth onPress={() => navigation.navigate('MeetingSetup')} />
      </View>

      {ats ? <AtsReportView report={ats} /> : null}

      <Card padding="lg">
        <Text role="h4" weight="bold" style={{ marginBottom: theme.spacing.sm }}>{t('career.description')}</Text>
        {job.skills.length ? (
          <View style={[styles.wrap, { gap: theme.spacing.xs, marginBottom: theme.spacing.md }]}>
            {job.skills.map((s) => <Badge key={s.key} label={s.label} />)}
          </View>
        ) : null}
        <Text role="bodySm" style={{ writingDirection: rtlText ? 'rtl' : 'ltr', textAlign: rtlText ? 'right' : 'left' }} selectable>
          {job.description}
        </Text>
      </Card>

      {similar.length ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text role="h4" weight="bold">{t('career.similar')}</Text>
          {similar.map((s) => (
            <JobRow key={s.id} job={s} onPress={(j) => navigation.push('JobDetail', { jobId: j.id, title: j.title })} />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
