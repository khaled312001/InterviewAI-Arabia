/**
 * The only place millisecond literals live. Components read durations from
 * theme.transitions.duration, which is wired from this object.
 */
export const motion = {
  duration: {
    shortest: 100,
    shorter: 140,
    short: 180,
    standard: 220,          // default for UI state changes
    complex: 300,           // drawers, dialogs
    enteringScreen: 240,    // enter is always slower than exit
    leavingScreen: 180,
  },
  easing: {
    easeInOut: 'cubic-bezier(0.2, 0, 0, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
  },
  stagger: { step: 40, maxItems: 6, cap: 240 },
  countUp: { duration: 600, minValue: 10 },
} as const;

/** Any component passing a `timeout` funnels it through this. */
export const motionSafe = (reduced: boolean, ms: number) => (reduced ? 0 : ms);

/** Fade+rise delay for a first-mount stagger, capped so nothing feels slow. */
export const staggerDelay = (index: number, reduced = false) =>
  reduced ? 0 : Math.min(index, motion.stagger.maxItems - 1) * motion.stagger.step;
