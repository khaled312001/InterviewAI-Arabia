/**
 * The live transcript on a phone — the on-device recogniser, held open.
 *
 * The practice interview's recogniser (media/speech.native.ts) is built for
 * turns: it commits once when the candidate stops and closes. The assistant
 * listens for the whole interview, so this keeps one session running and cuts
 * it into utterances itself:
 *
 *   • Android 13+ segments a continuous session and marks each segment final,
 *     which is an utterance as it stands.
 *   • iOS keeps one growing transcript until the session ends, and Android 12
 *     and below cannot run a continuous session at all. For both, a pause of
 *     SILENCE_MS after the last partial result turns that partial into a
 *     final, and the session is restarted so the next question starts clean.
 *
 * The restart costs a fraction of a second, and it happens in a pause — which
 * is exactly where the interviewer stopped talking.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import type { EventSubscription } from 'expo-modules-core';

import { SPEECH_LOCALE } from '../../media/contract';
import type {
  LiveTranscriber, LiveTranscriberOptions, TranscriberState, UseLiveTranscriber,
} from './liveTranscriber.types';

const NATIVE_CONTINUOUS =
  Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) >= 33);

/** Quiet after the last partial result that ends an utterance. */
const SILENCE_MS = 800;
/** Breathing room for the recogniser to hand the microphone back. */
const RESTART_DELAY_MS = 150;
/** Hard failures in a row before giving up (silence is not a failure). */
const MAX_ERROR_STREAK = 6;

function probe(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

export const useLiveTranscriber: UseLiveTranscriber = (opts): LiveTranscriber => {
  const optsRef = useRef<LiveTranscriberOptions>(opts);
  optsRef.current = opts;

  const [supported] = useState(probe);
  const [state, setState] = useState<TranscriberState>('idle');
  const [interim, setInterim] = useState('');

  const activeRef = useRef(false);
  /** Set while a cut is in flight: late results from the old session are dropped. */
  const cuttingRef = useRef(false);
  const pendingRef = useRef('');
  const streakRef = useRef(0);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null; }
    if (restartRef.current) { clearTimeout(restartRef.current); restartRef.current = null; }
  }, []);

  const begin = useCallback(() => {
    if (!activeRef.current) return;
    const lang = optsRef.current.language === 'ar' ? SPEECH_LOCALE.ar : SPEECH_LOCALE.en;
    try {
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        maxAlternatives: 1,
        continuous: NATIVE_CONTINUOUS,
        requiresOnDeviceRecognition: false,
        // Question marks are half of how a question is recognised.
        addsPunctuation: true,
      });
    } catch {
      streakRef.current += 1;
      if (streakRef.current > MAX_ERROR_STREAK) {
        activeRef.current = false;
        setState('idle');
        optsRef.current.onError('unsupported');
        return;
      }
      restartRef.current = setTimeout(begin, RESTART_DELAY_MS * streakRef.current);
    }
  }, []);

  /** Emit what was heard as one utterance. */
  const flush = useCallback(() => {
    const text = pendingRef.current.trim();
    pendingRef.current = '';
    setInterim('');
    if (!text) return;
    optsRef.current.onFinal(text);
    optsRef.current.onTurnEnd();
  }, []);

  /** End the utterance on a pause and reopen the session for the next one. */
  const cut = useCallback(() => {
    silenceRef.current = null;
    if (!activeRef.current || !pendingRef.current.trim()) return;
    flush();
    cuttingRef.current = true;
    try { ExpoSpeechRecognitionModule.abort(); } catch { /* not running */ }
    // `end` follows the abort and restarts the session.
  }, [flush]);

  useEffect(() => {
    if (!supported) return undefined;
    const subs: EventSubscription[] = [
      ExpoSpeechRecognitionModule.addListener('start', () => {
        cuttingRef.current = false;
        if (activeRef.current) setState('listening');
      }),
      ExpoSpeechRecognitionModule.addListener('result', (ev: ExpoSpeechRecognitionResultEvent) => {
        if (!activeRef.current || cuttingRef.current) return;
        streakRef.current = 0;
        const text = (ev.results[0]?.transcript ?? '').trim();
        if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null; }
        if (ev.isFinal) {
          pendingRef.current = text || pendingRef.current;
          flush();
          return;
        }
        pendingRef.current = text;
        setInterim(text);
        if (text) silenceRef.current = setTimeout(cut, SILENCE_MS);
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        if (!activeRef.current) return;
        // A session that closed on its own may still hold an utterance.
        if (!cuttingRef.current && pendingRef.current.trim()) flush();
        if (restartRef.current) clearTimeout(restartRef.current);
        restartRef.current = setTimeout(begin, RESTART_DELAY_MS);
      }),
      ExpoSpeechRecognitionModule.addListener('error', (ev: ExpoSpeechRecognitionErrorEvent) => {
        if (!activeRef.current || ev.error === 'aborted') return;
        if (ev.error === 'not-allowed') {
          activeRef.current = false;
          clearTimers();
          setState('idle');
          optsRef.current.onError('denied');
          return;
        }
        if (ev.error === 'service-not-allowed' || ev.error === 'language-not-supported') {
          activeRef.current = false;
          clearTimers();
          setState('idle');
          optsRef.current.onError('unsupported');
          return;
        }
        // Silence closes the session; `end` reopens it. Anything else counts.
        if (ev.error !== 'no-speech' && ev.error !== 'speech-timeout') {
          streakRef.current += 1;
          if (streakRef.current > MAX_ERROR_STREAK) {
            activeRef.current = false;
            clearTimers();
            setState('idle');
            try { ExpoSpeechRecognitionModule.abort(); } catch { /* closed */ }
            optsRef.current.onError('network');
          }
        }
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [supported, begin, clearTimers, cut, flush]);

  const start = useCallback(async () => {
    if (!supported) { optsRef.current.onError('unsupported'); return; }
    if (activeRef.current) return;
    setState('starting');
    let granted = false;
    try {
      const current = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      granted = current.granted
        || (current.canAskAgain && (await ExpoSpeechRecognitionModule.requestPermissionsAsync()).granted);
    } catch {
      granted = false;
    }
    if (!granted) {
      setState('idle');
      optsRef.current.onError('denied');
      return;
    }
    activeRef.current = true;
    cuttingRef.current = false;
    streakRef.current = 0;
    pendingRef.current = '';
    begin();
  }, [supported, begin]);

  const stop = useCallback(() => {
    activeRef.current = false;
    clearTimers();
    pendingRef.current = '';
    setInterim('');
    setState('idle');
    try { ExpoSpeechRecognitionModule.abort(); } catch { /* not running */ }
  }, [clearTimers]);

  // The microphone must not outlive the screen.
  useEffect(() => stop, [stop]);

  return useMemo(() => ({
    supported, canCaptureTab: false, state, interim, start, stop,
  }), [supported, state, interim, start, stop]);
};
