/**
 * Deepgram Voice Agent — credentials and session settings.
 *
 * WHAT THIS REPLACES. The live interview used to be three round trips with a
 * person waiting in between: the device recognised speech locally, posted the
 * text to /meeting/turn, waited for a complete reply, then spoke it. Every
 * stage ran to completion before the next began, so the candidate heard a gap
 * of several seconds after every answer — the single thing that makes a mock
 * interview feel like software instead of a person.
 *
 * The Voice Agent collapses that into one websocket the client holds open for
 * the whole call: audio in, audio out, and Deepgram handling the part that is
 * genuinely hard — deciding when the candidate has actually finished speaking,
 * and stopping the interviewer mid-sentence when they haven't.
 *
 * WHAT STAYS OURS. The interviewer's judgement. Deepgram's `think` step points
 * back at /api/voice/think, so the model, the persona, the CV and the job
 * description never leave this backend — see services/voice/think.js for why
 * that boundary is a security property and not just tidiness.
 *
 * LANGUAGE IS NOT SYMMETRIC, and this is the constraint that shapes the whole
 * file: Deepgram transcribes Arabic well (nova-3 covers ar-EG through ar-MA)
 * but CANNOT SPEAK IT — its text-to-speech is English, Spanish, German,
 * French, Italian, Dutch and Japanese, with no Arabic voice at any price. Nor
 * is there a free provider on the list its `speak` slot accepts.
 *
 * So an English interview is pure Deepgram end to end, and an Arabic one
 * borrows nothing: `speak` points back at /api/voice/speak, where the Egyptian
 * neural voice the typed interview has always used answers in the shape
 * Deepgram expects from OpenAI. Both ends of the Arabic call are ours, both
 * are free, and the only paid part of either language is Deepgram itself.
 */

import { cfg } from '../secrets/store.js';
import { logger } from '../../utils/logger.js';
import { voiceIsUp } from './speak.js';

const GRANT_URL = 'https://api.deepgram.com/v1/auth/grant';

/**
 * Lifetime of the credential handed to the client.
 *
 * Deepgram's default is 30 seconds and the ceiling is an hour. Thirty is
 * enough in principle — the token only has to be valid for the websocket
 * UPGRADE, and the connection outlives its expiry — but it is not enough in
 * practice on a phone on mobile data, where the gap between "backend replied"
 * and "handshake reached Deepgram" is occasionally seconds. Two minutes costs
 * nothing: the token grants usage against this project and dies on its own,
 * and it is minted per call rather than per user.
 */
const TOKEN_TTL_SECONDS = 120;

/** Deepgram's own timeout is generous; ours is the user staring at a spinner. */
const GRANT_TIMEOUT_MS = 8_000;

export function isConfigured() {
  return Boolean(cfg('DEEPGRAM_API_KEY'));
}

/**
 * Can this language actually be spoken aloud by the agent?
 *
 * Checked before a session is opened rather than after, because the failure it
 * guards against is the worst kind: a connection that succeeds, transcribes
 * the candidate correctly, thinks correctly, and produces nothing audible.
 */
export async function canSpeak(language) {
  if (!isConfigured()) return false;
  // English is Deepgram's own voice and is up whenever the agent is. Arabic is
  // ours, and "ours" is an undocumented Microsoft endpoint that has moved
  // address once already — so it is asked, not assumed. The answer is cached;
  // see services/voice/speak.js.
  if (language !== 'ar') return true;
  return voiceIsUp();
}

/**
 * Mint a short-lived Deepgram token for one client.
 *
 * The project API key never leaves this process. It cannot: a key shipped in
 * the mobile bundle is extractable from the APK by anyone who downloads it,
 * and a Deepgram key is a billable credential with no per-user scope.
 */
