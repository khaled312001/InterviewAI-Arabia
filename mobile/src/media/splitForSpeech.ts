/**
 * Break a reply into utterance-sized chunks on sentence boundaries.
 *
 * Ported verbatim from `src/speech/webSpeech.ts` so both platforms chunk
 * identically. Long single utterances are unreliable on every engine: Chrome
 * cuts them off around fifteen seconds, and Android's TTS has its own limit.
 */

import type { SplitForSpeech } from './contract';
import { MAX_UTTERANCE_CHARS } from './locale';

export const splitForSpeech: SplitForSpeech = (text) => {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return [];
  if (clean.length <= MAX_UTTERANCE_CHARS) return [clean];

  // Keep the terminator attached to the sentence it ends. Split on a captured
  // group and re-pair rather than using a lookbehind: this runs under Hermes
  // on native, which rejects lookbehind.
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
};
