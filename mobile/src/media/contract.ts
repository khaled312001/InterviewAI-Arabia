/**
 * The media layer's shared surface — every type both platforms must agree on.
 *
 * Why a contract file at all
 *   Metro resolves `./index` to `index.web.ts` on web and `index.native.ts` on
 *   native; TypeScript understands neither and only ever sees `index.ts`. So
 *   the two implementations are never typechecked against each other by the
 *   module graph. This file closes that hole: each implementation annotates its
 *   exported hook with the matching `UseX` type from here, which makes drift
 *   between web and native a compile error instead of a runtime surprise on one
 *   platform only.
 *
 * The rule for this file
 *   Types and plain data only. No `react-native` runtime import, no DOM global,
 *   no `expo-*` package — it is parsed on every platform and by every module in
 *   `src/media`, so anything with a side effect here becomes everyone's problem.
 *   The two `import type` lines below are erased at compile time.
 *
 * Where the values live
 *   `capabilities` → `./capabilities`, the voice helpers → `./tts/*`. They are
 *   deliberately *not* re-declared here with `declare const`: an ambient value
 *   declaration compiles to nothing, so anyone importing it from this module
 *   would get `undefined` at runtime with no warning. Their shapes are pinned
 *   below as function types instead, which is the same guarantee without the
 *   trapdoor.
 */

