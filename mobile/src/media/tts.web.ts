/**
 * Interviewer voice — the browser's own neural speech synthesis, with server
 * TTS as the fallback.
 *
 * Why this order
 *   The interviewer used to be voiced only by `POST /api/tts`, which scrapes
 *   Google Translate's unofficial endpoint: a flat concatenative voice, one
 *   network round-trip per utterance, no contract. Every browser that can run
 *   this call screen also ships `window.speechSynthesis`, and on Windows both
 *   Edge and Chrome expose Microsoft's *Natural* (neural) voices through it. So
 *   the local voice goes first, and the server is kept only for engines with no
 *   usable voice for the interview language — a missing voice must never stall
 *   the interview.
 *
 * The two things that make this fiddly
 *   1. `getVoices()` is populated asynchronously. The first call on a cold page
 *      almost always returns `[]`, and the `voiceschanged` event that fills it
 *      is one some engines never fire. Hence `loadVoices()`: event plus
 *      timeout, cached once non-empty, warmed on mount.
 *   2. Chrome silently truncates a single utterance at roughly 15 seconds, so a
 *      reply is split into sentence-sized chunks and queued.
 *
 * The orchestration below — session counter, start timeout, end poll, and the
 * cancel-on-give-up — is carried over unchanged from `src/speech/webSpeech.ts`.
 * Every branch in it is a bug that was already found and fixed once.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  CaptureHandle, InterviewerVoice, SpeakOutcome, SpeakRequest, SpeechLang,
  UseInterviewerVoice, VoiceCandidate, VoiceGender,
} from './contract';
import { SPEECH_LOCALE, asCaptureHandle } from './contract';
import {
  ensureAudioContext, mixDestination, releaseAudioGraph, retainAudioGraph,
} from './audioGraph.web';
import { PITCH, RATE } from './locale';
import { splitForSpeech } from './splitForSpeech';
import { pickVoice } from './voiceScoring';

/** How long we wait for the voice list before giving up and scoring what we have. */
const VOICE_LOAD_TIMEOUT_MS = 1500;

/**
 * How long the first utterance may take to actually start before we treat the
 * engine as broken and fall back to server TTS. Generous, because an
 * "Online (Natural)" voice fetches its audio from Microsoft on first use.
 */
const START_TIMEOUT_MS = 3000;

/** Backstop poll for an engine that never fires `onend`. */
const END_POLL_MS = 400;

/* ------------------------------------------------------------------ *
 * Engine access
 * ------------------------------------------------------------------ */

function engine(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  const s = (window as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  return s && typeof s.speak === 'function' ? s : null;
}

function speechSynthesisSupported(): boolean {
  return engine() !== null;
}

function safeGetVoices(s: SpeechSynthesis): SpeechSynthesisVoice[] {
  try {
    return s.getVoices() ?? [];
  } catch {
    return [];
  }
}

let voiceCache: SpeechSynthesisVoice[] = [];
let voiceLoad: Promise<SpeechSynthesisVoice[]> | null = null;

/**
 * The voice list, waiting for `voiceschanged` when it is not ready yet.
 *
 * Safe to call early and often: the result is cached once it is non-empty, and
 * concurrent callers share one in-flight wait.
 */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const s = engine();
  if (!s) return Promise.resolve([]);

  const immediate = safeGetVoices(s);
  if (immediate.length) {
    voiceCache = immediate;
    return Promise.resolve(immediate);
  }
  if (voiceCache.length) return Promise.resolve(voiceCache);
  if (voiceLoad) return voiceLoad;

  voiceLoad = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let settled = false;

    const legacy = s as unknown as { onvoiceschanged: (() => void) | null };

    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { s.removeEventListener?.('voiceschanged', done); } catch { /* noop */ }
      if (legacy.onvoiceschanged === done) legacy.onvoiceschanged = null;
      const list = safeGetVoices(s);
      if (list.length) voiceCache = list;
      voiceLoad = null;
      resolve(voiceCache);
    };

    const timer = setTimeout(done, VOICE_LOAD_TIMEOUT_MS);

    // Both hooks, deliberately. `addEventListener?.()` is a *silent* no-op when
    // the method is missing — an optional call returns undefined rather than
    // throwing — so a `try/catch` around it can never fire, and an engine that
    // only exposes the `onvoiceschanged` property would sit out the whole
    // timeout before falling back to server TTS on the opening line. Wiring
    // both is safe: `done` is idempotent, and it unhooks whichever fired.
    if (typeof s.addEventListener === 'function') {
      try { s.addEventListener('voiceschanged', done); } catch { /* noop */ }
    }
    try { legacy.onvoiceschanged = done; } catch { /* noop */ }
  });

  return voiceLoad;
}

