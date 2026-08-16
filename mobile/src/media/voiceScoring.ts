/**
 * Voice selection, shared by the web and native synthesisers.
 *
 * Ported from `src/speech/webSpeech.ts` so the two platforms rank voices the
 * same way; the only difference is which quality signal is available. Web has
 * `localService` (false ⇒ a cloud/neural voice); `expo-speech` has no analogue
 * but does expose `VoiceQuality.Enhanced`. Both are folded in below and both
 * are optional, so a platform that knows neither still scores sensibly.
 */

import type { PickVoice, ScoreVoice, SpeechLang, VoiceCandidate, VoiceGender } from './contract';
import { SPEECH_LOCALE } from './contract';

/** Markers vendors use for their neural/cloud voices. */
const QUALITY_HINTS = ['natural', 'neural', 'online', 'wavenet', 'premium', 'enhanced', 'siri'];

/** Markers for the old robotic engines — the exact sound we are moving away from. */
const POOR_HINTS = ['espeak', 'compact', 'festival', 'pico', 'sapi 4'];

/**
 * Gendered voice names, by vendor. Neither `SpeechSynthesisVoice` nor
 * `expo-speech`'s `Voice` carries a gender field, so the persona can only be
 * matched by name. Female is tested first: "female" contains "male".
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
 * The ordering of the weights is the whole design: language correctness is a
 * gate, then voice *quality* dominates, and gender is a preference on top — a
 * natural female voice reading Ahmed's lines is a far better call than a
 * robotic male one, so gender never outranks quality.
 */
export const scoreVoice: ScoreVoice = (voice, lang, gender) => {
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
  if (voice.remote === true) score += 12;        // web: !localService
  if (voice.quality === 'enhanced') score += 40; // native: VoiceQuality.Enhanced

  // Persona fit.
  const isFemale = matchesAny(name, FEMALE_HINTS);
  const isMale = !isFemale && matchesAny(name, MALE_HINTS);
  if (isFemale || isMale) {
    const wanted = gender === 'female' ? isFemale : isMale;
    score += wanted ? 25 : -20;
  }

  if (voice.isDefault) score += 2; // tie-break only

  return score;
};

/**
 * Quality floor. Only the `POOR_HINTS` penalty can drag a correct-language
 * voice this low — an ordinary non-neural system voice still scores 80+, even
 * with the wrong region and the wrong gender. So this rejects exactly the
 * eSpeak/"Compact" class, which sounds *worse* than the server fallback and
 * would otherwise win simply by being installed.
 */
export const MIN_VOICE_SCORE = 60;

/**
 * The best available voice for the language, or `null` when the engine has
 * nothing worth using — in which case the caller falls back to server TTS.
 *
 * Returns one of the objects it was handed, so the caller can map the result
 * back to the engine's own voice by identity or position.
 */
export const pickVoice: PickVoice = (voices, lang, gender) => {
  let best: VoiceCandidate | null = null;
  let bestScore = MIN_VOICE_SCORE;
  for (const voice of voices) {
    const score = scoreVoice(voice, lang, gender);
    if (score > bestScore) { best = voice; bestScore = score; }
  }
  return best;
};

export type { SpeechLang, VoiceGender, VoiceCandidate };
