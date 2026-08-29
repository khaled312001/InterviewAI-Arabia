import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, CameraView } from 'expo-camera';
import type { CameraMountError } from 'expo-camera';

import { asCaptureHandle } from './contract';
import type {
  CameraController,
  CameraFacing,
  CameraPreviewProps,
  MediaFault,
  UseCamera,
} from './contract';

/**
 * How long a mounted `CameraView` may stay silent — no `onCameraReady`, no
 * `onMountError` — before the preview is treated as live anyway. Long enough
 * that a cold camera on a slow handset still reports for itself, short enough
 * that a candidate who turned the camera on does not sit in front of an
 * avatar wondering what went wrong.
 */
const PREVIEW_READY_FALLBACK_MS = 1500;

/* ------------------------------------------------------------------ *
 * Snapshot store
 *
 * `Preview` must be the SAME component instance for the whole call: the
 * contract requires it to survive `enabled` toggles, and re-creating it every
 * render would remount `CameraView` — which on Android tears the CameraX
 * session down and back up, flashing black and (worse) killing any recording
 * in flight. So the component is built once and reads its state from this tiny
 * external store instead of from props or closures.
 * ------------------------------------------------------------------ */

interface CameraSnapshot {
  /** Both camera AND microphone permissions were granted. */
  granted: boolean;
  fault: MediaFault;
  /** The candidate's camera toggle. */
  enabled: boolean;
  micEnabled: boolean;
  facing: CameraFacing;
  /** `onCameraReady` has fired for the currently mounted view. */
  previewReady: boolean;
  /** The screen still wants a live capture (false on the result screen). */
  active: boolean;
  /** Teardown ran; nothing may re-open the camera afterwards. */
  released: boolean;
}

interface CameraStore {
  getSnapshot: () => CameraSnapshot;
  subscribe: (listener: () => void) => () => void;
  set: (patch: Partial<CameraSnapshot>) => void;
}

function createCameraStore(initial: CameraSnapshot): CameraStore {
  let snapshot = initial;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(patch) {
      // `useSyncExternalStore` re-reads on every notification and compares by
      // identity, so a new object for an unchanged value would loop forever.
      const current = snapshot as unknown as Record<string, unknown>;
      const next = patch as unknown as Record<string, unknown>;
      let changed = false;
      for (const key of Object.keys(next)) {
        if (next[key] !== undefined && current[key] !== next[key]) { changed = true; break; }
      }
      if (!changed) return;
      snapshot = { ...snapshot, ...patch };
      listeners.forEach((listener) => listener());
    },
  };
}

/* ------------------------------------------------------------------ *
 * Preview
 * ------------------------------------------------------------------ */

interface PreviewHandlers {
  onReady: () => void;
  onMountError: (event: CameraMountError) => void;
  onViewRef: (view: CameraView | null) => void;
}

