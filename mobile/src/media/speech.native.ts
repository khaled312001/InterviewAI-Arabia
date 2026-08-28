/**
 * The candidate's voice — Android/iOS speech recognition.
 *
 * This is the native half of `UseSpeechRecognizer`. The web half wraps
 * `window.SpeechRecognition`, which hands you a long-lived object with its own
 * handlers; the native module is a *singleton* with a global event emitter, so
 * the same contract has to be rebuilt out of different parts. Three of those
 * parts are not optional, and each one is a field failure the web build simply
 * does not have:
 *
 *   1. Android runs a SEGMENTED session. `results[0].transcript` resets to `''`
 *      after every `isFinal`, so a candidate who pauses to think mid-answer
 *      loses everything said before the pause unless the finals are accumulated
 *      on this side. (jamsch/expo-speech-recognition#87)
 *   2. Android ≤ 12 has no `EXTRA_SEGMENTED_SESSION`, so `continuous` does not
 *      exist there and the service also drops the session on its own idle
 *      timers. Continuous listening is emulated by re-opening on `end`.
 *   3. `stop()` races the open segment and surfaces a `client` error as often as
 *      it returns the final transcript (#158, #165). Nothing here depends on
 *      `stop()`'s result — the accumulator is the source of truth and the
 *      session is closed with `abort()`.
 *
 * Everything above sits *below* the silence timer and the single commit point,
 * so the observable behaviour is identical to web: one `onFinal` per turn, with
 * the trimmed accumulated text, never as a result of `stop()` or `release()`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
// `addSpeechRecognitionListener` was removed in expo-speech-recognition 56
// (SDK 54): the module now extends NativeModule and carries `.addListener`.
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type {
  ExpoSpeechRecognitionErrorCode,
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
// Renamed from `Subscription` in expo-modules-core for SDK 54.
import type { EventSubscription } from 'expo-modules-core';

import { SPEECH_LOCALE } from './contract';
import type {
  SpeechErrorCode,
  SpeechRecognizer,
  SpeechRecognizerOptions,
  UseSpeechRecognizer,
} from './contract';

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

/**
 * Whether the platform can hold a session open by itself. Android gained
 * segmented sessions in 13 (API 33); below that `continuous` is rejected and
 * the restart loop is the only thing keeping the mic open between sentences.
 */
const NATIVE_CONTINUOUS =
  Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) >= 33);

/** Breathing room for the recognizer to release the mic before we re-open it. */
const RESTART_DELAY_MS = 220;
/** How many synchronous start() failures before we stop pretending to listen. */
const MAX_START_ATTEMPTS = 3;

/**
 * How many *hard* failures in a row before we stop retrying. Silence codes are
 * excluded — a candidate thinking for thirty seconds is the normal case, not a
 * fault — so this only counts network/busy/client style errors, which back off
 * linearly and are usually transient.
 */
const MAX_ERROR_STREAK = 5;

/**
 * The mic level ring is driven by the recognizer's `volumechange` event
 * (Android's `onRmsChanged`). Only the call that opens the session can enable
 * it, and the recognizer owns the single microphone client for the whole
 * interview, so it has to be switched on here or the ring is dead everywhere.
 */
const VOLUME_EVENT_INTERVAL_MS = 100;

/* ------------------------------------------------------------------ *
 * Error classification
 * ------------------------------------------------------------------ */

const ERROR_CODES: Record<ExpoSpeechRecognitionErrorCode, SpeechErrorCode> = {
  aborted: 'aborted',
  'audio-capture': 'unknown',
  'bad-grammar': 'unknown',
  busy: 'busy',
  client: 'unknown',
  'language-not-supported': 'language-not-supported',
  network: 'network',
  'no-speech': 'no-speech',
  'not-allowed': 'not-allowed',
  'service-not-allowed': 'service-not-allowed',
  'speech-timeout': 'no-speech',
  // New in expo-speech-recognition 56: the recogniser was cut off by another
  // audio client — an incoming call, an alarm, another app taking the mic.
  // NOT mapped to 'aborted': that is reserved for our own abort() call, and
  // conflating them would report the user's own cancellation for something
  // that happened to them.
  interrupted: 'busy',
  unknown: 'unknown',
};

