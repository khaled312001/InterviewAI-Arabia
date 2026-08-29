import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
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

import i18n from '../i18n';
import {
  cancelScreenRecording,
  isScreenRecordingAvailable,
  ScreenRecorderError,
  startScreenRecording,
  stopScreenRecording,
} from '../../modules/screen-recorder';
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

  /*
   * The foreground service must post a notification, so it may as well say
   * something true in the reader's language. Read from the i18n instance
   * rather than a hook, because this module has no component to hang
   * `useTranslation` on and the value is only needed at the moment of start.
   */
  const notificationTitle = i18n.t('meeting.recordNotificationTitle');
  const notificationBody = i18n.t('meeting.recordNotificationBody');

  const start = useCallback(async () => {
    if (recordingRef.current || releasedRef.current) return;

    /*
     * The camera is no longer the source.
     *
     * This used to require a mounted `CameraView` and record its preview, so
     * the file showed the candidate's face and nothing else — not the
     * question on screen, not the interviewer, not the captions. It now
     * captures the DISPLAY through MediaProjection, which means the camera may
     * be off, may be toggled mid-take, and the recording still shows the
     * interview as it happened. `handle` is left in the signature because the
     * contract is shared with the web build, which still needs it.
     */
    if (!isScreenRecordingAvailable()) { notice('recordFailed', 'danger'); return; }

    settledRef.current = false;
    deliveredRef.current = false;
    pendingStopRef.current = null;
    saveRef.current = true;
    durationRef.current = 0;
    startedAtRef.current = Date.now();
    recordingRef.current = true;
    setRecording(true);
    setElapsedMs(0);

    // The one notice the candidate gets at the moment of action, and it is the
    // disclosure rather than the confirmation: the recognizer owns the single
    // microphone client Android gives an app, so this file has no sound. The
    // REC chip already says that a recording is running.
    notice('recordVideoOnly', 'info');

    /*
     * The system consent dialog opens here, and it opens EVERY time — Android
     * gives no way to remember it, by design. So the optimistic state above is
     * rolled back rather than never set: the REC chip appearing for the second
     * the dialog is up, and then leaving, is the honest rendering of "you were
     * asked and you said no".
     */
    try {
      await startScreenRecording(notificationTitle, notificationBody);
    } catch (err) {
      settledRef.current = true;
      deliveredRef.current = true;
      recordingRef.current = false;
      startedAtRef.current = null;
      setRecording(false);
      const code = (err as { message?: string })?.message ?? '';
      // Declining is a decision, not a failure, and saying "recording failed"
      // to someone who just pressed Cancel is both wrong and alarming.
      if (!code.includes(ScreenRecorderError.denied)) notice('recordFailed', 'danger');
      return;
    }

    // Re-stamp: the clock starts when frames start, not when the dialog opened.
    startedAtRef.current = Date.now();
  }, [notice, notificationBody, notificationTitle]);

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

    // MediaProjection hands the file back from `stop()` itself, so unlike the
    // camera there is no separate promise that might never resolve. The grace
    // timer stays as a net for the one case that remains: a muxer that hangs
    // on finalisation and never returns at all.
    armGrace(STOP_SETTLE_MS, true);
    stopScreenRecording()
      .then((result) => finalize(result?.uri ?? null))
      .catch(() => finalize(null));

    return pending;
  }, [armGrace, finalize]);

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

    /*
     * Synchronous by contract, so the work is started and not awaited.
     *
     * A projection left running would keep both the capture session and its
     * foreground notification alive after the screen is gone — the user would
     * see "recording" on a call that ended. Delivery still runs if the file
     * lands afterwards: the share sheet appearing over the results screen is
     * the native analogue of the browser download firing during teardown.
     */
    if (opts.save) {
      armGrace(REC_STOP_GRACE_MS, false);
      stopScreenRecording()
        .then((result) => finalize(result?.uri ?? null))
        .catch(() => finalize(null));
    } else {
      void cancelScreenRecording();
      settleState();
    }
  }, [armGrace, finalize, settleState]);

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
    // A projection left running would keep capturing the screen — and showing
    // its notification — after this screen is gone.
    if (recordingRef.current) {
      void cancelScreenRecording();
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
    // No longer gated on the camera: the display is the source, so the control
    // works whether or not the candidate is on screen.
    supported: capabilities.recorder.available && isScreenRecordingAvailable(),
    recording,
    elapsedMs,
    start,
    stop,
    release,
  }), [recording, elapsedMs, start, stop, release]);
};
