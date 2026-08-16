/**
 * What this browser can actually do, probed once at module load.
 *
 * The hooks below each own their own runtime state; this descriptor exists so
 * the call UI can decide what to *render* — a disabled record button with an
 * explanatory footnote instead of a control that fails on tap.
 */

import type { MediaCapabilities } from './contract';
import { SPEECH_LOCALE } from './contract';

/** Preference order for the recording container/codec. */
const REC_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const hasWindow = typeof window !== 'undefined';
const media = hasWindow && typeof navigator !== 'undefined'
  ? (navigator.mediaDevices as MediaDevices | undefined)
  : undefined;

/**
 * What this browser can record.
 * `mimeType: ''` means "MediaRecorder exists but cannot be asked about
 * types" — the browser picks its own container in that case.
 */
function detectRecorderSupport(): { supported: boolean; mimeType: string } {
  if (!hasWindow) return { supported: false, mimeType: '' };
  const MR = (window as any).MediaRecorder as typeof MediaRecorder | undefined;
  if (!MR) return { supported: false, mimeType: '' };
  if (typeof MR.isTypeSupported !== 'function') return { supported: true, mimeType: '' };
  for (const mime of REC_MIME_CANDIDATES) {
    try {
      if (MR.isTypeSupported(mime)) return { supported: true, mimeType: mime };
    } catch {
      /* isTypeSupported can throw on malformed strings in older engines */
    }
  }
  return { supported: false, mimeType: '' };
}

const recorderSupport = detectRecorderSupport();

const hasGetUserMedia = typeof media?.getUserMedia === 'function';
const hasDisplayMedia = typeof (media as any)?.getDisplayMedia === 'function';
const hasRecognition = hasWindow
  && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
const hasSynthesis = hasWindow
  && typeof (window as any).speechSynthesis?.speak === 'function';
const hasAudioContext = hasWindow
  && !!((window as any).AudioContext || (window as any).webkitAudioContext);

/**
 * Device count is only knowable asynchronously — and before the first
 * permission grant most engines report a single unlabelled entry — so this
 * starts optimistic and tightens once the probe lands. `CameraController.flip()`
 * re-checks and returns false when there is nothing to flip to; that is the
 * authority, this is the hint the UI paints with.
 */
let videoInputs: number | null = null;
if (hasGetUserMedia && typeof media?.enumerateDevices === 'function') {
  media.enumerateDevices()
    .then((devices) => { videoInputs = devices.filter((d) => d.kind === 'videoinput').length; })
    .catch(() => { videoInputs = null; });
}

export const capabilities: MediaCapabilities = {
  platform: 'web',

  camera: {
    available: hasGetUserMedia,
    // `track.enabled = false` keeps the pipeline warm, so the recorder goes on
    // writing (black) frames and the feed comes back instantly.
    canToggleWhileRecording: true,
    get canFlip() {
      return videoInputs === null ? hasGetUserMedia : videoInputs > 1;
    },
    // Flipping means re-running getUserMedia, which hands back a *new* stream:
    // the recorder is still holding the old tracks, and they are about to be
    // stopped. Same outcome as native, different reason.
    canFlipWhileRecording: false,
    previewMirroredByPlatform: false,
  },

  speech: {
    available: hasRecognition,
    continuous: true,
    nativeContinuous: true,
    interim: true,
    locales: Object.values(SPEECH_LOCALE),
  },

  tts: {
    available: hasSynthesis,
    voiceSelection: true,
    qualitySignal: 'localService',
    serverFallback: true,
  },

  micLevel: {
    available: hasAudioContext,
    // Only the server-TTS path has a MediaStream to analyse; `speechSynthesis`
    // plays through the OS mixer and rides the synthesised envelope instead.
    ttsKind: 'waveform',
    micKind: hasAudioContext ? 'rms' : 'none',
  },

  recorder: {
    available: recorderSupport.supported,
    mimeType: recorderSupport.mimeType,
    fileExtension: 'webm',
    capturesScreen: hasDisplayMedia,
    capturesMicAudio: true,
    // The neural voice never enters Web Audio, so it lands in the file only
    // when the user grants tab/system audio in the share dialog.
    capturesInterviewerAudio: hasDisplayMedia,
    delivery: 'download',
    locksCameraControls: false,
  },
};
