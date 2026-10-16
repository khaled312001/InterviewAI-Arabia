/**
 * The interview calendar: connect Google, see what is coming up grouped by
 * day with interviews picked out, join a call in one tap, and jump straight
 * into the Live Assistant for an interview that is about to start.
 *
 * Four states besides the agenda itself: loading (skeletons), not configured
 * (the server has no OAuth client — only the .ics route is offered), not
 * connected (the pitch and the connect button), and failed (retry).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, AppState } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { MotiView, AnimatePresence } from 'moti';

import { useAppTheme } from '../../theme/useTheme';
import {
  Screen, Text, Card, Button, Badge, EmptyState, SectionHeader, SkeletonCard,
} from '../../components';
import { confirmAsk } from '../career/careerUi';
import {
  calendarApi, connectGoogle, calendarErrorKind, eventDay, dayLabel, formatTime, durationLabel,
  type CalendarStatus, type CalendarEvent, type CalendarTask, type CalendarErrorKind, type ConnectOutcome,
} from './calendarApi';
import { FadeIn, IconBubble, PulseDot, openJoinLink, useTicker, styles } from './calendarUi';

const DAYS = 14;

type Banner = { tone: 'success' | 'danger'; text: string } | null;

export function CalendarScreen({ route, navigation }: any) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();

  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [tasks, setTasks] = useState<CalendarTask[] | null>(null);
  const [error, setError] = useState<CalendarErrorKind | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = useCallback((b: Banner) => {
    setBanner(b);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    if (b) bannerTimer.current = setTimeout(() => setBanner(null), 5000);
  }, []);
  useEffect(() => () => { if (bannerTimer.current) clearTimeout(bannerTimer.current); }, []);

  const bannerFor = useCallback((outcome: ConnectOutcome | 'expired') => {
    if (outcome === 'connected') showBanner({ tone: 'success', text: t('calendar.banner.connected') });
    else if (outcome === 'denied') showBanner({ tone: 'danger', text: t('calendar.banner.denied') });
    else if (outcome === 'expired') showBanner({ tone: 'danger', text: t('calendar.banner.expired') });
    else if (outcome === 'error') showBanner({ tone: 'danger', text: t('calendar.banner.error') });
  }, [showBanner, t]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await calendarApi.status();
      setStatus(s);
      if (s.configured && s.connected && s.scopes.calendar) {
        const [ev, tk] = await Promise.all([
          calendarApi.events(DAYS),
          s.scopes.tasks ? calendarApi.tasks().catch(() => [] as CalendarTask[]) : Promise.resolve(null),
        ]);
        setEvents(ev.events);
        setTasks(tk);
      } else {
        setEvents([]);
        setTasks(null);
      }
    } catch (e) {
      const kind = calendarErrorKind(e);
      // The grant was revoked at Google: the server has already forgotten it.
      if (kind === 'notConnected') {
        setStatus((s) => (s ? { ...s, connected: false } : s));
        setEvents([]);
        bannerFor('error');
      } else {
        setError(kind);
      }
    }
  }, [bannerFor]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // A result handed over by the web redirect (see calendarReturn.ts).
  useEffect(() => {
    const result = route.params?.result as 'connected' | 'error' | undefined;
    if (!result) return;
    const reason = route.params?.reason as string | undefined;
    bannerFor(result === 'connected' ? 'connected' : reason === 'denied' ? 'denied' : reason === 'expired' ? 'expired' : 'error');
    navigation.setParams({ result: undefined, reason: undefined });
  }, [route.params?.result, route.params?.reason, bannerFor, navigation]);

  // An auth session the OS dismissed still may have connected: re-check on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active' && connecting) load(); });
    return () => sub.remove();
  }, [connecting, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const outcome = await connectGoogle();
      if (outcome === 'redirecting') return; // the page is navigating away
      bannerFor(outcome);
      await load();
    } catch (e) {
      const kind = calendarErrorKind(e);
      showBanner({ tone: 'danger', text: t(`calendar.errors.${kind}`) });
    } finally {
      setConnecting(false);
    }
  }, [bannerFor, load, showBanner, t]);

  const disconnect = useCallback(async () => {
    if (!(await confirmAsk(t('calendar.disconnectConfirm'), t('calendar.disconnect'), t('common.cancel')))) return;
    try {
      await calendarApi.disconnect();
      setStatus((s) => (s ? { ...s, connected: false, email: null, scopes: { calendar: false, tasks: false } } : s));
      setEvents([]);
      setTasks(null);
    } catch (e) {
      showBanner({ tone: 'danger', text: t(`calendar.errors.${calendarErrorKind(e)}`) });
    }
  }, [showBanner, t]);

  const schedule = useCallback(() => navigation.navigate('ScheduleInterview'), [navigation]);
  const addTask = useCallback(() => navigation.navigate('PrepTask'), [navigation]);
  const startAssist = useCallback((ev: CalendarEvent) => {
    navigation.navigate('AssistSetup', {
      prefill: { title: ev.role || ev.title, company: ev.company || '', notes: ev.title },
    });
  }, [navigation]);

  /* ------------------------------------------------------------ grouping */

  const groups = useMemo(() => {
    const map = new Map<string, { day: Date; items: CalendarEvent[] }>();
    for (const ev of events || []) {
      const day = eventDay(ev);
      if (!day) continue;
      const key = day.toDateString();
      if (!map.has(key)) map.set(key, { day, items: [] });
      map.get(key)!.items.push(ev);
    }
    return [...map.values()].sort((a, b) => a.day.getTime() - b.day.getTime());
  }, [events]);

  /* ------------------------------------------------------------- render */

  const bannerView = (
    <AnimatePresence>
      {banner ? (
        <MotiView
          key={banner.text}
          from={{ opacity: 0, translateY: -theme.spacing.md }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={{ opacity: 0, translateY: -theme.spacing.md }}
          transition={{ type: 'timing', duration: theme.motion.duration.normal }}
        >
          <Card padding="md" variant="filled" style={{ backgroundColor: banner.tone === 'success' ? theme.colors.successMuted : theme.colors.dangerMuted }}>
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <Ionicons
                name={banner.tone === 'success' ? 'checkmark-circle' : 'alert-circle'}
                size={theme.layout.icon.md}
                color={banner.tone === 'success' ? theme.colors.success : theme.colors.danger}
              />
              <Text role="bodySm" weight="bold" tone={banner.tone} flex accessibilityLiveRegion="polite">{banner.text}</Text>
            </View>
          </Card>
        </MotiView>
      ) : null}
    </AnimatePresence>
  );

  if (error) {
    return (
      <Screen scroll refreshing={refreshing} onRefresh={onRefresh} contentStyle={{ paddingTop: theme.spacing.lg }}>
        <EmptyState
          tone="danger"
          icon={error === 'network' ? 'cloud-offline-outline' : 'calendar-outline'}
          title={t(`calendar.errors.${error}`)}
          actionLabel={t('common.retry')}
          onAction={load}
        />
      </Screen>
    );
  }

  if (!status) {
    return (
      <Screen contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.md }}>
        <SkeletonCard height={150} />
        <SkeletonCard height={88} />
        <SkeletonCard height={88} />
      </Screen>
    );
  }

  const connected = status.configured && status.connected;

  return (
    <Screen
      scroll
      refreshing={refreshing}
      onRefresh={onRefresh}
      contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: theme.spacing['3xl'] }}
    >
      {bannerView}

      {/* ---------------------------------------------------- connection */}
      <FadeIn index={0}>
        {!status.configured ? (
          <Card padding="lg">
            <View style={[styles.row, { gap: theme.spacing.md, alignItems: 'flex-start' }]}>
              <IconBubble name="calendar-outline" tone="neutral" />
              <View style={styles.grow}>
                <Text role="bodyLg" weight="bold">{t('calendar.notConfiguredTitle')}</Text>
                <Text role="bodySm" tone="secondary" style={{ marginTop: theme.spacing.xxs }}>{t('calendar.notConfiguredBody')}</Text>
              </View>
            </View>
          </Card>
        ) : connected ? (
          <Card padding="md">
            <View style={[styles.row, { gap: theme.spacing.md }]}>
              <IconBubble name="logo-google" tone="success" />
              <View style={styles.grow}>
                <Text role="body" weight="bold" numberOfLines={1}>{t('calendar.connectedGeneric')}</Text>
                {status.email ? (
                  <Text role="caption" tone="secondary" numberOfLines={1}>{t('calendar.connectedAs', { email: status.email })}</Text>
                ) : null}
              </View>
              <Button title={t('calendar.disconnect')} size="sm" variant="ghost" fullWidth={false} onPress={disconnect} />
            </View>
            {!status.scopes.tasks || !status.scopes.calendar ? (
              <View style={[styles.row, { gap: theme.spacing.sm, marginTop: theme.spacing.md, alignItems: 'flex-start' }]}>
                <Ionicons name="information-circle-outline" size={theme.layout.icon.md} color={theme.colors.warning} />
                <Text role="caption" tone="secondary" flex>{t('calendar.tasksMissing')}</Text>
              </View>
            ) : null}
            {!status.scopes.tasks || !status.scopes.calendar ? (
              <Button title={t('calendar.reconnect')} size="sm" variant="outline" style={{ marginTop: theme.spacing.sm }} loading={connecting} onPress={connect} />
            ) : null}
          </Card>
        ) : (
          <Card padding="lg">
            <View style={[styles.row, { gap: theme.spacing.md }]}>
              <IconBubble name="calendar" tone="primary" size={52} />
              <View style={styles.grow}>
                <Text role="h4" weight="bold">{t('calendar.heroTitle')}</Text>
              </View>
            </View>
            <Text role="bodySm" tone="secondary" style={{ marginTop: theme.spacing.md }}>{t('calendar.heroBody')}</Text>
            <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
              {([
                ['star-outline', 'agenda'],
                ['videocam-outline', 'meet'],
                ['checkbox-outline', 'tasks'],
                ['lock-closed-outline', 'privacy'],
              ] as const).map(([icon, key], i) => (
                <FadeIn key={key} index={i + 1}>
                  <View style={[styles.row, { gap: theme.spacing.sm }]}>
                    <Ionicons name={icon} size={theme.layout.icon.sm} color={theme.colors.primary} />
                    <Text role="bodySm" flex>{t(`calendar.benefits.${key}`)}</Text>
                  </View>
                </FadeIn>
              ))}
            </View>
            <Button
              title={t('calendar.connect')}
              style={{ marginTop: theme.spacing.lg }}
              loading={connecting}
              onPress={connect}
              iconLeft={<Ionicons name="logo-google" size={18} color={theme.colors.onPrimary} />}
            />
          </Card>
        )}
      </FadeIn>

      {/* ------------------------------------------------------- actions */}
      <FadeIn index={1}>
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <View style={styles.grow}>
            <Button
              title={t('calendar.actions.schedule')}
              variant={connected ? 'primary' : 'secondary'}
              onPress={schedule}
              iconLeft={<Ionicons name="add-circle-outline" size={18} color={connected ? theme.colors.onPrimary : theme.colors.primary} />}
            />
          </View>
          {connected && status.scopes.tasks ? (
            <View style={styles.grow}>
              <Button
                title={t('calendar.actions.prepTask')}
                variant="outline"
                onPress={addTask}
                iconLeft={<Ionicons name="checkbox-outline" size={18} color={theme.colors.primary} />}
              />
            </View>
          ) : null}
        </View>
      </FadeIn>

      {/* -------------------------------------------------------- agenda */}
      {connected ? (
        <View style={{ gap: theme.spacing.md }}>
          <SectionHeader title={t('calendar.agenda')} subtitle={t('calendar.agendaHint', { days: DAYS })} />
          {events === null ? (
            <>
              <SkeletonCard height={88} />
              <SkeletonCard height={88} />
            </>
          ) : groups.length === 0 ? (
            <FadeIn index={2}>
              <EmptyState
                compact
                icon="calendar-clear-outline"
                title={t('calendar.emptyTitle')}
                description={t('calendar.emptyBody', { days: DAYS })}
                actionLabel={t('calendar.actions.schedule')}
                onAction={schedule}
              />
            </FadeIn>
          ) : (
            groups.map((g, gi) => (
              <View key={g.day.toDateString()} style={{ gap: theme.spacing.sm }}>
                <FadeIn index={gi + 2}>
                  <Text role="caption" weight="bold" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                    {dayLabel(g.day, i18n.language, t)}
                  </Text>
                </FadeIn>
                {g.items.map((ev, i) => (
                  <FadeIn key={ev.id} index={gi + i + 3}>
                    <EventCard event={ev} onAssist={startAssist} />
                  </FadeIn>
                ))}
              </View>
            ))
          )}
        </View>
      ) : null}

      {/* --------------------------------------------------------- tasks */}
      {connected && tasks ? (
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t('calendar.tasksTitle')} actionLabel={t('calendar.actions.prepTask')} onAction={addTask} />
          {tasks.length === 0 ? (
            <Text role="bodySm" tone="muted">{t('calendar.tasksEmpty')}</Text>
          ) : (
            <Card padding="none">
              {tasks.map((tk, i) => (
                <FadeIn key={tk.id} index={i}>
                  <View
                    style={[styles.row, {
                      gap: theme.spacing.md,
                      paddingHorizontal: theme.spacing.lg,
                      paddingVertical: theme.spacing.md,
                      borderTopWidth: i ? theme.layout.hairline : 0,
                      borderTopColor: theme.colors.divider,
                    }]}
                  >
                    <Ionicons name="ellipse-outline" size={theme.layout.icon.md} color={theme.colors.primary} />
                    <View style={styles.grow}>
                      <Text role="bodySm" weight="bold" numberOfLines={2}>{tk.title}</Text>
                      {tk.due ? (
                        <Text role="micro" tone="muted">
                          {t('calendar.due', { date: dayLabel(new Date(`${tk.due}T12:00:00`), i18n.language, t) })}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </FadeIn>
              ))}
            </Card>
          )}
        </View>
      ) : null}
    </Screen>
  );
}

