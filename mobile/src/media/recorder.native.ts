import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import type { CameraView } from 'expo-camera';
/*
 * `expo-file-system/legacy`, deliberately.
 *
 * SDK 54 ships expo-file-system v19, whose default export is a completely new
 * object-oriented API (`new File(...)`, `new Directory(...)`). The constants
 * and helpers used below — documentDirectory, cacheDirectory, EncodingType,
 * getInfoAsync's `size` option — do not exist on it.
 *
 * The `/legacy` entry point is Expo's own supported bridge for exactly this,
 * and it keeps the v18 surface intact. Porting to the new API is a separate,
 * larger change with its own risk; pinning to the legacy import here makes the
 * SDK upgrade a dependency change rather than a rewrite of the recording and
 * audio-cache paths, which are the two things in this app that must not break.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

import { readCaptureHandle } from './contract';
import { capabilities } from './capabilities.native';
import type {
  CaptureHandle,
  RecordingDelivery,
  RecordingError,
  RecordingResult,
  SessionRecorder,
  UseSessionRecorder,
} from './contract';
import { REC_STOP_GRACE_MS, recordingFileName } from './tuning';

/** One hour. Longer than any interview, and a hard stop against a runaway file. */
const MAX_RECORDING_SECONDS = 3600;

/**
 * How long a mid-call stop waits for CameraX / AVFoundation to hand back the
 * file before it gives up and releases the UI. Finalisation normally takes a
 * few hundred milliseconds; without a ceiling a session that never resolves
 * would leave the REC chip running for the rest of the call. A late file is
 * still delivered — this net only unsticks the interface.
 */
const STOP_SETTLE_MS = 8000;

type NoticeTone = 'info' | 'danger' | 'success';

/** The web build downloads a `.webm`; the native camera writes MPEG-4. */
const CONTAINER = 'mp4';

/**
 * The capture handle is the mounted `CameraView`. Nothing outside this module
 * knows that, which is what keeps MeetingScreen free of platform branches.
 */
function cameraFromHandle(handle: CaptureHandle | null): CameraView | null {
  const view = readCaptureHandle<CameraView>(handle);
  return view && typeof view.recordAsync === 'function' ? view : null;
}

async function safeDelete(uri: string) {
  try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch { /* noop */ }
}

/**
 * Put the file somewhere the candidate can actually reach it. The share sheet
 * is the honest analogue of the browser's silent download: it is the only way
 * an app-private file leaves the sandbox on either platform.
 */