/* ------------------------------------------------------------------ *
 * Voice selection
 * ------------------------------------------------------------------ */

function toCandidate(voice: SpeechSynthesisVoice, index: number): VoiceCandidate {
  return {
    id: voice.voiceURI || `${voice.name}#${index}`,
    name: voice.name || '',
    lang: (voice.lang || '').toLowerCase().replace(/_/g, '-'),
    // `localService === false` is the signal that most reliably identifies a
    // cloud/neural voice on web. Native has no analogue for it.
    remote: typeof voice.localService === 'boolean' ? !voice.localService : undefined,
    isDefault: voice.default,
  };
}

/**
 * The best available voice, or null when the engine has nothing worth using —
 * in which case the caller falls back to server TTS.
 */
function pickSynthesisVoice(
  voices: SpeechSynthesisVoice[],
  lang: SpeechLang,
  gender: VoiceGender,
): SpeechSynthesisVoice | null {
  const candidates = voices.map(toCandidate);
  const best = pickVoice(candidates, lang, gender);
  if (!best) return null;
  // `pickVoice` returns one of the objects it was handed, so position is an
  // exact mapping back to the engine's own voice — safer than matching on a
  // `voiceURI` that some engines duplicate across entries.
  return voices[candidates.indexOf(best)] ?? null;
}

/* ------------------------------------------------------------------ *
 * Speaking — local neural voice
 * ------------------------------------------------------------------ */

interface SpeakOptions {
  text: string;
  lang: SpeechLang;
  gender: VoiceGender;
  onStart?: () => void;
  onEnd?: () => void;
}

/**
 * Session counter. Every `cancelBrowserSpeech()` bumps it, which is how a
 * queued utterance from a previous turn knows its callbacks are stale — the
 * `onerror` events the engine fires while `cancel()` drains its queue must not
 * be mistaken for "the interviewer finished speaking" and advance the
 * interview.
 */
let session = 0;
let endPoll: ReturnType<typeof setInterval> | null = null;

function stopEndPoll() {
  if (endPoll !== null) { clearInterval(endPoll); endPoll = null; }
}

function cancelBrowserSpeech() {
  session += 1;
  stopEndPoll();
  const s = engine();
  if (!s) return;
  try { s.cancel(); } catch { /* noop */ }
}

/**
 * Speak a line with the best local neural voice.
 *
 * Resolves `true` once audio has actually started — that is the caller's signal
 * that no fallback is needed. Resolves `false` when the engine is missing, has
 * no voice for the language, or never starts within `START_TIMEOUT_MS`; in
 * every one of those cases nothing has been heard yet, so the caller can fall
 * back to server TTS without doubling the line.
 */
