/**
 * Put an interview (or a practice session, or prep time) in the calendar.
 *
 * Connected to Google: the event goes straight into Google Calendar, with a
 * Meet link if asked for and reminders a day and 30 minutes before. Not
 * connected — or Google not configured on this server — the same event comes
 * back as a .ics file that Outlook, Apple Calendar and Google all accept.
 *
 * Opened from a job or a tracked application, the interview is linked to the
 * tracker: its status moves to "interview" and the date is remembered.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView, Switch, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';

import { useAppTheme } from '../../theme/useTheme';
import { Screen, Text, Card, Button, Input, SectionHeader } from '../../components';
import { Chip } from '../career/careerUi';
import {
  calendarApi, fetchIcs, calendarErrorKind, deviceTimeZone, formatDayLong, formatTime, durationLabel,
  type CalendarStatus, type EventKind, type NewEvent, type CalendarEvent, type LinkedApplication,
} from './calendarApi';
import { saveIcs } from './icsShare';
import { DateStrip, TimePicker, SuccessMark, FadeIn, openJoinLink, styles } from './calendarUi';

const KINDS: EventKind[] = ['interview', 'practice', 'prep'];
const DURATIONS = [30, 45, 60, 90, 120];

type Done =
  | { via: 'google'; event: CalendarEvent; application: LinkedApplication | null }
  | { via: 'ics' };

/** Tomorrow at 10:00 — a sensible first guess that is never in the past. */
function defaultStart(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 10, 0);
}