function createPreview(
  store: CameraStore,
  handlers: { current: PreviewHandlers },
): ComponentType<CameraPreviewProps> {
  return function CameraPreview({ style, placeholder, accessibilityLabel }: CameraPreviewProps) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    const live = state.granted && state.active && state.enabled && !state.released && state.fault === null;

    /*
     * These three MUST be stable, and the ref most of all.
     *
     * React re-invokes a callback ref whenever its IDENTITY changes between
     * renders: it calls the old one with `null`, then the new one with the
     * instance. An inline arrow is a new identity every render, so a parent
     * that re-renders produces a detach/attach cycle on a camera that never
     * moved — and `onViewRef(null)` clears `previewReady` and cancels the
     * readiness fallback that is about to set it.
     *
     * MeetingScreen re-renders about once a second, because it shows a
     * countdown. That is faster than PREVIEW_READY_FALLBACK_MS, so the
     * fallback timer was armed and cancelled forever without firing, and on a
     * device whose CameraX build never emits `onCameraReady` — the case the
     * fallback exists for — `previewReady` could never become true. The camera
     * opened, streamed, and sat underneath the placeholder for the whole call:
     * logcat showed `CameraDevice.onOpened()` and `CameraState{type=OPEN,
     * error=null}` while the candidate looked at their own initial.
     *
     * Nothing failed, which is why nothing reported a failure.
     */
    const setViewRef = useCallback((view: CameraView | null) => {
      handlers.current.onViewRef(view);
    }, []);
    const handleReady = useCallback(() => { handlers.current.onReady(); }, []);
    const handleMountError = useCallback((event: CameraMountError) => {
      handlers.current.onMountError(event);
    }, []);

    return (
      <View
        style={[styles.fill, style]}
        accessible={!!accessibilityLabel}
        accessibilityLabel={accessibilityLabel}
      >
        {live ? (
          <CameraView
            ref={setViewRef}
            style={StyleSheet.absoluteFill}
            facing={state.facing}
            // `video` is what makes `recordAsync` legal, and `mute` is not a
            // stylistic choice: on Android a second microphone client silences
            // the speech recognizer without raising an error, so the recorder
            // never takes the mic. The recognizer owns it for the whole call.
            mode="video"
            mute
            // Mirroring the *recording* would flip the candidate's face in the
            // review file; the front PREVIEW is already mirrored by CameraX /
            // AVFoundation, which is why `mirrored` is a no-op here.
            mirror={false}
            ratio="4:3"
            videoQuality="4:3"
            onCameraReady={handleReady}
            onMountError={handleMountError}
          />
        ) : null}

        {/* Also covers the gap between mounting and the first frame, so a
            camera toggle never shows a black rectangle. */}
        {!live || !state.previewReady ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {placeholder}
          </View>
        ) : null}
      </View>
    );
  };
}

/* ------------------------------------------------------------------ *
 * Hook
 * ------------------------------------------------------------------ */

