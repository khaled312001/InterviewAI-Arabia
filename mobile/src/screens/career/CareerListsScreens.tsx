/**
 * The three list screens of the career section: tailored CV versions, the
 * application tracker and saved-search alerts. Each is a plain list with
 * inline actions; there is nothing here a person needs a second screen for.
 */

import React, { useCallback, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';

import { useAppTheme } from '../../theme/useTheme';
import { Screen, Text, Card, Badge, Button, Input, EmptyState, SkeletonCard } from '../../components';
import { relativeTime } from '../mainShared';
import {
  careerApi, openDownload, openExternal, percentTone, APP_STATUSES,
  type CvVersion, type Application, type AppStatus, type SavedSearch,
} from './careerApi';
import { Chip, confirmAsk, useCareerError, styles } from './careerUi';
import { dayLabel, formatTime } from '../calendar/calendarApi';

/* ============================================================ versions */

export function CvVersionsScreen({ navigation }: any) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const describe = useCareerError();
  const [items, setItems] = useState<CvVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    careerApi.versions().then(setItems).catch((e) => { setError(describe(e).message); setItems((p) => p ?? []); });
  }, [describe]);
  useFocusEffect(load);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(describe(e).message); }
  }, [describe]);

  const remove = useCallback(async (v: CvVersion) => {
    if (!(await confirmAsk(t('career.versions.removeConfirm'), t('career.versions.remove'), t('common.cancel')))) return;
    await act(async () => { await careerApi.deleteVersion(v.id); setItems((p) => (p || []).filter((x) => x.id !== v.id)); });
  }, [act, t]);

  return (
    <Screen scroll contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.md }}>
      {error ? <Text role="bodySm" tone="danger">{error}</Text> : null}
      {items === null ? <><SkeletonCard /><SkeletonCard /></> : items.length === 0 ? (
        <EmptyState icon="sparkles-outline" title={t('career.versions.empty')} description={t('career.versions.emptyBody')}
          actionLabel={t('career.tab')} onAction={() => navigation.navigate('Main', { screen: 'Jobs' })} />
      ) : items.map((v) => (
        <Card key={v.id} padding="md">
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Text role="body" weight="bold" numberOfLines={2} flex>{v.title}</Text>
            {v.atsScore != null ? <Badge tone={percentTone(v.atsScore)} label={t('career.versions.ats', { score: v.atsScore })} /> : null}
          </View>
          <Text role="caption" tone="muted">
            {[t(`career.languages.${v.language}`), t(`career.templates.${v.template}`), relativeTime(v.updatedAt, t)].join(' · ')}
          </Text>
          <View style={[styles.wrap, { gap: theme.spacing.sm, marginTop: theme.spacing.md }]}>
            <Button title={t('career.cv.pdf')} size="sm" onPress={() => act(() => openDownload({ versionId: v.id, format: 'pdf' }))} />
            <Button title={t('career.cv.word')} size="sm" variant="outline" onPress={() => act(() => openDownload({ versionId: v.id, format: 'docx' }))} />
            {v.hasLetter ? (
              <Button title={t('career.versions.letter')} size="sm" variant="secondary" onPress={() => act(() => openDownload({ kind: 'letter', versionId: v.id, format: 'html' }))} />
            ) : null}
            <Button title={t('career.versions.remove')} size="sm" variant="ghost" onPress={() => remove(v)} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}

/* ========================================================= applications */

function ApplicationCard({ app, onChange, onRemove, onOpenJob, onSchedule, onPrepTask }: {
  app: Application;
  onChange: (a: Application) => void;
  onRemove: (a: Application) => void;
  onOpenJob: (a: Application) => void;
  onSchedule: (a: Application) => void;
  onPrepTask: (a: Application) => void;
}) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const describe = useCareerError();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(app.notes);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(async (body: Partial<{ status: AppStatus; notes: string }>) => {
    setError(null);
    try { onChange(await careerApi.updateApplication(app.id, body)); } catch (e) { setError(describe(e).message); }
  }, [app.id, onChange, describe]);

  // A scheduled interview (calendar → tracker) that has not happened yet.
  const next = app.nextActionAt ? new Date(app.nextActionAt) : null;
  const upcoming = next && !Number.isNaN(next.getTime()) && next.getTime() > Date.now() ? next : null;

  const tone = app.status === 'offer' || app.status === 'accepted' ? 'success'
    : app.status === 'rejected' || app.status === 'withdrawn' ? 'danger'
    : app.status === 'interview' ? 'accent' : 'primary';

  return (
    <Card padding="md" onPress={() => setOpen((o) => !o)}>
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <View style={styles.grow}>
          <Text role="body" weight="bold" numberOfLines={2}>{app.title}</Text>
          <Text role="bodySm" tone="secondary" numberOfLines={1}>{app.company}{app.location ? ` · ${app.location}` : ''}</Text>
        </View>
        <Badge tone={tone} size="md" label={t(`career.apps.status.${app.status}`)} />
      </View>
      <Text role="micro" tone="muted" style={{ marginTop: theme.spacing.xxs }}>
        {[app.matchScore != null ? t('career.matchLabel', { score: app.matchScore }) : '', relativeTime(app.updatedAt, t)].filter(Boolean).join(' · ')}
      </Text>
      {upcoming ? (
        <View style={{ marginTop: theme.spacing.xs }}>
          <Badge
            tone="accent"
            icon="calendar"
            label={t('calendar.trackerInterview', {
              when: `${dayLabel(upcoming, i18n.language, t)} · ${formatTime(upcoming, i18n.language)}`,
            })}
          />
        </View>
      ) : null}
      {open ? (
        <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.xs }}>
            {APP_STATUSES.map((s) => (
              <Chip key={s} label={t(`career.apps.status.${s}`)} active={app.status === s} onPress={() => update({ status: s })} />
            ))}
          </ScrollView>
          <Input label={t('career.apps.notes')} value={notes} onChangeText={setNotes} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />
          <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
            <Button title={t('career.apps.saveNotes')} size="sm" variant="secondary" onPress={() => update({ notes })} />
            {app.jobId ? <Button title={t('career.description')} size="sm" variant="outline" onPress={() => onOpenJob(app)} /> : null}
            {app.url ? <Button title={t('career.apps.open')} size="sm" variant="outline" onPress={() => openExternal(app.url as string)} /> : null}
            <Button title={t('calendar.actions.schedule')} size="sm" variant="secondary" onPress={() => onSchedule(app)} />
            <Button title={t('calendar.actions.prepTask')} size="sm" variant="outline" onPress={() => onPrepTask(app)} />
            <Button title={t('career.apps.remove')} size="sm" variant="ghost" onPress={() => onRemove(app)} />
          </View>
          {error ? <Text role="caption" tone="danger">{error}</Text> : null}
        </View>
      ) : null}
    </Card>
  );
}

