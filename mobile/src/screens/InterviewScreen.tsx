/**
 * Interview — the answer-writing screen.
 *
 * Three problems with the previous version drove this rebuild:
 *
 * 1. Progress was a lie. It rendered "سؤال {answered + 1}" from a counter that
 *    reset to 0 on every mount, and `navigation.replace('Interview', …)` from
 *    the feedback screen remounts it on every question — so it always said
 *    "question 1". Progress is now derived from `GET /sessions/:id`, which is
 *    the only source that survives the replace.
 * 2. Submitting froze a button for the several seconds an LLM round trip takes,
 *    with no signal that anything was happening. There is now an explicit
 *    stepped progress overlay.
 * 3. Errors went through `Alert.alert`, which react-native-web implements as
 *    an empty function — on the web build every failure was silent. All
 *    messaging is in-tree now (inline banners and a themed modal).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Modal, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { useBalance } from '../store/balance';
import { useAppTheme, useDirection } from '../theme/useTheme';
import { Screen, Text, Button, Card, Badge, Input, Skeleton } from '../components';
import { balanceLabel, durationLabel } from './mainShared';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Interview'>;

/** `answerSchema` on the server is `z.string().min(1).max(5000)`. */
const MAX_ANSWER = 5000;
/** Client-side quality floor — an eight-word answer can't be scored fairly. */
const MIN_ANSWER = 25;
/** Below this the hint stays visible to nudge a fuller answer. */
const HINT_UNTIL = 160;
/** How many segments before a segmented track becomes visual noise. */
const MAX_SEGMENTS = 10;

const THINKING_STEPS = ['stepReading', 'stepAnalysing', 'stepScoring', 'stepWriting'] as const;
const STEP_MS = 1700;

interface QuestionRecord {
  id: string;
  questionAr: string;
  questionEn: string;
  difficulty?: 'easy' | 'medium' | 'hard';
}

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | undefined)?.response?.status;
}

/* ------------------------------------------------------------------ *
 * Progress
 * ------------------------------------------------------------------ */

/**
 * Segmented progress.
 *
 * When a total is known — the balance divided by the flat per-answer charge
 * bounds how many more answers can be paid for — the track shows every
 * remaining step. When it isn't (a subscriber answers for free) it shows only
 * the questions already answered plus the current one, so nothing implies a
 * finish line that doesn't exist.
 */
