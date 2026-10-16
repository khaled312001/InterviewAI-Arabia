import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, ScrollView, Switch, AppState, Platform, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { useAppTheme } from '../../theme/useTheme';
import { Screen, Text, Card, Button, Input, Badge } from '../../components';
import { useBalance } from '../../store/balance';
import { Chip } from '../career/careerUi';
import {
  assistApi, assistErrorKind, streamAnswer, AssistError,
  type AnswerMode, type AssistBilling, type AssistErrorKind, type AssistSession, type AssistSetup,
} from './assistApi';
import {
  endsWithQuestionMark, findQuestion, isReadingAnswer, lastSpeech, wordCount,
} from './questionDetect';
import { useLiveTranscriber } from './liveTranscriber';
import type { TranscriberError, TranscriberSource } from './liveTranscriber.types';

/* ------------------------------------------------------------------ *
 * Tuning — every number here is time the candidate spends waiting.
 * ------------------------------------------------------------------ */

/**
 * Pause after a finished question before answering. The recogniser has
 * already waited out its own end-of-speech (300 ms on the stream), so these
 * are on top of that and deliberately short: users noticed 1.5–2.5 s on the
 * desktop app. If the interviewer carries on, the answer restarts with the
 * whole question (CONTINUE_WINDOW_MS), which is the cheaper mistake.
 */
const QUESTION_MARK_PAUSE_MS = 250;
/** A question-shaped sentence the recogniser did not punctuate. */
const QUESTION_PAUSE_MS = 700;
/** Speech this soon after an answer started continues the same question. */
const CONTINUE_WINDOW_MS = 2500;
const CONTINUE_MIN_WORDS = 3;
/** Transcript context sent with each answer. */
const CONTEXT_CHARS = 6000;
const MAX_SEGMENTS = 200;
/** Answer text sizes the reader can step through. */
const ANSWER_ROLES = ['h4', 'h3', 'h2'] as const;
const KEEP_AWAKE_TAG = 'live-assist';

interface Segment { id: number; text: string; question: boolean }
interface Suggestion { id: number; question: string; text: string; streaming: boolean; failed?: boolean }

const errorKey = (k: AssistErrorKind | TranscriberError) => {
  switch (k) {
    case 'quota': case 'network': case 'ai': case 'rate': case 'expired': case 'notFound':
    case 'denied': case 'unsupported': case 'noTabAudio':
      return `assist.errors.${k}`;
    case 'stt': return 'assist.errors.unsupported';
    default: return 'assist.errors.other';
  }
};

let segmentSeq = 0;

/**
 * The live view: what the room is saying, the question that was heard, and
 * the answer being written for it — large, because it is read at a glance in
 * the middle of a conversation.
 */