export function ApplicationsScreen({ navigation }: any) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const describe = useCareerError();
  const [items, setItems] = useState<Application[] | null>(null);
  const [filter, setFilter] = useState<AppStatus | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    careerApi.applications().then((d) => setItems(d.applications)).catch((e) => { setError(describe(e).message); setItems((p) => p ?? []); });
  }, [describe]));

  const onChange = useCallback((a: Application) => {
    setItems((prev) => (prev || []).map((x) => (x.id === a.id ? a : x)));
  }, []);
  const onOpenJob = useCallback((a: Application) => {
    if (a.jobId) navigation.navigate('JobDetail', { jobId: a.jobId, title: a.title });
  }, [navigation]);

  const onSchedule = useCallback((a: Application) => {
    navigation.navigate('ScheduleInterview', {
      kind: 'interview', applicationId: a.id, company: a.company, role: a.title, title: `${a.title} — ${a.company}`,
    });
  }, [navigation]);
  const onPrepTask = useCallback((a: Application) => {
    navigation.navigate('PrepTask', {
      jobId: a.jobId || undefined, company: a.company, role: a.title, title: `${a.title} — ${a.company}`,
    });
  }, [navigation]);

  const onRemove = useCallback(async (a: Application) => {
    if (!(await confirmAsk(t('career.apps.removeConfirm'), t('career.apps.remove'), t('common.cancel')))) return;
    try {
      await careerApi.deleteApplication(a.id);
      setItems((prev) => (prev || []).filter((x) => x.id !== a.id));
    } catch (e) { setError(describe(e).message); }
  }, [t, describe]);

  const counts = (items || []).reduce<Record<string, number>>((m, a) => { m[a.status] = (m[a.status] || 0) + 1; return m; }, {});
  const shown = (items || []).filter((a) => filter === 'all' || a.status === filter);

  return (
    <Screen scroll keyboardAvoiding contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.md }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.xs }}>
        <Chip label={`${t('career.apps.all')} ${items?.length ?? ''}`} active={filter === 'all'} onPress={() => setFilter('all')} />
        {APP_STATUSES.filter((s) => counts[s]).map((s) => (
          <Chip key={s} label={`${t(`career.apps.status.${s}`)} ${counts[s]}`} active={filter === s} onPress={() => setFilter(s)} />
        ))}
      </ScrollView>
      {error ? <Text role="bodySm" tone="danger">{error}</Text> : null}
      {items === null ? <><SkeletonCard /><SkeletonCard /></> : shown.length === 0 ? (
        <EmptyState icon="albums-outline" title={t('career.apps.empty')} description={t('career.apps.emptyBody')}
          actionLabel={t('career.tab')} onAction={() => navigation.navigate('Main', { screen: 'Jobs' })} />
      ) : shown.map((a) => <ApplicationCard key={a.id} app={a} onChange={onChange} onRemove={onRemove} onOpenJob={onOpenJob} onSchedule={onSchedule} onPrepTask={onPrepTask} />)}
    </Screen>
  );
}

