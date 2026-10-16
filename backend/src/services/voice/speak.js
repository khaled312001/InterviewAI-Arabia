/**
 * The interviewer's Arabic voice, for the live agent.
 *
 * WHY THIS FILE EXISTS. Deepgram's Voice Agent cannot speak Arabic — its
 * text-to-speech is English, Spanish, German, French, Italian, Dutch and
 * Japanese, with no Arabic voice at any price — and its `speak` slot accepts a
 * fixed list of providers, all of them paid. What it does accept is a
 * bring-your-own endpoint that talks OpenAI's audio API, and that is the gap
 * this file stands in: Deepgram asks us for a sentence of speech exactly as it
 * would ask OpenAI, and gets back the same Egyptian neural voice the typed
 * interview has always used. Free, no account, no key.
 *
 * THE CONTRACT, measured against the live service rather than read off a page,
 * because Deepgram documents none of it:
 *
 *     POST <this endpoint>
 *     authorization: Bearer <the voice token we minted>
 *     content-type: application/json
 *     {"input":"…","model":"tts-1","voice":"alloy","response_format":"pcm"}
 *
 * `response_format` is always `pcm` and cannot be changed — setting it in the
 * Settings frame is rejected outright ("Error parsing client message"). So the
 * answer must be RAW 16-bit little-endian mono PCM at 24 kHz, with no
 * container: Deepgram forwards the body to the client untouched, so a WAV
 * header or an MP3 arrives as a burst of noise rather than a voice.
 *
 * AND THE VOICE CANNOT GIVE US THAT DIRECTLY. Microsoft's endpoint allows a
 * short whitelist of output formats and every raw PCM variant is refused, so
 * the MP3 is decoded here, in-process, as it streams. That is the one piece of
 * real work in this file and the reason for the mpg123 dependency.
 *
 * STREAMING IS THE POINT. Decoding to completion before answering would add
 * the whole synthesis to every sentence the interviewer speaks. Frames are
 * decoded and written as they arrive, so audio starts flowing at roughly the
 * first 800 ms and the candidate hears a person taking a breath rather than
 * software thinking.
 */

import { MPEGDecoder } from 'mpg123-decoder';

import * as edge from '../tts/edgeNeural.js';
import { logger } from '../../utils/logger.js';

/** What Deepgram asks for, and therefore what we must produce. */
const TARGET_SAMPLE_RATE = 24000;

/**
 * Longest utterance we will synthesise.
 *
 * The interviewer's turns are a question or two and nowhere near this, so the
 * cap is not about the product — it is about what the token can be used for.
 * A voice token is valid for two hours and the text comes from the request
 * body, so anyone holding one could otherwise point a transcription job at
 * this endpoint and have us pay for it in bandwidth.
 */
const MAX_INPUT_CHARS = 1200;

/* ------------------------------------------------------------------ *
 * Availability
 * ------------------------------------------------------------------ */

/**
 * Is the voice actually answering?
 *
 * This exists because of the failure it prevents, which is the worst one
 * available: a call that connects, transcribes the candidate, thinks, and then
 * says nothing — indistinguishable from a broken microphone to the person
 * being interviewed. Microsoft's endpoint is undocumented and has moved once
 * already (the whole of ENDPOINTS in edgeNeural.js is that story), so "is it
 * up" is a real question with a changing answer.
 *
 * The result is cached: a session that had to wait for a synthesis round trip
 * before it could start would pay this on every interview, and the answer does
 * not change minute to minute. A failure is remembered for much less time than
 * a success, because the cost of being wrong is asymmetric — a stale "down"
 * denies a working voice interview, a stale "up" produces a silent one.
 */
const HEALTH_TTL_OK_MS = 10 * 60_000;
const HEALTH_TTL_FAIL_MS = 60_000;

let health = { ok: false, at: 0, checking: null };

export async function voiceIsUp() {
  const age = Date.now() - health.at;
  const ttl = health.ok ? HEALTH_TTL_OK_MS : HEALTH_TTL_FAIL_MS;
  if (health.at && age < ttl) return health.ok;

  // One probe at a time: ten sessions opening together should not open ten
  // websockets to Microsoft to ask the same question.
  if (!health.checking) {
    health.checking = edge.probe()
      .then((r) => {
        health = { ok: Boolean(r?.ok), at: Date.now(), checking: null };
        if (!health.ok) logger.warn('arabic voice unavailable', { error: r?.error });
        return health.ok;
      })
      .catch((err) => {
        health = { ok: false, at: Date.now(), checking: null };
        logger.warn('arabic voice probe threw', { message: err.message });
        return false;
      });
  }
  return health.checking;
}

