import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Subscription } from 'expo-modules-core';
import { addSpeechRecognitionListener, isRecognitionAvailable } from 'expo-speech-recognition';

import type { CaptureHandle, LevelMeter, LevelSource, UseLevelMeter } from './contract';
import {
  ENVELOPE_FLOOR,
  ENVELOPE_NOISE,
  ENVELOPE_SMOOTHING,
  ENVELOPE_SWING,
  LEVEL_EMIT_DELTA,
  LEVEL_EMIT_MS,
} from './tuning';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * `volumechange` is Android's `onRmsChanged` (and the iOS equivalent) surfaced
 * by the recognizer: a float from -2 (silence) to 10 (loud). Nothing else on
 * the device can give us the candidate's input level without opening a second
 * microphone client, which would silence the recognizer.
 */
const RMS_MIN = -2;
const RMS_RANGE = 12;

/**
 * Whether a recognizer exists at all. When it does not — a handset with no
 * Google speech service — there is no microphone amplitude to read, and we
 * report no source rather than animating a ring over a mic we cannot hear.
 */
let micProbe: boolean | null = null;
function micLevelAvailable(): boolean {
  if (micProbe === null) {
    try { micProbe = isRecognitionAvailable(); } catch { micProbe = false; }
  }
  return micProbe;
}

export const useLevelMeter: UseLevelMeter = () => {
  const [level, setLevel] = useState(0);
  const [source, setSource] = useState<LevelSource>(null);

  const envelopeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subRef = useRef<Subscription | null>(null);
  const lastRef = useRef({ at: 0, value: 0 });
  const releasedRef = useRef(false);

  /**
   * Double-throttled: at most one emit per LEVEL_EMIT_MS, and only when the
   * value actually moved by LEVEL_EMIT_DELTA. Every emit re-renders the whole
   * call UI, so an unthrottled meter is the difference between a smooth call
   * and a stuttering one. `force` is for the settle-to-zero on stop, which
   * must always land.
   */
  const emit = useCallback((next: number, force = false) => {
    if (releasedRef.current && !force) return;
    if (!force) {
      const now = Date.now();
      const last = lastRef.current;
      if (now - last.at < LEVEL_EMIT_MS) return;
      if (Math.abs(next - last.value) < LEVEL_EMIT_DELTA) return;
      lastRef.current = { at: now, value: next };
    } else {
      lastRef.current = { at: Date.now(), value: next };
    }
    setLevel(next);
  }, []);

  /** Drops both possible producers without touching the reported level. */
  const detach = useCallback(() => {
    if (envelopeRef.current !== null) {
      clearInterval(envelopeRef.current);
      envelopeRef.current = null;
    }
    if (subRef.current) {
      try { subRef.current.remove(); } catch { /* noop */ }
      subRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    detach();
    lastRef.current = { at: 0, value: 0 };
    setSource(null);
    emit(0, true);
  }, [detach, emit]);

  /**
   * Decoration, not measurement. Neither expo-speech nor an `Audio.Sound`
   * exposes a waveform, so the presence ring rides a smoothed pseudo-envelope
   * for as long as the interviewer is talking — sampled at the same rate and
   * on the same 0..1 contract as the web analyser, so the two are visually
   * indistinguishable on stage.
   */
  const startEnvelope = useCallback(() => {
    if (releasedRef.current) return;
    detach();
    let phase = 0;
    let value = ENVELOPE_FLOOR;
    envelopeRef.current = setInterval(() => {
      phase += 1;
      const target =
        ENVELOPE_FLOOR
        + Math.abs(Math.sin(phase * 0.7)) * ENVELOPE_SWING
        + Math.random() * ENVELOPE_NOISE;
      value = value * ENVELOPE_SMOOTHING + target * (1 - ENVELOPE_SMOOTHING);
      emit(Math.min(1, value));
    }, LEVEL_EMIT_MS);
    setSource('tts-envelope');
  }, [detach, emit]);

  /**
   * There is no AnalyserNode on native and no stream to hang one off, so the
   * server-TTS path gets the same envelope. The reported source stays
   * `tts-envelope` — claiming a waveform we never computed would be a lie the
   * UI could act on later.
   */
  const startTtsWaveform = useCallback((_handle: CaptureHandle | null) => {
    startEnvelope();
  }, [startEnvelope]);

  /**
   * The candidate's own level. `_handle` is the camera, which carries no audio
   * here by design; the amplitude comes from the recognizer that already owns
   * the microphone. It only arrives if the recognizer was started with
   * `volumeChangeEventOptions.enabled` — without that the ring simply stays
   * flat, which is the correct failure mode for a decorative meter.
   */
  const startMic = useCallback((_handle: CaptureHandle | null) => {
    if (releasedRef.current) return;
    detach();
    if (!micLevelAvailable()) {
      setSource(null);
      emit(0, true);
      return;
    }
    try {
      subRef.current = addSpeechRecognitionListener('volumechange', (event) => {
        emit(clamp((event.value - RMS_MIN) / RMS_RANGE, 0, 1));
      });
      setSource('mic');
    } catch {
      subRef.current = null;
      setSource(null);
      emit(0, true);
    }
  }, [detach, emit]);

  const release = useCallback(() => {
    releasedRef.current = true;
    detach();
    lastRef.current = { at: 0, value: 0 };
    setSource(null);
    // Forced, because the released guard would otherwise swallow it and leave
    // the presence ring lit for a call that has ended.
    emit(0, true);
  }, [detach, emit]);

  // A subscription or interval that outlives the screen would keep waking the
  // JS thread for a call that already ended.
  useEffect(() => () => {
    releasedRef.current = true;
    if (envelopeRef.current !== null) {
      clearInterval(envelopeRef.current);
      envelopeRef.current = null;
    }
    if (subRef.current) {
      try { subRef.current.remove(); } catch { /* noop */ }
      subRef.current = null;
    }
  }, []);

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
