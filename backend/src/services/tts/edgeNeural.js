/**
 * Microsoft Edge's read-aloud neural voices.
 *
 * This is the interviewer's voice. It replaces a scrape of Google Translate's
 * `translate_tts` endpoint, which is a single flat voice per language with no
 * prosody — the "male" interviewer was the *same* female voice played slower.
 * On a screen asking the candidate to believe they are in a job interview,
 * that is the detail that breaks it.
 *
 * The Edge voices are Azure Neural TTS: `ar-EG-SalmaNeural` is Egyptian, not
 * Modern Standard read aloud, and there is a real male voice. Free, no key, no
 * account.
 *
 * Why this is safe to depend on, and where it is not
 *   The endpoint is undocumented. It is reached with a `Sec-MS-GEC` token —
 *   SHA-256 over a five-minute-rounded Windows tick count and a well-known
 *   client token — plus a `Sec-MS-GEC-Version` carrying a *current* Chromium
 *   version. Microsoft rejects a version string that has aged out, so
 *   `DEFAULT_CHROMIUM_VERSION` is the one value here with a shelf life. It is
 *   settable at runtime so a rejection is a config change rather than a
 *   deploy, and every failure falls through to the Google Translate voice —
 *   the interview never loses its voice because of this file.
 *
 * The float arithmetic in `secMsGec` is deliberate and must not be "fixed":
 * the reference implementation computes the tick count as a double and formats
 * it with %.0f, so the number it hashes is already rounded past 2^53. Computing
 * it exactly with BigInt produces a different string and a 403.
 */

import crypto from 'node:crypto';
import WebSocket from 'ws';

import { logger } from '../../utils/logger.js';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WIN_EPOCH = 11644473600;
const WSS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

/** Bumped when Microsoft ages out the old string; overridable at runtime. */
export const DEFAULT_CHROMIUM_VERSION = '143.0.3650.75';

/** Streaming stops if the socket has produced nothing for this long. */
const IDLE_TIMEOUT_MS = 12000;
/** Absolute ceiling for one synthesis, however long the text. */
const TOTAL_TIMEOUT_MS = 30000;

/**
 * The interviewer's voice per persona and language.
 *
 * Egyptian rather than Modern Standard for Arabic: the product interviews
 * candidates in Egypt, and `ar-SA` reads as a newsreader to them. English is
 * the multilingual pair, which handles an Arabic name inside an English
 * sentence without switching to a spelling voice.
 */
export const NEURAL_VOICES = {
  female_ar: 'ar-EG-SalmaNeural',
  male_ar: 'ar-EG-ShakirNeural',
  female_en: 'en-US-EmmaMultilingualNeural',
  male_en: 'en-US-AndrewMultilingualNeural',
};

/** The SSML locale that goes with each voice. */
const VOICE_LANG = { ar: 'ar-EG', en: 'en-US' };

/**
 * Prosody.
 *
 * An interviewer does not read; they speak, and slightly slower than a
 * narrator. `-4%` is the difference between "assistant reading a script" and
 * "person asking you a question" — enough to leave room at clause boundaries
 * without sounding sedated.
 */
const PROSODY = { rate: '-4%', pitch: '+0Hz', volume: '+0%' };

const escapeXml = (s) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

function secMsGec() {
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 1e9 / 100;
  return crypto
    .createHash('sha256')
    .update(ticks.toFixed(0) + TRUSTED_CLIENT_TOKEN, 'ascii')
    .digest('hex')
    .toUpperCase();
}

const connectId = () => crypto.randomUUID().replace(/-/g, '');

function ssml(text, voice, lang) {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">`
    + `<voice name="${voice}">`
    + `<prosody pitch="${PROSODY.pitch}" rate="${PROSODY.rate}" volume="${PROSODY.volume}">`
    + escapeXml(text)
    + '</prosody></voice></speak>';
}