/* ============================================================ event card */

const EventCard = React.memo(function EventCard({ event, onAssist }: {
  event: CalendarEvent;
  onAssist: (ev: CalendarEvent) => void;
}) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  useTicker(60_000); // keeps "in N min" / "now" honest while the screen is open

  const start = event.start ? new Date(event.start) : null;
  const end = event.end ? new Date(event.end) : null;
  const now = Date.now();
  const live = !event.allDay && start && end ? start.getTime() <= now && now < end.getTime() : false;
  const minutesAway = !event.allDay && start ? Math.round((start.getTime() - now) / 60_000) : null;
  const soon = minutesAway !== null && minutesAway > 0 && minutesAway <= 60;
  const interview = event.looksLikeInterview;
  const accent = interview ? theme.colors.accent : event.kind ? theme.colors.primary : theme.colors.borderStrong;
  const length = start && end ? (end.getTime() - start.getTime()) / 60_000 : 0;

  return (
    <Card
      padding="none"
      variant={interview ? 'elevated' : 'outlined'}
      style={interview ? { borderColor: theme.colors.accentBorder } : undefined}
    >
      <View style={styles.row}>
        <View style={{ width: 4, alignSelf: 'stretch', backgroundColor: accent }} />
        <View style={[styles.grow, { padding: theme.spacing.lg, gap: theme.spacing.xs }]}>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            {live ? <PulseDot color={theme.colors.danger} /> : null}
            <Text role="caption" weight="bold" tone={live ? 'danger' : soon ? 'warning' : 'secondary'}>
              {event.allDay
                ? t('calendar.allDay')
                : live
                  ? t('calendar.now')
                  : soon
                    ? t('calendar.startsIn', { minutes: minutesAway })
                    : start ? formatTime(start, i18n.language) : ''}
            </Text>
            {!event.allDay && length > 0 ? (
              <Text role="caption" tone="muted">{`· ${durationLabel(length, t)}`}</Text>
            ) : null}
          </View>

          <Text role="body" weight="bold" numberOfLines={2}>{event.title || '—'}</Text>
          {event.organizer || event.location ? (
            <Text role="caption" tone="secondary" numberOfLines={1}>
              {[event.organizer, event.joinUrl ? null : event.location].filter(Boolean).join(' · ')}
            </Text>
          ) : null}

          {interview || event.kind || event.joinProvider ? (
            <View style={[styles.wrap, { gap: theme.spacing.xs, marginTop: theme.spacing.xxs }]}>
              {interview ? <Badge tone="accent" icon="briefcase" label={t('calendar.badges.interview')} /> : null}
              {!interview && event.kind ? <Badge tone="primary" label={t(`calendar.badges.${event.kind}`)} /> : null}
              {event.joinProvider ? <Badge icon="videocam" label={t(`calendar.providers.${event.joinProvider}`)} /> : null}
            </View>
          ) : null}

          {event.joinUrl || interview ? (
            <View style={[styles.row, { gap: theme.spacing.sm, marginTop: theme.spacing.sm }]}>
              {event.joinUrl ? (
                <View style={styles.grow}>
                  <Button
                    title={t('calendar.actions.join')}
                    size="sm"
                    variant={live || soon ? 'primary' : 'outline'}
                    onPress={() => openJoinLink(event.joinUrl as string)}
                    iconLeft={<Ionicons name="videocam" size={16} color={live || soon ? theme.colors.onPrimary : theme.colors.primary} />}
                    accessibilityLabel={`${t('calendar.actions.join')} — ${event.title}`}
                  />
                </View>
              ) : null}
              {interview ? (
                <View style={styles.grow}>
                  <Button
                    title={t('calendar.actions.assist')}
                    size="sm"
                    variant="secondary"
                    onPress={() => onAssist(event)}
                    iconLeft={<Ionicons name="ear" size={16} color={theme.colors.primary} />}
                    accessibilityLabel={`${t('calendar.actions.assist')} — ${event.title}`}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
});
