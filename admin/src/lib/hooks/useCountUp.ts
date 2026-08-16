import { useEffect, useRef, useState } from 'react';
import { motion } from '../../theme/motion';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * Runs only on the first `undefined -> number` transition, and only for
 * |value| >= 10. Counting 0 -> 3 is noise; counting on refetch is a lie about
 * what changed. Reduced motion jumps to the final value on frame 1.
 */
export function useCountUp(value: number | undefined, enabled = true): number | undefined {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState<number | undefined>(value);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (value === undefined) return;

    const shouldAnimate =
      enabled && !reduced && !hasAnimated.current && Math.abs(value) >= motion.countUp.minValue;

    if (!shouldAnimate) {
      setDisplay(value);
      if (value !== undefined) hasAnimated.current = true;
      return;
    }

    hasAnimated.current = true;
    const from = 0;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / motion.countUp.duration);
      setDisplay(Math.round(from + (value - from) * easeOutCubic(t)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, enabled, reduced]);

  return display;
}