export function ScheduleInterviewScreen({ route, navigation }: any) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const p = route.params || {};

  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [kind, setKind] = useState<EventKind>(p.kind || 'interview');
  const [company, setCompany] = useState<string>(p.company || '');
  const [role, setRole] = useState<string>(p.role || '');
  const [day, setDay] = useState<Date>(() => defaultStart());
  const [hour, setHour] = useState(10);
  const [minute, setMinute] = useState(0);
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState('');
  const [addMeet, setAddMeet] = useState(true);
  const [busy, setBusy] = useState<'google' | 'ics' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    calendarApi.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  const google = Boolean(status?.configured && status.connected && status.scopes.calendar);
  const start = useMemo(
    () => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute),
    [day, hour, minute],
  );
  const inPast = start.getTime() < Date.now();

  const body = useCallback((): NewEvent => ({
    kind,
    start: start.toISOString(),
    durationMinutes: duration,
    timeZone: deviceTimeZone(),
    company: company.trim() || undefined,
    role: role.trim() || undefined,
    notes: notes.trim() || undefined,
    addMeet: google && kind !== 'prep' ? addMeet : false,
    jobId: kind === 'interview' ? p.jobId : undefined,
    applicationId: kind === 'interview' ? p.applicationId : undefined,
    language: i18n.language === 'ar' ? 'ar' : 'en',
  }), [kind, start, duration, company, role, notes, google, addMeet, p.jobId, p.applicationId, i18n.language]);

  const saveGoogle = useCallback(async () => {
    if (inPast) { setError(t('calendar.schedule.past')); return; }
    setBusy('google');
    setError(null);
    try {
      const res = await calendarApi.createEvent(body());
      setDone({ via: 'google', event: res.event, application: res.application });
    } catch (e) {
      setError(t(`calendar.errors.${calendarErrorKind(e)}`));
    } finally {
      setBusy(null);
    }
  }, [inPast, body, t]);

  const saveFile = useCallback(async () => {
    if (inPast) { setError(t('calendar.schedule.past')); return; }
    setBusy('ics');
    setError(null);
    try {
      const { text, filename } = await fetchIcs(body());
      const ok = await saveIcs(text, filename, t('calendar.ics.shareTitle'));
      if (!ok) setError(t('calendar.ics.unavailable'));
      else setDone({ via: 'ics' });
    } catch (e) {
      setError(t(`calendar.errors.${calendarErrorKind(e)}`));
    } finally {
      setBusy(null);
    }
  }, [inPast, body, t]);

  const reset = useCallback(() => { setDone(null); setNotes(''); }, []);

  /* --------------------------------------------------------------- done */

  if (done) {
    const meet = done.via === 'google' ? done.event.joinUrl : null;
    return (
      <Screen scroll contentStyle={{ paddingTop: theme.spacing['3xl'], gap: theme.spacing.lg }}>
        <SuccessMark icon={done.via === 'google' ? 'checkmark' : 'download-outline'} />
        <FadeIn index={1}>
          <Text role="h3" weight="bold" align="center">
            {done.via === 'google' ? t('calendar.schedule.successTitle') : t('calendar.schedule.successIcsTitle')}
          </Text>
          <Text role="bodySm" tone="secondary" align="center" style={{ marginTop: theme.spacing.xs }}>
            {done.via === 'google' ? t('calendar.schedule.successBody') : t('calendar.schedule.successIcs')}
          </Text>
        </FadeIn>
        <FadeIn index={2}>
          <Card padding="lg" variant="filled">
            <Text role="body" weight="bold">
              {done.via === 'google' ? done.event.title : (role || company || t(`calendar.schedule.kinds.${kind}`))}
            </Text>
            <Text role="bodySm" tone="secondary" style={{ marginTop: theme.spacing.xxs }}>
              {`${t('calendar.schedule.when', { date: formatDayLong(start, i18n.language), time: formatTime(start, i18n.language) })} · ${durationLabel(duration, t)}`}
            </Text>
            {done.via === 'google' && done.application ? (
              <View style={[styles.row, { gap: theme.spacing.sm, marginTop: theme.spacing.md }]}>
                <Ionicons name="albums-outline" size={theme.layout.icon.sm} color={theme.colors.success} />
                <Text role="caption" tone="secondary" flex>{t('calendar.schedule.trackerUpdated')}</Text>
              </View>
            ) : null}
          </Card>
        </FadeIn>
        <FadeIn index={3} style={{ gap: theme.spacing.sm }}>
          {meet ? (
            <Button
              title={t('calendar.schedule.meetLink')}
              variant="secondary"
              onPress={() => openJoinLink(meet)}
              iconLeft={<Ionicons name="videocam" size={18} color={theme.colors.primary} />}
            />
          ) : null}
          {done.via === 'google' && done.event.htmlLink ? (
            <Button title={t('calendar.actions.openInGoogle')} variant="outline" onPress={() => openJoinLink(done.event.htmlLink as string)} />
          ) : null}
          <Button title={t('calendar.schedule.done')} onPress={() => navigation.goBack()} />
          <Button title={t('calendar.schedule.another')} variant="ghost" onPress={reset} />
        </FadeIn>
      </Screen>
    );
  }

  /* --------------------------------------------------------------- form */

  return (
    <Screen scroll keyboardAvoiding contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.xl, paddingBottom: theme.spacing['3xl'] }}>
      {p.title ? (
        <FadeIn index={0}>
          <Card padding="md" variant="filled">
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <Ionicons name="briefcase-outline" size={theme.layout.icon.md} color={theme.colors.primary} />
              <Text role="bodySm" weight="bold" flex numberOfLines={2}>{t('calendar.schedule.linkedTo', { title: p.title })}</Text>
            </View>
          </Card>
        </FadeIn>
      ) : null}

      <FadeIn index={1} style={{ gap: theme.spacing.sm }}>
        <Text role="bodySm" weight="bold" tone="secondary">{t('calendar.schedule.kind')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm }}>
          {KINDS.map((k) => (
            <Chip
              key={k}
              label={t(`calendar.schedule.kinds.${k}`)}
              icon={k === 'interview' ? 'briefcase-outline' : k === 'practice' ? 'mic-outline' : 'book-outline'}
              active={kind === k}
              onPress={() => setKind(k)}
            />
          ))}
        </ScrollView>
      </FadeIn>

      {kind !== 'practice' ? (
        <FadeIn index={2} style={{ gap: theme.spacing.md }}>
          <Input
            label={t('calendar.schedule.company')}
            placeholder={t('calendar.schedule.companyPlaceholder')}
            value={company}
            onChangeText={setCompany}
            maxLength={191}
            iconLeft="business-outline"
          />
          <Input
            label={t('calendar.schedule.role')}
            placeholder={t('calendar.schedule.rolePlaceholder')}
            value={role}
            onChangeText={setRole}
            maxLength={255}
            iconLeft="person-outline"
          />
        </FadeIn>
      ) : null}

      <FadeIn index={3} style={{ gap: theme.spacing.sm }}>
        <SectionHeader title={t('calendar.schedule.date')} subtitle={formatDayLong(day, i18n.language)} />
        <DateStrip value={day} onChange={(d) => d && setDay(d)} days={60} />
      </FadeIn>

      <FadeIn index={4}>
        <Card padding="lg">
          <Text role="bodySm" weight="bold" tone="secondary" style={{ marginBottom: theme.spacing.md }}>{t('calendar.schedule.time')}</Text>
          <TimePicker hour={hour} minute={minute} onChange={(h, m) => { setHour(h); setMinute(m); }} />
        </Card>
      </FadeIn>

      <FadeIn index={5} style={{ gap: theme.spacing.sm }}>
        <Text role="bodySm" weight="bold" tone="secondary">{t('calendar.schedule.duration')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm }}>
          {DURATIONS.map((m) => (
            <Chip key={m} label={durationLabel(m, t)} active={duration === m} onPress={() => setDuration(m)} />
          ))}
        </ScrollView>
      </FadeIn>

      <FadeIn index={6}>
        <Input
          label={t('calendar.schedule.notes')}
          placeholder={t('calendar.schedule.notesPlaceholder')}
          value={notes}
          onChangeText={setNotes}
          multiline
          maxLength={4000}
          style={{ minHeight: 88, textAlignVertical: 'top' }}
        />
      </FadeIn>

      {google && kind !== 'prep' ? (
        <FadeIn index={7}>
          <Card padding="md" variant="outlined">
            <View style={[styles.row, { gap: theme.spacing.md }]}>
              <Ionicons name="videocam-outline" size={theme.layout.icon.lg} color={theme.colors.primary} />
              <View style={styles.grow}>
                <Text role="body" weight="bold">{t('calendar.schedule.addMeet')}</Text>
                <Text role="caption" tone="secondary">{t('calendar.schedule.addMeetHint')}</Text>
              </View>
              <Switch
                value={addMeet}
                onValueChange={setAddMeet}
                accessibilityLabel={t('calendar.schedule.addMeet')}
                trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primary }}
                thumbColor={Platform.OS === 'android' ? theme.colors.surface : undefined}
                ios_backgroundColor={theme.colors.borderStrong}
              />
            </View>
          </Card>
        </FadeIn>
      ) : null}

      {/* -------------------------------------------------------- summary */}
      <MotiView
        key={`${start.getTime()}-${duration}`}
        from={{ opacity: theme.motion.reduced ? 1 : 0.5 }}
        animate={{ opacity: 1 }}
        transition={{ type: 'timing', duration: theme.motion.duration.fast }}
      >
        <View style={[styles.row, { gap: theme.spacing.sm, justifyContent: 'center' }]}>
          <Ionicons name="time-outline" size={theme.layout.icon.sm} color={inPast ? theme.colors.danger : theme.colors.textMuted} />
          <Text role="bodySm" tone={inPast ? 'danger' : 'secondary'}>
            {inPast
              ? t('calendar.schedule.past')
              : `${t('calendar.schedule.when', { date: formatDayLong(start, i18n.language), time: formatTime(start, i18n.language) })} · ${durationLabel(duration, t)}`}
          </Text>
        </View>
      </MotiView>

      {error ? <Text role="bodySm" tone="danger" align="center" accessibilityLiveRegion="polite">{error}</Text> : null}

      <View style={{ gap: theme.spacing.sm }}>
        {google ? (
          <Button
            title={t('calendar.schedule.saveGoogle')}
            size="lg"
            loading={busy === 'google'}
            disabled={busy !== null || inPast}
            onPress={saveGoogle}
            iconLeft={<Ionicons name="logo-google" size={18} color={theme.colors.onPrimary} />}
          />
        ) : null}
        <Button
          title={t('calendar.schedule.saveIcs')}
          size={google ? 'md' : 'lg'}
          variant={google ? 'outline' : 'primary'}
          loading={busy === 'ics'}
          disabled={busy !== null || inPast}
          onPress={saveFile}
          iconLeft={<Ionicons name="download-outline" size={18} color={google ? theme.colors.primary : theme.colors.onPrimary} />}
        />
        <Text role="caption" tone="muted" align="center">{t('calendar.schedule.icsHint')}</Text>
        {status?.configured && !status.connected ? (
          <Card padding="md" variant="filled" onPress={() => navigation.navigate('Calendar')} accessibilityLabel={t('calendar.schedule.connectLink')}>
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <Ionicons name="logo-google" size={theme.layout.icon.md} color={theme.colors.primary} />
              <View style={styles.grow}>
                <Text role="bodySm" weight="bold" tone="primary">{t('calendar.schedule.connectLink')}</Text>
                <Text role="caption" tone="secondary">{t('calendar.schedule.connectHint')}</Text>
              </View>
            </View>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
