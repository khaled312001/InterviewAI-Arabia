import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { useAppTheme, useDirection } from '../../theme/useTheme';
import { Card, Text, Badge } from '../../components';
import { calendarApi, eventDay, dayLabel, formatTime, type CalendarEvent } from './calendarApi';

const REFRESH_MS = 60_000;

/**
 * The way into the interview calendar from Home, under the Live Assistant
 * card. Once Google is connected it doubles as a glance: the next interview
 * on the calendar, so the day of the interview opens on it.
 *
 * Failures are silent on purpose — this is a shortcut, not a status panel,
 * and Home already has its own error state.
 */
export const CalendarEntryCard = React.memo(function CalendarEntryCard({ onPress }: { onPress: () => void }) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const { chevronForward } = useDirection();
  const [connected, setConnected] = useState(false);
  const [next, setNext] = useState<CalendarEvent | null>(null);
  const lastFetch = useRef(0);

  useFocusEffect(useCallback(() => {
    if (Date.now() - lastFetch.current < REFRESH_MS) return;
    lastFetch.current = Date.now();
    let alive = true;
    calendarApi.status()
      .then(async (s) => {
        const on = s.configured && s.connected && s.scopes.calendar;
        if (!alive) return;
        setConnected(on);
        if (!on) { setNext(null); return; }
        const { events } = await calendarApi.events(14);
        if (alive) setNext(events.find((e) => e.looksLikeInterview) || null);
      })
      .catch(() => { /* silent: see above */ });
    return () => { alive = false; };
  }, []));

  const nextLine = next ? (() => {
    const day = eventDay(next);
    const when = [day ? dayLabel(day, i18n.language, t) : '', next.allDay || !next.start ? '' : formatTime(next.start, i18n.language)]
      .filter(Boolean).join(' · ');
    return { title: t('calendar.entryNext', { title: next.title }), when };
  })() : null;

  return (
    <Card
      onPress={onPress}
      padding="lg"
      accessibilityLabel={t('calendar.entryTitle')}
      accessibilityHint={nextLine ? `${nextLine.title} ${nextLine.when}` : t('calendar.entrySubtitle')}
    >
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <View
          style={[styles.icon, {
            width: theme.layout.avatar.md,
            height: theme.layout.avatar.md,
            borderRadius: theme.radii.md,
            backgroundColor: nextLine ? theme.colors.accentMuted : theme.colors.primaryMuted,
          }]}
        >
          <Ionicons name="calendar" size={theme.layout.icon.lg} color={nextLine ? theme.colors.accentText : theme.colors.primary} />
        </View>
        <View style={styles.grow}>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Text role="bodyLg" weight="bold" numberOfLines={1} flex>{t('calendar.entryTitle')}</Text>
            {connected ? <Badge tone="success" icon="logo-google" label={t('calendar.entryBadge')} /> : null}
          </View>
          {nextLine ? (
            <>
              <Text role="caption" weight="bold" numberOfLines={1} style={{ color: theme.colors.accentText }}>{nextLine.title}</Text>
              <Text role="caption" tone="secondary" numberOfLines={1}>{nextLine.when}</Text>
            </>
          ) : (
            <Text role="caption" tone="secondary" numberOfLines={2}>{t('calendar.entrySubtitle')}</Text>
          )}
        </View>
        <Ionicons name={chevronForward} size={theme.layout.icon.md} color={theme.colors.textMuted} />
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1, minWidth: 0 },
  icon: { alignItems: 'center', justifyContent: 'center' },
});