export async function grantToken() {
  const key = cfg('DEEPGRAM_API_KEY');
  if (!key) throw new Error('DEEPGRAM_API_KEY is not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRANT_TIMEOUT_MS);

  try {
    const res = await fetch(GRANT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // The key itself is never logged, but its shape of failure is: a 403
      // here means the key lacks Member permissions, which looks identical
      // from the client to a key that is simply wrong.
      logger.error('Deepgram token grant failed', { status: res.status, detail: detail.slice(0, 200) });
      throw new Error(`Deepgram token grant failed (${res.status})`);
    }

    const body = await res.json();
    if (!body?.access_token) throw new Error('Deepgram token grant returned no token');

    return { token: body.access_token, expiresIn: body.expires_in ?? TOKEN_TTL_SECONDS };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

/**
 * Audio formats.
 *
 * 16 kHz in because Deepgram states there is no accuracy gain above it, and
 * on a phone every kilobit of uplink is a kilobit that can stall. 24 kHz out
 * because that is what the voices are synthesised at and resampling only
 * costs quality. Raw linear16 both ways: a container would have to be
 * demuxed before playback, and the client is playing a stream that has no end
 * yet.
 */
const AUDIO = {
  input: { encoding: 'linear16', sample_rate: 16000 },
  output: { encoding: 'linear16', sample_rate: 24000, container: 'none' },
};

/**
 * How certain Flux must be that the candidate has stopped talking.
 *
 * This number is the interview's whole rhythm. Deepgram's default is 0.7 and
 * ours is higher, because the two mistakes are not symmetric in an interview:
 * cutting in early on someone mid-thought — which is what a candidate under
 * pressure sounds like when they pause to think — is far more damaging than
 * half a second of extra silence. `eot_timeout_ms` is the backstop that ends
 * a turn on silence regardless of confidence.
 */
const EOT_THRESHOLD = 0.8;
const EOT_TIMEOUT_MS = 4_000;

/**
 * Terms worth biasing the recogniser towards.
 *
 * A candidate says their job title and their employer's name more than any
 * other proper nouns in the call, and those are exactly the words a general
 * model mangles. They come from the interview context, so they cost nothing
 * to collect.
 */
function keytermsFrom(context) {
  const terms = [context?.jobTitle, context?.company]
    .filter(Boolean)
    .map((t) => String(t).trim().slice(0, 60))
    .filter((t) => t.length > 1);
  return terms.slice(0, 8);
}

function listenFor(language, context) {
  if (language === 'ar') {
    /*
     * Arabic listens on nova-3 (listen v1), not Flux: Flux is English-only
     * (`flux-general-en`) plus a ten-language multi model that does not cover
     * Arabic. The cost is real and worth naming — v1 ends a turn on silence
     * rather than on a model's judgement of completeness, so Arabic turn-taking
     * is measurably blunter than English. It is the best available until
     * Deepgram ships Arabic Flux.
     */
    return {
      provider: {
        type: 'deepgram',
        version: 'v1',
        model: 'nova-3',
        language: 'ar',
        keyterms: keytermsFrom(context),
      },
    };
  }

  return {
    provider: {
      type: 'deepgram',
      version: 'v2',
      model: 'flux-general-en',
      eot_threshold: EOT_THRESHOLD,
      eot_timeout_ms: EOT_TIMEOUT_MS,
      keyterms: keytermsFrom(context),
    },
  };
}

function speakFor(language, { speakUrl, speakToken }) {
  if (language !== 'ar') {
    return {
      provider: {
        type: 'deepgram',
        version: 'v2',
        model: cfg('VOICE_SPEAK_MODEL') || 'flux-kit-en',
      },
    };
  }

  /*
   * Arabic speaks through our own endpoint, in the same OpenAI costume the
   * `think` block wears below and for the same reason: `open_ai` is the
   * provider type for ANY endpoint that speaks OpenAI's shape, and ours does.
   * On the other side of this URL is the Egyptian neural voice the typed
   * interview has always used — free, no account, no key. See
   * services/voice/speak.js for the measured request contract.
   *
   * `model` and `voice` are sent to us on every request and ignored: the
   * Settings frame passes through the client, so the only trustworthy source
   * for which voice speaks is the signed token, not a field in the body. They
   * are set to OpenAI's own values because the field is required and must
   * validate, not because anything reads them.
   */
  return {
    provider: { type: 'open_ai', model: 'tts-1', voice: 'alloy' },
    endpoint: {
      url: speakUrl,
      headers: { authorization: `Bearer ${speakToken}` },
    },
  };
}

/**
 * The opening line, written here rather than generated.
 *
 * Two reasons. The obvious one is latency: a model call before the first word
 * would add seconds to the moment the candidate is most likely to think the
 * app is broken. The less obvious one is echo cancellation — Deepgram's own
 * guidance is to have the agent speak first so the client's canceller has a
 * reference signal to calibrate against before anyone is talking over anyone.
 *
 * It stays deliberately short and does not use the candidate's name: the name
 * lives in the CV summary, which the model sees and this function does not.
 */
function greetingFor(language, gender, context) {
  const company = context?.company ? String(context.company).trim().slice(0, 80) : '';

  if (language !== 'ar') {
    const name = gender === 'male' ? 'Ahmed' : 'Sarah';
    const where = company ? ` from ${company}` : '';
    return `Hi, I'm ${name}${where}. Thanks for making the time today — whenever you're ready, tell me a little about yourself.`;
  }

  const name = gender === 'male' ? 'أحمد' : 'سارة';
  const where = company ? ` من ${company}` : '';
  return gender === 'male'
    ? `أهلاً بك، أنا ${name}${where}. شكرًا لوقتك اليوم. لما تكون جاهز، حدّثني قليلاً عن نفسك.`
    : `أهلاً بك، أنا ${name}${where}. شكرًا لوقتك اليوم. لما تكون جاهزًا، حدّثني قليلاً عن نفسك.`;
}

/**
 * Build the Settings message for one interview.
 *
 * Returned to the client, which forwards it to Deepgram verbatim as the first
 * frame. That it travels through the client is worth being clear-eyed about:
 * the client CAN alter it before sending. What it cannot do is alter what the
 * interviewer knows or says, because the prompt is not in here — only the
 * address of the endpoint that holds it, and a token that endpoint verifies.
 * The worst a tampered Settings achieves is a worse interview for the person
 * who tampered with it.
 *
 * @param {object} opts
 * @param {'ar'|'en'} opts.language
 * @param {'male'|'female'} opts.gender
 * @param {object} opts.context      Interview context (company, jobTitle, ...).
 * @param {string} opts.thinkUrl     Absolute URL of our own /api/voice/think.
 * @param {string} opts.thinkToken   Bearer token that endpoint verifies.
 * @param {string} [opts.speakUrl]   Absolute URL of /api/voice/speak (Arabic).
 * @param {string} [opts.speakToken] Bearer token that endpoint verifies.
 */
export function settingsFor({
  language = 'ar', gender = 'female', context = null,
  thinkUrl, thinkToken, speakUrl, speakToken,
}) {
  return {
    type: 'Settings',
    audio: AUDIO,
    agent: {
      listen: listenFor(language, context),
      think: {
        /*
         * `open_ai` is the provider type for ANY endpoint that speaks the
         * OpenAI chat-completions shape, which ours does. It is not a
         * statement about which model runs — that is Claude, chosen by
         * VOICE_LLM_MODEL on the other side of this URL.
         *
         * Pointing Deepgram's `anthropic` provider straight at Anthropic was
         * the obvious alternative and it does not work: that path sends
         * `temperature`, which Opus 5.5 rejects with a 400 on every request.
         * Going through our own endpoint also keeps the API key, the persona
         * and the candidate's CV on this side of the wire.
         */
        provider: { type: 'open_ai', model: cfg('VOICE_LLM_MODEL') || cfg('CLAUDE_MODEL') },
        endpoint: {
          url: thinkUrl,
          headers: { authorization: `Bearer ${thinkToken}` },
        },
      },
      speak: speakFor(language, { speakUrl, speakToken }),
      greeting: greetingFor(language, gender, context),
    },
  };
}
