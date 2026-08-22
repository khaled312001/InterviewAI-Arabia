/**
 * Session summary — the end of the practice loop.
 *
 * `GET /sessions/:id` returns the session with `category` and `answers`, each
 * answer carrying `aiScore` and `aiFeedback` (the model's JSON, stored as a
 * string). The old screen showed the raw `totalScore` — a running sum that
 * grows with session length and therefore says nothing about quality — and
 * printed each answer as three lines of muted text.
 *
 * Here the dominant element is the session average on a `ScoreRing`, the raw
 * point total is demoted to a supporting stat, and each answer is an expandable
 * row that reveals what the user actually wrote plus the model's tip. Answers
 * render through a `FlatList` because a premium session is unbounded.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, Modal, Pressable, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { api } from '../api/client';
import { maybeAskForPush } from '../push';
import { useAppTheme, useResponsive, useDirection } from '../theme/useTheme';
import { scoreTone } from '../theme/tokens';
import {
  Screen, Text, Button, Card, Badge, EmptyState, SectionHeader,
  ScoreRing, ScoreBar, Skeleton,
} from '../components';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'SessionSummary'>;

interface AnswerRecord {
  id: string | number;
  userAnswer?: string | null;
  aiScore?: number | null;
  aiFeedback?: string | null;
  questionText?: string | null;
  question?: { questionAr?: string; questionEn?: string } | null;
}

interface SessionRecord {
  id: string | number;
  totalScore?: number;
  startedAt?: string;
  endedAt?: string | null;
  category?: { id?: number; nameAr?: string; nameEn?: string } | null;
  answers?: AnswerRecord[];
}

type Phase = 'loading' | 'ready' | 'error';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/* ------------------------------------------------------------------ *
 * Sub-components
 * ------------------------------------------------------------------ */