function ProgressTrack({ current, total }: { current: number; total: number | null }) {
  const theme = useAppTheme();
  const count = Math.min(total ?? current, MAX_SEGMENTS);
  const continuous = (total ?? current) > MAX_SEGMENTS;

  if (continuous) {
    const ratio = total ? Math.min(1, current / total) : 1;
    return (
      <View
        style={{
          height: theme.spacing.sm,
          borderRadius: theme.radii.pill,
          backgroundColor: theme.colors.surfaceSunken,
          overflow: 'hidden',
        }}
      >
        <MotiView
          from={{ width: '0%' }}
          animate={{ width: `${ratio * 100}%` }}
          transition={{ type: 'timing', duration: theme.motion.duration.slow }}
          style={{ height: '100%', backgroundColor: theme.colors.primary }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.segments, { gap: theme.spacing.xs }]}>
      {Array.from({ length: Math.max(1, count) }).map((_, i) => {
        const done = i < current - 1;
        const active = i === current - 1;
        return (
          <MotiView
            key={i}
            from={{ opacity: 0.2 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: theme.motion.duration.fast, delay: i * theme.motion.stagger }}
            style={{
              flex: 1,
              height: theme.spacing.sm,
              borderRadius: theme.radii.pill,
              backgroundColor: done
                ? theme.colors.success
                : active
                  ? theme.colors.primary
                  : theme.colors.surfaceSunken,
            }}
          />
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Submitting overlay
 * ------------------------------------------------------------------ */

function ThinkingOverlay({ visible }: { visible: boolean }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!visible) {
      setStep(0);
      return;
    }
    // The real call has no progress events, so the steps are paced to the
    // observed p50 of the evaluate endpoint and hold on the last one rather
    // than completing — the screen never claims to be finished before it is.
    const id = setInterval(
      () => setStep((s) => Math.min(s + 1, THINKING_STEPS.length - 1)),
      STEP_MS,
    );
    return () => clearInterval(id);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={[styles.overlay, { backgroundColor: theme.colors.overlay, padding: theme.spacing.xl }]}>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('interview.thinking')}
          accessibilityValue={{ min: 0, max: THINKING_STEPS.length, now: step + 1 }}
          style={[
            styles.overlayCard,
            {
              // There is no dialog-width token yet (flagged in the report);
              // derived from the content cap so it scales with it.
              maxWidth: theme.layout.maxContentWidth * 0.6,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.xl,
              padding: theme.spacing.xl,
              gap: theme.spacing.lg,
            },
            theme.shadow.xl,
          ]}
        >
          <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <MotiView
              from={{ scale: 1 }}
              animate={{ scale: 1.1 }}
              transition={{ loop: !theme.motion.reduced, type: 'timing', duration: theme.motion.duration.deliberate }}
              style={[
                styles.pulse,
                {
                  width: theme.layout.avatar.lg,
                  height: theme.layout.avatar.lg,
                  borderRadius: theme.radii.pill,
                  backgroundColor: theme.colors.primaryMuted,
                },
              ]}
            >
              <Ionicons name="sparkles" size={theme.layout.icon.xl} color={theme.colors.primary} />
            </MotiView>

            <Text role="h4" weight="bold" align="center">{t('interview.thinking')}</Text>
          </View>

          <View style={{ gap: theme.spacing.md }}>
            {THINKING_STEPS.map((key, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <View key={key} style={[styles.stepRow, { gap: theme.spacing.md }]}>
                  {done ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={theme.layout.icon.md}
                      color={theme.colors.success}
                    />
                  ) : (
                    <MotiView
                      from={{ opacity: active ? 0.35 : 1 }}
                      animate={{ opacity: 1 }}
                      transition={active
                        ? { loop: !theme.motion.reduced, type: 'timing', duration: theme.motion.duration.slow }
                        : { type: 'timing', duration: theme.motion.duration.instant }}
                      style={{
                        width: theme.layout.icon.md,
                        height: theme.layout.icon.md,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <View
                        style={{
                          width: theme.spacing.sm,
                          height: theme.spacing.sm,
                          borderRadius: theme.radii.pill,
                          backgroundColor: active ? theme.colors.primary : theme.colors.borderStrong,
                        }}
                      />
                    </MotiView>
                  )}
                  <Text
                    role="bodySm"
                    weight={active ? 'bold' : 'regular'}
                    tone={done ? 'success' : active ? 'default' : 'muted'}
                    flex
                  >
                    {t(`interview.${key}`)}
                  </Text>
                </View>
              );
            })}
          </View>

          <Text role="caption" tone="muted" align="center">{t('interview.thinkingHint')}</Text>
        </View>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Confirm sheet
 * ------------------------------------------------------------------ */

function ConfirmSheet({
  visible, title, body, confirmLabel, confirming, onConfirm, onCancel,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const theme = useAppTheme();
  const { t } = useTranslation();

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
        onPress={onCancel}
        style={[styles.overlay, { backgroundColor: theme.colors.overlay, padding: theme.spacing.xl }]}
      >
        <Pressable
          // Swallows the backdrop press without becoming a control itself.
          accessibilityRole="none"
          onPress={() => {}}
          style={[
            styles.overlayCard,
            {
              maxWidth: theme.layout.maxContentWidth * 0.6,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.xl,
              padding: theme.spacing.xl,
              gap: theme.spacing.md,
            },
            theme.shadow.xl,
          ]}
        >
          <Text role="h3" weight="bold">{title}</Text>
          <Text role="bodySm" tone="muted">{body}</Text>
          <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
            <Button title={confirmLabel} onPress={onConfirm} loading={confirming} />
            <Button title={t('common.cancel')} variant="ghost" onPress={onCancel} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export function InterviewScreen({ route, navigation }: Props) {
  const { sessionId, firstQuestion, category } = route.params;
  const { t, i18n } = useTranslation();
  const theme = useAppTheme();
  const { arrowForward } = useDirection();
  const user = useAuth((s) => s.user);
  const refreshMe = useAuth((s) => s.refreshMe);
  const balance = useBalance((s) => s.balance);
  const refreshBalance = useBalance((s) => s.refresh);
  const applyBalance = useBalance((s) => s.apply);

  const isEn = i18n.language.startsWith('en');
  const question = firstQuestion as QuestionRecord;

  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [quotaBlocked, setQuotaBlocked] = useState(false);

  // Progress has to come from the session, not from local state: the feedback
  // screen re-enters this route with `replace`, which discards local state.
  const [answered, setAnswered] = useState<number | null>(null);
  const [sessionCategory, setSessionCategory] = useState<{ nameAr?: string; nameEn?: string } | null>(
    category && (category.nameAr || category.nameEn) ? category : null,
  );

  const mounted = useRef(true);
  useEffect(() => {
    // Re-armed on setup, not just on first render: StrictMode's dev double-
    // invoke runs the cleanup once before the real mount, which would
    // otherwise leave every post-await state update permanently skipped.
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    api.get(`/sessions/${sessionId}`)
      .then(({ data }) => {
        if (!alive) return;
        setAnswered(data.session?.answers?.length ?? 0);
        if (data.session?.category) setSessionCategory(data.session.category);
      })
      .catch(() => { if (alive) setAnswered(0); });

    // The balance IS volatile — another device, an expiring allowance, a
    // top-up — so it is re-read once per mount, never per focus.
    refreshMe().catch(() => {});
    refreshBalance().catch(() => {});

    return () => { alive = false; };
  }, [sessionId, refreshBalance, refreshMe]);

  const isPremium = (balance?.plan ?? user?.plan) === 'premium';
  const current = (answered ?? 0) + 1;

  /**
   * How many more answers the balance can pay for.
   *
   * `practiceAnswerSeconds` is a flat charge the server sends; dividing the
   * available seconds by it is the only bounded number this screen can honestly
   * show. A subscriber is charged 0, so there is no ceiling and no total —
   * which is exactly what `ProgressTrack` renders when `total` is null.
   */
  const answerCost = balance?.costs?.practiceAnswerSeconds ?? null;
  const affordable = answerCost && answerCost > 0
    ? Math.floor((balance?.availableSeconds ?? 0) / answerCost)
    : null;
  const total = affordable === null ? null : (answered ?? 0) + Math.max(1, affordable);

  // `quotaBlocked` is set by a 402 and outranks the local arithmetic: the
  // server is the only authority on whether the next answer can be paid for.
  const outOfQuota = quotaBlocked || (affordable !== null && affordable <= 0);

  const categoryName = isEn
    ? (sessionCategory?.nameEn ?? sessionCategory?.nameAr)
    : (sessionCategory?.nameAr ?? sessionCategory?.nameEn);

  const questionText = isEn
    ? (question?.questionEn ?? question?.questionAr)
    : (question?.questionAr ?? question?.questionEn);

  const trimmedLength = answer.trim().length;
  const tooShort = trimmedLength < MIN_ANSWER;
  const nearLimit = answer.length > MAX_ANSWER * 0.9;

  const counterTone = answer.length >= MAX_ANSWER ? 'danger' : nearLimit ? 'warning' : 'muted';

  const answerMinHeight = useMemo(
    // Eight comfortable lines of body text — derived from the type scale so it
    // stays correct if the scale changes.
    () => theme.typography.scale.body.lineHeight * 8,
    [theme.typography.scale.body.lineHeight],
  );

  const onChangeAnswer = useCallback((value: string) => {
    setAnswer(value.slice(0, MAX_ANSWER));
    if (error) setError(null);
  }, [error]);

  const onSubmit = useCallback(async () => {
    setTouched(true);
    if (answer.trim().length < MIN_ANSWER) {
      setError(t('interview.tooShort'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post(`/sessions/${sessionId}/answer`, {
        questionId: question.id,
        userAnswer: answer.trim(),
        language: isEn ? 'en' : 'ar',
      });
      // The answer response already carries the new balance, so the extra GET
      // is skipped — and the count under the progress track is right before the
      // next screen even mounts.
      applyBalance(data.balance);
      await refreshMe().catch(() => {});
      navigation.replace('Feedback', {
        answerId: data.answerId,
        feedback: data.feedback,
        tokensUsed: data.tokensUsed,
        nextQuestion: data.nextQuestion,
        sessionId,
      });
    } catch (err) {
      if (!mounted.current) return;
      const status = statusOf(err);
      // 503 is a distinct state, not a connectivity problem: the model call
      // failed and the server already refunded the quota, so the honest advice
      // is "retry", not "check your connection".
      if (status === 402) setQuotaBlocked(true);
      else if (status === 503) setError(t('interview.aiUnavailable'));
      else setError(t('interview.submitFailed'));
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [answer, applyBalance, isEn, navigation, question?.id, refreshMe, sessionId, t]);

  const onEnd = useCallback(async () => {
    setEnding(true);
    try {
      await api.post(`/sessions/${sessionId}/end`);
    } catch {
      // Ending is best-effort — the summary reads the session either way.
    } finally {
      if (mounted.current) {
        setEnding(false);
        setConfirmEnd(false);
      }
      navigation.replace('SessionSummary', { sessionId });
    }
  }, [navigation, sessionId]);

  const onUpgrade = useCallback(() => navigation.navigate('Subscription'), [navigation]);

  return (
    <Screen
      scroll
      keyboardAvoiding
      contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}
    >
      {/* ---------------- Progress ---------------- */}
      <View style={{ gap: theme.spacing.sm }}>
        <View style={[styles.metaRow, { gap: theme.spacing.sm }]}>
          {answered === null ? (
            <Skeleton width="45%" height={theme.typography.scale.bodySm.fontSize} />
          ) : (
            <Text role="bodySm" weight="bold" flex numberOfLines={1}>
              {total
                ? t('interview.progress', { current, total })
                : t('interview.questionNumber', { current })}
            </Text>
          )}

          {categoryName ? (
            <Badge label={categoryName} tone="primary" icon="briefcase-outline" />
          ) : null}
        </View>

        <ProgressTrack current={current} total={total} />
      </View>

      {/* ---------------- Question ---------------- */}
      <MotiView
        key={question?.id}
        from={{ opacity: 0, translateY: theme.spacing.md }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: theme.motion.duration.normal }}
      >
        <View
          style={[
            styles.questionCard,
            {
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radii.xl,
              padding: theme.spacing.xl,
              gap: theme.spacing.md,
            },
            theme.shadow.brand,
          ]}
        >
          <View style={[styles.metaRow, { gap: theme.spacing.sm }]}>
            <View style={[styles.kickerRow, { gap: theme.spacing.xs }]}>
              <Ionicons name="chatbubble-ellipses" size={theme.layout.icon.sm} color={theme.colors.onPrimary} />
              <Text role="micro" weight="bold" tone="onBrand" style={styles.kicker}>
                {t('interview.kicker')}
              </Text>
            </View>
            {question?.difficulty ? (
              <Badge label={t(`difficulty.${question.difficulty}`)} tone="onDark" />
            ) : null}
          </View>

          <Text role="h2" weight="bold" tone="onBrand" accessibilityRole="header">
            {questionText}
          </Text>
        </View>
      </MotiView>

      {/* ---------------- Quota exhausted ---------------- */}
      {outOfQuota ? (
        <Card variant="outlined" padding="lg" style={{ borderColor: theme.colors.accentBorder }}>
          <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View
              style={[
                styles.centerIcon,
                {
                  width: theme.layout.avatar.lg,
                  height: theme.layout.avatar.lg,
                  borderRadius: theme.radii.pill,
                  backgroundColor: theme.colors.accentMuted,
                },
              ]}
            >
              <Ionicons name="hourglass-outline" size={theme.layout.icon.xl} color={theme.colors.accentText} />
            </View>
            <Text role="h3" weight="bold" align="center">{t('interview.limitReached')}</Text>
            <Text role="bodySm" tone="muted" align="center">{t('interview.limitBody')}</Text>
            <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm, marginTop: theme.spacing.xs }}>
              <Button
                title={t('interview.upgrade')}
                variant="accent"
                onPress={onUpgrade}
                iconRight={<Ionicons name="sparkles" size={theme.layout.icon.md} color={theme.colors.onAccent} />}
                accessibilityHint={t('interview.limitBody')}
              />
              <Button
                title={t('interview.limitViewSummary')}
                variant="ghost"
                onPress={() => setConfirmEnd(true)}
              />
            </View>
          </View>
        </Card>
      ) : (
        <>
          {/* ---------------- Answer ---------------- */}
          <View style={{ gap: theme.spacing.sm }}>
            <Input
              label={t('interview.answerLabel')}
              placeholder={t('interview.yourAnswer')}
              value={answer}
              onChangeText={onChangeAnswer}
              onBlur={() => setTouched(true)}
              multiline
              maxLength={MAX_ANSWER}
              editable={!submitting}
              textAlignVertical="top"
              accessibilityLabel={t('interview.answerLabel')}
              accessibilityHint={t('interview.hint')}
              error={touched && tooShort && error ? error : undefined}
              style={{
                minHeight: answerMinHeight,
                paddingVertical: theme.spacing.md,
              }}
            />

            <View style={[styles.metaRow, { gap: theme.spacing.md }]}>
              <Text role="caption" tone="muted" flex>
                {trimmedLength < HINT_UNTIL ? t('interview.hint') : ' '}
              </Text>
              <Text
                role="caption"
                weight={nearLimit ? 'bold' : 'regular'}
                tone={counterTone}
                accessibilityLabel={t('interview.charCount', { n: answer.length, max: MAX_ANSWER })}
              >
                {t('interview.charCount', { n: answer.length, max: MAX_ANSWER })}
              </Text>
            </View>
          </View>

          {/* ---------------- Submit error ---------------- */}
          {error && !tooShort ? (
            <View
              style={[
                styles.inlineError,
                {
                  backgroundColor: theme.colors.dangerMuted,
                  borderRadius: theme.radii.sm,
                  padding: theme.spacing.md,
                  gap: theme.spacing.sm,
                },
              ]}
            >
              <Ionicons name="alert-circle" size={theme.layout.icon.md} color={theme.colors.danger} />
              <Text role="caption" tone="danger" flex>{error}</Text>
            </View>
          ) : null}

          {/* ---------------- Tip ---------------- */}
          <Card variant="filled" padding="md">
            <View style={[styles.tipRow, { gap: theme.spacing.md }]}>
              <View
                style={[
                  styles.centerIcon,
                  {
                    width: theme.layout.avatar.sm,
                    height: theme.layout.avatar.sm,
                    borderRadius: theme.radii.sm,
                    backgroundColor: theme.colors.accentMuted,
                  },
                ]}
              >
                <Ionicons name="bulb-outline" size={theme.layout.icon.md} color={theme.colors.accentText} />
              </View>
              <View style={styles.tipText}>
                <Text role="bodySm" weight="bold">{t('interview.tipTitle')}</Text>
                <Text role="caption" tone="muted" style={{ marginTop: theme.spacing.xxs }}>
                  {t('interview.tipBody')}
                </Text>
              </View>
            </View>
          </Card>

          {/* ---------------- Actions ----------------
              These live in the scroll body rather than a pinned footer because
              `Screen` renders `footer` outside its KeyboardAvoidingView — a
              pinned bar would sit under the keyboard on iOS while typing. */}
          <View style={{ gap: theme.spacing.sm }}>
            <Button
              title={t('interview.submit')}
              size="lg"
              onPress={onSubmit}
              loading={submitting}
              // Deliberately not disabled while the answer is short: a dead
              // button explains nothing. Pressing it surfaces the reason.
              iconRight={
                <Ionicons name={arrowForward} size={theme.layout.icon.md} color={theme.colors.onPrimary} />
              }
              accessibilityLabel={t('interview.submit')}
              accessibilityHint={t('interview.thinkingHint')}
            />
            <Button
              title={t('interview.endSession')}
              variant="ghost"
              onPress={() => setConfirmEnd(true)}
              disabled={submitting}
              accessibilityHint={t('interview.endConfirmBody')}
            />

            {/* The charge and the balance, both from the server, stated before
                the tap that spends them. */}
            {answerCost !== null ? (
              <Text role="caption" tone="muted" align="center">
                {answerCost === 0
                  ? t('interview.answerCostFree')
                  : `${t('interview.answerCost', { label: durationLabel(answerCost, t) })} ${
                    t('interview.balanceLeft', {
                      label: balanceLabel(balance?.availableSeconds ?? 0, t),
                    })}`}
              </Text>
            ) : null}
          </View>
        </>
      )}

      <ThinkingOverlay visible={submitting} />

      <ConfirmSheet
        visible={confirmEnd}
        title={t('interview.endConfirmTitle')}
        body={t('interview.endConfirmBody')}
        confirmLabel={t('interview.endConfirmCta')}
        confirming={ending}
        onConfirm={onEnd}
        onCancel={() => setConfirmEnd(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  segments: { flexDirection: 'row', alignItems: 'center' },

  questionCard: { overflow: 'hidden' },
  kickerRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  kicker: { opacity: 0.8 },

  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlayCard: { width: '100%' },
  pulse: { alignItems: 'center', justifyContent: 'center' },
  stepRow: { flexDirection: 'row', alignItems: 'center' },

  centerIcon: { alignItems: 'center', justifyContent: 'center' },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start' },
  tipText: { flex: 1 },

  inlineError: { flexDirection: 'row', alignItems: 'center' },
});
