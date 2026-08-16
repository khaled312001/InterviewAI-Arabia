/**
 * Interviewer voice — the browser's own neural speech synthesis.
 *
 * Why this exists
 *   The interviewer used to be voiced by `POST /api/tts`, which scrapes Google
 *   Translate's unofficial TTS endpoint. That is a flat concatenative voice, it
 *   costs a network round-trip per utterance (chunked and fetched *serially*,
 *   so a four-sentence reply meant four sequential HTTP requests before a
 *   single sound), and it hangs off an endpoint with no contract.
 *
 *   Every browser that can run this call screen at all — it already requires
 *   `getUserMedia`, `MediaRecorder` and `webkitSpeechRecognition` — also ships
 *   `window.speechSynthesis`. On Windows, Edge and Chrome expose Microsoft's
 *   *Natural* (neural) voices through it: "Microsoft Salma Online (Natural)"
 *   and "Microsoft Hamed Online (Natural)" for Arabic. Those are a different
 *   class of voice from the Google Translate scrape, and they start speaking
 *   without a round-trip of ours. So: browser first, server TTS only as the
 *   fallback for engines that have no usable voice for the language.
 *
 * The two things that make this fiddly
 *   1. `getVoices()` is populated asynchronously. The first call on a cold page
 *      almost always returns `[]`; the list arrives with a `voiceschanged`
 *      event that some engines never fire. Hence `loadVoices()` — event plus
 *      timeout, cached once non-empty.
 *   2. Chrome silently truncates a single utterance at roughly 15 seconds. The
 *      standard fix is to split the reply into sentence-sized utterances and
 *      queue them; that also gets the first syllable out sooner, because the
 *      engine only has to synthesise the opening sentence to start.
 *
 * Everything here is a no-op off the web platform, so callers do not branch.
 */

import { Platform } from 'react-native';

export type SpeechLang = 'ar' | 'en';
export type VoiceGender = 'male' | 'female';

/**
 * BCP-47 tag per interview language — used for both the synthesiser and the
 * `SpeechRecognition.lang` of the recognizer, so the interviewer and the
 * candidate are always on the same locale.
 *
 * Arabic resolves to Egyptian: it is the dialect of the product's primary
 * market, and it is what the Microsoft Arabic neural voices are trained on.
 */
export const SPEECH_LOCALE: Record<SpeechLang, string> = {
  ar: 'ar-EG',
  en: 'en-US',
};

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */

/**
 * Conversational, not newsreader. Neural voices default to a slightly formal
 * cadence; nudging the rate up a hair reads as "someone talking to you" and
 * shortens every reply, which is the other half of the "respond fast" ask.
 */
const RATE: Record<SpeechLang, number> = { ar: 1.02, en: 1.05 };
/** Left near-neutral on purpose — pitch shifting a neural voice sounds synthetic. */
const PITCH = 1.0;

/** Sentence-sized utterances: under Chrome's ~15s single-utterance ceiling. */
const MAX_UTTERANCE_CHARS = 180;

/** How long we wait for the voice list before giving up and scoring what we have. */
const VOICE_LOAD_TIMEOUT_MS = 1500;

/**
 * How long the first utterance may take to actually start before we treat the
 * engine as broken and hand the caller back to server TTS. Generous, because
 * an "Online (Natural)" voice fetches its audio from Microsoft on first use.
 */
const START_TIMEOUT_MS = 3000;

/** Backstop poll for an engine that never fires `onend`. */
const END_POLL_MS = 400;

/* ------------------------------------------------------------------ *
 * Engine access
 * ------------------------------------------------------------------ */

function engine(): SpeechSynthesis | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const s = (window as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  return s && typeof s.speak === 'function' ? s : null;
}

