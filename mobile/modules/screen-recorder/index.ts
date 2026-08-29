/**
 * Screen recording, Android only.
 *
 * A thin typed front for the Kotlin module — see
 * `android/src/main/java/com/interprova/screenrecorder/ScreenRecorderModule.kt`
 * for what it captures (video, not audio) and why the ordering of consent,
 * foreground service and projection is fixed.
 *
 * Everything here degrades rather than throws when the native side is absent:
 * the web bundle never sees this file (`.web.ts` sibling), but an iOS build or
 * a JS-only reload of an older binary would, and a missing module must read as
 * "screen recording is unavailable" rather than a crash at import time.
 */

import { requireOptionalNativeModule } from 'expo';

export interface ScreenRecordingResult {
  /** `file://` URI in the app cache. The caller owns it from here. */
  uri: string;
  durationMs: number;
  sizeBytes: number;
}

interface ScreenRecorderNativeModule {
  isAvailable(): boolean;
  isRecording(): boolean;
  /** Shows the system consent dialog, then starts. Rejects when declined. */
  start(notificationTitle: string, notificationBody: string): Promise<boolean>;
  stop(): Promise<ScreenRecordingResult | null>;
  cancel(): Promise<void>;
}

const native = requireOptionalNativeModule<ScreenRecorderNativeModule>('ScreenRecorder');

/** Error codes the native side rejects with, so callers can tell them apart. */
export const ScreenRecorderError = {
  /** The person declined the system capture dialog. Not a failure. */
  denied: 'ERR_PERMISSION_DENIED',
  alreadyRecording: 'ERR_ALREADY_RECORDING',
  noActivity: 'ERR_NO_ACTIVITY',
  startFailed: 'ERR_RECORDER_START',
  /** Stopped so soon that the encoder never wrote a frame. */
  empty: 'ERR_EMPTY_RECORDING',
} as const;

export function isScreenRecordingAvailable(): boolean {
  try {
    return !!native?.isAvailable();
  } catch {
    return false;
  }
}

export function isScreenRecording(): boolean {
  try {
    return !!native?.isRecording();
  } catch {
    return false;
  }
}

export async function startScreenRecording(
  notificationTitle: string,
  notificationBody = '',
): Promise<void> {
  if (!native) throw new Error(ScreenRecorderError.startFailed);
  await native.start(notificationTitle, notificationBody);
}

export async function stopScreenRecording(): Promise<ScreenRecordingResult | null> {
  if (!native) return null;
  return native.stop();
}

export async function cancelScreenRecording(): Promise<void> {
  if (!native) return;
  try { await native.cancel(); } catch { /* nothing to cancel */ }
}