/** Retrying these is pointless — the turn, and usually the call, is over. */
const FATAL: ReadonlySet<ExpoSpeechRecognitionErrorCode> = new Set<ExpoSpeechRecognitionErrorCode>([
  'not-allowed',
  'service-not-allowed',
  'language-not-supported',
  'bad-grammar',
]);

/** Not failures at all: the recognizer heard nothing and closed. Re-open. */
const SILENCE: ReadonlySet<ExpoSpeechRecognitionErrorCode> = new Set<ExpoSpeechRecognitionErrorCode>([
  'no-speech',
  'speech-timeout',
]);

/**
 * Whether this device has a recognition service at all.
 *
 * On Android this is `SpeechRecognizer.isRecognitionAvailable(context)`, which
 * is false on handsets shipped without Google's recognizer — a real supported
 * path in this market, not an edge case, and the reason `supported` is a hard
 * gate rather than a hint. The `try` also covers the module being absent from
 * the binary entirely (an old dev client built before it was added).
 */
function probeAvailability(): boolean {
  if (Platform.OS === 'web') return false;
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Hook
 * ------------------------------------------------------------------ */

export const useSpeechRecognizer: UseSpeechRecognizer = (opts) => {
  const optsRef = useRef<SpeechRecognizerOptions>(opts);
  optsRef.current = opts;

  const [supported, setSupported] = useState<boolean>(probeAvailability);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');

  const supportedRef = useRef(supported);
  supportedRef.current = supported;

  /** The candidate is meant to be speaking. Every handler is gated on this. */
  const activeRef = useRef(false);
  const releasedRef = useRef(false);
  /** Our belief about whether a native session is open. Best effort. */
  const runningRef = useRef(false);
  const finalsRef = useRef('');
  const sessionRef = useRef(0);
  const errorStreakRef = useRef(0);
  const permissionRef = useRef<boolean | null>(null);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Consecutive synchronous `start()` throws. Reset by the first success. */
  const startFailRef = useRef(0);
  /**
   * Late-bound `fail`. `beginNative` has to be able to give up, but `fail` is
   * declared after it and depends on `commit`; a ref breaks the cycle without
   * reordering the whole hook.
   */
  const failRef = useRef<((code: SpeechErrorCode, permanent: boolean) => void) | null>(null);

  const clearTimers = useCallback(() => {
    if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null; }
    if (restartRef.current) { clearTimeout(restartRef.current); restartRef.current = null; }
  }, []);

  /**
   * Close the native session. `abort()` and not `stop()`: `stop()` asks the
   * recognizer for one last result, which is exactly the race that returns a
   * `client` error instead of a transcript. We already hold every final we
   * were given, so there is nothing left to ask for — and `abort()` is the
   * only one that reliably hands the microphone back.
   *
   * Called unconditionally rather than behind `runningRef`: if our belief is
   * wrong the call is a cheap no-op, whereas a session we failed to abort is a
   * hot microphone that outlives the call.
   */
  const stopNative = useCallback(() => {
    runningRef.current = false;
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // Nothing was open.
    }
  }, []);

  const emitError = useCallback((code: SpeechErrorCode) => {
    optsRef.current.onError?.(code);
  }, []);

  /**
   * The single commit point for an utterance.
   *
   * The guards are flipped *before* `abort()` on purpose. Aborting makes the
   * module emit `error: 'aborted'` and then `end`, and those events must not be
   * able to restart the loop or commit a second time — flipping `activeRef` and
   * bumping the session first is the native equivalent of the web build
   * detaching its handlers before aborting.
   */
  const commit = useCallback(() => {
    clearTimers();
    const text = finalsRef.current.trim();
    finalsRef.current = '';
    activeRef.current = false;
    sessionRef.current += 1;
    setInterim('');
    setListening(false);
    stopNative();
    if (text) optsRef.current.onFinal(text);
  }, [clearTimers, stopNative]);

  /** Silence-based endpointing, re-armed by every result. */
  const armSilence = useCallback(() => {
    if (silenceRef.current) clearTimeout(silenceRef.current);
    silenceRef.current = setTimeout(() => {
      silenceRef.current = null;
      if (!activeRef.current) return;
      if (finalsRef.current.trim()) commit();
    }, optsRef.current.silenceMs);
  }, [commit]);

  const beginNative = useCallback(() => {
    if (!activeRef.current || releasedRef.current || runningRef.current) return;
    runningRef.current = true;
    try {
      ExpoSpeechRecognitionModule.start({
        // Same locale as the interviewer, or an English answer comes back as
        // Arabic phonetics and gets scored as noise.
        lang: SPEECH_LOCALE[optsRef.current.language],
        interimResults: true,
        maxAlternatives: 1,
        continuous: NATIVE_CONTINUOUS,
        requiresOnDeviceRecognition: false,
        volumeChangeEventOptions: {
          enabled: true,
          intervalMillis: VOLUME_EVENT_INTERVAL_MS,
        },
      });
      setListening(true);
      startFailRef.current = 0;
    } catch {
      runningRef.current = false;
      setListening(false);
      // A synchronous throw means the recognizer never started, so no `end`
      // event will arrive to drive the usual restart — without retrying here
      // the microphone stays dead for the rest of the interview. Back off so a
      // genuinely broken engine does not spin, and give up loudly after a few
      // attempts rather than looking like it is still listening.
      startFailRef.current += 1;
      if (startFailRef.current >= MAX_START_ATTEMPTS) {
        startFailRef.current = 0;
        failRef.current?.('service-not-allowed', true);
      } else {
        restartRef.current = setTimeout(() => {
          restartRef.current = null;
          beginNative();
        }, RESTART_DELAY_MS * startFailRef.current);
      }
    }
  }, []);

  const scheduleRestart = useCallback((delayMs: number) => {
    if (!activeRef.current || releasedRef.current) return;
    if (restartRef.current) clearTimeout(restartRef.current);
    restartRef.current = setTimeout(() => {
      restartRef.current = null;
      beginNative();
    }, delayMs);
  }, [beginNative]);

  /**
   * Give up on this turn. Anything already transcribed is committed first —
   * losing a half-finished answer because the recognizer fell over is worse for
   * the candidate than a short turn, and it is still exactly one `onFinal`.
   */
  const fail = useCallback((code: SpeechErrorCode, permanent: boolean) => {
    clearTimers();
    if (finalsRef.current.trim()) {
      commit();
    } else {
      activeRef.current = false;
      sessionRef.current += 1;
      setInterim('');
      setListening(false);
      stopNative();
    }
    if (permanent) setSupported(false);
    emitError(code);
  }, [clearTimers, commit, emitError, stopNative]);

  useEffect(() => { failRef.current = fail; }, [fail]);

  const ensurePermission = useCallback(async (): Promise<boolean> => {
    if (permissionRef.current !== null) return permissionRef.current;
    try {
      const current = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (current.granted) {
        permissionRef.current = true;
        return true;
      }
      if (!current.canAskAgain) {
        permissionRef.current = false;
        return false;
      }
      const asked = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      permissionRef.current = asked.granted;
      return asked.granted;
    } catch {
      // Some MIUI builds throw out of the permission bridge rather than
      // resolving a denial (#138). Treat it as a denial, not as a crash.
      permissionRef.current = false;
      return false;
    }
  }, []);

  /* -------------------- native events -------------------- */

  useEffect(() => {
    if (!supported) return;

    const subs: EventSubscription[] = [
      ExpoSpeechRecognitionModule.addListener('start', () => {
        runningRef.current = true;
        if (activeRef.current) setListening(true);
      }),

      ExpoSpeechRecognitionModule.addListener('result', (ev: ExpoSpeechRecognitionResultEvent) => {
        if (!activeRef.current) return;
        errorStreakRef.current = 0;
        const text = ev.results[0]?.transcript ?? '';
        if (ev.isFinal) {
          // The accumulator. Android's segmented session resets `transcript`
          // to '' after every final, so this is the only place the answer
          // survives a think-pause.
          const trimmed = text.trim();
          if (trimmed) finalsRef.current += `${trimmed} `;
          setInterim('');
        } else {
          setInterim(text);
        }
        armSilence();
      }),

      ExpoSpeechRecognitionModule.addListener('speechstart', () => {
        // Someone is talking: stop counting silence until the next result.
        if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null; }
      }),

      ExpoSpeechRecognitionModule.addListener('speechend', () => {
        if (activeRef.current) armSilence();
      }),

      ExpoSpeechRecognitionModule.addListener('end', () => {
        runningRef.current = false;
        if (!activeRef.current || releasedRef.current) return;
        // Re-arm before restarting: the session can close with text already
        // accumulated, and the pause the candidate is taking still has to be
        // able to end the turn.
        if (finalsRef.current.trim()) armSilence();
        scheduleRestart(RESTART_DELAY_MS);
      }),

      ExpoSpeechRecognitionModule.addListener('error', (ev: ExpoSpeechRecognitionErrorEvent) => {
        if (!activeRef.current || releasedRef.current) return;
        if (ev.error === 'aborted') return; // we caused it
        const code = ERROR_CODES[ev.error] ?? 'unknown';
        if (FATAL.has(ev.error)) {
          // Only a missing recognizer is permanent; a locale the engine cannot
          // speak is reported but leaves the gate open for the other language.
          fail(code, ev.error === 'service-not-allowed');
          return;
        }
        if (SILENCE.has(ev.error)) {
          scheduleRestart(RESTART_DELAY_MS);
          return;
        }
        errorStreakRef.current += 1;
        if (errorStreakRef.current > MAX_ERROR_STREAK) {
          fail(code, false);
          return;
        }
        scheduleRestart(RESTART_DELAY_MS * errorStreakRef.current);
      }),
    ];

    return () => {
      for (const sub of subs) sub.remove();
    };
  }, [supported, armSilence, fail, scheduleRestart]);

  /* -------------------- public surface -------------------- */

  const start = useCallback(() => {
    if (releasedRef.current || !supportedRef.current) return;
    if (activeRef.current) return; // re-entrant safe
    activeRef.current = true;
    errorStreakRef.current = 0;
    finalsRef.current = '';
    setInterim('');

    const mine = ++sessionRef.current;
    void (async () => {
      const granted = await ensurePermission();
      // The permission dialog can outlive the turn that asked for it.
      if (mine !== sessionRef.current || !activeRef.current || releasedRef.current) return;
      if (!granted) {
        activeRef.current = false;
        setListening(false);
        emitError('not-allowed');
        return;
      }
      beginNative();
    })();
  }, [beginNative, emitError, ensurePermission]);

  const stop = useCallback(() => {
    clearTimers();
    activeRef.current = false;
    sessionRef.current += 1;
    finalsRef.current = '';
    setInterim('');
    setListening(false);
    stopNative();
  }, [clearTimers, stopNative]);

  const release = useCallback(() => {
    releasedRef.current = true;
    stop();
  }, [stop]);

  // Backstop for the microphone: even if the screen forgets to tear down, an
  // unmount must not leave a recognition session running.
  useEffect(() => release, [release]);

  return useMemo<SpeechRecognizer>(
    () => ({ supported, listening, interim, start, stop, release }),
    [supported, listening, interim, start, stop, release],
  );
};