/** True when this platform can synthesise speech at all. */
export function speechSynthesisSupported(): boolean {
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
 * concurrent callers share one in-flight wait. Call it on mount to warm the
 * list so the first reply of the interview does not pay the wait.
 */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
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
    // the method is missing — optional call returns undefined rather than
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

/** Vendor markers for a neural/cloud voice rather than a concatenative one. */
const QUALITY_HINTS = ['natural', 'neural', 'online', 'wavenet', 'premium', 'enhanced', 'siri'];

/** Markers for the old robotic engines — the exact sound we are moving away from. */
const POOR_HINTS = ['espeak', 'compact', 'festival', 'pico', 'sapi 4'];

/**
 * Gendered voice names, by vendor. `speechSynthesisVoice` carries no gender
 * field anywhere, so the persona can only be matched by name.
 * Female is tested first: "female" contains "male".
 */
const FEMALE_HINTS = [
  'female', 'woman',
  // Arabic
  'salma', 'hoda', 'zariyah', 'amany', 'laila', 'layla', 'fatima', 'noura', 'sara', 'iman',
  // English
  'aria', 'jenny', 'michelle', 'ana', 'zira', 'samantha', 'sonia', 'libby', 'emma', 'ava',
];

const MALE_HINTS = [
  'male', 'man',
  // Arabic
  'hamed', 'shakir', 'naayf', 'fahed', 'moaz', 'ali', 'omar', 'bassel', 'hedi', 'taim',
  // English
  'guy', 'christopher', 'eric', 'brian', 'david', 'mark', 'ryan', 'daniel', 'alex', 'george',
];

function matchesAny(name: string, hints: string[]) {
  return hints.some((h) => name.includes(h));
}

/**
 * How well a voice fits the request. Negative means unusable.
 *
 * Ordering of the weights is the whole design: language correctness is a gate,
 * then voice *quality* dominates, and gender is a preference on top — a natural
 * female voice reading Ahmed's lines is a far better call than a robotic male
 * one, so gender never outranks quality.
 */
export function scoreVoice(voice: SpeechSynthesisVoice, lang: SpeechLang, gender: VoiceGender): number {
  const name = (voice.name || '').toLowerCase();
  const tag = (voice.lang || '').toLowerCase().replace(/_/g, '-');

  // Wrong language is disqualifying, not merely unattractive: an English
  // engine reading Arabic text is unintelligible.
  if (!tag.startsWith(lang)) return -1;

  let score = 100;

  // Regional fit.
  const preferred = SPEECH_LOCALE[lang].toLowerCase();
  if (tag === preferred) score += 30;
  else if (lang === 'ar' && (tag.startsWith('ar-sa') || tag.startsWith('ar-ae'))) score += 14;
  else if (lang === 'en' && (tag.startsWith('en-us') || tag.startsWith('en-gb'))) score += 10;

  // Quality — the reason this module exists.
  if (matchesAny(name, QUALITY_HINTS)) score += 70;
  if (matchesAny(name, POOR_HINTS)) score -= 80;
  // Cloud voices are the neural ones on every engine that has both.
  if (voice.localService === false) score += 12;

  // Persona fit.
  const isFemale = matchesAny(name, FEMALE_HINTS);
  const isMale = !isFemale && matchesAny(name, MALE_HINTS);
  if (isFemale || isMale) {
    const wanted = gender === 'female' ? isFemale : isMale;
    score += wanted ? 25 : -20;
  }

  if (voice.default) score += 2; // tie-break only

  return score;
}

/**
 * Quality floor. Only the `POOR_HINTS` penalty can drag a correct-language
 * voice this low — an ordinary non-neural system voice still scores 80+, even
 * with the wrong region and the wrong gender. So this rejects exactly the
 * eSpeak/"Compact" class, which sounds *worse* than the server fallback and
 * would otherwise win simply by being installed.
 */
const MIN_VOICE_SCORE = 60;

/**
 * The best available voice for the language, or `null` when the engine has
 * nothing worth using — in which case the caller falls back to server TTS.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: SpeechLang,
  gender: VoiceGender,
): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = MIN_VOICE_SCORE;
  for (const voice of voices) {
    const score = scoreVoice(voice, lang, gender);
    if (score > bestScore) { best = voice; bestScore = score; }
  }
  return best;
}

/** Whether this browser can voice the given language at all. */
export async function hasVoiceFor(lang: SpeechLang, gender: VoiceGender = 'female'): Promise<boolean> {
  if (!speechSynthesisSupported()) return false;
  return pickVoice(await loadVoices(), lang, gender) !== null;
}

/* ------------------------------------------------------------------ *
 * Speaking
 * ------------------------------------------------------------------ */

/**
 * Split a reply into utterance-sized pieces on sentence boundaries, keeping the
 * punctuation so the engine still hears the question mark and intones it.
 */
export function splitForSpeech(text: string): string[] {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return [];
  if (clean.length <= MAX_UTTERANCE_CHARS) return [clean];

  // Keep the terminator attached to the sentence it ends. Split on a captured
  // group and re-pair rather than using a lookbehind: this module is parsed on
  // native too (it just never runs there), and Hermes rejects lookbehind.
  const parts = clean.split(/([.!?،؛؟…]+)/);
  const sentences: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const piece = `${parts[i] ?? ''}${parts[i + 1] ?? ''}`.trim();
    if (piece) sentences.push(piece);
  }

  const out: string[] = [];
  let current = '';

  const flushLong = (piece: string) => {
    let rest = piece;
    while (rest.length > MAX_UTTERANCE_CHARS) {
      let cut = rest.lastIndexOf(' ', MAX_UTTERANCE_CHARS);
      if (cut < MAX_UTTERANCE_CHARS / 3) cut = MAX_UTTERANCE_CHARS;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    return rest;
  };

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length <= MAX_UTTERANCE_CHARS) {
      current = next;
      continue;
    }
    if (current) { out.push(current); current = ''; }
    current = sentence.length > MAX_UTTERANCE_CHARS ? flushLong(sentence) : sentence;
  }
  if (current) out.push(current);

  return out.filter(Boolean);
}

