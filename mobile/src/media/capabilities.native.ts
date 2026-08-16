/**
 * What the device build can actually do.
 *
 * The values here are deliberately conservative and honest — the call UI reads
 * them to decide what to *render*, and a control that claims a capability the
 * platform lacks is worse than one that is visibly unavailable.
 *
 * Three native limits drive most of this and are worth stating plainly:
 *
 *  1. Android hands the microphone to a single client. The speech recogniser
 *     holds it for the whole interview, so the session recording captures
 *     video only — mixing the candidate's own audio in would mean giving up
 *     live transcription, which is the feature.
 *  2. There is no `getDisplayMedia` equivalent available to us here. Capturing
 *     the whole screen needs `MediaProjection` behind a foreground service of
 *     type `mediaProjection`, which Android 14 (targetSdk 34) additionally
 *     gates on the `FOREGROUND_SERVICE_MEDIA_PROJECTION` permission and a
 *     per-session consent dialog. That is a custom native module, not a
 *     configuration flag.
 *  3. `CameraView` owns the recording. Unmounting it — which is what turning
 *     the camera "off" does — ends the recording, so the camera and flip
 *     controls lock while a recording is running.
 */

import { Platform } from 'react-native';
import type { MediaCapabilities } from './contract';
import { SPEECH_LOCALE } from './contract';

/**
 * `EXTRA_SEGMENTED_SESSION` (API 33+) is what lets Android's recogniser listen
 * continuously. Below that the hook restarts the recogniser on each `end`
 * event, which works but drops a beat between segments.
 */
const nativeContinuous = Platform.OS === 'android' && Number(Platform.Version) >= 33;

export const capabilities: MediaCapabilities = {
  platform: Platform.OS === 'ios' ? 'ios' : 'android',

  camera: {
    available: true,
    // Toggling unmounts CameraView, which ends any in-flight recording.
    canToggleWhileRecording: false,
    canFlip: true,
    canFlipWhileRecording: false,
    // CameraX mirrors the front preview itself; no CSS transform needed.
    previewMirroredByPlatform: true,
  },

  speech: {
    available: true,
    continuous: true,
    nativeContinuous,
    interim: true,
    locales: [SPEECH_LOCALE.ar, SPEECH_LOCALE.en],
  },

  tts: {
    available: true,
    voiceSelection: true,
    // expo-speech exposes VoiceQuality.Enhanced rather than web's localService.
    qualitySignal: 'voiceQuality',
    serverFallback: true,
  },

  micLevel: {
    available: true,
    // The synthesiser gives no signal to tap, so the interviewer's "speaking"
    // animation is driven by a synthetic envelope rather than real amplitude.
    ttsKind: 'synthetic',
    micKind: 'rms',
  },

  recorder: {
    available: true,
    mimeType: 'video/mp4',
    fileExtension: 'mp4',
    capturesScreen: false,
    capturesMicAudio: false,
    capturesInterviewerAudio: false,
    delivery: 'media-library',
    locksCameraControls: true,
  },
};
