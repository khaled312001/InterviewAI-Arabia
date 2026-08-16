/**
 * The presence ring's 0..1 envelope.
 *
 * Two sources, because the two voice paths are not alike: server TTS plays
 * through an <audio> element Web Audio can analyse, while `speechSynthesis`
 * plays straight to the OS mixer and exposes no stream at all. The synthesised
 * envelope covers that second case — it is decoration, not measurement, and it
 * is labelled as such so nobody later mistakes it for a real level.
 *
 * Both paths emit on the same budget: at most once per `LEVEL_EMIT_MS`, and the
 * analyser path only on a change of at least `LEVEL_EMIT_DELTA`. Emitting on
 * every animation frame re-rendered the whole call UI 60×/s, which is the
 * difference between a smooth call and a stuttering one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CaptureHandle, LevelMeter, LevelSource, UseLevelMeter } from './contract';
import { readCaptureHandle } from './contract';
import { ensureAudioContext, releaseAudioGraph, retainAudioGraph } from './audioGraph.web';
import {
  ENVELOPE_FLOOR, ENVELOPE_NOISE, ENVELOPE_SMOOTHING, ENVELOPE_SWING,
  LEVEL_EMIT_DELTA, LEVEL_EMIT_MS,
} from './tuning';

export const useLevelMeter: UseLevelMeter = () => {
  const [level, setLevel] = useState(0);
  const [source, setSource] = useState<LevelSource>(null);

  const animRef = useRef<number | null>(null);
  const envelopeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRef = useRef({ at: 0, value: 0 });
  /** Only the nodes this hook created. The TTS analyser belongs to the voice
   *  module and is disconnected there — disconnecting it here would silence the
   *  interviewer mid-sentence. */
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);

  const stopLoops = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    if (envelopeRef.current !== null) {
      clearInterval(envelopeRef.current);
      envelopeRef.current = null;
    }
    const src = micSourceRef.current;
    micSourceRef.current = null;
    if (src) { try { src.disconnect(); } catch { /* noop */ } }
    const analyser = micAnalyserRef.current;
    micAnalyserRef.current = null;
    if (analyser) { try { analyser.disconnect(); } catch { /* noop */ } }
  }, []);

  const stop = useCallback(() => {
    stopLoops();
    lastRef.current = { at: 0, value: 0 };
    setLevel(0);
    setSource(null);
  }, [stopLoops]);

  /** RMS over the time-domain buffer, scaled so ordinary speech reaches the top. */
  const runAnalyser = useCallback((analyser: AnalyserNode) => {
    // Only one loop may own `animRef`; a second would leak the first's frame id
    // and leave it running against a dead analyser forever.
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    const buf = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      const next = Math.min(1, Math.sqrt(sumSq / buf.length) * 6);

      const now = Date.now();
      const last = lastRef.current;
      if (now - last.at >= LEVEL_EMIT_MS && Math.abs(next - last.value) >= LEVEL_EMIT_DELTA) {
        lastRef.current = { at: now, value: next };
        setLevel(next);
      }
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
  }, []);

  /**
   * Smoothing keeps it from flickering; the sine term gives it the loose
   * periodicity of speech rather than the jitter of pure noise. The interval
   * *is* the throttle, so it needs no second delta gate.
   */
  const startEnvelope = useCallback(() => {
    stopLoops();
    setSource('tts-envelope');
    let phase = 0;
    let value = ENVELOPE_FLOOR;
    envelopeRef.current = setInterval(() => {
      phase += 1;
      const target =
        ENVELOPE_FLOOR
        + Math.abs(Math.sin(phase * 0.7)) * ENVELOPE_SWING
        + Math.random() * ENVELOPE_NOISE;
      value = value * ENVELOPE_SMOOTHING + target * (1 - ENVELOPE_SMOOTHING);
      setLevel(Math.min(1, value));
    }, LEVEL_EMIT_MS);
  }, [stopLoops]);

  const startTtsWaveform = useCallback((handle: CaptureHandle | null) => {
    const analyser = readCaptureHandle<AnalyserNode>(handle);
    if (!analyser || typeof analyser.getByteTimeDomainData !== 'function') {
      // The local neural voice has no stream to analyse — this is its path too.
      startEnvelope();
      return;
    }
    stopLoops();
    setSource('tts-waveform');
    runAnalyser(analyser);
  }, [runAnalyser, startEnvelope, stopLoops]);

  const startMic = useCallback((handle: CaptureHandle | null) => {
    if (releasedRef.current) return;
    // Stop first, unconditionally. Both early returns below used to leave a
    // previously running producer alive, so switching from the interviewer's
    // envelope to a mic that turns out to be unusable left the ring animating
    // to the wrong source for the rest of the call.
    stopLoops();
    const stream = readCaptureHandle<MediaStream>(handle);
    if (!stream?.getAudioTracks().length) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;

    try {
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      // Never wired to `ctx.destination`: routing the microphone back to the
      // speakers would echo the candidate at themselves.
      src.connect(analyser);
      micSourceRef.current = src;
      micAnalyserRef.current = analyser;
      setSource('mic');
      runAnalyser(analyser);
    } catch {
      stop();
    }
  }, [runAnalyser, stop, stopLoops]);

  const releasedRef = useRef(false);
  const graphRef = useRef(false);
  const dropGraph = useCallback(() => {
    if (!graphRef.current) return;
    graphRef.current = false;
    releaseAudioGraph();
  }, []);

  const release = useCallback(() => {
    // Latch, so a producer started after teardown cannot re-create an
    // AudioContext that nothing is left to close.
    releasedRef.current = true;
    stop();
    dropGraph();
  }, [dropGraph, stop]);

  useEffect(() => {
    graphRef.current = true;
    retainAudioGraph();
    return () => { release(); };
  }, [release]);

  return useMemo<LevelMeter>(() => ({
    level,
    source,
    startEnvelope,
    startTtsWaveform,
    startMic,
    stop,
    release,
  }), [level, source, startEnvelope, startTtsWaveform, startMic, stop, release]);
};