import type { ComponentType, ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/* ------------------------------------------------------------------ *
 * 0. Shared vocabulary
 * ------------------------------------------------------------------ */

export type SpeechLang = 'ar' | 'en';
export type VoiceGender = 'male' | 'female';

/**
 * BCP-47 tag per interview language — drives the recognizer locale *and* the
 * synthesiser voice, so the interviewer and the candidate are always on the
 * same locale.
 *
 * Arabic resolves to Egyptian: it is the dialect of the product's primary
 * market, and it is what the Arabic neural voices are trained on.
 */
export const SPEECH_LOCALE: Record<SpeechLang, string> = {
  ar: 'ar-EG',
  en: 'en-US',
};

/**
 * Opaque platform capture handle.
 *
 * Web: a `MediaStream` (camera) or a `MediaElementAudioSourceNode` (server TTS).
 * Native: the `CameraView` instance ref. `MeetingScreen` passes one from
 * `useCamera` into `useSessionRecorder` / `useLevelMeter` and never inspects it
 * — that is the whole reason the screen carries no `Platform.OS` branch.
 *
 * The `unique symbol` brand is nominal: nothing is structurally assignable to
 * it, so an implementation cannot accidentally leak a raw `MediaStream` through
 * the contract. Cross the boundary with the two helpers below, never with a
 * bare `as` — a named cast is greppable, an anonymous one is not.
 */
export type CaptureHandle = { readonly __captureHandle: unique symbol };

/**
 * Brand a platform object as a capture handle. Implementation-side only.
 * Null in, null out, so `asCaptureHandle(streamRef.current)` is safe before
 * acquisition completes.
 */
export function asCaptureHandle<T>(value: T | null | undefined): CaptureHandle | null {
  return (value ?? null) as unknown as CaptureHandle | null;
}

/**
 * Unbrand a capture handle back to the platform object that produced it.
 *
 * This is an unchecked cast by construction — the brand carries no runtime tag
 * — so only the implementation that created the handle may read it. Calling
 * this in `MeetingScreen`, or in the *other* platform's module, is the bug this
 * type exists to prevent.
 */
export function readCaptureHandle<T>(handle: CaptureHandle | null | undefined): T | null {
  return (handle ?? null) as unknown as T | null;
}

/* ------------------------------------------------------------------ *
 * 1. Capability descriptor
 *
 * Declared first because the hooks below reference it. This is what the call
 * UI reads to decide whether a control is offered, locked with an explanation,
 * or hidden — it replaces the `Platform.OS === 'web'` checks that used to be
 * scattered through the screen.
 * ------------------------------------------------------------------ */

export type RecordingDelivery = 'download' | 'share-sheet' | 'media-library' | 'none';
export type LevelKind = 'waveform' | 'rms' | 'synthetic';

export interface MediaCapabilities {
  readonly platform: 'web' | 'android' | 'ios';

  readonly camera: {
    readonly available: boolean;
    /** Web: true (`track.enabled`). Native: false — unmounting `CameraView` kills the recording. */
    readonly canToggleWhileRecording: boolean;
    /** Web: more than one `videoinput` device. Native: always true. */
    readonly canFlip: boolean;
    /** Whether flipping mid-recording is safe. Native: false — it stops the recording. */
    readonly canFlipWhileRecording: boolean;
    /** Web needs a CSS `scaleX(-1)`; Android CameraX mirrors the front preview itself. */
    readonly previewMirroredByPlatform: boolean;
  };

  readonly speech: {
    /**
     * Static, best-effort. `SpeechRecognizer.supported` is the authority once
     * its async probe has run — on Android the recognizer's presence cannot be
     * known synchronously.
     */
    readonly available: boolean;
    readonly continuous: boolean;
    /** Android ≤ 12 has no `EXTRA_SEGMENTED_SESSION`; the hook restarts on `end` instead. */
    readonly nativeContinuous: boolean;
    readonly interim: boolean;
    readonly locales: readonly string[];
  };

  readonly tts: {
    readonly available: boolean;
    /** Can a voice be chosen, or is the system default all there is? */
    readonly voiceSelection: boolean;
    /** Where the "this is a neural voice" signal comes from, if anywhere. */
    readonly qualitySignal: 'localService' | 'voiceQuality' | 'none';
    readonly serverFallback: boolean;
  };

  readonly micLevel: {
    readonly available: boolean;
    /** Web server-TTS path: 'waveform'. `speechSynthesis` and native: 'synthetic'. */
    readonly ttsKind: LevelKind;
    readonly micKind: LevelKind | 'none';
  };

  readonly recorder: {
    readonly available: boolean;
    /** `''` means "a recorder exists but the container cannot be queried". */
    readonly mimeType: string;
    readonly fileExtension: string;
    /** Web `getDisplayMedia` captures the whole call UI. Native: false — camera only. */
    readonly capturesScreen: boolean;
    /**
     * Native Android: false. There is effectively one microphone client per
     * app, and the recognizer owns it for the length of the call — see the
     * `meeting.recordVideoOnly` disclosure in the control bar.
     */
    readonly capturesMicAudio: boolean;
    /** Only reachable via captured tab/system audio. Native: false. */
    readonly capturesInterviewerAudio: boolean;
    readonly delivery: RecordingDelivery;
    /** True when starting a recording must lock the camera and flip controls. */
    readonly locksCameraControls: boolean;
  };
}

/* ------------------------------------------------------------------ *
 * 2. Camera / self-view
 * ------------------------------------------------------------------ */

export type CameraFacing = 'front' | 'back';
export type MediaFault = 'denied' | 'unsupported' | null;

export interface CameraPreviewProps {
  style?: StyleProp<ViewStyle>;
  /** Self-views are mirrored. The implementation decides whether that costs a transform. */
  mirrored?: boolean;
  /** Rendered instead of the feed when the camera is off or not yet ready. */
  placeholder?: ReactNode;
  accessibilityLabel?: string;
}

export interface CameraController {
  /**
   * Stable component bound to this controller.
   *
   * It must stay mounted across `enabled` toggles on web — remounting drops
   * `srcObject` and the feed comes back as a black frame. The implementation
   * owns that invariant (web hides the element, native unmounts it, which is
   * why `canToggleWhileRecording` differs); the caller just renders it and
   * passes the camera-off artwork as `placeholder`.
   */
  readonly Preview: ComponentType<CameraPreviewProps>;

  /** Capture is live and the Start CTA may be enabled. */
  readonly ready: boolean;
  readonly fault: MediaFault;
  readonly enabled: boolean;
  readonly micEnabled: boolean;
  readonly facing: CameraFacing;
  /** Passed to `useSessionRecorder` / `useLevelMeter`. Null until `ready`. */
  readonly handle: CaptureHandle | null;

  setEnabled(on: boolean): void;
  setMicEnabled(on: boolean): void;
  /** No-op returning false when `capabilities.camera.canFlip` is false. */
  flip(): boolean;
  /** Re-run acquisition after a denial. Backs the media-fault "Retry" button. */
  retry(): Promise<void>;
  /** Idempotent. Stops every track / unmounts capture. The camera light must not outlive the call. */
  release(): void;
}

export type UseCamera = (opts: {
  /** False parks the camera without unmounting the hook (e.g. on the result screen). */
  active: boolean;
  initialFacing?: CameraFacing;
  onFault?: (fault: Exclude<MediaFault, null>) => void;
}) => CameraController;

/* ------------------------------------------------------------------ *
 * 3. Speech recognition
 * ------------------------------------------------------------------ */

export type SpeechErrorCode =
  | 'not-allowed'
  | 'service-not-allowed'
  | 'language-not-supported'
  | 'no-speech'
  | 'network'
  | 'busy'
  /** We caused it. Callers ignore this code. */
  | 'aborted'
  | 'unknown';

export interface SpeechRecognizerOptions {
  language: SpeechLang;
  /** Silence-based endpointing, so a thinking pause does not cut the candidate off. */
  silenceMs: number;
  /**
   * The single commit point for an utterance. Fires exactly once per turn with
   * the trimmed accumulated final text, and never as a result of `stop()` or
   * `release()` — a torn-down call must not post one last answer.
   */
  onFinal: (text: string) => void;
  /** Only codes the UI reacts to are surfaced; transient ones are swallowed. */
  onError?: (code: SpeechErrorCode) => void;
}

export interface SpeechRecognizer {
  /**
   * Hard gate. False means the candidate can never speak — show the
   * `sttUnsupported` notice. On Android this is a real, supported path
   * (a handset with no Google recognizer installed), not a rare edge case.
   */
  readonly supported: boolean;
  readonly listening: boolean;
  /** Live partial text for the caption chip. Cleared on commit and on stop. */
  readonly interim: string;

  /** Re-entrant-safe: calling it while already listening is a no-op. */
  start(): void;
  /**
   * Deliberate stop (mute, end call). Detaches handlers *before* aborting so a
   * half-finished utterance cannot be committed. Guarantees `onFinal` is not called.
   */
  stop(): void;
  release(): void;
}

export type UseSpeechRecognizer = (opts: SpeechRecognizerOptions) => SpeechRecognizer;

/* ------------------------------------------------------------------ *
 * 4. Text to speech
 * ------------------------------------------------------------------ */

/** Which path produced the audio — the level meter needs to know which envelope to run. */
export type SpokenBy = 'local-voice' | 'server-tts' | 'none';

export interface SpeakRequest {
  text: string;
  lang: SpeechLang;
  gender: VoiceGender;
  /**
   * Fired once, only when sound is actually leaving the speaker.
   *
   * It carries `by` and `analysable` rather than leaving the caller to read
   * them off the resolved `SpeakOutcome`: the outcome does not exist yet when
   * this fires, and the level meter has to start on the *first* syllable, not
   * on the last one. `analysable` is non-null only for the web server-TTS path.
   */
  onStart?: (by: SpokenBy, analysable: CaptureHandle | null) => void;
  /** Fired once when the last chunk finishes. Never fired after `cancel()`. */
  onEnd?: () => void;
}

export interface SpeakOutcome {
  /**
   * True iff the candidate heard something. False lets the caller fall back
   * without doubling the line — which is only honest if the failing path
   * dropped its queue on the way out.
   */
  readonly heard: boolean;
  readonly by: SpokenBy;
  /**
   * Present only when `by === 'server-tts'` and a real analyser exists (web).
   * Hand it to `LevelMeter.startTtsWaveform()`. Null everywhere else.
   */
  readonly analysable: CaptureHandle | null;
}

export interface InterviewerVoice {
  readonly speaking: boolean;
  /**
   * Local voice first, server TTS second. Always resolves: a failure in either
   * path must never deadlock the interview waiting on a voice that never arrives.
   */
  speak(req: SpeakRequest): Promise<SpeakOutcome>;
  /** Silences immediately and invalidates pending callbacks via the session counter. */
  cancel(): void;
  /** Warms the voice list on mount so the opening line pays no wait. */
  warmUp(): Promise<void>;
  hasVoiceFor(lang: SpeechLang, gender: VoiceGender): Promise<boolean>;
  release(): void;
}

export type UseInterviewerVoice = (opts: {
  /**
   * Injected so this layer never imports the axios client or `secureStorage`.
   * The one call that bypasses the shared client (it needs the raw body, not
   * JSON) stays in the screen, where the auth store already lives.
   */
  fetchServerTts: (req: {
    text: string;
    gender: VoiceGender;
    language: SpeechLang;
  }) => Promise<ArrayBuffer>;
}) => InterviewerVoice;

/* ---- platform-neutral voice helpers (implemented under ./tts) ---- */

/**
 * A candidate voice, normalised away from `SpeechSynthesisVoice` so the same
 * scoring runs over `expo-speech`'s voice list.
 */
export interface VoiceCandidate {
  id: string;
  name: string;
  /** BCP-47, already lowercased with `_` replaced by `-`. */
  lang: string;
  /** Web: undefined. Native: `expo-speech`'s `VoiceQuality`, mapped. */
  quality?: 'default' | 'enhanced';
  /** Web: `!voice.localService`. Native: undefined — there is no analogue. */
  remote?: boolean;
  isDefault?: boolean;
}

/** Shape of `./tts/voiceScoring`'s `scoreVoice`. Negative means unusable. */
export type ScoreVoice = (voice: VoiceCandidate, lang: SpeechLang, gender: VoiceGender) => number;

/** Shape of `./tts/voiceScoring`'s `pickVoice`. Null means "fall back to server TTS". */
export type PickVoice = (
  voices: VoiceCandidate[],
  lang: SpeechLang,
  gender: VoiceGender,
) => VoiceCandidate | null;

/** Shape of `./tts/splitForSpeech`'s chunker. Hermes-safe; identical on both platforms. */
export type SplitForSpeech = (text: string) => string[];

/* ------------------------------------------------------------------ *
 * 5. Mic / voice level
 * ------------------------------------------------------------------ */

export type LevelSource = 'tts-waveform' | 'tts-envelope' | 'mic' | null;

export interface LevelMeter {
  /**
   * 0..1, double-throttled by the implementation at `LEVEL_EMIT_MS` *and*
   * `LEVEL_EMIT_DELTA`. Both implementations must honour this — it is a
   * performance contract, not a suggestion: emitting on every animation frame
   * re-rendered the entire call UI 60×/s.
   */
  readonly level: number;
  readonly source: LevelSource;

  /** Decorative envelope for a voice with no analysable stream (`speechSynthesis`, `expo-speech`). */
  startEnvelope(): void;
  /** Real analyser over the server-TTS element. Falls back to `startEnvelope()` on native. */
  startTtsWaveform(handle: CaptureHandle | null): void;
  /** The candidate's own mic amplitude, for the listening-state ring. */
  startMic(handle: CaptureHandle | null): void;
  /** Cancels the rAF loop, the envelope interval and the mic subscription, then emits 0. */
  stop(): void;
  release(): void;
}

export type UseLevelMeter = () => LevelMeter;

/* ------------------------------------------------------------------ *
 * 6. Session recording
 * ------------------------------------------------------------------ */

export type RecordingError = 'unsupported' | 'empty' | 'failed' | 'permission' | 'no-source';

export interface RecordingResult {
  readonly ok: boolean;
  readonly fileName: string;
  readonly durationMs: number;
  readonly delivery: RecordingDelivery;
  /** Web: undefined — the anchor download has already fired. Native: a `file://` URI. */
  readonly uri?: string;
  readonly sizeBytes?: number;
  readonly error?: RecordingError;
}

export interface SessionRecorder {
  readonly supported: boolean;
  readonly recording: boolean;
  /** Ticks itself every second, so the screen keeps no interval of its own. */
  readonly elapsedMs: number;

  /** Web may prompt for `getDisplayMedia`. Native starts `CameraView.recordAsync`. */
  start(): Promise<void>;
  /** Mid-call stop. Resolves once the file is delivered, or dropped when `save` is false. */
  stop(opts: { save: boolean }): Promise<RecordingResult | null>;
  /**
   * Synchronous teardown path. Must be called *before* the camera/mic tracks
   * are stopped so the encoder can still flush, and it arms its own grace timer
   * internally — a recorder whose sources die mid-flush may never emit `onstop`,
   * and the candidate's footage would be silently dropped.
   */
  release(opts: { save: boolean }): void;
}

export type UseSessionRecorder = (opts: {
  handle: CaptureHandle | null;
  /** Live-region feedback, keyed under `meeting.*` in the translations. */
  onNotice?: (key: string, tone: 'info' | 'danger' | 'success') => void;
}) => SessionRecorder;