function FooterBar({ children }: { children: React.ReactNode }) {
  const theme = useAppTheme();
  const { maxWidth, screenPadding } = useResponsive();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        backgroundColor: theme.colors.bgElevated,
        borderTopWidth: theme.layout.hairline,
        borderTopColor: theme.colors.border,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.md + insets.bottom,
      }}
    >
      <View
        style={{
          width: '100%',
          alignSelf: 'center',
          maxWidth,
          paddingHorizontal: screenPadding,
          gap: theme.spacing.sm,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function StatCell({
  value, label, icon, tone,
}: {
  value: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'primary' | 'accent' | 'success';
}) {
  const theme = useAppTheme();
  return (
    <View style={[styles.statCell, { gap: theme.spacing.xxs }]}>
      <Ionicons name={icon} size={theme.layout.icon.md} color={theme.colors[tone]} />
      <Text role="h4" weight="bold" numberOfLines={1}>{value}</Text>
      <Text role="micro" tone="muted" align="center" numberOfLines={2}>{label}</Text>
    </View>
  );
}

/** One answer. Memoised so expanding a row doesn't re-render the whole list. */
const AnswerRow = memo(function AnswerRow({
  item, index, isEn, expanded, onToggle,
}: {
  item: AnswerRecord;
  index: number;
  isEn: boolean;
  expanded: boolean;
  onToggle: (id: string) => void;
}) {
  const theme = useAppTheme();
  const { t } = useTranslation();

  const questionText = item.question
    ? (isEn ? item.question.questionEn : item.question.questionAr) ?? item.questionText
    : item.questionText;

  const hasScore = typeof item.aiScore === 'number';
  const score = hasScore ? Number(item.aiScore) : 0;

  // `aiFeedback` is the raw model JSON; a malformed row must not break the list.
  const tip = useMemo(() => {
    if (!item.aiFeedback) return '';
    try {
      const parsed = JSON.parse(item.aiFeedback) as { improvement?: unknown };
      return typeof parsed?.improvement === 'string' ? parsed.improvement.trim() : '';
    } catch {
      return '';
    }
  }, [item.aiFeedback]);

  const handlePress = useCallback(() => onToggle(String(item.id)), [item.id, onToggle]);

  // `Card` renders a Pressable whose accessibilityLabel REPLACES its children
  // for assistive tech, so the label has to carry the question and the score —
  // otherwise a screen reader announces nothing but "Question 1, button".
  const a11yLabel = [
    t('summary.question', { index: index + 1 }),
    questionText ?? '',
    hasScore ? String(score) : t('summary.noScore'),
  ].filter(Boolean).join(' — ');

  return (
    <Card
      variant="outlined"
      padding="md"
      onPress={handlePress}
      accessibilityLabel={a11yLabel}
      accessibilityHint={t('summary.answersHint')}
    >
      <View style={{ gap: theme.spacing.md }}>
        <View style={[styles.answerHead, { gap: theme.spacing.md }]}>
          <View style={styles.answerText}>
            <Text role="micro" weight="bold" tone="muted">
              {t('summary.question', { index: index + 1 })}
            </Text>
            <Text role="bodySm" weight="bold" numberOfLines={expanded ? undefined : 2} style={{ marginTop: theme.spacing.xxs }}>
              {questionText ?? '—'}
            </Text>
          </View>

          <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            {hasScore ? (
              <>
                <Text role="h4" weight="bold" tone="inherit" style={{ color: theme.colors[scoreTone(score)] }}>
                  {score}
                </Text>
                <ScoreBar score={score} width={theme.layout.avatar.lg} />
              </>
            ) : (
              <Badge label={t('summary.noScore')} tone="neutral" />
            )}
          </View>

          {/* Disclosure affordance. Vertical chevrons carry no writing
              direction, so this one is deliberately not from useDirection(). */}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={theme.layout.icon.md}
            color={theme.colors.textDisabled}
            style={styles.disclosure}
          />
        </View>

        {expanded ? (
          <MotiView
            from={{ opacity: 0, translateY: -theme.spacing.sm }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: theme.motion.duration.fast }}
            style={{ gap: theme.spacing.md }}
          >
            <View
              style={{
                backgroundColor: theme.colors.surfaceSunken,
                borderRadius: theme.radii.md,
                padding: theme.spacing.md,
                gap: theme.spacing.xs,
              }}
            >
              <Text role="micro" weight="bold" tone="muted">{t('summary.yourAnswer')}</Text>
              <Text role="bodySm">{item.userAnswer || '—'}</Text>
            </View>

            {tip ? (
              <View style={[styles.tipRow, { gap: theme.spacing.sm }]}>
                <Ionicons name="bulb-outline" size={theme.layout.icon.md} color={theme.colors.accentText} />
                <Text role="caption" tone="secondary" flex>{tip}</Text>
              </View>
            ) : null}
          </MotiView>
        ) : null}
      </View>
    </Card>
  );
});

function LoadingSkeleton() {
  const theme = useAppTheme();
  return (
    <View style={{ gap: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
      <Skeleton height={theme.layout.avatar.xl * 3} radius={theme.radii.lg} />
      <Skeleton height={theme.layout.avatar.lg + theme.spacing.xl} radius={theme.radii.lg} />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={theme.layout.avatar.lg + theme.spacing.lg} radius={theme.radii.lg} />
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function SessionSummaryScreen({ route, navigation }: Props) {
  const { sessionId } = route.params;
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const { arrowForward } = useDirection();

  const isEn = i18n.language.startsWith('en');

  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [shareFallback, setShareFallback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const { data } = await api.get(`/sessions/${sessionId}`);
      setSession(data.session as SessionRecord);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, [sessionId]);

  // A finished session is immutable — load once, never on focus.
  useEffect(() => { load(); }, [load]);

  /**
   * The notification permission is asked for here and nowhere near first launch.
   *
   * This is the first screen where the app has actually delivered something: the
   * user finished an interview and is looking at their score, so "we'll tell you
   * when your evaluation is ready" is a promise about a thing they have already
   * been given. Prompting on launch instead spends the one system prompt an
   * install ever gets before any value has changed hands, and a denial there is
   * permanent — no release can re-ask it.
   *
   * `maybeAskForPush` decides whether to show anything at all (already decided,
   * already blocked, asked too recently, asked twice already → it returns
   * silently). The delay lets the score render first, so the prompt lands on top
   * of the result rather than on a loading skeleton.
   */
  useEffect(() => {
    if (phase !== 'ready') return;
    const timer = setTimeout(() => { void maybeAskForPush(); }, 1200);
    return () => clearTimeout(timer);
  }, [phase]);

  const answers = useMemo(() => session?.answers ?? [], [session]);

  const scored = useMemo(
    () => answers.filter((a) => typeof a.aiScore === 'number'),
    [answers],
  );

  const average = useMemo(() => {
    if (!scored.length) return 0;
    return scored.reduce((sum, a) => sum + Number(a.aiScore ?? 0), 0) / scored.length;
  }, [scored]);

  const durationLabel = useMemo(() => {
    if (!session?.startedAt) return '—';
    const start = new Date(session.startedAt).getTime();

    // A session the user abandoned never gets `endedAt`. Falling back to
    // Date.now() there reported the time since the session was *opened* —
    // a session left open three weeks ago rendered as "63572 دقيقة".
    // Use the last recorded answer as the real end instead, and show nothing
    // when there is no answer to measure against.
    let end: number | null = session.endedAt ? new Date(session.endedAt).getTime() : null;
    if (end == null) {
      const times = (session.answers ?? [])
        .map((a: any) => (a?.createdAt ? new Date(a.createdAt).getTime() : NaN))
        .filter((n: number) => Number.isFinite(n));
      end = times.length ? Math.max(...times) : null;
    }
    if (end == null) return '—';

    const ms = Math.max(0, end - start);
    return ms >= MINUTE
      ? t('summary.durationMinutes', { n: Math.round(ms / MINUTE) })
      : t('summary.durationSeconds', { n: Math.round(ms / SECOND) });
  }, [session?.startedAt, session?.endedAt, session?.answers, t]);

  const categoryName = isEn
    ? (session?.category?.nameEn ?? session?.category?.nameAr)
    : (session?.category?.nameAr ?? session?.category?.nameEn);

  const onToggle = useCallback((id: string) => {
    setExpanded((prev) => (prev === id ? null : id));
  }, []);

  const onShare = useCallback(async () => {
    const message = t('summary.shareMessage', {
      score: average.toFixed(1),
      category: categoryName ?? '',
    });
    try {
      await Share.share({ message });
    } catch {
      // react-native-web rejects when `navigator.share` is unavailable, which
      // is most desktop browsers — surface the text instead of failing silently.
      setShareFallback(message);
    }
  }, [average, categoryName, t]);

  const onRetrySame = useCallback(async () => {
    const categoryId = session?.category?.id;
    if (!categoryId) {
      navigation.navigate('Main');
      return;
    }
    setRestarting(true);
    try {
      const { data } = await api.post('/sessions/start', { categoryId });
      navigation.replace('Interview', {
        sessionId: data.sessionId,
        firstQuestion: data.question,
        category: data.category,
      });
    } catch (err) {
      // 402 means the field went premium-only (or the plan lapsed) between the
      // two sessions — send the user somewhere that can actually resolve it.
      const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
      navigation.navigate(status === 402 ? 'Subscription' : 'Main');
    } finally {
      setRestarting(false);
    }
  }, [navigation, session?.category?.id]);

  const onHome = useCallback(() => navigation.navigate('Main'), [navigation]);

  const keyExtractor = useCallback((item: AnswerRecord) => String(item.id), []);

  const renderItem = useCallback(
    ({ item, index }: { item: AnswerRecord; index: number }) => (
      <AnswerRow
        item={item}
        index={index}
        isEn={isEn}
        expanded={expanded === String(item.id)}
        onToggle={onToggle}
      />
    ),
    [expanded, isEn, onToggle],
  );

  /* ------------------------------ phases ------------------------------ */

  if (phase === 'loading') {
    return (
      <Screen scroll>
        <LoadingSkeleton />
      </Screen>
    );
  }

  if (phase === 'error') {
    return (
      <Screen scroll>
        <EmptyState
          icon="cloud-offline-outline"
          tone="danger"
          title={t('summary.errorTitle')}
          description={t('summary.errorBody')}
          actionLabel={t('common.retry')}
          onAction={load}
        />
      </Screen>
    );
  }

  /* ------------------------------- ready ------------------------------ */

  const header = (
    <View style={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}>
      <MotiView
        from={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', ...theme.motion.easing.spring }}
      >
        <Card variant="elevated" padding="lg">
          <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <Text role="micro" weight="bold" tone="muted">{t('summary.kicker')}</Text>

            {categoryName ? (
              <Badge label={categoryName} tone="primary" size="md" icon="briefcase-outline" />
            ) : null}

            <ScoreRing
              score={average}
              size={theme.layout.avatar.xl + theme.spacing['3xl']}
              strokeWidth={theme.spacing.sm}
              label={t('summary.averageScore')}
            />
          </View>
        </Card>
      </MotiView>

      <MotiView
        from={{ opacity: 0, translateY: theme.spacing.md }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: theme.motion.duration.normal, delay: theme.motion.stagger }}
      >
        <Card variant="outlined" padding="md">
          <View style={styles.statRow}>
            <StatCell
              icon="trophy-outline"
              tone="accent"
              value={String(session?.totalScore ?? 0)}
              label={t('summary.points')}
            />
            <View style={[styles.statDivider, { backgroundColor: theme.colors.divider }]} />
            <StatCell
              icon="help-circle-outline"
              tone="primary"
              value={String(answers.length)}
              label={t('summary.questionsAnswered')}
            />
            <View style={[styles.statDivider, { backgroundColor: theme.colors.divider }]} />
            <StatCell
              icon="time-outline"
              tone="success"
              value={durationLabel}
              label={t('summary.duration')}
            />
          </View>
        </Card>
      </MotiView>

      {answers.length ? (
        <SectionHeader
          title={t('summary.answers')}
          subtitle={t('summary.answersHint')}
          // The list's own `gap` owns the space below this header.
          style={{ marginBottom: theme.spacing.none }}
        />
      ) : null}
    </View>
  );

  return (
    <Screen
      // `footer` is a sibling of the content, not an overlay, so no bottom
      // inset is needed for the list to clear it.
      footer={
        <FooterBar>
          <Button
            title={t('summary.retrySame')}
            size="lg"
            loading={restarting}
            onPress={onRetrySame}
            iconRight={
              <Ionicons name={arrowForward} size={theme.layout.icon.md} color={theme.colors.onPrimary} />
            }
            accessibilityHint={categoryName}
          />
          <View style={[styles.footerRow, { gap: theme.spacing.sm }]}>
            <Button
              title={t('summary.share')}
              variant="secondary"
              onPress={onShare}
              style={styles.footerButton}
              iconLeft={
                <Ionicons name="share-social-outline" size={theme.layout.icon.md} color={theme.colors.primary} />
              }
            />
            <Button
              title={t('summary.goHome')}
              variant="ghost"
              onPress={onHome}
              style={styles.footerButton}
            />
          </View>
        </FooterBar>
      }
    >
      <FlatList
        data={answers}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        // `Screen`'s capped container grows to fill; the list needs `flex: 1`
        // on top of that to get a bounded height and actually scroll.
        style={styles.list}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            icon="document-text-outline"
            title={t('summary.emptyTitle')}
            description={t('summary.emptyBody')}
          />
        }
        contentContainerStyle={{
          paddingBottom: theme.spacing['3xl'],
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        windowSize={7}
        removeClippedSubviews={false}
      />

      <Modal
        visible={!!shareFallback}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShareFallback(null)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={() => setShareFallback(null)}
          style={[styles.overlay, { backgroundColor: theme.colors.overlay, padding: theme.spacing.xl }]}
        >
          <Pressable
            accessibilityRole="none"
            onPress={() => {}}
            style={[
              styles.overlayCard,
              {
                maxWidth: theme.layout.maxContentWidth * 0.6,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.xl,
                padding: theme.spacing.xl,
                gap: theme.spacing.lg,
              },
              theme.shadow.xl,
            ]}
          >
            <Text role="h3" weight="bold">{t('summary.shareFallbackTitle')}</Text>
            <View
              style={{
                backgroundColor: theme.colors.surfaceSunken,
                borderRadius: theme.radii.md,
                padding: theme.spacing.lg,
              }}
            >
              <Text role="bodySm" selectable>{shareFallback}</Text>
            </View>
            <Button title={t('common.close')} variant="secondary" onPress={() => setShareFallback(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  statRow: { flexDirection: 'row', alignItems: 'stretch' },
  statCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },

  answerHead: { flexDirection: 'row', alignItems: 'flex-start' },
  answerText: { flex: 1 },
  disclosure: { alignSelf: 'center' },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start' },

  footerRow: { flexDirection: 'row', alignItems: 'center' },
  footerButton: { flex: 1 },

  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlayCard: { width: '100%' },
});
