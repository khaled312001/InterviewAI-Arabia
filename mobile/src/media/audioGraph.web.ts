/**
 * The call's single Web Audio graph.
 *
 * Three hooks share it and none of them owns it: the server-TTS voice builds an
 * AnalyserNode over its <audio> element, the level meter reads that analyser (or
 * one of its own over the microphone), and the recorder needs the interviewer's
 * voice mixed into its destination alongside the mic. In MeetingScreen those
 * were three refs on one component; splitting the screen into hooks split the
 * refs apart, so the context and the mixdown bus live here instead.
 *
 * One context per call, exactly as before. The retain count is what closes it:
 * an AudioContext that outlives the call holds an output device open, and this
 * project has already shipped one media leak.
 */

let ctx: AudioContext | null = null;
let mixDest: MediaStreamAudioDestinationNode | null = null;
let retained = 0;

/**
 * The shared context, created on first use and resumed if the browser's
 * autoplay policy parked it. Null when Web Audio is unavailable — every caller
 * treats that as "no analyser", never as a failure.
 */
export function ensureAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  // A context closed by the previous call cannot be revived.
  if (ctx && ctx.state === 'closed') ctx = null;
  if (!ctx) {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    try { ctx = new Ctx() as AudioContext; } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/**
 * The recorder's mixdown bus while a recording is running, else null.
 *
 * This is the only path the server-TTS voice has into the recording: the
 * browser's own neural voice plays straight to the OS mixer and never enters
 * Web Audio at all, so it reaches the file only through captured tab audio.
 */
export function mixDestination(): MediaStreamAudioDestinationNode | null {
  return mixDest;
}

export function setMixDestination(dest: MediaStreamAudioDestinationNode | null) {
  mixDest = dest;
}

export function retainAudioGraph() {
  retained += 1;
}

/** Closes the context once the last hook has let go of it. */
export function releaseAudioGraph() {
  retained = Math.max(0, retained - 1);
  if (retained > 0) return;
  const dying = ctx;
  ctx = null;
  mixDest = null;
  if (dying && dying.state !== 'closed') dying.close().catch(() => {});
}
