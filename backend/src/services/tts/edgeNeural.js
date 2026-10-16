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

/**
 * Where the voices live, in the order they are tried.
 *
 * `speech.platform.bing.com` was the only address for years and in October 2026
 * it began answering 403 with an empty body — every Chromium version string,
 * every region tested, nothing in the response to act on. The service had moved
 * to `api.msedgeservices.com`, which takes the same protocol and the same
 * trusted client token, this time as `Ocp-Apim-Subscription-Key`.
 *
 * Both are kept and tried in order, and `preferred` remembers which one
 * answered last so the cost of the dead host is paid once per process rather
 * than once per question. Keeping the old address is not sentiment: this is the
 * second time Microsoft has moved the goalposts, and a list is the cheapest
 * place to put the third.
 */
const ENDPOINTS = [
  (gec, version, id) => 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1'
    + `?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}`
    + `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-${version}&ConnectionId=${id}`,
  (gec, version, id) => 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
    + `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`
    + `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-${version}&ConnectionId=${id}`,
];

let preferred = 0;

/** Bumped when Microsoft ages out the old string; overridable at runtime. */
export const DEFAULT_CHROMIUM_VERSION = '143.0.3650.75';

/**
 * Output encodings.
 *
 * The consumer endpoint allows a short whitelist and raw PCM is not on it —
 * `raw-24khz-16bit-mono-pcm`, `riff-*` and the Opus variants other than WebM
 * all come back as "Unsupported Edge output format". That is why the live voice
 * agent decodes MP3 rather than asking for PCM it cannot have; see
 * services/voice/speak.js.
 *
 * 24 kHz for both: it is the rate the voices are synthesised at and the rate
 * the agent emits, so nothing resamples anywhere. HQ_MP3_24KHZ doubles the
 * bitrate for the same audio, which is worth it on the live path where the
 * bytes are decoded and thrown away rather than stored.
 */
export const MP3_24KHZ = 'audio-24khz-48kbitrate-mono-mp3';
export const HQ_MP3_24KHZ = 'audio-24khz-96kbitrate-mono-mp3';

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
 * One live connection to the voice service.
 *
 * Connections are reused, and the reason is a measurement: the handshake to
 * Microsoft costs about 1400 ms while the synthesis itself returns its first
 * audio in about 300 ms. On the typed interview that gap is a slow-feeling
 * answer; on the live voice agent it is a second and a half of silence after
 * every question, which is most of what makes a spoken interview feel like
 * software. The protocol carries an `X-RequestId` per turn precisely because a
 * socket is meant to serve many — so it does.
 *
 * One turn at a time per socket. Interleaving by request id probably works and
 * is not worth finding out the hard way: a mix-up would splice two questions
 * into one audio stream, and the pool below opens another socket instead.
 */
