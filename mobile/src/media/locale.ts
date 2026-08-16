/**
 * Prosody constants, shared by both synthesisers so the interviewer sounds the
 * same on web and on device. Ported from `src/speech/webSpeech.ts`.
 */

import type { SpeechLang } from './contract';

/**
 * Conversational, not newsreader. Neural voices default to a slightly formal
 * cadence; nudging the rate up a hair reads as "someone talking to you" and
 * shortens every reply, which is the other half of the "respond fast" ask.
 */
export const RATE: Record<SpeechLang, number> = { ar: 1.02, en: 1.05 };

/** Left near-neutral on purpose — pitch shifting a neural voice sounds synthetic. */
export const PITCH = 1.0;

/** Sentence-sized utterances: under Chrome's ~15s single-utterance ceiling. */
export const MAX_UTTERANCE_CHARS = 180;