/* ------------------------------------------------------------------ *
 * Synthesis
 * ------------------------------------------------------------------ */

/** Float samples in [-1, 1] to the 16-bit little-endian PCM Deepgram wants. */
function toPcm16(samples) {
  const out = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    // Clamp before scaling: a decoder can legitimately overshoot 1.0 on loud
    // frames, and letting that wrap produces a click at full scale.
    const s = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return out;
}

/**
 * Speak one utterance into an HTTP response.
 *
 * Headers are withheld until the first decoded sample, which is the same rule
 * the /api/tts route follows and for the same reason: a failure before the
 * first byte is still a clean 502 that Deepgram can report, and a failure
 * after it would leave the agent playing a truncated sentence it cannot tell
 * from a short one.
 *
 * @param {object} opts
 * @param {string} opts.text
 * @param {'male'|'female'} opts.gender
 * @param {'ar'|'en'} opts.language
 * @param {import('express').Response} opts.res
 */
export async function streamSpeech({ text, gender, language, res }) {
  const { voice, lang } = edge.voiceFor(gender, language);
  const decoder = new MPEGDecoder();
  await decoder.ready;

  let sent = false;
  let rateWarned = false;
  let samples = 0;

  const write = (chunk) => {
    /*
     * Stop synthesising for a listener that has gone.
     *
     * Deepgram drops the request when the candidate interrupts the
     * interviewer, which in a live interview is often — and throwing here is
     * how the synthesiser is told, because every remaining frame is work
     * nobody will hear and bytes written to a dead socket.
     */
    if (res.writableEnded || res.destroyed) throw new Error('response closed');

    const decoded = decoder.decode(chunk);
    if (!decoded?.samplesDecoded) return;

    /*
     * The rate is asserted rather than assumed. Everything here is 24 kHz —
     * the voice, the decode, and the agent's own output — so a mismatch means
     * the output format changed under us, and the audible result is an
     * interviewer speaking too fast or too slow rather than an error anyone
     * would notice in a log.
     */
    if (decoded.sampleRate !== TARGET_SAMPLE_RATE && !rateWarned) {
      rateWarned = true;
      logger.error('voice sample rate mismatch', {
        got: decoded.sampleRate, want: TARGET_SAMPLE_RATE,
      });
    }

    if (!sent) {
      sent = true;
      res.setHeader('Content-Type', 'audio/pcm');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Voice', voice);
    }
    samples += decoded.samplesDecoded;
    // Mono: channelData[0] is the whole signal. The voices are synthesised
    // mono, so there is no second channel to mix down.
    res.write(toPcm16(decoded.channelData[0]));
    res.flush?.();
  };

  let failure = null;
  try {
    await edge.synthesise({
      text,
      voice,
      lang,
      // The live path decodes and discards, so the extra bitrate costs nothing
      // that is kept and buys back what the encoder would have thrown away.
      outputFormat: edge.HQ_MP3_24KHZ,
      onChunk: write,
    });

    // Whatever is left in the decoder's buffer. Without this the last frame —
    // usually the final word of the question — is silently dropped.
    const tail = decoder.decode(new Uint8Array(0));
    if (tail?.samplesDecoded && sent) {
      samples += tail.samplesDecoded;
      res.write(toPcm16(tail.channelData[0]));
    }
  } catch (err) {
    failure = err;
  } finally {
    decoder.free();
  }

  // Nothing was sent: a clean error the route turns into a 502.
  if (!sent) throw failure ?? new Error('voice produced no audio');

  /*
   * Half a sentence must not look like a whole one.
   *
   * Ending the response normally here would hand Deepgram a valid 200 carrying
   * audio that stops mid-word, and nothing downstream can tell that from a
   * short question — the interviewer simply trails off. Rethrowing leaves the
   * body incomplete, which the error handler turns into a dropped socket and
   * Deepgram reports as a failed utterance.
   *
   * Unless the listener is the one who left: Deepgram drops the request when
   * the candidate interrupts, and that is the system working.
   */
  if (failure && !(res.writableEnded || res.destroyed)) throw failure;

  res.end();
  return { samples, seconds: samples / TARGET_SAMPLE_RATE };
}

export { MAX_INPUT_CHARS };
