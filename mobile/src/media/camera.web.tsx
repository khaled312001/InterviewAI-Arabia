/**
 * Self-view over `getUserMedia`, rendered into a real <video> element.
 *
 * Lifted from MeetingScreen's `acquireMedia`, its attach effect and its
 * mic/camera toggles. Three behaviours are load-bearing, and each was a bug
 * once:
 *
 *   • `Preview` is created once and never re-created. Re-mounting the element
 *     on a camera toggle drops `srcObject` and the feed returns as a black
 *     frame, so "camera off" is `display: none` over a still-mounted element
 *     whose track is disabled. That is also why the web build can toggle the
 *     camera mid-recording: the pipeline stays warm.
 *   • A stream that resolves after the call ended — the candidate left while
 *     the permission prompt was up — is stopped, not stored. Otherwise the
 *     camera light outlives the interview.
 *   • A retry after a denial releases the previous stream only once the new one
 *     has arrived, so the two can never be live at the same time.
 */

import type { ComponentType } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type {
  CameraController, CameraFacing, CameraPreviewProps, MediaFault, UseCamera,
} from './contract';
import { asCaptureHandle } from './contract';

/** 4:3, matching the self-view tile the call chrome is laid out for. */
const CAPTURE = { width: 640, height: 480 } as const;

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => {
    try { track.stop(); } catch { /* noop */ }
  });
}

export const useCamera: UseCamera = ({ active, initialFacing = 'front', onFault }) => {
  const [handle, setHandle] = useState(asCaptureHandle<MediaStream>(null));
  const [fault, setFault] = useState<MediaFault>(null);
  const [enabled, setEnabledState] = useState(true);
  const [micEnabled, setMicEnabledState] = useState(true);
  const [facing, setFacing] = useState<CameraFacing>(initialFacing);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const enabledRef = useRef(true);
  const micRef = useRef(true);
  const facingRef = useRef<CameraFacing>(initialFacing);
  const releasedRef = useRef(false);
  const canFlipRef = useRef(false);
  /** Bumped per acquisition, so a stream that lands after a retry, a flip or a
   *  teardown is orphaned and stopped instead of replacing the live one. */
  const genRef = useRef(0);

  const faultRef = useRef(onFault);
  useEffect(() => { faultRef.current = onFault; });

  /**
   * What `Preview` renders from. It is a plain mirror of state, assigned during
   * render on purpose: `Preview` renders in the same pass as its parent, so
   * filling this in from an effect would leave the feed on screen for a frame
   * after the camera was switched off.
   */
  const viewRef = useRef({ live: false });
  viewRef.current = { live: enabled && handle !== null };

  const attach = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    const stream = streamRef.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.play().catch(() => {});
  }, []);

  /** Labels and device count only become trustworthy after the first grant. */
  const probeFlip = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      canFlipRef.current = devices.filter((d) => d.kind === 'videoinput').length > 1;
    } catch {
      canFlipRef.current = false;
    }
  }, []);

  const acquire = useCallback(async (want: CameraFacing) => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setFault('unsupported');
      faultRef.current?.('unsupported');
      return;
    }
    const gen = (genRef.current += 1);
    setFault(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: CAPTURE.width,
          height: CAPTURE.height,
          facingMode: want === 'front' ? 'user' : 'environment',
        },
        audio: true,
      });

      // Released, or superseded, while the permission prompt was up.
      if (releasedRef.current || gen !== genRef.current) { stopTracks(stream); return; }

      const previous = streamRef.current;
      if (previous && previous !== stream) stopTracks(previous);

      streamRef.current = stream;
      stream.getAudioTracks().forEach((track) => { track.enabled = micRef.current; });
      stream.getVideoTracks().forEach((track) => { track.enabled = enabledRef.current; });
      setHandle(asCaptureHandle(stream));
      void probeFlip();
    } catch {
      if (gen !== genRef.current) return;
      setFault('denied');
      faultRef.current?.('denied');
    }
  }, [probeFlip]);

  const release = useCallback(() => {
    releasedRef.current = true;
    genRef.current += 1; // orphan anything still in flight
    const stream = streamRef.current;
    streamRef.current = null;
    stopTracks(stream);
    const el = videoRef.current;
    if (el) {
      try { el.pause(); el.srcObject = null; } catch { /* noop */ }
    }
    setHandle(null);
  }, []);

  const retry = useCallback(async () => {
    releasedRef.current = false;
    await acquire(facingRef.current);
  }, [acquire]);

  useEffect(() => {
    if (!active) { release(); return undefined; }
    releasedRef.current = false;
    void acquire(facingRef.current);
    return () => { release(); };
  }, [active, acquire, release]);

  // Re-attach whenever the stream or the camera state changes: a toggle back on
  // must find the element still wired to a live stream.
  useEffect(() => {
    const el = videoRef.current;
    const stream = streamRef.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.play().catch(() => {});
  }, [handle, enabled]);

  const setEnabled = useCallback((on: boolean) => {
    enabledRef.current = on;
    setEnabledState(on);
    streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = on; });
  }, []);

  const setMicEnabled = useCallback((on: boolean) => {
    micRef.current = on;
    setMicEnabledState(on);
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = on; });
  }, []);

  const flip = useCallback(() => {
    if (!canFlipRef.current || releasedRef.current) return false;
    const next: CameraFacing = facingRef.current === 'front' ? 'back' : 'front';
    facingRef.current = next;
    setFacing(next);
    void acquire(next);
    return true;
  }, [acquire]);

  const Preview = useMemo<ComponentType<CameraPreviewProps>>(() => {
    // Created exactly once per call: `attach` and `viewRef` are both stable, so
    // this closure never has to be rebuilt and the element never re-mounts.
    function CameraPreview({ style, mirrored, placeholder, accessibilityLabel }: CameraPreviewProps) {
      const { live } = viewRef.current;
      return (
        <View style={[styles.fill, style]} accessible accessibilityLabel={accessibilityLabel}>
          <video
            ref={attach}
            autoPlay
            muted
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: mirrored ? 'scaleX(-1)' : 'none',
              display: live ? 'block' : 'none',
            }}
          />
          {live ? null : placeholder}
        </View>
      );
    }
    return CameraPreview;
  }, [attach]);

  return useMemo<CameraController>(() => ({
    Preview,
    ready: handle !== null,
    fault,
    enabled,
    micEnabled,
    facing,
    handle,
    setEnabled,
    setMicEnabled,
    flip,
    retry,
    release,
  }), [
    Preview, handle, fault, enabled, micEnabled, facing,
    setEnabled, setMicEnabled, flip, retry, release,
  ]);
};

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
});
