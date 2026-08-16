/**
 * The candidate's voice, over `window.SpeechRecognition`.
 *
 * Lifted from MeetingScreen's `startRecognition` / `stopRecognition`, including
 * the two rules the whole turn loop rests on:
 *
 *   • `onend` is the ONLY place an utterance is committed. The silence timer
 *     stops the recognizer and lets `onend` deliver the accumulated text, so a
 *     turn can never be sent twice or half-sent.
 *   • A deliberate stop detaches the handlers *before* aborting, so muting the
 *     mic or ending the call cannot post one last half-finished sentence.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SpeechErrorCode, SpeechRecognizer, UseSpeechRecognizer } from './contract';
import { SPEECH_LOCALE } from './contract';

const SR: any = typeof window !== 'undefined'
  ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  : null;

function toErrorCode(raw: unknown): SpeechErrorCode {
  switch (raw) {
    case 'not-allowed': return 'not-allowed';
    case 'service-not-allowed': return 'service-not-allowed';
    case 'language-not-supported': return 'language-not-supported';
    case 'no-speech': return 'no-speech';
    case 'network': return 'network';
    case 'aborted': return 'aborted';
    default: return 'unknown';
  }
}

export const useSpeechRecognizer: UseSpeechRecognizer = (options) => {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');

  const recRef = useRef<any>(null);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accRef = useRef('');
  const releasedRef = useRef(false);
  /** True only inside our own `stop()`, so the abort we caused stays silent. */
  const abortingRef = useRef(false);

  const cfgRef = useRef(options);
  useEffect(() => { cfgRef.current = options; });

  const stop = useCallback(() => {
    if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null; }

    const rec = recRef.current;
    recRef.current = null;
    accRef.current = '';

    if (rec) {
      // Detach first: a deliberate stop (mute, end call) must not commit a
      // half-finished utterance through `onend`.
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      rec.onspeechstart = null;
      abortingRef.current = true;
      try { rec.abort?.(); } catch { /* not implemented everywhere */ }
      try { rec.stop?.(); } catch { /* already stopped */ }
      abortingRef.current = false;
    }

    setListening(false);
    setInterim('');
  }, []);

  const start = useCallback(() => {
    if (!SR || releasedRef.current) return;
    if (recRef.current) return; // already open

    const rec = new SR();
    // The recognizer must be on the same locale as the interview, or an English
    // answer gets transcribed as Arabic phonetics and scored as noise.
    rec.lang = SPEECH_LOCALE[cfgRef.current.language];
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    accRef.current = '';

    const armSilence = () => {
      if (silenceRef.current) clearTimeout(silenceRef.current);
      silenceRef.current = setTimeout(() => {
        if (accRef.current.trim()) {
          // Let `onend` commit — that is the single place an utterance is sent.
          try { rec.stop(); } catch { /* noop */ }
        }
      }, cfgRef.current.silenceMs);
    };

    rec.onresult = (e: any) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) accRef.current += `${r[0].transcript} `;
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
      armSilence();
    };

    rec.onspeechstart = () => {
      if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null; }
    };

    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim('');
      if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null; }
      const final = accRef.current.trim();
      accRef.current = '';
      if (final && !releasedRef.current) cfgRef.current.onFinal(final);
    };

    rec.onerror = (e: any) => {
      setListening(false);
      const code = toErrorCode(e?.error);
      if (abortingRef.current && code === 'aborted') return;
      cfgRef.current.onError?.(code);
    };

    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      recRef.current = null;
      setListening(false);
    }
  }, []);

  const release = useCallback(() => {
    releasedRef.current = true;
    stop();
  }, [stop]);

  useEffect(() => () => { release(); }, [release]);

  return useMemo<SpeechRecognizer>(() => ({
    supported: !!SR,
    listening,
    interim,
    start,
    stop,
    release,
  }), [listening, interim, start, stop, release]);
};
