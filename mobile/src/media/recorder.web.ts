/**
 * Session recording — `MediaRecorder` over the whole call, delivered as a
 * `.webm` download so the candidate can review their own performance.
 *
 * Lifted from MeetingScreen's `startRecording` / `stopRecording` /
 * `finalizeRecording` / `buildRecordingStream`. Four things in here are
 * load-bearing and none of them is obvious:
 *
 *   • Chunks live in a ref. Putting them in state would re-render the entire
 *     call UI on every `dataavailable`.
 *   • `release()` must run *before* the camera tracks are stopped, and it arms
 *     a grace timer: a recorder whose sources die mid-flush can fail to emit
 *     `onstop` at all, which would silently drop the take.
 *   • `finalize` empties the chunk buffer, so whichever of `onstop` and the
 *     grace timer runs first wins and a late `onstop` cannot produce a second
 *     download.
 *   • Audio is mixed down to a single track. `MediaRecorder` encodes only one,
 *     so handing it both the mic and the captured tab would silently drop one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RecordingResult, SessionRecorder, UseSessionRecorder } from './contract';
import { readCaptureHandle } from './contract';
import { capabilities } from './capabilities';
import {
  ensureAudioContext, releaseAudioGraph, retainAudioGraph, setMixDestination,
} from './audioGraph.web';
import {
  BLOB_URL_TTL_MS, REC_STOP_GRACE_MS, REC_TIMESLICE_MS, recordingFileName,
} from './tuning';

export const useSessionRecorder: UseSessionRecorder = ({ handle, onNotice }) => {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const handleRef = useRef(handle);
  const noticeRef = useRef(onNotice);
  useEffect(() => { handleRef.current = handle; noticeRef.current = onNotice; });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const saveRef = useRef(true);
  const startedAtRef = useRef<number | null>(null);
  /** True between `rec.stop()` and its `onstop`, so a second teardown pass
   *  cannot flush the same chunks into a second download. */
  const stoppingRef = useRef(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Screen-capture stream, when the browser grants one. Separate from the
   *  camera stream so teardown can release both independently. */
  const displayStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const tabSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const releasedRef = useRef(false);
  const graphRef = useRef(false);
  /** `stop()` callers waiting on the file, resolved by whichever finalize wins. */
  const pendingRef = useRef<Array<(result: RecordingResult | null) => void>>([]);

  const notify = useCallback((key: string, tone: 'info' | 'danger' | 'success') => {
    noticeRef.current?.(key, tone);
  }, []);

  const resolvePending = useCallback((result: RecordingResult | null) => {
    const waiting = pendingRef.current;
    pendingRef.current = [];
    waiting.forEach((resolve) => resolve(result));
  }, []);

  const finalize = useCallback((save: boolean) => {
    // Safe to call twice: the second pass sees no session and returns quietly
    // instead of saving a duplicate file or crying "nothing was captured".
    const wasRecording = startedAtRef.current !== null || chunksRef.current.length > 0;
    const durationMs = startedAtRef.current !== null ? Date.now() - startedAtRef.current : 0;
    stoppingRef.current = false;
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }

    const chunks = chunksRef.current;
    chunksRef.current = [];
    startedAtRef.current = null;
    setRecording(false);
    setElapsedMs(0);

    // Detach the mic from the mixing graph so the node is not left running, and
    // end the synthetic track the mix produced — it is a MediaStreamTrack like
    // any other and would otherwise stay live until the context closes.
    try { micSourceRef.current?.disconnect(); } catch { /* noop */ }
    micSourceRef.current = null;
    try { tabSourceRef.current?.disconnect(); } catch { /* noop */ }
    tabSourceRef.current = null;
    // Release the screen-capture tracks as well. Leaving them live keeps the
    // browser's "you are sharing your screen" bar up after the call ended.
    try {
      displayStreamRef.current?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
    } catch { /* noop */ }
    displayStreamRef.current = null;
    const dest = destRef.current;
    destRef.current = null;
    setMixDestination(null);
    if (dest) {
      try { dest.disconnect(); } catch { /* noop */ }
      dest.stream.getTracks().forEach((track) => { try { track.stop(); } catch { /* noop */ } });
    }

    if (!wasRecording) { resolvePending(null); return; }

    const fileName = recordingFileName(capabilities.recorder.fileExtension);
    if (!save) {
      resolvePending({ ok: false, fileName, durationMs, delivery: 'none' });
      return;
    }
    if (!chunks.length) {
      notify('recordingEmpty', 'danger');
      resolvePending({ ok: false, fileName, durationMs, delivery: 'none', error: 'empty' });
      return;
    }
    if (typeof document === 'undefined') {
      resolvePending({ ok: false, fileName, durationMs, delivery: 'none', error: 'unsupported' });
      return;
    }

    try {
      const blob = new Blob(chunks, { type: capabilities.recorder.mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking immediately cancels the save in some engines; the URL is
      // released once the browser has certainly taken the bytes.
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* noop */ } }, BLOB_URL_TTL_MS);
      notify('recordingSaved', 'success');
      resolvePending({
        ok: true, fileName, durationMs, delivery: 'download', sizeBytes: blob.size,
      });
    } catch {
      notify('recordFailed', 'danger');
      resolvePending({ ok: false, fileName, durationMs, delivery: 'none', error: 'failed' });
    }
  }, [notify, resolvePending]);

  /** `fromRelease` is what arms the missing-`onstop` net — see the file header. */
  const stopInternal = useCallback((save: boolean, fromRelease: boolean) => {
    const rec = recorderRef.current;
    recorderRef.current = null;

    if (!rec) {
      // Nothing running. Flush leftovers unless a stop is already in flight —
      // that one's `onstop` will resolve the waiters.
      if (!stoppingRef.current) finalize(save);
      return;
    }

    saveRef.current = save;
    try {
      if (rec.state !== 'inactive') {
        stoppingRef.current = true;
        try { rec.requestData(); } catch { /* not supported everywhere */ }
        rec.stop(); // `onstop` finalizes

        // …unless it doesn't. Teardown stops the camera/mic tracks in the same
        // synchronous block — the camera light must not outlive the call — and
        // a recorder that loses its input mid-flush can go quiet without ever
        // firing `onstop`, silently losing the take. So on the teardown path
        // only, save what we already have if `onstop` misses its window.
        //
        // Deliberately NOT armed for a mid-call stop (the record button): there
        // the tracks stay live, `onstop` is certain to arrive, and finalizing
        // early would truncate the last second of footage for no reason.
        if (fromRelease) {
          if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
          stopTimerRef.current = setTimeout(() => {
            stopTimerRef.current = null;
            if (stoppingRef.current) finalize(saveRef.current);
          }, REC_STOP_GRACE_MS);
        }
      } else {
        finalize(save);
      }
    } catch {
      stoppingRef.current = false;
      finalize(save);
    }
  }, [finalize]);

  /**
   * Assemble what actually gets recorded.
   *
   * `base` is the camera+mic stream. When `display` is supplied (screen
   * capture) its video replaces the webcam, so the review file shows the whole
   * call — interviewer, captions and the candidate's own PiP — rather than a
   * head-and-shoulders crop.
   *
   * On the interviewer's voice: the server-TTS fallback plays through an
   * <audio> element wired straight into this destination, so it is always in
   * the take. The local neural voice never enters Web Audio — `speechSynthesis`
   * has no MediaStream — so it reaches the file only via the tab/system audio
   * the user grants in the share dialog.
   */
  const buildRecordingStream = useCallback(
    (base: MediaStream, display?: MediaStream | null): MediaStream => {
      const video = display?.getVideoTracks().length
        ? display.getVideoTracks()
        : base.getVideoTracks();

      try {
        const ctx = ensureAudioContext();
        const sources: MediaStream[] = [];
        if (base.getAudioTracks().length) sources.push(base);
        if (display?.getAudioTracks().length) sources.push(display);

        if (!ctx || sources.length === 0) {
          return new MediaStream([...video, ...base.getAudioTracks()]);
        }

        const dest = ctx.createMediaStreamDestination();
        // Connected to the mix only, never to `ctx.destination` — routing these
        // back to the speakers would echo the candidate at themselves and feed
        // the interviewer's own voice into a loop.
        const micSource = ctx.createMediaStreamSource(sources[0]);
        micSource.connect(dest);
        if (sources[1]) {
          const tabSource = ctx.createMediaStreamSource(sources[1]);
          tabSource.connect(dest);
          tabSourceRef.current = tabSource;
        }

        const mixedAudio = dest.stream.getAudioTracks();
        if (!mixedAudio.length) return new MediaStream([...video, ...base.getAudioTracks()]);

        destRef.current = dest;
        micSourceRef.current = micSource;
        // Published so the server-TTS voice can join the mix mid-recording.
        setMixDestination(dest);
        return new MediaStream([...video, ...mixedAudio]);
      } catch {
        return new MediaStream([...video, ...base.getAudioTracks()]);
      }
    },
    [],
  );

  const start = useCallback(async () => {
    if (recorderRef.current || releasedRef.current) return;
    if (!capabilities.recorder.available) { notify('recordUnsupported', 'danger'); return; }
    const base = readCaptureHandle<MediaStream>(handleRef.current);
    if (!base) { notify('recordFailed', 'danger'); return; }

    try {
      const MR = (window as any).MediaRecorder as typeof MediaRecorder;

      // Capture the whole call, not just the webcam: `getDisplayMedia` records
      // the tab, so the interviewer, the live captions and the candidate's own
      // picture-in-picture are all in the review file. The camera-only stream
      // is the fallback when the browser has no screen capture or the user
      // dismisses the picker.
      let stream: MediaStream;
      let display: MediaStream | null = null;
      const md: any = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
      if (md?.getDisplayMedia) {
        try {
          display = await md.getDisplayMedia({
            video: { frameRate: 30 },
            // Tab audio where the browser offers it — that carries the
            // interviewer's synthesised voice.
            audio: true,
          });
        } catch {
          display = null; // dismissed or blocked — fall back below
        }
      }

      // The call can end while the share picker is up. Nothing owns those
      // tracks then, and leaving them live keeps the sharing bar on screen.
      if (releasedRef.current) {
        display?.getTracks().forEach((track) => { try { track.stop(); } catch { /* noop */ } });
        return;
      }

      if (display) {
        // Mix the microphone into the display capture so the candidate's own
        // answers are audible; display audio alone would only carry the
        // interviewer.
        stream = buildRecordingStream(base, display);
        displayStreamRef.current = display;
        // Ending the share from the browser's own "Stop sharing" bar must stop
        // our recorder too, or it keeps writing a frozen frame.
        const track = display.getVideoTracks()[0];
        if (track) track.onended = () => { stopInternal(true, false); };
      } else {
        stream = buildRecordingStream(base);
        notify('recordCameraOnly', 'info');
      }

      const rec = capabilities.recorder.mimeType
        ? new MR(stream, { mimeType: capabilities.recorder.mimeType })
        : new MR(stream);

      chunksRef.current = [];
      saveRef.current = true;

      rec.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => { finalize(saveRef.current); };
      rec.onerror = () => {
        // Route through the one stop path rather than hand-roll a second: that
        // is what releases the buffer and the mixing nodes instead of pinning
        // `stoppingRef` on forever.
        notify('recordFailed', 'danger');
        stopInternal(false, false); // a broken take is discarded, not handed over
      };

      rec.start(REC_TIMESLICE_MS);
      recorderRef.current = rec;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setRecording(true);
      notify('recordingStarted', 'success');
    } catch {
      recorderRef.current = null;
      notify('recordFailed', 'danger');
    }
  }, [buildRecordingStream, finalize, notify, stopInternal]);

  const stop = useCallback(
    (opts: { save: boolean }) => new Promise<RecordingResult | null>((resolve) => {
      pendingRef.current.push(resolve);
      stopInternal(opts.save, false);
    }),
    [stopInternal],
  );

  const release = useCallback((opts: { save: boolean }) => {
    releasedRef.current = true;
    stopInternal(opts.save, true);
    if (graphRef.current) { graphRef.current = false; releaseAudioGraph(); }
  }, [stopInternal]);

  useEffect(() => {
    if (!recording) return undefined;
    const id = setInterval(
      () => setElapsedMs(Date.now() - (startedAtRef.current ?? Date.now())),
      1000,
    );
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    graphRef.current = true;
    retainAudioGraph();
    // The grace timer is deliberately left armed on unmount: it runs off refs,
    // not off React, and it is the only thing between an abrupt teardown and a
    // lost take.
    return () => { release({ save: saveRef.current }); };
  }, [release]);

  return useMemo<SessionRecorder>(() => ({
    supported: capabilities.recorder.available,
    recording,
    elapsedMs,
    start,
    stop,
    release,
  }), [recording, elapsedMs, start, stop, release]);
};
