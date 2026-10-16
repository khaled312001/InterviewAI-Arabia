/**
 * Add a prep task to Google Tasks — "Tailor CV for <role> at <company>" and
 * friends, with an optional due date.
 *
 * Without a Google connection (or with Tasks access unticked on the consent
 * screen) the screen explains why and offers the two ways forward: connect,
 * or block prep time in the calendar instead, which works with a .ics file.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useAppTheme } from '../../theme/useTheme';
import { Screen, Text, Card, Button, Input, SectionHeader, SkeletonCard } from '../../components';
import { calendarApi, calendarErrorKind, isoDate, type CalendarStatus } from './calendarApi';
import { DateStrip, SuccessMark, FadeIn, IconBubble, styles } from './calendarUi';
import { Chip } from '../career/careerUi';

export function PrepTaskScreen({ route, navigation }: any) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const p = route.params || {};
  const role: string = p.role || '';
  const company: string = p.company || '';

  const suggestions = useMemo(() => [
    role && company ? t('calendar.task.suggest.tailor', { role, company }) : t('calendar.task.suggest.tailorShort'),
    company ? t('calendar.task.suggest.research', { company }) : t('calendar.task.suggest.researchShort'),
    t('calendar.task.suggest.mock'),
    t('calendar.task.suggest.questions'),
  ], [role, company, t]);

  const [status, setStatus] = useState<CalendarStatus | null | undefined>(undefined);
  const [title, setTitle] = useState(suggestions[0]);
  const [notes, setNotes] = useState('');
  const [due, setDue] = useState<Date | null>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(() => {
    calendarApi.status().then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await calendarApi.createTask({
        title: title.trim(),
        notes: notes.trim() || undefined,
        due: due ? isoDate(due) : undefined,
        jobId: p.jobId,
      });
      setDone(true);
    } catch (e) {
      setError(t(`calendar.errors.${calendarErrorKind(e)}`));
    } finally {
      setBusy(false);
    }
  }, [title, notes, due, p.jobId, t]);

  if (status === undefined) {
    return <Screen contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.md }}><SkeletonCard height={120} /><SkeletonCard height={200} /></Screen>;
  }

  const canUseTasks = Boolean(status?.configured && status.connected && status.scopes.tasks);

  if (done) {
    return (
      <Screen scroll contentStyle={{ paddingTop: theme.spacing['3xl'], gap: theme.spacing.lg }}>
        <SuccessMark />
        <FadeIn index={1}>
          <Text role="h3" weight="bold" align="center">{t('calendar.task.successTitle')}</Text>
          <Text role="bodySm" tone="secondary" align="center" style={{ marginTop: theme.spacing.xs }}>{t('calendar.task.successBody')}</Text>
        </FadeIn>
        <FadeIn index={2}>
          <Card padding="lg" variant="filled">
            <Text role="body" weight="bold">{title}</Text>
          </Card>
        </FadeIn>
        <FadeIn index={3} style={{ gap: theme.spacing.sm }}>
          <Button title={t('calendar.schedule.done')} onPress={() => navigation.goBack()} />
          <Button
            title={t('calendar.actions.prepTask')}
            variant="ghost"
            onPress={() => { setDone(false); setNotes(''); setTitle(suggestions[1]); }}
          />
        </FadeIn>
      </Screen>
    );
  }

  if (!canUseTasks) {
    const scheduleBlock = () => navigation.replace('ScheduleInterview', { kind: 'prep', company, role, jobId: p.jobId, title: p.title });
    return (
      <Screen scroll contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}>
        <FadeIn index={0}>
          <Card padding="lg">
            <View style={[styles.row, { gap: theme.spacing.md, alignItems: 'flex-start' }]}>
              <IconBubble name="checkbox-outline" />
              <View style={styles.grow}>
                <Text role="bodyLg" weight="bold">
                  {status?.configured ? t('calendar.task.connectTitle') : t('calendar.notConfiguredTitle')}
                </Text>
                <Text role="bodySm" tone="secondary" style={{ marginTop: theme.spacing.xxs }}>
                  {status?.configured
                    ? (status.connected ? t('calendar.tasksMissing') : t('calendar.task.connectBody'))
                    : t('calendar.notConfiguredBody')}
                </Text>
              </View>
            </View>
          </Card>
        </FadeIn>
        <FadeIn index={1} style={{ gap: theme.spacing.sm }}>
          {status?.configured ? (
            <Button
              title={status.connected ? t('calendar.reconnect') : t('calendar.connect')}
              onPress={() => navigation.navigate('Calendar')}
              iconLeft={<Ionicons name="logo-google" size={18} color={theme.colors.onPrimary} />}
            />
          ) : null}
          <Button
            title={t('calendar.task.prepBlock')}
            variant={status?.configured ? 'outline' : 'primary'}
            onPress={scheduleBlock}
            iconLeft={<Ionicons name="calendar-outline" size={18} color={status?.configured ? theme.colors.primary : theme.colors.onPrimary} />}
          />
        </FadeIn>
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAvoiding contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.xl, paddingBottom: theme.spacing['3xl'] }}>
      <FadeIn index={0}>
        <Card padding="md" variant="filled">
          <View style={[styles.row, { gap: theme.spacing.sm, alignItems: 'flex-start' }]}>
            <Ionicons name="checkbox-outline" size={theme.layout.icon.md} color={theme.colors.primary} />
            <Text role="bodySm" tone="secondary" flex>{t('calendar.task.intro')}</Text>
          </View>
        </Card>
      </FadeIn>

      <FadeIn index={1} style={{ gap: theme.spacing.sm }}>
        <Text role="bodySm" weight="bold" tone="secondary">{t('calendar.task.suggestions')}</Text>
        <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
          {suggestions.map((s) => (
            <Chip key={s} label={s} active={title === s} onPress={() => setTitle(s)} />
          ))}
        </View>
      </FadeIn>

      <FadeIn index={2} style={{ gap: theme.spacing.md }}>
        <Input
          label={t('calendar.task.field')}
          placeholder={t('calendar.task.fieldPlaceholder')}
          value={title}
          onChangeText={setTitle}
          maxLength={200}
        />
        <Input
          label={t('calendar.task.notes')}
          value={notes}
          onChangeText={setNotes}
          multiline
          maxLength={4000}
          style={{ minHeight: 72, textAlignVertical: 'top' }}
        />
      </FadeIn>

      <FadeIn index={3} style={{ gap: theme.spacing.sm }}>
        <SectionHeader title={t('calendar.task.due')} />
        <DateStrip value={due} onChange={setDue} days={30} allowNone noneLabel={t('calendar.task.noDate')} />
      </FadeIn>

      {error ? <Text role="bodySm" tone="danger" align="center" accessibilityLiveRegion="polite">{error}</Text> : null}

      <Button
        title={t('calendar.task.save')}
        size="lg"
        loading={busy}
        disabled={!title.trim()}
        onPress={save}
        iconLeft={<Ionicons name="add-circle-outline" size={18} color={theme.colors.onPrimary} />}
      />
    </Screen>
  );
}