export const useCamera: UseCamera = ({ active, initialFacing = 'front', onFault }) => {
  const [store] = useState(() => createCameraStore({
    granted: false,
    fault: null,
    enabled: true,
    micEnabled: true,
    facing: initialFacing,
    previewReady: false,
    active,
    released: false,
  }));

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const viewRef = useRef<CameraView | null>(null);
  const faultRef = useRef(onFault);
  useEffect(() => { faultRef.current = onFault; });

  /**
   * The safety net under `onCameraReady`.
   *
   * That event is emitted from a `CameraState` observer on the CameraX
   * lifecycle, and on some Android builds the OPEN transition is simply never
   * delivered to it — the preview renders, the session is live, and the event
   * never arrives. Because `previewReady` gates both the placeholder and the
   * recorder handle, that turns a working camera into a permanently blank tile
   * whose Record button then reports a permissions problem the candidate does
   * not have. Nothing in the UI recovers from it, because from the app's point
   * of view nothing failed.
   *
   * So the event is treated as an optimisation, not a precondition: once the
   * view has been mounted this long without either `onCameraReady` or
   * `onMountError`, we proceed as if it were ready. A genuine bind failure
   * still comes back as `onMountError` and still wins — this only closes the
   * case where no answer arrives at all.
   */
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearReadyTimer = useCallback(() => {
    if (readyTimerRef.current) { clearTimeout(readyTimerRef.current); readyTimerRef.current = null; }
  }, []);

  const handlersRef = useRef<PreviewHandlers>({
    onReady: () => { clearReadyTimer(); store.set({ previewReady: true }); },
    onMountError: () => {
      // The view mounted but the device refused to open a session — a camera
      // held by another app, or none at all. Reported as `unsupported` rather
      // than `denied` so the UI offers the right recovery.
      clearReadyTimer();
      store.set({ previewReady: false, fault: 'unsupported' });
      faultRef.current?.('unsupported');
    },
    onViewRef: (view) => {
      viewRef.current = view;
      clearReadyTimer();
      if (!view) { store.set({ previewReady: false }); return; }
      readyTimerRef.current = setTimeout(() => {
        readyTimerRef.current = null;
        const snapshot = store.getSnapshot();
        // Anything that already settled the question wins: a refusal, a
        // teardown, or a view that has since been unmounted.
        if (snapshot.released || snapshot.fault !== null || !viewRef.current) return;
        store.set({ previewReady: true });
      }, PREVIEW_READY_FALLBACK_MS);
    },
  });

  const [Preview] = useState<ComponentType<CameraPreviewProps>>(
    () => createPreview(store, handlersRef),
  );

  /**
   * Camera *and* microphone, in one pass, exactly like the web build's single
   * `getUserMedia({ video, audio })`: a candidate who blocks the microphone
   * cannot answer, so a half-granted call is a denial, not a degraded mode.
   */
  const acquire = useCallback(async () => {
    store.set({ fault: null });
    try {
      const camera = await Camera.requestCameraPermissionsAsync();
      const microphone = await Camera.requestMicrophonePermissionsAsync();
      // The call can end while the OS dialog is still up.
      if (store.getSnapshot().released) return;

      if (!camera.granted || !microphone.granted) {
        store.set({ granted: false, previewReady: false, fault: 'denied' });
        faultRef.current?.('denied');
        return;
      }
      store.set({ granted: true, fault: null });
    } catch {
      store.set({ granted: false, previewReady: false, fault: 'unsupported' });
      faultRef.current?.('unsupported');
    }
  }, [store]);

  useEffect(() => {
    store.set({ active });
  }, [active, store]);

  useEffect(() => {
    if (!active) return;
    const snapshot = store.getSnapshot();
    // Only the explicit Retry re-prompts after a refusal — asking again on
    // every render is how an app trains users to hit "never ask again".
    if (snapshot.granted || snapshot.released || snapshot.fault !== null) return;
    void acquire();
  }, [active, acquire, store]);

  const setEnabled = useCallback((on: boolean) => {
    if (store.getSnapshot().released) return;
    store.set({ enabled: on });
  }, [store]);

  /**
   * There is no per-track `enabled` flag on native. The camera already records
   * muted, so muting means one thing only: the recognizer stops listening —
   * which MeetingScreen does in `toggleMic`. This flag is the UI's memory of
   * that decision.
   */
  const setMicEnabled = useCallback((on: boolean) => {
    if (store.getSnapshot().released) return;
    store.set({ micEnabled: on });
  }, [store]);

  const flip = useCallback((): boolean => {
    const snapshot = store.getSnapshot();
    if (snapshot.released || !snapshot.granted) return false;
    // Flipping mid-recording stops the recording (expo-camera's own caveat);
    // callers gate on `capabilities.camera.canFlipWhileRecording`.
    store.set({ facing: snapshot.facing === 'front' ? 'back' : 'front', previewReady: false });
    return true;
  }, [store]);

  const retry = useCallback(async () => {
    store.set({ released: false, previewReady: false, fault: null });
    await acquire();
  }, [acquire, store]);

  const release = useCallback(() => {
    if (store.getSnapshot().released) return;
    clearReadyTimer();
    // Belt and braces: teardown calls the recorder first, but a recorder that
    // failed to stop would otherwise keep the encoder — and the camera light —
    // alive past the end of the call.
    try { viewRef.current?.stopRecording(); } catch { /* noop */ }
    viewRef.current = null;
    store.set({ released: true, enabled: false, previewReady: false });
  }, [clearReadyTimer, store]);

  // The camera must never outlive the screen, whatever path unmounted it.
  useEffect(() => () => { release(); }, [release]);

  /*
   * Deliberately no AppState handling here. CameraX and AVCaptureSession
   * unbind themselves when the host activity stops, and doing it ourselves in
   * the same tick would race the recorder's own background stop and abort the
   * flush instead of letting it finalize. Backgrounding is the recorder's
   * concern; see recorder.native.ts.
   */

  // The mounted view IS the capture handle on native; the recorder unbrands it
  // back to a CameraView and nobody else may look inside.
  const handle = state.previewReady ? asCaptureHandle(viewRef.current) : null;

  return useMemo<CameraController>(() => ({
    Preview,
    // On native "ready" means the OS let us in — the preview mounting is a
    // rendering detail, and gating the Start CTA on it would strand a
    // candidate who turned their camera off before starting.
    ready: state.granted && !state.released && state.fault === null,
    fault: state.fault,
    enabled: state.enabled,
    micEnabled: state.micEnabled,
    facing: state.facing,
    handle,
    setEnabled,
    setMicEnabled,
    flip,
    retry,
    release,
  }), [Preview, state, handle, setEnabled, setMicEnabled, flip, retry, release]);
};

const styles = StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
});