/* ======================================================= saved searches */

export function SavedSearchesScreen({ navigation }: any) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const describe = useCareerError();
  const [items, setItems] = useState<SavedSearch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    careerApi.searches().then(setItems).catch((e) => { setError(describe(e).message); setItems((p) => p ?? []); });
  }, [describe]));

  const setFrequency = useCallback(async (s: SavedSearch, frequency: SavedSearch['frequency']) => {
    try {
      await careerApi.updateSearch(s.id, { frequency });
      setItems((prev) => (prev || []).map((x) => (x.id === s.id ? { ...x, frequency } : x)));
    } catch (e) { setError(describe(e).message); }
  }, [describe]);

  const remove = useCallback(async (s: SavedSearch) => {
    if (!(await confirmAsk(t('career.alerts.removeConfirm'), t('career.alerts.remove'), t('common.cancel')))) return;
    try {
      await careerApi.deleteSearch(s.id);
      setItems((prev) => (prev || []).filter((x) => x.id !== s.id));
    } catch (e) { setError(describe(e).message); }
  }, [t, describe]);

  return (
    <Screen scroll contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.md }}>
      {error ? <Text role="bodySm" tone="danger">{error}</Text> : null}
      {items === null ? <SkeletonCard /> : items.length === 0 ? (
        <EmptyState icon="notifications-outline" title={t('career.alerts.empty')} description={t('career.alerts.emptyBody')}
          actionLabel={t('career.tab')} onAction={() => navigation.navigate('Main', { screen: 'Jobs' })} />
      ) : items.map((s) => (
        <Card key={s.id} padding="md">
          <Text role="body" weight="bold">{s.name}</Text>
          <View style={[styles.wrap, { gap: theme.spacing.xs, marginTop: theme.spacing.sm }]}>
            {(['daily', 'weekly', 'off'] as const).map((f) => (
              <Chip key={f} label={t(`career.alerts.${f}`)} active={s.frequency === f} onPress={() => setFrequency(s, f)} />
            ))}
            <Button title={t('career.alerts.remove')} size="sm" variant="ghost" onPress={() => remove(s)} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