/** The voice for a persona and interview language. */
export function voiceFor(gender, language) {
  const key = `${gender === 'male' ? 'male' : 'female'}_${language === 'en' ? 'en' : 'ar'}`;
  return { voice: NEURAL_VOICES[key], lang: VOICE_LANG[language === 'en' ? 'en' : 'ar'] };
}

/**
 * Synthesise one utterance.
 *
 * Resolves the whole MP3, or throws; the caller is expected to have a
 * fallback. `onChunk` additionally receives each MP3 fragment as it arrives —
 * the route uses it to start sending audio to the client after roughly the
 * first 400ms rather than after the full synthesis, which on a two-sentence
 * question is the difference between an interviewer who answers and one who
 * pauses first.
 */
export function synthesise({ text, voice, lang, onChunk, chromiumVersion = DEFAULT_CHROMIUM_VERSION }) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({
      TrustedClientToken: TRUSTED_CLIENT_TOKEN,
      'Sec-MS-GEC': secMsGec(),
      'Sec-MS-GEC-Version': `1-${chromiumVersion}`,
      ConnectionId: connectId(),
    });
    const major = chromiumVersion.split('.', 1)[0];

    const ws = new WebSocket(`${WSS_BASE}?${query}`, {
      headers: {
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
          + `Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
      },
      handshakeTimeout: 8000,
    });

    const chunks = [];
    let settled = false;
    let idle;

    const finish = (err, buf) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      clearTimeout(total);
      try { ws.close(); } catch { /* already closing */ }
      if (err) reject(err); else resolve(buf);
    };

    const total = setTimeout(() => finish(new Error('edge-tts total timeout')), TOTAL_TIMEOUT_MS);
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish(new Error('edge-tts idle timeout')), IDLE_TIMEOUT_MS);
    };
    touch();

    ws.on('open', () => {
      const stamp = new Date().toISOString();
      ws.send(
        `X-Timestamp:${stamp}\r\nContent-Type:application/json; charset=utf-8\r\n`
        + 'Path:speech.config\r\n\r\n'
        + '{"context":{"synthesis":{"audio":{"metadataoptions":{'
        + '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},'
        + '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}',
      );
      ws.send(
        `X-RequestId:${connectId()}\r\nContent-Type:application/ssml+xml\r\n`
        + `X-Timestamp:${stamp}\r\nPath:ssml\r\n\r\n`
        + ssml(text, voice, lang),
      );
    });

    ws.on('message', (data, isBinary) => {
      touch();
      if (isBinary) {
        // Binary frame: a 2-byte big-endian header length, the text header,
        // then the MP3 bytes. Anything shorter than the prefix is malformed.
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buf.length < 2) return;
        const headerLength = buf.readUInt16BE(0);
        if (buf.length > headerLength + 2) {
          const audio = buf.subarray(headerLength + 2);
          chunks.push(audio);
          if (onChunk) {
            // A throwing consumer (a client that hung up) must abort the
            // synthesis, not be retried into a half-written response.
            try { onChunk(audio); } catch (err) { finish(err); }
          }
        }
        return;
      }
      if (String(data).includes('Path:turn.end')) {
        finish(null, Buffer.concat(chunks));
      }
    });

    ws.on('error', (err) => finish(err));
    ws.on('close', (code) => {
      if (settled) return;
      if (chunks.length) finish(null, Buffer.concat(chunks));
      else finish(new Error(`edge-tts closed (${code}) with no audio`));
    });
  });
}

/**
 * Whether the service is answering at all.
 *
 * Used by the admin health panel, so a 403 from an aged-out Chromium version
 * is something an operator can see and fix rather than a silent downgrade to
 * the flat fallback voice that nobody notices until a user complains.
 */
export async function probe(chromiumVersion = DEFAULT_CHROMIUM_VERSION) {
  try {
    const buf = await synthesise({
      text: 'مرحبا', voice: NEURAL_VOICES.female_ar, lang: 'ar-EG', chromiumVersion,
    });
    return { ok: buf.length > 0, bytes: buf.length };
  } catch (err) {
    logger.warn('edge-tts probe failed', { message: err.message });
    return { ok: false, error: err.message };
  }
}
