import { Router } from 'express';
import { z } from 'zod';

import { aiLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { requireUser } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Arabic Text-to-Speech via Google Translate's unofficial TTS endpoint.
// Why not Microsoft Edge-TTS? Hostinger's shared hosting blocks outbound
// WebSocket connections to speech.platform.bing.com, so the msedge-tts
// library fails at handshake. Google Translate's TTS is plain HTTPS GET,
// always reachable, free, and the ar voice is a clear adult female.
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

async function fetchChunk(text, lang = 'ar', textLen = 0) {
  const url = new URL('https://translate.google.com/translate_tts');
  url.searchParams.set('ie', 'UTF-8');
  url.searchParams.set('q', text);
  url.searchParams.set('tl', lang);
  url.searchParams.set('client', 'tw-ob');
  url.searchParams.set('ttsspeed', '0.95');
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

const ttsSchema = z.object({
  text: z.string().min(1).max(2000),
  voice: z.string().optional(),   // accepted but ignored (Google picks regional voice)
  rate: z.string().optional(),    // ignored for simplicity
});

router.post('/', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = ttsSchema.parse(req.body);
  const chunks = splitForTTS(body.text);

  try {
    const buffers = [];
    for (const chunk of chunks) {
      const buf = await fetchChunk(chunk, 'ar', body.text.length);
      buffers.push(buf);
    }
    const combined = Buffer.concat(buffers);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(combined.length));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(combined);
  } catch (err) {
    logger.error('TTS failed', { message: err.message, chunks: chunks.length });
    throw new HttpError(502, 'TTS service unavailable');
  }
}));

export default router;