class EdgeSocket {
  constructor(endpointIndex, chromiumVersion) {
    this.endpointIndex = endpointIndex;
    this.chromiumVersion = chromiumVersion;
    this.turn = null;
    this.dead = false;
    this.busy = false;
    this.idleTimer = null;
    this.fresh = true;

    const major = chromiumVersion.split('.', 1)[0];
    this.ws = new WebSocket(
      ENDPOINTS[endpointIndex](secMsGec(), chromiumVersion, connectId()),
      {
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
      },
    );

    this.ready = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });

    this.ws.on('message', (data, isBinary) => this.onMessage(data, isBinary));
    this.ws.on('error', (err) => this.kill(tagUnreachable(err)));
    this.ws.on('close', (code, reason) => {
      const said = String(reason || '').slice(0, 120);
      this.kill(new Error(`edge-tts closed (${code})${said ? `: ${said}` : ''}`));
    });
  }

  /** Fail the turn in flight, if any, and retire the socket. */
  kill(err) {
    this.dead = true;
    clearTimeout(this.idleTimer);
    const turn = this.turn;
    this.turn = null;
    if (turn) turn.finish(err);
    try { this.ws.close(); } catch { /* already closing */ }
  }

  onMessage(data, isBinary) {
    const turn = this.turn;
    if (!turn) return;
    turn.touch();

    if (isBinary) {
      // Binary frame: a 2-byte big-endian header length, the text header,
      // then the MP3 bytes. Anything shorter than the prefix is malformed.
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length < 2) return;
      const headerLength = buf.readUInt16BE(0);
      if (buf.length > headerLength + 2) {
        const audio = buf.subarray(headerLength + 2);
        turn.chunks.push(audio);
        if (turn.onChunk) {
          // A throwing consumer (a client that hung up) must abort the
          // synthesis, not be retried into a half-written response.
          try { turn.onChunk(audio); } catch (err) { turn.finish(err); }
        }
      }
      return;
    }

    if (String(data).includes('Path:turn.end')) turn.finish(null, Buffer.concat(turn.chunks));
  }

  /** Synthesise one utterance on this socket. Caller holds `busy`. */
  synthesise({ text, voice, lang, onChunk, outputFormat }) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let idle;

      const turn = {
        chunks: [],
        onChunk,
        touch: () => {
          clearTimeout(idle);
          idle = setTimeout(() => turn.finish(new Error('edge-tts idle timeout')), IDLE_TIMEOUT_MS);
        },
        finish: (err, buf) => {
          if (settled) return;
          settled = true;
          clearTimeout(idle);
          clearTimeout(total);
          if (this.turn === turn) this.turn = null;
          // A turn that failed mid-stream leaves the socket in an unknown
          // state — half a sentence may still be on its way — so it does not
          // go back in the pool.
          if (err) { this.dead = true; reject(err); } else resolve(buf);
        },
      };

      const total = setTimeout(() => turn.finish(new Error('edge-tts total timeout')), TOTAL_TIMEOUT_MS);
      turn.touch();
      this.turn = turn;

      const stamp = new Date().toISOString();
      // One id across both frames. The legacy host tolerated a config frame
      // with no X-RequestId; api.msedgeservices.com closes the socket with
      // 1007 for it, which is a protocol error with no message attached and
      // therefore the kind of thing worth not having to rediscover.
      const requestId = connectId();
      try {
        this.ws.send(
          `X-RequestId:${requestId}\r\nX-Timestamp:${stamp}\r\n`
          + 'Content-Type:application/json; charset=utf-8\r\n'
          + 'Path:speech.config\r\n\r\n'
          + '{"context":{"synthesis":{"audio":{"metadataoptions":{'
          + '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},'
          + `"outputFormat":"${outputFormat}"}}}}`,
        );
        this.ws.send(
          `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\n`
          + `X-Timestamp:${stamp}\r\nPath:ssml\r\n\r\n`
          + ssml(text, voice, lang),
        );
      } catch (err) {
        turn.finish(err);
      }
    });
  }
}

/** Connection-level failures are the ones worth retrying on the other host. */
function tagUnreachable(err) {
  if (/Unexpected server response|ENOTFOUND|ECONNREFUSED|ECONNRESET|handshake/i.test(err?.message || '')) {
    err.edgeUnreachable = true;
  }
  return err;
}

/* ------------------------------------------------------------------ *
 * The pool
 * ------------------------------------------------------------------ */

/**
 * How many sockets, and how long an unused one is kept.
 *
 * Three is sized for the shape of the load rather than its volume: a voice
 * interview speaks one sentence at a time, so a single socket serves a whole
 * call, and the pool exists for the handful of concurrent calls a deployment
 * this size runs. Twenty seconds outlives the gap between an interviewer's
 * questions — a candidate answering takes well under that — and closes the
 * socket shortly after the call ends rather than holding it open for the night.
 */
const POOL_MAX = 3;
const POOL_IDLE_MS = 20_000;

const pool = [];
const waiting = [];

function wake() {
  const next = waiting.shift();
  if (next) next();
}

function release(socket) {
  socket.busy = false;
  socket.fresh = false;

  if (socket.dead) {
    const at = pool.indexOf(socket);
    if (at >= 0) pool.splice(at, 1);
  } else {
    clearTimeout(socket.idleTimer);
    socket.idleTimer = setTimeout(() => {
      const at = pool.indexOf(socket);
      if (at >= 0) pool.splice(at, 1);
      try { socket.ws.close(); } catch { /* already closing */ }
    }, POOL_IDLE_MS);
    // Timers must not keep a worker alive past its work.
    socket.idleTimer.unref?.();
  }

  wake();
}

