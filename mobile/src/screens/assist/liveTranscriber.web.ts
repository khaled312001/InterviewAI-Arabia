/**
 * The live transcript in a browser.
 *
 * PRIMARY PATH: getUserMedia → MediaRecorder (Opus) → a websocket straight to
 * the streaming recogniser, authenticated with the short-lived credential from
 * /assist/:id/listen. Audio never passes through our server, which is what
 * keeps the delay between the interviewer's last word and the transcript at a
 * few hundred milliseconds. Safari's MediaRecorder cannot produce Opus, so
 * there the same socket is fed raw 16-bit PCM from a ScriptProcessor instead.
 *
 * TWO SOURCES on desktop. The microphone hears the room. A shared meeting tab
 * (getDisplayMedia with its audio) hears ONLY the interviewer — the right
 * choice when the candidate is on headphones, where the microphone would hear
 * nothing but the candidate.
 *
 * FALLBACK: when the server has no streaming recogniser configured, the
 * browser's own SpeechRecognition (Chrome, Edge) listens to the microphone.
 *
 * Echo cancellation is OFF on purpose. It exists to remove what the speakers
 * play, and when the interview runs on the same laptop, what the speakers play
 * is the interviewer — the one voice this has to hear.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AssistError } from './assistApi';
import type {
  LiveTranscriber, LiveTranscriberOptions, TranscriberSource, TranscriberState, UseLiveTranscriber,
} from './liveTranscriber.types';

/** Opus chunk length. Short, so the first words reach the recogniser quickly. */
const TIMESLICE_MS = 250;
const PCM_RATE = 16000;
/** Reconnect attempts before the drop is reported. */
const MAX_RECONNECTS = 4;

const OPUS_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'];

function opusType(): string | null {
  const MR = (globalThis as any).MediaRecorder;
  if (!MR?.isTypeSupported) return null;
  return OPUS_TYPES.find((t) => MR.isTypeSupported(t)) ?? null;
}

