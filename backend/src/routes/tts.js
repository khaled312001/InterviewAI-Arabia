import { Router } from 'express';
import { z } from 'zod';

import * as edge from '../services/tts/edgeNeural.js';

import { aiLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { requireUser } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

// The interviewer's voice, in two tiers.
//
//  1. Microsoft Edge neural voices (services/tts/edgeNeural.js). Real Egyptian
//     Arabic, a real male voice, and prosody. This is what the candidate should
//     hear.
//  2. Google Translate's unofficial TTS endpoint, kept as the fallback.
//
// The note that used to live here said Edge-TTS was impossible because
// "Hostinger blocks outbound WebSockets". That was a misreading of a 403: the
// host reaches speech.platform.bing.com fine — 443 is open and the voice list
// downloads — and the rejection was a missing `Sec-MS-GEC` token. Verified
// from the production box: handshake returns 101 and all four voices
// synthesise. See edgeNeural.js.
//
// What the Google tier is still for: an Edge outage, and an aged-out Chromium
// version string. Its tradeoffs, unchanged:
//
// Tradeoffs:
// - ~200 char limit per request → we split long text into chunks and stream
//   the MP3 concatenated (MP3 frame format tolerates concatenation).
// - Unofficial endpoint — could break if Google changes it, but has been
//   stable for 10+ years.

const MAX_CHARS_PER_CHUNK = 180;

function splitForTTS(text) {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= MAX_CHARS_PER_CHUNK) return [clean];

  // Split on sentence terminators first (., !, ?, Arabic period ۔).
  const pieces = clean.split(/([.!?،؛])/).reduce((acc, part, i, arr) => {
    if (i % 2 === 0) acc.push(part + (arr[i + 1] || ''));
    return acc;
  }, []);

  const chunks = [];
  let current = '';
  for (const p of pieces) {
    const next = (current ? current + ' ' : '') + p.trim();
    if (next.length <= MAX_CHARS_PER_CHUNK) {
      current = next;
    } else {
      if (current) chunks.push(current);
      if (p.length > MAX_CHARS_PER_CHUNK) {
        // Single giant sentence — hard-split on spaces.
        let s = p.trim();
        while (s.length > MAX_CHARS_PER_CHUNK) {
          let cut = s.lastIndexOf(' ', MAX_CHARS_PER_CHUNK);
          if (cut < 50) cut = MAX_CHARS_PER_CHUNK;
          chunks.push(s.slice(0, cut).trim());
          s = s.slice(cut).trim();
        }
        current = s;
      } else {
        current = p.trim();
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

async function fetchChunk(text, lang = 'ar', textLen = 0, speed = 0.95) {
  const url = new URL('https://translate.google.com/translate_tts');
  url.searchParams.set('ie', 'UTF-8');
  url.searchParams.set('q', text);
  url.searchParams.set('tl', lang);
  url.searchParams.set('client', 'tw-ob');
  url.searchParams.set('ttsspeed', String(speed));
  url.searchParams.set('total', '1');
  url.searchParams.set('idx', '0');
  url.searchParams.set('textlen', String(textLen || text.length));

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept': 'audio/mpeg,audio/*;q=0.9,*/*;q=0.8',
      'Referer': 'https://translate.google.com/',
    },
  });
  if (!res.ok) {
    throw new Error(`Google TTS HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// Fallback voice table. Google Translate's Arabic is a single female voice, so
// the "male" interviewer is that same voice slowed down — audibly a woman, and
// the reason tier 1 exists.
//
// The key is `${gender}_${language}`. Every combination the client can send
// must exist here or the lookup silently falls through to `female_ar`, which
// is how an English interview ended up being read aloud by an Arabic voice.
const VOICE_PROFILES = {
  female_ar:    { lang: 'ar',    speed: 0.96 },
  male_ar:      { lang: 'ar',    speed: 0.88 }, // slower → deeper perceived pitch
  female_en:    { lang: 'en',    speed: 0.98 },
  male_en:      { lang: 'en',    speed: 0.90 }, // same trick as male_ar
};

const ttsSchema = z.object({
  text: z.string().min(1).max(2000),
  voice: z.string().optional(),
  gender: z.enum(['male', 'female']).optional().default('female'),
  language: z.enum(['ar', 'en']).optional().default('ar'),
  rate: z.string().optional(),
});

/**
 * Stream the neural voice.
 *
 * Headers are withheld until the first audio frame arrives, which is the whole
 * point: a failure before that byte is still recoverable into the fallback
 * voice, and a failure after it would leave the client holding a truncated MP3
 * it cannot tell from a short answer. `sent` is that line.
 */
async function speakNeural(res, { text, gender, language }) {
  const { voice, lang } = edge.voiceFor(gender, language);
  let sent = false;

  await edge.synthesise({
    text,
    voice,
    lang,
    onChunk: (audio) => {
      if (!sent) {
        sent = true;
        res.setHeader('Content-Type', 'audio/mpeg');
        // Chunked: the length is unknown until the synthesis ends, and waiting
        // for it would give back every millisecond streaming just bought.
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('X-TTS-Voice', voice);
      }
      res.write(audio);
    },
  });

  if (!sent) throw new Error('edge-tts produced no audio');
  res.end();
  return true;
}

/** The flat Google Translate voice. Buffered — it is not a streaming API. */
async function speakFallback(res, { text, gender, language }) {
  const profile = VOICE_PROFILES[`${gender}_${language}`] || VOICE_PROFILES.female_ar;
  const chunks = splitForTTS(text);
  const buffers = [];
  for (const chunk of chunks) {
    buffers.push(await fetchChunk(chunk, profile.lang, text.length, profile.speed));
  }
  const combined = Buffer.concat(buffers);

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', String(combined.length));
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-TTS-Voice', `google-translate-${profile.lang}`);
  res.end(combined);
}

router.post('/', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = ttsSchema.parse(req.body);

  try {
    await speakNeural(res, body);
    return;
  } catch (err) {
    // Only recoverable while nothing has been written. `headersSent` is the
    // authority on that, not our own bookkeeping.
    if (res.headersSent) {
      logger.error('TTS neural failed mid-stream', { message: err.message });
      res.end();
      return;
    }
    logger.warn('TTS neural unavailable, using fallback voice', { message: err.message });
  }

  try {
    await speakFallback(res, body);
  } catch (err) {
    logger.error('TTS failed', { message: err.message });
    throw new HttpError(502, 'TTS service unavailable');
  }
}));

export default router;