async function handOver(file: string): Promise<RecordingDelivery> {
  let canShare = false;
  try { canShare = await Sharing.isAvailableAsync(); } catch { canShare = false; }

  if (canShare) {
    try {
      await Sharing.shareAsync(file, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' });
      return 'share-sheet';
    } catch {
      // No app on the device can take an mp4 — fall through to the gallery.
    }
  }

  try {
    // Needs WRITE_EXTERNAL_STORAGE on Android 9 and below, which app.json
    // blocks; on those handsets this returns denied and delivery is 'none'.
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (permission.granted) {
      await MediaLibrary.saveToLibraryAsync(file);
      return 'media-library';
    }
  } catch { /* noop */ }

  return 'none';
}

export const useSessionRecorder: UseSessionRecorder = ({ handle, onNotice }) => {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const viewRef = useRef<CameraView | null>(null);
  const recordingRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const durationRef = useRef(0);
  const saveRef = useRef(true);
  /** The UI has been told the take is over. */
  const settledRef = useRef(false);
  /** The file work has run. Kept separate from `settledRef` so a file that
   *  arrives after we gave up waiting is still handed to the candidate. */
  const deliveredRef = useRef(false);
  const releasedRef = useRef(false);
  const mountedRef = useRef(true);
  const graceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveRef = useRef<((result: RecordingResult | null) => void) | null>(null);
  const pendingStopRef = useRef<Promise<RecordingResult | null> | null>(null);

  const noticeRef = useRef(onNotice);
  useEffect(() => { noticeRef.current = onNotice; });

  const notice = useCallback((key: string, tone: NoticeTone) => {
    if (!mountedRef.current) return;
    noticeRef.current?.(key, tone);
  }, []);

  const resolvePending = useCallback((result: RecordingResult | null) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    pendingStopRef.current = null;
    resolve?.(result);
  }, []);

  /** Ends the take as far as the interface is concerned. Idempotent. */
  const settleState = useCallback((): number => {
    if (settledRef.current) return durationRef.current;
    settledRef.current = true;
    if (graceRef.current) { clearTimeout(graceRef.current); graceRef.current = null; }
    const startedAt = startedAtRef.current;
    startedAtRef.current = null;
    durationRef.current = startedAt ? Date.now() - startedAt : 0;
    recordingRef.current = false;
    if (mountedRef.current) {
      setRecording(false);
      setElapsedMs(0);
    }
    return durationRef.current;
  }, []);

  const deliver = useCallback(async (
    uri: string | null,
    save: boolean,
    durationMs: number,
  ): Promise<RecordingResult> => {
    const fileName = recordingFileName(CONTAINER);
    const fail = (error: RecordingError, at?: string): RecordingResult =>
      ({ ok: false, fileName, durationMs, delivery: 'none', uri: at, error });

    if (!uri) { notice('recordFailed', 'danger'); return fail('failed'); }

    let sizeBytes: number | undefined;
    try {
      // `{ size: true }` was dropped in expo-file-system v19's legacy surface —
      // size is now always returned for a file that exists, so asking for it is
      // both unnecessary and a type error.
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) { notice('recordingEmpty', 'danger'); return fail('empty'); }
      sizeBytes = info.size;
      if (!sizeBytes) {
        await safeDelete(uri);
        notice('recordingEmpty', 'danger');
        return fail('empty');
      }
    } catch {
      // A stat we could not read is not proof of an empty file — keep going.
    }

    if (!save) {
      await safeDelete(uri);
      return { ok: true, fileName, durationMs, delivery: 'none', sizeBytes };
    }

    // Out of the cache first: the OS may evict cacheDirectory at any moment,
    // and the share sheet can sit unanswered for minutes.
    let file = uri;
    const dir = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}recordings/` : null;
    if (dir) {
      try {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        await FileSystem.moveAsync({ from: uri, to: dir + fileName });
        file = dir + fileName;
      } catch {
        file = uri; // still playable from the cache; deliver it from there
      }
    }

    const delivery = await handOver(file);
    if (delivery === 'none') {
      // The bytes exist but stayed inside the sandbox, which for the candidate
      // is indistinguishable from having lost them.
      notice('recordFailed', 'danger');
      return { ok: false, fileName, durationMs, delivery, uri: file, sizeBytes, error: 'failed' };
    }

    notice('recordingSaved', 'success');
    return { ok: true, fileName, durationMs, delivery, uri: file, sizeBytes };
  }, [notice]);

  const finalize = useCallback(async (uri: string | null) => {
    if (deliveredRef.current) return;
    deliveredRef.current = true;
    const durationMs = settleState();
    viewRef.current = null;
    const result = await deliver(uri, saveRef.current, durationMs);
    resolvePending(result);
  }, [deliver, resolvePending, settleState]);

  /**
   * The camera hands the file back through `recordAsync`, so a session that
   * never resolves would pin the recorder open. `notify` is off on the
   * teardown path: there the grace window is short by design and the screen is
   * already being replaced, so crying failure at 1.2s would be noise.
   */
  const armGrace = useCallback((ms: number, notify: boolean) => {
    if (graceRef.current) clearTimeout(graceRef.current);
    graceRef.current = setTimeout(() => {
      graceRef.current = null;
      if (settledRef.current) return;
      const durationMs = settleState();
      if (notify) notice('recordFailed', 'danger');
      resolvePending({
        ok: false,
        fileName: recordingFileName(CONTAINER),
        durationMs,
        delivery: 'none',
        error: 'failed',
      });
    }, ms);
  }, [notice, resolvePending, settleState]);

  const start = useCallback(async () => {
    if (recordingRef.current || releasedRef.current) return;

    const view = cameraFromHandle(handle);
    // No permission work here: `useCamera` already holds CAMERA, and the
    // recorder deliberately never asks for the microphone.
    //
    // A missing handle therefore is not a permissions problem and must not
    // claim to be one: it means there is no live preview to record from —
    // the camera is off, or its first frame has not landed yet. Sending a
    // candidate to check permissions they already granted is the single most
    // confusing thing this screen can say, so it says the true thing instead.
    if (!view) { notice('recordNeedsCamera', 'info'); return; }

    settledRef.current = false;
    deliveredRef.current = false;
    pendingStopRef.current = null;
    saveRef.current = true;
    durationRef.current = 0;
    startedAtRef.current = Date.now();
    viewRef.current = view;
    recordingRef.current = true;
    setRecording(true);
    setElapsedMs(0);

    // The one notice the candidate gets at the moment of action, and it is the
    // disclosure rather than the confirmation: the recognizer owns the single
    // microphone client Android gives an app, so this file has no sound. The
    // REC chip already says that a recording is running.
    notice('recordVideoOnly', 'info');

    let pending: Promise<{ uri: string } | undefined>;
    try {
      pending = view.recordAsync({ maxDuration: MAX_RECORDING_SECONDS });
    } catch {
      settledRef.current = true;
      deliveredRef.current = true;
      recordingRef.current = false;
      startedAtRef.current = null;
      viewRef.current = null;
      setRecording(false);
      notice('recordFailed', 'danger');
      return;
    }

    pending
      .then((result) => finalize(result?.uri ?? null))
      .catch(() => finalize(null));
  }, [finalize, handle, notice]);

  const stop = useCallback((opts: { save: boolean }): Promise<RecordingResult | null> => {
    if (!recordingRef.current) return Promise.resolve(null);
    saveRef.current = opts.save;
    // A second stop before the camera has handed the file back — a double tap,
    // or a backgrounding on top of a tap — must join the first, not orphan its
    // promise and leave the caller awaiting forever.
    if (pendingStopRef.current) return pendingStopRef.current;

    const pending = new Promise<RecordingResult | null>((resolve) => {
      resolveRef.current = resolve;
    });
    pendingStopRef.current = pending;
    try { viewRef.current?.stopRecording(); } catch { /* noop */ }
    armGrace(STOP_SETTLE_MS, true);
    return pending;
  }, [armGrace]);

  const release = useCallback((opts: { save: boolean }) => {
    releasedRef.current = true;

    // The guard comes BEFORE the flag, exactly as in recorder.web.ts. A second
    // release — the screen's unmount cleanup arriving behind the one teardown
    // already ran — must not re-arm a take it is not driving: `finalize` reads
    // `saveRef` when `recordAsync` finally resolves, so writing it here would
    // hand back a file the candidate asked to discard.
    if (!recordingRef.current) {
      if (graceRef.current) { clearTimeout(graceRef.current); graceRef.current = null; }
      return;
    }

    saveRef.current = opts.save;

    // Synchronous by contract: teardown stops the camera in the same block, and
    // a capture session whose surface disappears mid-flush can leave
    // `recordAsync` pending forever. Delivery still runs if the file lands
    // afterwards — the share sheet appearing over the results screen is the
    // native analogue of the browser download firing during teardown.
    try { viewRef.current?.stopRecording(); } catch { /* noop */ }
    armGrace(REC_STOP_GRACE_MS, false);
  }, [armGrace]);

  useEffect(() => {
    if (!recording) return undefined;
    const id = setInterval(
      () => setElapsedMs(Date.now() - (startedAtRef.current ?? Date.now())),
      1000,
    );
    return () => clearInterval(id);
  }, [recording]);

  /**
   * There is no "stop sharing" bar to watch on native. Backgrounding is the
   * equivalent moment: the OS unbinds the camera behind our back, so stopping
   * first is what turns a truncated take into a saved one. `inactive` is
   * excluded — iOS raises it for a passing control-centre swipe.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'background') return;
      if (!recordingRef.current) return;
      void stop({ save: true });
    });
    return () => { sub.remove(); };
  }, [stop]);

  useEffect(() => () => {
    mountedRef.current = false;
    releasedRef.current = true;
    if (graceRef.current) { clearTimeout(graceRef.current); graceRef.current = null; }
    // An encoder left running would hold the camera open past the screen.
    if (recordingRef.current) {
      try { viewRef.current?.stopRecording(); } catch { /* noop */ }
    }
    // Clearing the grace timer above removes the only thing that would ever
    // have settled an in-flight `stop()`. Anyone awaiting it — the end-meeting
    // dialog, for one — would wait forever, so resolve it here instead.
    if (resolveRef.current) {
      resolveRef.current(null);
      resolveRef.current = null;
      pendingStopRef.current = null;
    }
  }, []);

  return useMemo<SessionRecorder>(() => ({
    // Recording needs a mounted CameraView, which only exists once the camera
    // has been granted and is previewing. Claiming support before that lights
    // up a control that cannot work yet.
    supported: capabilities.recorder.available,
    recording,
    elapsedMs,
    start,
    stop,
    release,
  }), [recording, elapsedMs, start, stop, release]);
};
