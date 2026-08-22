/**
 * Media timing constants, lifted out of MeetingScreen.
 *
 * These are numbers both platform builds have to agree on — a level meter that
 * emits at a different rate on native, or a recorder grace window that differs
 * from the web one, would be a behaviour difference disguised as a magic
 * number. Kept in a leaf module with no imports so a screen that only wants
 * `SILENCE_MS` does not pull the camera/recorder graph into its bundle.
 *
 * `NOTICE_MS` deliberately stayed in MeetingScreen: how long a toast lingers is
 * UI timing, not media timing.
 */

/** How long after the last transcription event we treat the candidate as done. */
export const SILENCE_MS = 2500;

/** Pause before re-opening the mic after the interviewer stops speaking. */
export const RESUME_LISTEN_MS = 500;

/**
 * Voice-envelope sampling: emit at most ~16fps, and only on a real change.
 * Emitting every animation frame re-rendered the whole call UI 60×/s.
 */
export const LEVEL_EMIT_MS = 60;
export const LEVEL_EMIT_DELTA = 0.04;

/**
 * Neither `speechSynthesis` nor `expo-speech` plays through a stream, so there
 * is no waveform to analyse while a neural voice is talking. The presence ring
 * rides a synthesised envelope instead — sampled at the same rate as the real
 * analyser so the two paths look identical on stage. Smoothing keeps it from
 * flickering; the sine term gives it the loose periodicity of speech rather
 * than the jitter of pure noise.
 */
export const ENVELOPE_SMOOTHING = 0.55;
export const ENVELOPE_FLOOR = 0.34;
export const ENVELOPE_SWING = 0.44;
export const ENVELOPE_NOISE = 0.18;

/**
 * Recorder timeslice — flushes a chunk every second so an abrupt teardown
 * loses at most one second of footage.
 */
export const REC_TIMESLICE_MS = 1000;

/** Object URLs are revoked after the browser has had time to start the save. */
export const BLOB_URL_TTL_MS = 60_000;

/**
 * How long we wait for the recorder to hand back its file before saving what
 * we already have. Ending a call stops the camera/mic in the same synchronous
 * block — the camera light must not outlive the call — and a recorder whose
 * sources die mid-flush can fail to signal completion at all. Without this the
 * candidate's footage would be silently dropped.
 */
export const REC_STOP_GRACE_MS = 1200;

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/**
 * `interprova-interview-2026-08-16-1435.webm`
 *
 * The container is the caller's, because it is the one thing that genuinely
 * differs: browsers give us WebM, the native camera writes MPEG-4.
 */
export function recordingFileName(extension: string = 'webm') {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  return `interprova-interview-${stamp}.${extension}`;
}