/** An idle socket, a new one, or a place in the queue — in that order. */
async function acquire(endpointIndex, chromiumVersion) {
  for (;;) {
    /*
     * Retire the dead before counting the living.
     *
     * A socket can die while idle — the far end closes it, the network drops —
     * and nothing is holding it, so nothing calls `release` to take it out.
     * Without this sweep those corpses still count towards POOL_MAX, and once
     * three of them have accumulated the pool stops opening connections and
     * every caller waits forever for a release that cannot come. That is a
     * hung interview, not a slow one.
     */
    for (let i = pool.length - 1; i >= 0; i -= 1) {
      if (pool[i].dead && !pool[i].busy) pool.splice(i, 1);
    }

    const idle = pool.find((s) => !s.busy && !s.dead
      && s.endpointIndex === endpointIndex && s.chromiumVersion === chromiumVersion);
    if (idle) {
      idle.busy = true;
      clearTimeout(idle.idleTimer);
      return idle;
    }

    if (pool.length < POOL_MAX) {
      const socket = new EdgeSocket(endpointIndex, chromiumVersion);
      socket.busy = true;
      pool.push(socket);
      try {
        await socket.ready;
      } catch (err) {
        const at = pool.indexOf(socket);
        if (at >= 0) pool.splice(at, 1);
        socket.dead = true;
        // A slot just came free by failing. Anyone queued behind it is
        // entitled to try, and would otherwise wait for a release that is
        // never coming.
        wake();
        throw tagUnreachable(err);
      }
      return socket;
    }

    // Everything is busy. Wait for a release rather than opening a fourth
    // connection to a service that is being polite enough to host this at all.
    await new Promise((resolve) => waiting.push(resolve));
  }
}

/**
 * Open a connection before it is needed.
 *
 * Called when a voice session opens, so the greeting — the first thing the
 * candidate hears, and the moment they are most likely to think the app is
 * broken — is not waiting on a handshake. Failure is deliberately silent:
 * nothing depends on this having worked.
 */
export async function prewarm() {
  try {
    const socket = await acquire(preferred, DEFAULT_CHROMIUM_VERSION);
    release(socket);
  } catch { /* the next real call will try again, and report properly */ }
}

/**
 * Synthesise one utterance.
 *
 * Resolves the whole MP3, or throws; the caller is expected to have a
 * fallback. `onChunk` additionally receives each MP3 fragment as it arrives —
 * the route uses it to start sending audio to the client after roughly the
 * first 300ms rather than after the full synthesis, which on a two-sentence
 * question is the difference between an interviewer who answers and one who
 * pauses first.
 */
export async function synthesise({
  text, voice, lang, onChunk,
  chromiumVersion = DEFAULT_CHROMIUM_VERSION,
  outputFormat = MP3_24KHZ,
}) {
  /*
   * Count what has reached the consumer, because that is what decides whether
   * a failure may be retried. Once a fragment has been handed to `onChunk` it
   * is already in an HTTP response on its way to Deepgram or a browser, and
   * synthesising the sentence again would append it to itself.
   */
  let delivered = 0;
  const job = {
    text, voice, lang, outputFormat,
    onChunk: (chunk) => { delivered += 1; if (onChunk) onChunk(chunk); },
  };

  /*
   * Try each host, starting with the one that worked last.
   *
   * Only a connection-level failure moves on to the next: a 403 or a refused
   * handshake says "wrong address", while a rejected output format or a
   * timeout mid-stream says the address was right and the request was not, and
   * retrying that elsewhere just doubles the wait before the fallback voice.
   */
  const order = [preferred, ...ENDPOINTS.keys()].filter((i, n, a) => a.indexOf(i) === n);
  let lastErr;

  for (const index of order) {
    // Two attempts on a working host, because a pooled socket can be closed by
    // the far end between calls and the failure looks identical to a real one.
    // The retry is only safe while nothing has been delivered: `onChunk` has
    // already handed those bytes to a response, and replaying them would
    // splice the question onto itself.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let socket;
      try {
        socket = await acquire(index, chromiumVersion);
      } catch (err) {
        lastErr = err;
        break;
      }

      const reused = !socket.fresh;
      try {
        const audio = await socket.synthesise(job);
        preferred = index;
        release(socket);
        return audio;
      } catch (err) {
        release(socket);
        lastErr = err;
        if (reused && delivered === 0 && attempt === 0) {
          logger.warn('edge-tts reused socket failed, retrying fresh', { message: err.message });
          continue;
        }
        if (err?.edgeUnreachable) break;
        throw err;
      }
    }

    if (!lastErr?.edgeUnreachable) break;
    logger.warn('edge-tts host unreachable, trying the next', { index, message: lastErr.message });
  }

  throw lastErr ?? new Error('edge-tts: no endpoint answered');
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
