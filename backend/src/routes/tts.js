import { Router } from 'express';
import { z } from 'zod';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

import { aiLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { requireUser } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Neutral, professional Arabic female voices available on Microsoft's free
// Edge-TTS service. Salma (Egyptian) is the default — warm and clear.
const VOICES = {
  salma:   'ar-EG-SalmaNeural',    // Female, Egyptian Arabic (default)
  zariyah: 'ar-SA-ZariyahNeural',  // Female, Saudi Arabic
  shakir:  'ar-EG-ShakirNeural',   // Male, Egyptian (fallback if user wants)
};

const ttsSchema = z.object({
  text: z.string().min(1).max(2000),
  voice: z.enum(['salma', 'zariyah', 'shakir']).default('salma'),
  rate: z.string().optional(),   // e.g. "+5%", "-10%"
  pitch: z.string().optional(),  // e.g. "+10Hz"
});

// Cache a single TTS instance per voice to avoid re-handshaking every call.
const ttsInstances = new Map();
async function getTTS(voiceKey) {
  if (ttsInstances.has(voiceKey)) return ttsInstances.get(voiceKey);
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICES[voiceKey], OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  ttsInstances.set(voiceKey, tts);
  return tts;
}

router.post('/', requireUser, aiLimiter, asyncHandler(async (req, res) => {
  const body = ttsSchema.parse(req.body);

  let tts;
  try {
    tts = await getTTS(body.voice);
  } catch (err) {
    logger.error('Edge TTS connect failed', { message: err.message });
    throw new HttpError(502, 'TTS service unavailable');
  }

  // Optional prosody tuning via SSML.
  const ssmlText = (body.rate || body.pitch)
    ? `<prosody rate="${body.rate || '+0%'}" pitch="${body.pitch || '+0Hz'}">${escapeSsml(body.text)}</prosody>`
    : escapeSsml(body.text);

  let stream;
  try {
    const result = await tts.toStream(ssmlText);
    stream = result.audioStream;
  } catch (err) {
    logger.error('TTS stream failed', { message: err.message });
    // Reset instance so next call re-handshakes.
    ttsInstances.delete(body.voice);
    throw new HttpError(502, 'TTS stream error');
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=300');
  stream.on('data', (chunk) => res.write(chunk));
  stream.on('end', () => res.end());
  stream.on('error', (err) => {
    logger.error('TTS stream error', { message: err.message });
    ttsInstances.delete(body.voice);
    if (!res.headersSent) res.status(502).json({ error: 'TTS stream error' });
    else res.end();
  });
}));

function escapeSsml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default router;