export function LiveAssistScreen({ route, navigation }: any) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const setAvailableSeconds = useBalance((s) => s.setAvailableSeconds);
  const refreshBalance = useBalance((s) => s.refresh);

  const setup: AssistSetup = route.params.setup;
  const [session, setSession] = useState<AssistSession>(route.params.session);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [billing, setBilling] = useState<AssistBilling>(session.billing);
  const [paused, setPaused] = useState(false);
  /** The server closed the session (swept, or another device took over). */
  const [ended, setEnded] = useState(false);
  /** Out of minutes. */
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [source, setSource] = useState<TranscriberSource>('mic');
  const [auto, setAuto] = useState(true);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [current, setCurrent] = useState<Suggestion | null>(null);
  const [history, setHistory] = useState<Suggestion[]>([]);
  const [typed, setTyped] = useState('');
  const [sizeIdx, setSizeIdx] = useState(1);
  /** Bumped on every end of utterance, so the trigger re-evaluates at once. */
  const [turnTick, setTurnTick] = useState(0);

  const busy = Boolean(current?.streaming);

  const currentRef = useRef(current);
  currentRef.current = current;
  const historyRef = useRef(history);
  historyRef.current = history;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const abortRef = useRef<AbortController | null>(null);
  /** Segments with an id at or below this have been answered. */
  const answeredIdRef = useRef(0);
  const lastQuestionRef = useRef('');
  const triggeredAtRef = useRef(0);
  /** The interviewer carried on after an answer started: re-ask the whole question. */
  const continuingRef = useRef(false);
  const restartingRef = useRef<Promise<boolean> | null>(null);

  /* -------------------------------------------------------- billing */

  const endSession = useCallback(() => {
    assistApi.end(sessionRef.current.sessionId).catch(() => {});
  }, []);

  const block = useCallback(() => {
    if (blockedRef.current) return;
    blockedRef.current = true;
    setBlocked(true);
    transcriberRef.current?.stop();
    endSession();
    refreshBalance();
  }, [endSession, refreshBalance]);

  const applyBilling = useCallback((b: AssistBilling | null | undefined) => {
    if (!b) return;
    setBilling(b);
    setAvailableSeconds(b.remainingSeconds);
    if (b.exhausted) block();
  }, [setAvailableSeconds, block]);

  /**
   * Open a fresh session with the same setup — after a sweep, or after the
   * session was taken over. Shared, so three failing calls restart it once.
   */
  const restartSession = useCallback((): Promise<boolean> => {
    if (restartingRef.current) return restartingRef.current;
    const run = (async () => {
      try {
        const next = await assistApi.start({ ...setup, resumeSessionId: sessionRef.current.sessionId });
        sessionRef.current = next;
        setSession(next);
        setEnded(false);
        applyBilling(next.billing);
        return true;
      } catch (e) {
        const kind = assistErrorKind(e);
        if (kind === 'quota') block();
        else setNotice(t(errorKey(kind)));
        return false;
      } finally {
        restartingRef.current = null;
      }
    })();
    restartingRef.current = run;
    return run;
  }, [setup, applyBilling, block, t]);

  const tick = useCallback(async () => {
    try {
      applyBilling(await assistApi.tick(sessionRef.current.sessionId));
    } catch (e) {
      const kind = assistErrorKind(e);
      if (kind === 'expired') {
        transcriberRef.current?.stop();
        setEnded(true);
      } else if (kind === 'quota') {
        block();
      }
      // A failed heartbeat is otherwise harmless: the next one bills the gap.
    }
  }, [applyBilling, block]);

  /* ----------------------------------------------------- transcript */

  const onMicError = useCallback((code: TranscriberError) => {
    if (code === 'quota') { block(); return; }
    if (code === 'expired') {
      setEnded(true);
      return;
    }
    setPaused(true);
    if (code !== 'sourceEnded') setNotice(t(errorKey(code)));
  }, [block, t]);

  const transcriber = useLiveTranscriber({
    language: session.speechLanguage,
    streaming: session.streamingStt,
    getCredential: () => assistApi.listen(sessionRef.current.sessionId).catch((e) => {
      throw new AssistError(assistErrorKind(e));
    }),
    onFinal: (text) => {
      segmentSeq += 1;
      const seg = { id: segmentSeq, text, question: false };
      setSegments((prev) => [...prev, seg].slice(-MAX_SEGMENTS));
    },
    onTurnEnd: () => setTurnTick((n) => n + 1),
    onError: onMicError,
  });
  const transcriberRef = useRef(transcriber);
  transcriberRef.current = transcriber;

  const listening = transcriber.state !== 'idle';

  const transcriptTail = useCallback(() => {
    const all = segmentsRef.current.map((s) => s.text).join('\n');
    return all.length > CONTEXT_CHARS ? all.slice(-CONTEXT_CHARS) : all;
  }, []);

  /* -------------------------------------------------------- answers */

  const ask = useCallback(async (
    question: string,
    mode: AnswerMode = 'answer',
    opts: { replace?: boolean; retried?: boolean } = {},
  ): Promise<void> => {
    if (blockedRef.current || !question.trim()) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const prev = currentRef.current;
    // Oldest first, as the server expects; the answer on screen is the last.
    const earlier = [...historyRef.current].reverse().map((h) => h.text)
      .concat(prev?.text ? [prev.text] : [])
      .filter(Boolean)
      .slice(-3);
    if (mode === 'answer' && prev?.text && !opts.replace) {
      setHistory((h) => [prev, ...h].slice(0, 10));
    }

    const id = Date.now();
    triggeredAtRef.current = id;
    lastQuestionRef.current = question;
    setNotice(null);
    setCurrent({ id, question, text: '', streaming: true });

    try {
      const b = await streamAnswer(
        sessionRef.current.sessionId,
        { question, transcript: transcriptTail(), previous: earlier, mode },
        {
          signal: ctrl.signal,
          onDelta: (d) => setCurrent((c) => (c && c.id === id ? { ...c, text: c.text + d } : c)),
        },
      );
      setCurrent((c) => (c && c.id === id ? { ...c, streaming: false } : c));
      applyBilling(b);
    } catch (e) {
      if (ctrl.signal.aborted) {
        setCurrent((c) => (c && c.id === id ? { ...c, streaming: false } : c));
        return;
      }
      const kind = assistErrorKind(e);
      if (kind === 'expired' && !opts.retried && await restartSession()) {
        return ask(question, mode, { ...opts, replace: true, retried: true });
      }
      setCurrent((c) => (c && c.id === id ? { ...c, streaming: false, failed: !c.text } : c));
      if (kind === 'quota') block();
      else setNotice(t(errorKey(kind)));
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }, [transcriptTail, applyBilling, restartSession, block, t]);

  /** Answer `question`, marking the speech it came from as answered. */
  const fire = useCallback((question: string, fresh: Segment[], replace: boolean) => {
    if (!fresh.length) return;
    answeredIdRef.current = fresh[fresh.length - 1].id;
    continuingRef.current = false;
    const ids = new Set(fresh.filter((s) => question.includes(s.text) || s.text.includes(question)).map((s) => s.id));
    if (!ids.size) ids.add(fresh[fresh.length - 1].id);
    setSegments((prev) => prev.map((s) => (ids.has(s.id) ? { ...s, question: true } : s)));
    void ask(question, 'answer', { replace });
  }, [ask]);

  // Automatic answers: a question was heard and the room went quiet.
  useEffect(() => {
    if (!auto || blocked || ended || transcriber.interim) return undefined;
    const fresh = segments.filter((s) => s.id > answeredIdRef.current);
    if (!fresh.length) return undefined;
    const freshText = fresh.map((s) => s.text).join(' ');

    if (continuingRef.current) {
      if (busy) return undefined;
      const whole = `${lastQuestionRef.current} ${freshText}`.trim();
      const timer = setTimeout(() => fire(whole, fresh, true), QUESTION_MARK_PAUSE_MS);
      return () => clearTimeout(timer);
    }
    if (busy) return undefined;

    const question = findQuestion(freshText, currentRef.current?.text || '');
    if (!question) return undefined;
    const delay = endsWithQuestionMark(question) ? QUESTION_MARK_PAUSE_MS : QUESTION_PAUSE_MS;
    const timer = setTimeout(() => fire(question, fresh, false), delay);
    return () => clearTimeout(timer);
  }, [segments, transcriber.interim, busy, auto, blocked, ended, turnTick, fire]);

  // The interviewer kept going just after an answer started: the question was
  // not finished. Stop, and answer the whole of it in its place.
  useEffect(() => {
    if (!auto || !busy || continuingRef.current) return;
    const fresh = segments.filter((s) => s.id > answeredIdRef.current);
    if (!fresh.length) return;
    const text = fresh.map((s) => s.text).join(' ');
    const soon = Date.now() - triggeredAtRef.current < CONTINUE_WINDOW_MS;
    if (soon && wordCount(text) >= CONTINUE_MIN_WORDS && !isReadingAnswer(text, currentRef.current?.text || '')) {
      continuingRef.current = true;
      abortRef.current?.abort();
    }
  }, [segments, busy, auto]);

  const answerNow = useCallback(() => {
    const fresh = segmentsRef.current.filter((s) => s.id > answeredIdRef.current);
    const heard = [fresh.map((s) => s.text).join(' '), transcriberRef.current.interim].join(' ').trim();
    if (heard) {
      const question = findQuestion(heard, currentRef.current?.text || '') || lastSpeech(heard);
      if (fresh.length) fire(question, fresh, false);
      else void ask(question, 'answer');
      return;
    }
    if (lastQuestionRef.current) {
      void ask(lastQuestionRef.current, 'answer', { replace: true });
      return;
    }
    setNotice(t('assist.live.nothingHeard'));
  }, [fire, ask, t]);

  const sendTyped = useCallback(() => {
    const q = typed.trim();
    if (!q) return;
    setTyped('');
    void ask(q, 'answer');
  }, [typed, ask]);

  const stopAnswer = useCallback(() => {
    continuingRef.current = false;
    abortRef.current?.abort();
  }, []);

  /* --------------------------------------------------- mic control */

  const resume = useCallback(async (src: TranscriberSource = sourceRef.current) => {
    if (blockedRef.current) return;
    setNotice(null);
    if (ended && !(await restartSession())) return;
    setPaused(false);
    await transcriberRef.current.start(src);
    void tick();
  }, [ended, restartSession, tick]);

  const pause = useCallback(() => {
    transcriberRef.current.stop();
    setPaused(true);
  }, []);

  const switchSource = useCallback((next: TranscriberSource) => {
    if (next === sourceRef.current && listening) return;
    transcriberRef.current.stop();
    setSource(next);
    sourceRef.current = next;
    void resume(next);
  }, [listening, resume]);

  // Listen from the moment the screen opens: Start was the tap.
  useEffect(() => {
    void transcriberRef.current.start('mic');
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The clock runs while the session is doing something billable.
  const live = !paused && !blocked && !ended && (listening || busy);
  const tickEvery = Math.max(5, billing.tickSeconds || 15) * 1000;
  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(() => { void tick(); }, tickEvery);
    return () => clearInterval(timer);
  }, [live, tickEvery, tick]);

  // The screen must not sleep in the middle of an interview.
  useEffect(() => {
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => { try { deactivateKeepAwake(KEEP_AWAKE_TAG); } catch { /* not held */ } };
  }, []);

  // A phone cannot listen from the background: pause there, pick up on return.
  const resumeOnActiveRef = useRef(false);
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        if (resumeOnActiveRef.current) {
          resumeOnActiveRef.current = false;
          void resume();
        }
      } else if (next === 'background' && transcriberRef.current.state !== 'idle') {
        resumeOnActiveRef.current = true;
        transcriberRef.current.stop();
      }
    });
    return () => sub.remove();
  }, [resume]);

  // Leaving the screen ends the session: the clock stops here, not at the sweep.
  useEffect(() => () => {
    abortRef.current?.abort();
    transcriberRef.current.stop();
    assistApi.end(sessionRef.current.sessionId).catch(() => {}).finally(() => refreshBalance());
    // Unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --------------------------------------------------------- render */

  const transcriptRef = useRef<ScrollView | null>(null);
  const shownSegments = useMemo(() => segments.slice(-40), [segments]);

  const statusLabel = blocked ? t('assist.live.ended')
    : ended ? t('assist.live.ended')
    : transcriber.state === 'starting' ? t('assist.live.starting')
    : transcriber.state === 'reconnecting' ? t('assist.live.reconnecting')
    : listening ? t('assist.live.listening')
    : t('assist.live.paused');
  const statusTone = listening && transcriber.state === 'listening' ? 'success' : blocked || ended ? 'danger' : 'neutral';
  const answerRole = ANSWER_ROLES[sizeIdx];

  return (
    <Screen scroll keyboardAvoiding contentStyle={{ paddingTop: theme.spacing.md, gap: theme.spacing.md, paddingBottom: theme.spacing['3xl'] }}>
      {/* ------------------------------------------------- status row */}
      <View style={[styles.row, { gap: theme.spacing.sm, flexWrap: 'wrap' }]}>
        <Badge size="md" tone={statusTone} icon={listening ? 'radio' : 'pause'} label={statusLabel} />
        <Badge
          size="md"
          tone={billing.warn ? 'warning' : 'neutral'}
          icon="time-outline"
          label={t('assist.live.minutesLeft', { count: billing.remainingMinutes })}
        />
        {session.job?.title ? <Badge size="md" icon="briefcase-outline" label={session.job.title} /> : null}
        <View style={styles.grow} />
        <Pressable
          onPress={() => setSizeIdx((i) => (i + 1) % ANSWER_ROLES.length)}
          accessibilityRole="button"
          accessibilityLabel={t('assist.live.textSize')}
          hitSlop={8}
          style={[styles.iconBtn, { borderColor: theme.colors.border, borderRadius: theme.radii.pill, width: theme.layout.control.sm, height: theme.layout.control.sm }]}
        >
          <Ionicons name="text" size={theme.layout.icon.md} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      {billing.warn && !blocked ? <Text role="caption" tone="warning">{t('assist.live.lowBalance')}</Text> : null}

      {blocked ? (
        <Card padding="lg" variant="outlined">
          <Text role="body" weight="bold">{t('assist.errors.quota')}</Text>
          <Button
            title={t('assist.buyMinutes')}
            variant="accent"
            style={{ marginTop: theme.spacing.md }}
            onPress={() => navigation.navigate('Subscription')}
          />
        </Card>
      ) : ended ? (
        <Card padding="lg" variant="outlined">
          <Text role="body">{t('assist.errors.expired')}</Text>
          <Button title={t('assist.live.startAgain')} style={{ marginTop: theme.spacing.md }} onPress={() => { void resume(); }} />
        </Card>
      ) : null}

      {/* ------------------------------------------------ the answer */}
      <Card padding="lg" depth>
        {current ? (
          <View style={{ gap: theme.spacing.md }}>
            <View style={{ backgroundColor: theme.colors.accentMuted, borderRadius: theme.radii.md, padding: theme.spacing.md }}>
              <Text role="micro" weight="bold" tone="accent">{t('assist.live.question')}</Text>
              <Text role="body" weight="bold" selectable>{current.question}</Text>
            </View>
            <View>
              <Text role="micro" weight="bold" tone="primary">{t('assist.live.answer')}</Text>
              {current.text ? (
                <Text role={answerRole} selectable style={{ marginTop: theme.spacing.xs }}>{current.text}</Text>
              ) : current.streaming ? (
                <View style={[styles.row, { gap: theme.spacing.sm, marginTop: theme.spacing.sm }]}>
                  <ActivityIndicator color={theme.colors.primary} />
                  <Text role="body" tone="secondary">{t('assist.live.thinking')}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={[styles.row, { gap: theme.spacing.md, alignItems: 'flex-start' }]}>
            <Ionicons name="chatbubble-ellipses-outline" size={theme.layout.icon.lg} color={theme.colors.textMuted} />
            <Text role="bodyLg" tone="secondary" flex>{t('assist.live.waiting')}</Text>
          </View>
        )}
      </Card>

      {notice ? <Text role="bodySm" tone="danger">{notice}</Text> : null}

      {/* ----------------------------------------------- answer actions */}
      <View style={[styles.row, { gap: theme.spacing.sm, flexWrap: 'wrap' }]}>
        <View style={styles.grow}>
          <Button
            title={t('assist.live.answerNow')}
            fullWidth
            disabled={blocked}
            onPress={answerNow}
            iconLeft={<Ionicons name="flash" size={18} color={theme.colors.textOnBrand} />}
          />
        </View>
        {busy ? (
          <Button title={t('assist.live.stopAnswer')} variant="outline" onPress={stopAnswer} />
        ) : null}
      </View>
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <View style={styles.grow}>
          <Button
            title={t('assist.live.regenerate')}
            variant="outline"
            size="sm"
            fullWidth
            disabled={!current?.text || busy || blocked}
            onPress={() => current && ask(current.question, 'regenerate', { replace: true })}
          />
        </View>
        <View style={styles.grow}>
          <Button
            title={t('assist.live.shorter')}
            variant="outline"
            size="sm"
            fullWidth
            disabled={!current?.text || busy || blocked}
            onPress={() => current && ask(current.question, 'shorter', { replace: true })}
          />
        </View>
      </View>

      {/* --------------------------------------------------- mic control */}
      <Card padding="md">
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <Pressable
            onPress={() => (listening ? pause() : void resume())}
            disabled={blocked}
            accessibilityRole="button"
            accessibilityLabel={listening ? t('assist.live.pause') : t('assist.live.resume')}
            style={({ pressed }) => [
              styles.micBtn,
              {
                width: theme.layout.avatar.lg,
                height: theme.layout.avatar.lg,
                borderRadius: theme.radii.pill,
                backgroundColor: listening ? theme.colors.success : theme.colors.primary,
                opacity: blocked ? 0.4 : pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons name={listening ? 'pause' : 'mic'} size={theme.layout.icon.xl} color={theme.colors.textOnBrand} />
          </Pressable>
          <View style={styles.grow}>
            <Text role="body" weight="bold">{listening ? t('assist.live.pause') : t('assist.live.resume')}</Text>
            <View style={[styles.row, { gap: theme.spacing.sm, marginTop: theme.spacing.xs }]}>
              <Text role="bodySm" tone="secondary" flex>{t('assist.live.auto')}</Text>
              <Switch value={auto} onValueChange={setAuto} />
            </View>
            {!auto ? <Text role="caption" tone="muted">{t('assist.live.autoHint')}</Text> : null}
          </View>
        </View>
        {transcriber.canCaptureTab ? (
          <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.md }}>
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <Chip icon="mic-outline" label={t('assist.live.sourceMic')} active={source === 'mic'} onPress={() => switchSource('mic')} />
              <Chip icon="browsers-outline" label={t('assist.live.sourceTab')} active={source === 'tab'} onPress={() => switchSource('tab')} />
            </View>
            <Text role="caption" tone="muted">{t('assist.live.sourceTabHint')}</Text>
          </View>
        ) : null}
      </Card>

      {/* ---------------------------------------------------- transcript */}
      <Card padding="md">
        <Text role="caption" weight="bold" tone="muted">{t('assist.live.transcript')}</Text>
        <ScrollView
          ref={transcriptRef}
          style={{ maxHeight: 200, marginTop: theme.spacing.xs }}
          nestedScrollEnabled
          onContentSizeChange={() => transcriptRef.current?.scrollToEnd({ animated: false })}
        >
          {shownSegments.length === 0 && !transcriber.interim ? (
            <Text role="bodySm" tone="muted">{t('assist.live.transcriptEmpty')}</Text>
          ) : null}
          {shownSegments.map((s) => (
            <Text
              key={s.id}
              role="bodySm"
              weight={s.question ? 'bold' : 'regular'}
              tone={s.question ? 'accent' : 'default'}
              style={{ marginTop: theme.spacing.xxs }}
            >
              {s.text}
            </Text>
          ))}
          {transcriber.interim ? (
            <Text role="bodySm" tone="muted" style={{ marginTop: theme.spacing.xxs, fontStyle: 'italic' }}>{transcriber.interim}</Text>
          ) : null}
        </ScrollView>
      </Card>

      <View style={[styles.row, { gap: theme.spacing.sm, alignItems: 'flex-end' }]}>
        <View style={styles.grow}>
          <Input
            label={t('assist.live.typeQuestion')}
            value={typed}
            onChangeText={setTyped}
            onSubmitEditing={sendTyped}
            returnKeyType="send"
            maxLength={2000}
          />
        </View>
        <Button title={t('assist.live.send')} variant="secondary" disabled={!typed.trim() || blocked} onPress={sendTyped} />
      </View>

      {/* ------------------------------------------------ earlier answers */}
      {history.length ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text role="h4" weight="bold">{t('assist.live.earlier')}</Text>
          {history.map((h) => (
            <Card key={h.id} padding="md" variant="outlined">
              <Text role="caption" weight="bold" tone="secondary">{h.question}</Text>
              <Text role="bodySm" selectable style={{ marginTop: theme.spacing.xs }}>{h.text}</Text>
            </Card>
          ))}
        </View>
      ) : null}

      <Button title={t('assist.live.end')} variant="ghost" onPress={() => navigation.goBack()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  iconBtn: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  micBtn: { alignItems: 'center', justifyContent: 'center' },
});
