import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, Pressable, ScrollView, LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { api } from '../api/client';
import { useAppTheme, useDirection } from '../theme/useTheme';
import { accentForCategory, scoreTone } from '../theme/tokens';
import {
  Screen, Text, Card, Badge, EmptyState, ScoreBar, SkeletonRow,
} from '../components';
import {
  answerCount, categoryIcon, categoryName, questionCountLabel, relativeTime,
  sessionAverage, sessionKind, type SessionKind, type SessionLike,
} from './mainShared';

const PAGE_SIZE = 20;

type Filter = 'all' | SessionKind;

/* ------------------------------------------------------------------ *
 * Filter chips
 * ------------------------------------------------------------------ */

interface ChipProps {
  label: string;
  active: boolean;
  onPress: (value: Filter) => void;
  value: Filter;
}

const FilterChip = React.memo(function FilterChip({ label, active, onPress, value }: ChipProps) {
  const theme = useAppTheme();
  const press = useCallback(() => onPress(value), [onPress, value]);

  return (
    <Pressable
      onPress={press}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      // The visible pill stays at control height; the pressable around it is
      // padded out to the 48px minimum target.
      style={[styles.chipTap, { minHeight: theme.layout.touchTarget }]}
    >
      {({ pressed }: { pressed: boolean }) => (
        <View
          style={[
            styles.chip,
            {
              height: theme.layout.control.sm,
              paddingHorizontal: theme.spacing.lg,
              borderRadius: theme.radii.pill,
              borderWidth: theme.layout.hairline,
              borderColor: active ? theme.colors.primary : theme.colors.border,
              backgroundColor: active ? theme.colors.primary : theme.colors.surface,
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Text
            role="bodySm"
            weight="bold"
            tone={active ? 'onBrand' : 'secondary'}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

/* ------------------------------------------------------------------ *
 * Session row
 * ------------------------------------------------------------------ */

interface RowProps {
  session: SessionLike;
  onPress: (id: string | number) => void;
}

// `t` and the active language are read inside the row rather than passed in:
// react-i18next hands back a fresh `t` identity on every render, so passing it
// as a prop would defeat React.memo on every parent update.
const SessionRow = React.memo(function SessionRow({ session, onPress }: RowProps) {
  const theme = useAppTheme();
  const { t, i18n } = useTranslation();
  const { chevronForward } = useDirection();
  const [barWidth, setBarWidth] = useState(0);
  const language = i18n.language;

  const answers = answerCount(session);
  const average = sessionAverage(session);
  const live = sessionKind(session) === 'meeting';
  const accent = accentForCategory(session.category?.id ?? session.categoryId ?? 0);
  const name = categoryName(session.category, language);

  const press = useCallback(() => onPress(session.id), [onPress, session.id]);

  // ScoreBar takes a pixel width, so measure the slot it lives in rather than
  // guessing a number that breaks on tablets and on desktop web.
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    setBarWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev));
  }, []);

  return (
    <Card
      onPress={press}
      padding="md"
      accessibilityLabel={`${name} — ${average.toFixed(1)}`}
      accessibilityHint={t('history.sessionHint')}
    >
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <View
          style={[
            styles.iconWrap,
            {
              width: theme.layout.avatar.md,
              height: theme.layout.avatar.md,
              borderRadius: theme.radii.md,
              backgroundColor: live ? theme.colors.successMuted : accent.bg,
            },
          ]}
        >
          <Ionicons
            name={live ? 'videocam-outline' : categoryIcon(session.category?.icon)}
            size={theme.layout.icon.md}
            color={live ? theme.colors.success : accent.fg}
          />
        </View>

        <View style={styles.grow}>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Text role="body" weight="bold" numberOfLines={1} flex>
              {name}
            </Text>
            {answers > 0 ? (
              <Badge tone={scoreTone(average)} size="md" label={average.toFixed(1)} />
            ) : null}
          </View>

          <View style={[styles.row, { gap: theme.spacing.sm, marginTop: theme.spacing.xxs }]}>
            <Text role="caption" tone="muted" numberOfLines={1} flex>
              {`${relativeTime(session.startedAt, t)} · ${questionCountLabel(answers, t)}`}
            </Text>
            {live ? <Badge tone="success" icon="radio-outline" label={t('history.meetingLabel')} /> : null}
          </View>

          {answers > 0 ? (
            <View onLayout={onLayout} style={{ marginTop: theme.spacing.sm }}>
              {barWidth > 0 ? <ScoreBar score={average} width={barWidth} /> : null}
            </View>
          ) : null}
        </View>

        <Ionicons
          name={chevronForward}
          size={theme.layout.icon.md}
          color={theme.colors.textDisabled}
        />
      </View>
    </Card>
  );
});

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function HistoryScreen({ navigation }: any) {
  const theme = useAppTheme();
  const { t } = useTranslation();

  const [sessions, setSessions] = useState<SessionLike[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const firstFocus = useRef(true);

  const load = useCallback(async (nextPage: number) => {
    const { data } = await api.get('/sessions', {
      params: { page: nextPage, limit: PAGE_SIZE },
    });
    const rows: SessionLike[] = data.sessions ?? [];
    setTotal(Number(data.total ?? rows.length));
    setPage(nextPage);
    setSessions((prev) => (nextPage === 1 || !prev ? rows : [...prev, ...rows]));
  }, []);

  const reload = useCallback(async () => {
    try {
      setFailed(false);
      await load(1);
    } catch {
      setFailed(true);
      setSessions((prev) => prev ?? []);
    }
  }, [load]);

  useEffect(() => { reload(); }, [reload]);

  // History changes whenever a session ends, so it is worth re-fetching the
  // first page on focus — but not on the focus that follows mount.
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) { firstFocus.current = false; return; }
      reload();
    }, [reload]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const onEndReached = useCallback(async () => {
    if (loadingMore || !sessions || sessions.length >= total) return;
    setLoadingMore(true);
    try { await load(page + 1); } catch { /* keep what we already have */ }
    setLoadingMore(false);
  }, [loadingMore, sessions, total, load, page]);

  const openSession = useCallback((id: string | number) => {
    navigation.navigate('SessionSummary', { sessionId: id });
  }, [navigation]);

  const startPractice = useCallback(() => navigation.navigate('Home'), [navigation]);
  const startMeeting = useCallback(() => navigation.navigate('MeetingSetup'), [navigation]);

  const visible = useMemo(() => {
    if (!sessions) return [];
    if (filter === 'all') return sessions;
    return sessions.filter((s) => sessionKind(s) === filter);
  }, [sessions, filter]);

  // Filtering happens client-side (the sessions endpoint has no `kind` filter),
  // so a narrow filter can produce a list too short to scroll — and a list that
  // cannot scroll never fires onEndReached. Pull further pages until the filter
  // has something to show or the history is exhausted.
  useEffect(() => {
    if (filter === 'all' || loadingMore || !sessions) return;
    if (sessions.length >= total) return;
    if (visible.length >= PAGE_SIZE / 2) return;
    onEndReached();
  }, [filter, loadingMore, sessions, total, visible.length, onEndReached]);

  const renderItem = useCallback(
    ({ item }: { item: SessionLike }) => <SessionRow session={item} onPress={openSession} />,
    [openSession],
  );

  const keyExtractor = useCallback((item: SessionLike) => String(item.id), []);

  const filters: { value: Filter; label: string }[] = [
    { value: 'all', label: t('history.filterAll') },
    { value: 'practice', label: t('history.filterPractice') },
    { value: 'meeting', label: t('history.filterMeeting') },
  ];

  const empty = failed ? (
    <EmptyState
      tone="danger"
      icon="cloud-offline-outline"
      title={t('common.loadErrorTitle')}
      description={t('common.loadErrorBody')}
      actionLabel={t('common.retry')}
      onAction={reload}
    />
  ) : filter === 'meeting' ? (
    <EmptyState
      icon="videocam-outline"
      title={t('history.emptyMeetingTitle')}
      description={t('history.emptyMeetingBody')}
      actionLabel={t('history.emptyMeetingAction')}
      onAction={startMeeting}
    />
  ) : filter === 'practice' ? (
    <EmptyState
      icon="school-outline"
      title={t('history.emptyPracticeTitle')}
      description={t('history.emptyPracticeBody')}
      actionLabel={t('history.emptyAction')}
      onAction={startPractice}
    />
  ) : (
    <EmptyState
      icon="time-outline"
      title={t('history.emptyTitle')}
      description={t('history.emptyBody')}
      actionLabel={t('history.emptyAction')}
      onAction={startPractice}
    />
  );

  return (
    <Screen contentStyle={{ paddingTop: theme.spacing.lg }}>
      <Text role="h2" weight="bold">{t('history.title')}</Text>
      <Text role="bodySm" tone="muted" style={{ marginTop: theme.spacing.xxs }}>
        {t('history.subtitle')}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // The chips declare accessibilityRole="tab"; a tab outside a tablist is
        // malformed on web and leaves VoiceOver without a group to announce.
        accessibilityRole="tablist"
        accessibilityLabel={t('history.subtitle')}
        contentContainerStyle={[styles.chipRow, { gap: theme.spacing.sm }]}
        style={{ flexGrow: 0, marginTop: theme.spacing.md }}
      >
        {filters.map((f) => (
          <FilterChip
            key={f.value}
            value={f.value}
            label={f.label}
            active={filter === f.value}
            onPress={setFilter}
          />
        ))}
      </ScrollView>

      <View style={styles.grow}>
        {sessions === null ? (
          <View style={{ gap: theme.layout.stackGap, paddingTop: theme.spacing.md }}>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
          </View>
        ) : (
          <FlatList
            data={visible}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.listContent,
              {
                gap: theme.layout.stackGap,
                paddingTop: theme.spacing.md,
                paddingBottom: theme.spacing['3xl'],
              },
            ]}
            ListEmptyComponent={
              <MotiView
                from={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ type: 'timing', duration: theme.motion.duration.normal }}
              >
                {empty}
              </MotiView>
            }
            ListFooterComponent={
              loadingMore ? <SkeletonRow /> : null
            }
            refreshing={refreshing}
            onRefresh={onRefresh}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.5}
            removeClippedSubviews={false}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', alignItems: 'center' },
  chipTap: { justifyContent: 'center' },
  chip: { alignItems: 'center', justifyContent: 'center' },
  listContent: { flexGrow: 1 },
});
