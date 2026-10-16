/**
 * Live voice interview over a single websocket — browser implementation.
 *
 * The shape of the thing
 *   One socket to Deepgram carries raw microphone audio up and the
 *   interviewer's synthesised voice down. Deepgram decides when the candidate
 *   has finished a sentence, calls OUR backend for what the interviewer should
 *   say, and streams the answer back as audio. Nothing in this file knows what
 *   the interviewer is told to be — see backend/src/services/voice.
 *
 * Why there are two AudioContexts
 *   Capture has to be 16 kHz, which is what Deepgram wants and the rate above
 *   which it says accuracy does not improve. Playback arrives at 24 kHz. A
 *   browser's default context runs at the output device's rate, usually 48 kHz,
 *   and resampling by hand is a pile of arithmetic that is easy to get subtly
 *   wrong. So capture gets its own context pinned to 16 kHz — a
 *   MediaStreamAudioSourceNode resamples into it for free — and playback uses
 *   the call's shared graph, where an AudioBuffer tagged 24 kHz is resampled on
 *   its way to the speakers by the same machinery.
 *
 * Echo cancellation is the browser's, and that is not a compromise
 *   The interviewer's voice comes out of the same speakers the microphone is
 *   listening to, so without cancellation she hears herself, decides the
 *   candidate has started talking, and stops mid-question. Deepgram's own
 *   guidance is to use the platform canceller first, which here means
 *   `echoCancellation: true` on getUserMedia. Noise suppression is deliberately
 *   OFF: it is tuned for conference calls and chews up the quiet end of speech,
 *   which is exactly where a nervous candidate lives.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  CaptureHandle, UseVoiceAgent, VoiceAgentController, VoiceAgentErrorCode,
  VoiceAgentOptions, VoiceAgentSpeaker, VoiceAgentState,
} from './contract';
import { asCaptureHandle } from './contract';
import {
  ensureAudioContext, mixDestination, releaseAudioGraph, retainAudioGraph,
} from './audioGraph.web';

/** What Deepgram wants on the way in, and what it sends on the way out. */
const CAPTURE_RATE = 16000;
const PLAYBACK_RATE = 24000;

/**
 * 80 ms of audio per frame — 1280 samples at 16 kHz.
 *
 * Deepgram's recommendation, and the reason is end-of-turn detection rather
 * than bandwidth: the model decides whether a sentence finished from the shape
 * of its last few frames, so frames much larger than this blur the moment it is
 * deciding about, and much smaller ones cost a websocket message each for no
 * extra resolution.
 */
const FRAME_SAMPLES = 1280;

/**
 * Keep-alive cadence.
 *
 * A candidate thinking in silence sends frames of near-zero audio, not nothing,
 * so the socket is rarely idle in the TCP sense. This is for the case that does
 * go quiet: the tab is backgrounded and the browser throttles timers. Comfortably
 * under any sensible idle timeout.
 */
const KEEPALIVE_MS = 8000;

/**
 * How far ahead of the clock audio is scheduled.
 *
 * Chunks arrive in bursts and must be stitched into one continuous voice; each
 * is scheduled at the end of the last. This cushion absorbs a late chunk
 * without a gap. Too large and barge-in feels sluggish, because everything
 * already scheduled has to be torn down before the interviewer actually stops.
 */
const SCHEDULE_AHEAD_S = 0.08;

/**
 * How long to wait for the call to go live before giving up on it.
 *
 * Covers the whole chain — our /voice/session, the microphone prompt, the
 * websocket upgrade and Deepgram validating the Settings frame. Generous,
 * because the microphone permission dialog is in the middle of it and the
 * candidate may take a moment to click Allow. The fallback on the far side of
 * this timeout is the typed interview, which still works.
 */
const CONNECT_TIMEOUT_MS = 20000;

/* ------------------------------------------------------------------ *
 * The capture worklet
 * ------------------------------------------------------------------ */

/**
 * Loaded from a Blob rather than a file.
 *
 * `addModule` takes a URL, and shipping a real .js asset would mean an entry in
 * the Expo web build's static output that has to survive bundling, hashing and
 * the CDN — for twenty lines. The Blob URL is same-origin by construction and
 * cannot go stale.
 *
 * The accumulation matters: the worklet is called with 128 frames at a time, so
 * it buffers ten of those into one 80 ms frame rather than posting 128-sample
 * messages 125 times a second.
 */