async function speakWithBrowserVoice(opts: SpeakOptions): Promise<boolean> {
  const s = engine();
  if (!s) return false;

  const chunks = splitForSpeech(opts.text);
  if (!chunks.length) return false;

  const voice = pickSynthesisVoice(await loadVoices(), opts.lang, opts.gender);
  if (!voice) return false;

  // Anything still queued belongs to a previous turn.
  cancelBrowserSpeech();
  const mine = session;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let started = false;
    let closed = false;

    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    /**
     * The single exit. `notify` is false on the cancel path so a torn-down call
     * never advances the interview from a dead utterance.
     */
    const close = (notify: boolean) => {
      if (closed) return;
      closed = true;
      clearTimeout(startTimer);
      if (mine === session) stopEndPoll();
      settle(started);
      if (notify && mine === session) opts.onEnd?.();
    };

    /**
     * Abandon the browser voice while nothing has been audible yet, so the
     * caller falls back to server TTS.
     *
     * The `cancel()` is the load-bearing part. Only the *failing* utterance
     * reports an error — its siblings stay queued in the engine and would go on
     * speaking underneath the fallback, so the candidate would hear the line
     * twice, overlapping and out of sync. Dropping the queue is what makes
     * "resolve false" honestly mean "nothing was heard".
     */
    const giveUp = () => {
      if (closed) return;
      closed = true;
      clearTimeout(startTimer);
      if (mine === session) cancelBrowserSpeech();
      settle(false);
    };

    const startTimer = setTimeout(() => {
      if (started || closed) return;
      // The engine accepted the utterance and then never spoke. Drop it and let
      // the caller reach for the server voice instead of a silent avatar.
      giveUp();
    }, START_TIMEOUT_MS);

    const lastIndex = chunks.length - 1;

    chunks.forEach((chunk, i) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.voice = voice;
      utterance.lang = voice.lang || SPEECH_LOCALE[opts.lang];
      utterance.rate = RATE[opts.lang];
      utterance.pitch = PITCH;
      utterance.volume = 1;

      if (i === 0) {
        utterance.onstart = () => {
          if (started || closed || mine !== session) return;
          started = true;
          clearTimeout(startTimer);
          opts.onStart?.();
          settle(true);

          // Backstop: some engines drop `onend` for an utterance queued behind
          // another. Without this the interview would sit forever waiting on a
          // turn that already finished playing.
          stopEndPoll();
          let quiet = 0;
          endPoll = setInterval(() => {
            if (mine !== session) { stopEndPoll(); return; }
            if (s.speaking || s.pending) { quiet = 0; return; }
            quiet += 1;
            if (quiet >= 2) close(true);
          }, END_POLL_MS);
        };
      }

      if (i === lastIndex) {
        utterance.onend = () => {
          // An `onend` we never saw an `onstart` for still means the engine ran
          // the utterance — Chrome is known to drop `onstart` for speech queued
          // in the same tick as the `cancel()` above. `close` resolves the
          // promise with `started`, so leaving it false here would tell the
          // caller nothing was heard: it would then fetch server TTS and
          // repeat, out loud, a line the candidate has already listened to — on
          // top of an `onEnd` that has already advanced the interview.
          if (!closed && mine === session) started = true;
          close(true);
        };
      }
      utterance.onerror = () => {
        if (closed) return;
        // Nothing audible yet: hand the line to server TTS, dropping the rest
        // of the queue so the two voices cannot overlap.
        if (!started) { giveUp(); return; }
        // Already speaking. A mid-reply chunk failing is not worth restarting
        // the whole line for — the end-poll backstop still closes the turn. A
        // cancel fires `onerror` on everything still queued; the session check
        // inside `close` is what keeps that from looking like an ending.
        if (i === lastIndex) close(true);
      };

      try {
        s.speak(utterance);
      } catch {
        if (!started) giveUp();
        else if (i === lastIndex) close(true);
      }
    });
  });
}

/* ------------------------------------------------------------------ *
 * Hook
 * ------------------------------------------------------------------ */

const SILENT: SpeakOutcome = { heard: false, by: 'none', analysable: null };