function speechCtor(): any {
  const w = globalThis as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const isPhoneBrowser = () =>
  typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

const BROWSER_LOCALE = { ar: 'ar-EG', en: 'en-US' } as const;

export const useLiveTranscriber: UseLiveTranscriber = (opts): LiveTranscriber => {
  const optsRef = useRef<LiveTranscriberOptions>(opts);
  optsRef.current = opts;

  const [state, setState] = useState<TranscriberState>('idle');
  const [interim, setInterim] = useState('');

  const supported = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const md = (navigator as any).mediaDevices;
    return Boolean((md?.getUserMedia && typeof WebSocket !== 'undefined') || speechCtor());
  }, []);
  const canCaptureTab = useMemo(
    () => typeof navigator !== 'undefined' && Boolean((navigator as any).mediaDevices?.getDisplayMedia) && !isPhoneBrowser(),
    [],
  );

  const activeRef = useRef(false);
  /** Bumped on every stop: callbacks from an older run see a stale number. */
  const runRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<any>(null);
  const audioRef = useRef<{ ctx: AudioContext; node: ScriptProcessorNode; src: MediaStreamAudioSourceNode } | null>(null);
  const browserRef = useRef<any>(null);
  const reconnectsRef = useRef(0);

  /* ------------------------------------------------------------ teardown */

  const closeSocket = useCallback(() => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* stopped */ }
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      try { audio.node.disconnect(); audio.src.disconnect(); } catch { /* gone */ }
      audio.ctx.close().catch(() => {});
    }
    const ws = socketRef.current;
    socketRef.current = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }));
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000);
      } catch { /* closed */ }
    }
  }, []);

  const releaseAll = useCallback(() => {
    closeSocket();
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* stopped */ } });
    const browser = browserRef.current;
    browserRef.current = null;
    if (browser) {
      browser.onend = null;
      browser.onresult = null;
      browser.onerror = null;
      try { browser.abort(); } catch { /* stopped */ }
    }
  }, [closeSocket]);

  const stop = useCallback(() => {
    activeRef.current = false;
    runRef.current += 1;
    releaseAll();
    setInterim('');
    setState('idle');
  }, [releaseAll]);

  /** Give up with a reason the screen can show. */
  const fail = useCallback((code: Parameters<LiveTranscriberOptions['onError']>[0]) => {
    stop();
    optsRef.current.onError(code);
  }, [stop]);

  /* ------------------------------------------------------- browser fallback */

  const startBrowser = useCallback((run: number) => {
    const Ctor = speechCtor();
    if (!Ctor) { fail('unsupported'); return; }
    const rec = new Ctor();
    const lang = optsRef.current.language;
    rec.lang = lang === 'multi' ? (navigator.language || 'en-US') : BROWSER_LOCALE[lang];
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      if (run !== runRef.current) return;
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        const text = String(r[0]?.transcript || '').trim();
        if (r.isFinal) {
          if (text) {
            optsRef.current.onFinal(text);
            optsRef.current.onTurnEnd();
          }
        } else {
          partial += `${text} `;
        }
      }
      setInterim(partial.trim());
    };
    rec.onerror = (e: any) => {
      if (run !== runRef.current) return;
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') fail('denied');
    };
    // Chrome ends a "continuous" session on its own after a while; reopen it.
    rec.onend = () => {
      if (run !== runRef.current || !activeRef.current) return;
      setTimeout(() => {
        if (run !== runRef.current || !activeRef.current) return;
        try { rec.start(); } catch { /* already started */ }
      }, 200);
    };
    browserRef.current = rec;
    try {
      rec.start();
      setState('listening');
    } catch {
      fail('unsupported');
    }
  }, [fail]);

  /* --------------------------------------------------------- streaming path */

  const connect = useCallback(async (run: number): Promise<void> => {
    const stream = streamRef.current;
    if (!stream || run !== runRef.current) return;

    let cred;
    try {
      cred = await optsRef.current.getCredential();
    } catch (e) {
      if (run !== runRef.current) return;
      const kind = e instanceof AssistError ? e.kind : 'network';
      if (kind === 'quota') { fail('quota'); return; }
      if (kind === 'expired') { fail('expired'); return; }
      throw e;
    }
    if (run !== runRef.current) return;

    const mime = opusType();
    let url = cred.url;
    let pcm: { ctx: AudioContext; node: ScriptProcessorNode; src: MediaStreamAudioSourceNode } | null = null;
    if (!mime) {
      const Ctx = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
      if (!Ctx) { fail('unsupported'); return; }
      let ctx: AudioContext;
      try { ctx = new Ctx({ sampleRate: PCM_RATE }); } catch { ctx = new Ctx(); }
      const src = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      pcm = { ctx, node, src };
      url += `&encoding=linear16&sample_rate=${Math.round(ctx.sampleRate)}&channels=1`;
    }

    // The credential rides in the subprotocol — the one handshake header a
    // browser websocket lets us set. Same arrangement as the voice interview.
    const ws = new WebSocket(url, ['bearer', cred.token]);
    ws.binaryType = 'arraybuffer';
    socketRef.current = ws;
    if (pcm) audioRef.current = pcm;

    ws.onopen = () => {
      if (run !== runRef.current) return;
      setState('listening');
      if (mime) {
        const MR = (globalThis as any).MediaRecorder;
        const rec = new MR(stream, { mimeType: mime });
        rec.ondataavailable = (e: any) => {
          if (e.data?.size && ws.readyState === WebSocket.OPEN) ws.send(e.data);
        };
        rec.start(TIMESLICE_MS);
        recorderRef.current = rec;
      } else if (pcm) {
        pcm.node.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const input = e.inputBuffer.getChannelData(0);
          const out = new Int16Array(input.length);
          for (let i = 0; i < input.length; i += 1) {
            const s = Math.max(-1, Math.min(1, input[i]));
            out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          ws.send(out.buffer);
        };
        pcm.src.connect(pcm.node);
        // A ScriptProcessor only runs while connected; its output is silence.
        pcm.node.connect(pcm.ctx.destination);
      }
    };

    ws.onmessage = (ev) => {
      if (run !== runRef.current || typeof ev.data !== 'string') return;
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'Results') {
        reconnectsRef.current = 0;
        const text = String(msg.channel?.alternatives?.[0]?.transcript || '').trim();
        if (msg.is_final) {
          setInterim('');
          if (text) optsRef.current.onFinal(text);
          if (msg.speech_final) optsRef.current.onTurnEnd();
        } else {
          setInterim(text);
        }
      } else if (msg.type === 'UtteranceEnd') {
        setInterim('');
        optsRef.current.onTurnEnd();
      }
    };

    ws.onclose = () => {
      if (run !== runRef.current || !activeRef.current) return;
      // Dropped mid-session: a new credential and a new socket, same audio.
      closeSocket();
      reconnectsRef.current += 1;
      if (reconnectsRef.current > MAX_RECONNECTS) { fail('network'); return; }
      setState('reconnecting');
      setTimeout(() => {
        if (run !== runRef.current || !activeRef.current) return;
        connect(run).catch(() => fail('network'));
      }, 400 * reconnectsRef.current);
    };
  }, [closeSocket, fail]);

  /* ---------------------------------------------------------------- start */

  const start = useCallback(async (source: TranscriberSource = 'mic') => {
    if (activeRef.current) return;
    if (!supported) { optsRef.current.onError('unsupported'); return; }
    activeRef.current = true;
    reconnectsRef.current = 0;
    const run = ++runRef.current;
    setState('starting');

    const md = (navigator as any).mediaDevices;
    const canStream = optsRef.current.streaming && md?.getUserMedia && typeof WebSocket !== 'undefined';

    if (!canStream) {
      if (source === 'tab') { fail('unsupported'); return; }
      startBrowser(run);
      return;
    }

    try {
      if (source === 'tab') {
        const shared: MediaStream = await md.getDisplayMedia({ video: true, audio: true });
        const audio = shared.getAudioTracks();
        // Only the sound is needed; the picture is dropped at once.
        shared.getVideoTracks().forEach((t) => t.stop());
        if (!audio.length) {
          shared.getTracks().forEach((t) => t.stop());
          if (run === runRef.current) fail('noTabAudio');
          return;
        }
        streamRef.current = new MediaStream(audio);
        audio[0].addEventListener('ended', () => {
          if (run === runRef.current && activeRef.current) fail('sourceEnded');
        });
      } else {
        streamRef.current = await md.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
      }
    } catch (e: any) {
      if (run !== runRef.current) return;
      const name = e?.name || '';
      if (source === 'tab' && name === 'NotAllowedError') fail('sourceEnded');
      else if (name === 'NotAllowedError' || name === 'SecurityError') fail('denied');
      else fail('unsupported');
      return;
    }
    if (run !== runRef.current) { releaseAll(); return; }

    try {
      await connect(run);
    } catch (e) {
      if (run !== runRef.current) return;
      const kind = e instanceof AssistError ? e.kind : 'network';
      if (kind === 'stt' && source === 'mic' && speechCtor()) {
        // No streaming recogniser on the server: the browser's own, if any.
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        startBrowser(run);
        return;
      }
      fail(kind === 'stt' ? 'unsupported' : 'network');
    }
  }, [supported, connect, fail, releaseAll, startBrowser]);

  useEffect(() => stop, [stop]);

  return useMemo(() => ({
    supported, canCaptureTab, state, interim, start, stop,
  }), [supported, canCaptureTab, state, interim, start, stop]);
};