const WORKLET_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(${FRAME_SAMPLES});
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      // Float [-1,1] to signed 16-bit, clamped: a sample above 1.0 wraps to a
      // loud negative one otherwise, which is audible as a click.
      let s = channel[i];
      if (s > 1) s = 1; else if (s < -1) s = -1;
      this.buffer[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === ${FRAME_SAMPLES}) {
        const out = this.buffer.slice(0);
        this.port.postMessage(out.buffer, [out.buffer]);
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor('interprova-capture', CaptureProcessor);
`;

/* ------------------------------------------------------------------ *
 * Hook
 * ------------------------------------------------------------------ */

export const useVoiceAgent: UseVoiceAgent = (opts: VoiceAgentOptions): VoiceAgentController => {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [state, setState] = useState<VoiceAgentState>('idle');
  const [speaker, setSpeaker] = useState<VoiceAgentSpeaker>('none');
  const [muted, setMutedState] = useState(false);
  // Read from `connect`, which runs long after the render that set the state.
  const mutedRef = useRef(false);

  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const scriptRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const playGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const scheduledRef = useRef<AudioBufferSourceNode[]>([]);
  const playheadRef = useRef(0);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const graphHeldRef = useRef(false);

  /**
   * Invalidates everything in flight from a previous call.
   *
   * Same pattern as the TTS hook's session counter, and for the same reason: a
   * websocket message or a scheduled buffer from a call the user already hung
   * up on must not be able to reach the UI of the next one.
   */
  const sessionRef = useRef(0);

  /**
   * The current state, readable from inside the socket callbacks.
   *
   * They close over the value they were created with, and a websocket that
   * fails during the handshake has to be told apart from one that drops
   * mid-call — the first is a credential problem the user can do nothing
   * about, the second is their train going into a tunnel.
   */
  const stateRef = useRef<VoiceAgentState>('idle');

  /**
   * The promise `start()` handed back, settled when the call is genuinely
   * live or when it has definitively failed.
   *
   * The screen needs a yes or no before it can decide which interview to run,
   * and "the websocket opened" is not that answer: Deepgram accepts the socket
   * first and validates the Settings frame after, so a bad voice id or a
   * rejected think endpoint arrives as an Error frame on a connection that
   * already looked fine.
   */
  const pendingStartRef = useRef<{
    resolve: () => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const settleStart = useCallback((err?: Error) => {
    const pending = pendingStartRef.current;
    if (!pending) return;
    pendingStartRef.current = null;
    clearTimeout(pending.timer);
    if (err) pending.reject(err); else pending.resolve();
  }, []);

  const supported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    if (typeof WebSocket === 'undefined') return false;
    const md = (navigator as any)?.mediaDevices;
    return Boolean(md?.getUserMedia) && Boolean((window as any).AudioContext || (window as any).webkitAudioContext);
  }, []);

  const emitState = useCallback((next: VoiceAgentState) => {
    stateRef.current = next;
    setState(next);
    optsRef.current.onStateChange?.(next);
  }, []);

  const emitSpeaker = useCallback((who: VoiceAgentSpeaker, analysable: CaptureHandle | null = null) => {
    setSpeaker(who);
    optsRef.current.onSpeakerChange?.(who, analysable);
  }, []);

  /**
   * Filled once `teardown` exists. `fail` has to be able to call it and is
   * declared first, because teardown's own dependencies read cleaner that way.
   */
  const teardownRef = useRef<() => void>(() => {});

  /**
   * Give up on the call, and let go of everything it was holding.
   *
   * The release is the part that was missing and mattered most: a failure
   * leaves a microphone open otherwise, and the browser's recording indicator
   * stays lit for the rest of a call the user is now having over the typed
   * interview instead. Tearing down also bumps the session counter, which is
   * what stops a connect still parked on an await from waking up later and
   * opening a second interview on top of the first.
   *
   * Order matters: teardown detaches `onclose` before closing the socket, so
   * `ended` cannot land on top of `failed`, and the state is set last.
   */
  const fail = useCallback((code: VoiceAgentErrorCode, detail?: string) => {
    optsRef.current.onError?.(code, detail);
    settleStart(new Error(detail ? `${code}: ${detail}` : code));
    teardownRef.current();
    // The close handler that used to do this has just been detached by the
    // teardown above, and a failure that leaves the stage showing a talking
    // interviewer is a worse lie than the failure itself.
    emitSpeaker('none');
    emitState('failed');
  }, [emitSpeaker, emitState, settleStart]);

  /* -------------------------- playback -------------------------- */

  /**
   * Drop everything queued and not yet heard.
   *
   * This is barge-in. The candidate has started talking over the interviewer,
   * so every chunk already scheduled — up to the whole rest of her sentence —
   * has to stop immediately, or she talks over the answer to her own question.
   */
  const flushPlayback = useCallback(() => {
    for (const node of scheduledRef.current) {
      try { node.onended = null; node.stop(); } catch { /* already finished */ }
    }
    scheduledRef.current = [];
    playheadRef.current = 0;
  }, []);

  const enqueueAudio = useCallback((pcm: ArrayBuffer, session: number) => {
    if (session !== sessionRef.current) return;
    const ctx = ensureAudioContext();
    const gain = playGainRef.current;
    if (!ctx || !gain) return;

    const samples = new Int16Array(pcm);
    if (samples.length === 0) return;

    // Tagged 24 kHz; the context resamples to the output device's rate on its
    // way through. Doing that arithmetic here would be a resampler nobody asked
    // for, with artefacts in the interviewer's voice as the prize.
    const buffer = ctx.createBuffer(1, samples.length, PLAYBACK_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(gain);

    const now = ctx.currentTime;
    // A playhead in the past means the queue drained — the gap between
    // sentences, or the first chunk of a reply. Restart it ahead of the clock.
    const at = Math.max(playheadRef.current, now + SCHEDULE_AHEAD_S);
    node.start(at);
    playheadRef.current = at + buffer.duration;

    scheduledRef.current.push(node);
    node.onended = () => {
      scheduledRef.current = scheduledRef.current.filter((n) => n !== node);
    };
  }, []);

  /* --------------------------- capture --------------------------- */

  const sendFrame = useCallback((frame: ArrayBuffer) => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // bufferedAmount guards the case where the uplink has stalled: without it
    // a bad network turns into an unbounded queue of stale audio that is
    // delivered late and transcribed as a reply to the wrong question.
    if (ws.bufferedAmount > FRAME_SAMPLES * 2 * 25) return;
    ws.send(frame);
  }, []);

  const startCapture = useCallback(async (stream: MediaStream, session: number) => {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new Ctx({ sampleRate: CAPTURE_RATE });
    captureCtxRef.current = ctx;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    // Hung up during the resume: the context below is already closed, and
    // every node built on it would throw.
    if (session !== sessionRef.current) return;

    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;

    try {
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        // Revoked even when addModule rejects, or the Blob outlives the call.
        URL.revokeObjectURL(url);
      }
      if (session !== sessionRef.current) return;

      const node = new AudioWorkletNode(ctx, 'interprova-capture');
      node.port.onmessage = (event) => sendFrame(event.data as ArrayBuffer);
      source.connect(node);
      // A worklet with nothing downstream is pruned by some engines. The
      // destination is connected through a silent gain so the graph stays
      // alive without the candidate hearing their own voice back.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink).connect(ctx.destination);
      workletRef.current = node;
      return;
    } catch {
      // Safari below 14.1 and any engine where addModule is blocked. The
      // deprecated node still works everywhere it matters, and a deprecated
      // capture path beats no interview.
    }

    if (session !== sessionRef.current) return;
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    let pending = new Int16Array(FRAME_SAMPLES);
    let filled = 0;
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      for (let i = 0; i < input.length; i++) {
        let s = input[i];
        if (s > 1) s = 1; else if (s < -1) s = -1;
        pending[filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (filled === FRAME_SAMPLES) {
          sendFrame(pending.buffer.slice(0));
          filled = 0;
        }
      }
    };
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(processor).connect(sink).connect(ctx.destination);
    scriptRef.current = processor;
  }, [sendFrame]);

  /* --------------------------- teardown --------------------------- */

  const teardown = useCallback(() => {
    sessionRef.current += 1;
    // A start still in flight is now a start that will never finish.
    settleStart(new Error('cancelled'));

    if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }

    const ws = socketRef.current;
    socketRef.current = null;
    if (ws) {
      ws.onmessage = null; ws.onerror = null; ws.onclose = null; ws.onopen = null;
      try { if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(); } catch {}
    }

    flushPlayback();

    if (workletRef.current) { try { workletRef.current.port.onmessage = null; workletRef.current.disconnect(); } catch {} workletRef.current = null; }
    if (scriptRef.current) { try { scriptRef.current.onaudioprocess = null; scriptRef.current.disconnect(); } catch {} scriptRef.current = null; }
    if (sourceRef.current) { try { sourceRef.current.disconnect(); } catch {} sourceRef.current = null; }

    if (captureCtxRef.current) {
      const dying = captureCtxRef.current;
      captureCtxRef.current = null;
      if (dying.state !== 'closed') dying.close().catch(() => {});
    }

    // The microphone light stays on until every track is stopped, and a user
    // who sees it after hanging up does not trust the app again.
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) { try { track.stop(); } catch {} }
      streamRef.current = null;
    }

    if (playGainRef.current) { try { playGainRef.current.disconnect(); } catch {} playGainRef.current = null; }
    if (analyserRef.current) { try { analyserRef.current.disconnect(); } catch {} analyserRef.current = null; }

    if (graphHeldRef.current) { graphHeldRef.current = false; releaseAudioGraph(); }
  }, [flushPlayback, settleStart]);

  /* ---------------------------- messages ---------------------------- */

  teardownRef.current = teardown;

  const handleMessage = useCallback((event: MessageEvent, session: number) => {
    if (session !== sessionRef.current) return;

    if (typeof event.data !== 'string') {
      const data = event.data as Blob | ArrayBuffer;
      if (data instanceof ArrayBuffer) enqueueAudio(data, session);
      else data.arrayBuffer().then((buf) => enqueueAudio(buf, session)).catch(() => {});
      return;
    }

    let msg: any;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case 'Welcome':
        break;

      case 'SettingsApplied':
        emitState('live');
        settleStart();
        break;

      case 'UserStartedSpeaking':
        // Barge-in. Deepgram has already stopped generating on its side; this
        // is the half the client owes — silencing what is already queued.
        flushPlayback();
        emitSpeaker('candidate');
        break;

      case 'AgentStartedSpeaking':
        emitSpeaker('interviewer', asCaptureHandle(analyserRef.current));
        break;

      case 'AgentAudioDone':
        emitSpeaker('none');
        break;

      case 'ConversationText':
        if (msg.content) {
          optsRef.current.onTurn({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: String(msg.content),
          });
        }
        break;

      case 'Error':
        // Fatal by definition — Deepgram closes the socket after one.
        fail('server', String(msg.description || msg.code || 'agent error'));
        break;

      case 'Warning':
      default:
        break;
    }
  }, [emitSpeaker, emitState, enqueueAudio, fail, flushPlayback, settleStart]);

  /* ----------------------------- start ----------------------------- */

  const connect = useCallback(async (session: number) => {
    emitState('connecting');

    let credentials;
    try {
      credentials = await optsRef.current.fetchSession();
    } catch (err: any) {
      // An attempt the screen has already given up on. Without this guard a
      // slow /voice/session that finally rejects would tear down whatever call
      // is live BY THEN — which, after the timeout fallback and a second
      // Start, is somebody's working interview.
      if (session !== sessionRef.current) return;
      fail(err?.code === 'VOICE_NO_VOICE' ? 'server' : 'network', err?.message);
      return;
    }
    if (session !== sessionRef.current) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          // See the file header: suppression is tuned for conference calls and
          // eats the quiet end of speech.
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: CAPTURE_RATE,
        },
        video: false,
      });
    } catch (err: any) {
      // Same reasoning as above: the permission dialog can outlive the attempt
      // that opened it.
      if (session !== sessionRef.current) return;
      fail(err?.name === 'NotAllowedError' ? 'mic-denied' : 'unknown', err?.message);
      return;
    }
    if (session !== sessionRef.current) { for (const t of stream.getTracks()) t.stop(); return; }
    streamRef.current = stream;
    // A fresh stream's tracks are enabled by default, so a reconnect while
    // muted would put the candidate back on air without the button moving.
    if (mutedRef.current) for (const t of stream.getAudioTracks()) t.enabled = false;

    // Playback chain, built before the socket so the first chunk has somewhere
    // to land. The analyser is for the level meter; the mix destination is how
    // the interviewer's voice reaches the session recording.
    const ctx = ensureAudioContext();
    if (ctx) {
      retainAudioGraph();
      graphHeldRef.current = true;
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      gain.connect(analyser);
      analyser.connect(ctx.destination);
      const mix = mixDestination();
      if (mix) analyser.connect(mix);
      playGainRef.current = gain;
      analyserRef.current = analyser;
      playheadRef.current = 0;
    }

    let ws: WebSocket;
    try {
      // The browser cannot set an Authorization header on a websocket, so the
      // token rides in the subprotocol — the one handshake header it does
      // control. Verified against the live service: ['bearer', <jwt>] is
      // accepted and echoed back as the negotiated protocol.
      ws = new WebSocket(credentials.url, ['bearer', credentials.token]);
    } catch (err: any) {
      fail('network', err?.message);
      return;
    }
    ws.binaryType = 'arraybuffer';
    socketRef.current = ws;

    ws.onopen = () => {
      if (session !== sessionRef.current) return;
      // Settings first, always: Deepgram ignores audio until it has them.
      ws.send(JSON.stringify(credentials.settings));
      startCapture(stream, session).catch((err) => {
        // A teardown that raced the capture setup is not a failure to report:
        // the call is already over and the screen has moved on.
        if (session !== sessionRef.current) return;
        fail('unknown', err?.message);
      });
      keepAliveRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }, KEEPALIVE_MS);
    };

    ws.onmessage = (event) => handleMessage(event, session);

    ws.onerror = () => {
      if (session !== sessionRef.current) return;
      // A failed handshake surfaces here with no status code — the browser
      // refuses to tell us whether it was 401 or a dead network. The server
      // rejects an expired token, which is the likeliest cause by far.
      fail(stateRef.current === 'connecting' ? 'auth' : 'network');
    };

    ws.onclose = () => {
      if (session !== sessionRef.current) return;
      if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }
      emitSpeaker('none');
      // `failed` is already terminal and more informative; do not overwrite it.
      if (stateRef.current !== 'failed') emitState('ended');
      // A socket that closes before Settings were ever applied is a failure to
      // start, not a call that ended — the screen is still waiting on an answer.
      settleStart(new Error('closed before the call went live'));
    };
  }, [emitSpeaker, emitState, fail, handleMessage, settleStart, startCapture]);

  /**
   * Open the call, and resolve only once it is actually live.
   *
   * The caller is deciding between two different interviews on the strength of
   * this promise, so it must not resolve optimistically: a rejection here is
   * the signal to fall back to the typed flow, and a false positive would
   * leave the candidate on a silent stage.
   */
  const start = useCallback((): Promise<void> => {
    if (!supported) { fail('unsupported'); return Promise.reject(new Error('unsupported')); }
    // A socket that exists but is not live is the wreckage of a previous
    // attempt. Resolving on it would tell the screen the voice interview is
    // running, and the screen would then never start the typed one — a silent
    // stage with the minute clock ticking.
    if (socketRef.current && stateRef.current === 'live') return Promise.resolve();

    // Clean slate first, and before the promise exists: teardown settles any
    // previous attempt, and must not be able to settle this one.
    teardown();
    const session = sessionRef.current;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Nothing came back at all — a captive portal, a proxy eating the
        // upgrade, or a network that accepted the TCP connection and stopped.
        fail('network', 'handshake timed out');
      }, CONNECT_TIMEOUT_MS);
      pendingStartRef.current = { resolve, reject, timer };
      void connect(session);
    });
  }, [connect, fail, supported, teardown]);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    mutedRef.current = next;
    const stream = streamRef.current;
    if (!stream) return;
    // Disabled tracks deliver silence rather than nothing, so the stream stays
    // continuous and Deepgram does not read the gap as the end of a turn.
    for (const track of stream.getAudioTracks()) track.enabled = !next;
  }, []);

  const stop = useCallback(() => {
    teardown();
    emitSpeaker('none');
    emitState('ended');
  }, [emitSpeaker, emitState, teardown]);

  const release = useCallback(() => { teardown(); }, [teardown]);

  useEffect(() => () => { teardown(); }, [teardown]);

  return useMemo(() => ({
    supported, state, speaker, muted, start, setMuted, stop, release,
  }), [supported, state, speaker, muted, start, setMuted, stop, release]);
};