export interface SpeakOptions {
  text: string;
  lang: SpeechLang;
  gender: VoiceGender;
  /** Fired once, when the first sound actually leaves the speaker. */
  onStart?: () => void;
  /** Fired once, when the last utterance finishes. Never fired after a cancel. */
  onEnd?: () => void;
}

/**
 * Session counter. Every `cancelBrowserSpeech()` bumps it, which is how a
 * queued utterance from the previous turn knows its callbacks are stale — the
 * `onerror: 'canceled'` events the engine fires during `cancel()` must not be
 * mistaken for "the interviewer finished speaking" and advance the interview.
 */
let session = 0;
let endPoll: ReturnType<typeof setInterval> | null = null;

function stopEndPoll() {
  if (endPoll !== null) { clearInterval(endPoll); endPoll = null; }
}

/**
 * Silence the interviewer immediately and invalidate the current utterance's
 * callbacks. Called before every new line and from the screen's teardown.
 */
export function cancelBrowserSpeech() {
  session += 1;
  stopEndPoll();
  const s = engine();
  if (!s) return;
  try { s.cancel(); } catch { /* noop */ }
}

/**
 * Speak a line with the best local neural voice.
 *
 * Resolves `true` once audio has actually started — that is the caller's
 * signal that no fallback is needed. Resolves `false` when the engine is
 * missing, has no voice for the language, or never starts within
 * `START_TIMEOUT_MS`; in every one of those cases nothing has been heard yet,
 * so the caller can safely fall back to server TTS without doubling the line.
 */
export async function speakWithBrowserVoice(opts: SpeakOptions): Promise<boolean> {
  const s = engine();
  if (!s) return false;

  const chunks = splitForSpeech(opts.text);
  if (!chunks.length) return false;

  const voice = pickVoice(await loadVoices(), opts.lang, opts.gender);
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
     * The single exit. `notify` is false for the cancel path so a torn-down
     * call never advances the interview from a dead utterance.
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
     * reports an error — its siblings stay queued in the engine and would go
     * on speaking underneath the fallback, so the candidate would hear the
     * line twice, overlapping, out of sync. Dropping the queue is what makes
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
      // The engine accepted the utterance and then never spoke. Drop it and
      // let the caller reach for the server voice instead of a silent avatar.
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

          // Backstop: some engines drop `onend` when an utterance is queued
          // behind another. Without this the interview would sit forever
          // waiting for a turn that already finished playing.
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
          // An `onend` we never saw an `onstart` for still means the engine
          // ran the utterance — Chrome is known to drop `onstart` for speech
          // queued in the same tick as the `cancel()` above. `close` resolves
          // the promise with `started`, so leaving it false here would tell
          // the caller nothing was heard: it would then fetch server TTS and
          // repeat, out loud, a line the candidate has already listened to —
          // on top of an `onEnd` that has already advanced the interview.
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
        // the whole line for — the end-poll backstop still closes the turn.
        // A cancel fires `onerror` on everything still queued; the session
        // check inside `close` is what keeps that from looking like an ending.
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