export const useInterviewerVoice: UseInterviewerVoice = ({ fetchServerTts }) => {
  const [speaking, setSpeaking] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  /** The element source feeding `analyserRef`. Held so the pair can be
   *  disconnected: a `MediaElementAudioSourceNode` left wired to
   *  `ctx.destination` keeps itself and its <audio> element alive, so one
   *  orphaned chain per turn would accumulate over a long call. */
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const fetchRef = useRef(fetchServerTts);
  useEffect(() => { fetchRef.current = fetchServerTts; });

  const graphRef = useRef(false);
  /** Latched by release(); speak() must not resurrect the audio graph after it. */
  const releasedRef = useRef(false);
  const dropGraph = useCallback(() => {
    if (!graphRef.current) return;
    graphRef.current = false;
    releaseAudioGraph();
  }, []);

  const cancel = useCallback(() => {
    // Browser voice first: `cancel()` also invalidates the pending utterance's
    // callbacks, so a torn-down call cannot advance the interview from a line
    // that is being cut off mid-word.
    cancelBrowserSpeech();

    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onplay = null;
      audio.onended = null;
      audio.onerror = null;
      try { audio.pause(); } catch { /* noop */ }
      try { audio.removeAttribute('src'); } catch { /* noop */ }
      try { audio.load(); } catch { /* noop */ }
    }

    // Unwire this turn's audio graph. Once an <audio> element is routed through
    // `createMediaElementSource`, pausing it is not enough on its own to
    // guarantee silence — the graph is the only path to the speakers, and it
    // must be torn down or every turn leaves a live chain behind.
    const src = sourceRef.current;
    sourceRef.current = null;
    if (src) { try { src.disconnect(); } catch { /* noop */ } }
    const analyser = analyserRef.current;
    analyserRef.current = null;
    if (analyser) { try { analyser.disconnect(); } catch { /* noop */ } }

    const url = audioUrlRef.current;
    audioUrlRef.current = null;
    if (url) { try { URL.revokeObjectURL(url); } catch { /* noop */ } }

    setSpeaking(false);
  }, []);

  const speak = useCallback(async (req: SpeakRequest): Promise<SpeakOutcome> => {
    // The native twin opens with the same guard. Without it a speak() racing
    // teardown re-opens the audio graph that release() just closed, and it
    // then lives for the rest of the app's lifetime.
    if (releasedRef.current) return SILENT;
    cancel();

    if (speechSynthesisSupported()) {
      const spoken = await speakWithBrowserVoice({
        text: req.text,
        lang: req.lang,
        gender: req.gender,
        onStart: () => { setSpeaking(true); req.onStart?.('local-voice', null); },
        onEnd: () => { setSpeaking(false); req.onEnd?.(); },
      });
      if (spoken) return { heard: true, by: 'local-voice', analysable: null };
    }

    // The local attempt is awaited, and the call can be torn down inside that
    // window — every turn spends up to START_TIMEOUT_MS in it. `release()`
    // cancels the queued utterance, which settles the promise `false`, so
    // without this the fall-through would fetch server TTS and talk over the
    // evaluation screen. Worse, `release()` has already closed the shared audio
    // graph: `ensureAudioContext()` below would open a brand-new one that no
    // `release()` will ever close. The session counter cannot catch this — the
    // `mine` below is taken *after* the cancel bumped it — so the latch has to.
    // The native twin guards the same seam (tts.native.ts, after speakLocally).
    if (releasedRef.current) return SILENT;

    // Taken after the local attempt, which runs its own session bookkeeping.
    // From here it guards the round-trip: a cancel during the fetch must not
    // start playing a line the call has already moved past.
    const mine = session;

    try {
      const buffer = await fetchRef.current({
        text: req.text, gender: req.gender, language: req.lang,
      });
      // Two different races, two different guards: `mine !== session` catches a
      // `cancel()` (the interview moved on), the latch catches a `release()`
      // (the call is gone and the audio graph with it).
      if (releasedRef.current) { cancel(); return SILENT; }
      if (mine !== session) return SILENT;

      const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/mpeg' }));
      audioUrlRef.current = url;

      const audio = new Audio(url);
      audio.crossOrigin = 'anonymous';
      audioRef.current = audio;

      // Route through an analyser so the presence ring can breathe with the
      // real waveform, and into the recording mix when one is running. The
      // analyser is the handle the level meter is given: it is the only node in
      // this chain that can be sampled.
      let analysable: CaptureHandle | null = null;
      try {
        const ctx = ensureAudioContext();
        if (ctx) {
          const src = ctx.createMediaElementSource(audio);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.6;
          src.connect(analyser);
          analyser.connect(ctx.destination);
          const mix = mixDestination();
          if (mix) analyser.connect(mix);
          sourceRef.current = src;
          analyserRef.current = analyser;
          analysable = asCaptureHandle(analyser);
        }
      } catch {
        // Analyser wiring is optional — playback still works without it.
      }

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        setSpeaking(false);
        if (audioUrlRef.current === url) {
          audioUrlRef.current = null;
          try { URL.revokeObjectURL(url); } catch { /* noop */ }
        }
        if (mine === session) req.onEnd?.();
      };

      audio.onplay = () => { setSpeaking(true); req.onStart?.('server-tts', analysable); };
      audio.onended = finish;
      audio.onerror = finish;
      await audio.play();

      return { heard: true, by: 'server-tts', analysable };
    } catch {
      // Nothing was heard. `cancel` detaches the half-built element so a late
      // `onerror` cannot fire `onEnd` on top of the caller's own fallback, and
      // the caller is free to carry on silently rather than deadlock.
      cancel();
      return SILENT;
    }
  }, [cancel]);

  const warmUp = useCallback(async () => { await loadVoices(); }, []);

  const hasVoiceFor = useCallback(async (lang: SpeechLang, gender: VoiceGender) => {
    if (!speechSynthesisSupported()) return false;
    return pickSynthesisVoice(await loadVoices(), lang, gender) !== null;
  }, []);

  const release = useCallback(() => {
    releasedRef.current = true;
    cancel();
    dropGraph();
  }, [cancel, dropGraph]);

  useEffect(() => {
    graphRef.current = true;
    retainAudioGraph();
    return () => { release(); };
  }, [release]);

  return useMemo<InterviewerVoice>(() => ({
    speaking,
    speak,
    cancel,
    warmUp,
    hasVoiceFor,
    release,
  }), [speaking, speak, cancel, warmUp, hasVoiceFor, release]);
};
