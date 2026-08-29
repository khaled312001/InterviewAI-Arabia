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
 *  2. Capturing the whole screen IS available now, through the local
 *     `modules/screen-recorder` module: `MediaProjection` behind a foreground
 *     service of type `mediaProjection`, which Android 14 additionally gates
 *     on `FOREGROUND_SERVICE_MEDIA_PROJECTION` and a consent dialog the system
 *     shows on every single start — there is no way to remember it, by design.
 *  3. Because the recording no longer comes from `CameraView`, unmounting the
 *     preview no longer ends it. The camera and flip controls stay usable for
 *     the whole take, which is what `locksCameraControls: false` below says.
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
    // MediaProjection, not the camera preview — see modules/screen-recorder.
    // The whole call is in the file: the interviewer, the question, the
    // captions and the candidate's own tile.
    capturesScreen: true,
    // Still false, and for the same reason as ever: the recogniser owns the one
    // microphone client Android gives an app, so the candidate's own voice
    // cannot be in the file without giving up live transcription.
    capturesMicAudio: false,
    // True now. AudioPlaybackCapture, scoped to this app's own UID, puts the
    // interviewer's voice in the recording without touching the microphone.
    capturesInterviewerAudio: true,
    delivery: 'media-library',
    // The recording no longer comes from CameraView, so unmounting the preview
    // cannot end it: the camera and flip controls stay live throughout.
    locksCameraControls: false,
  },
};
