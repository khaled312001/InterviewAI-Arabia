import { useId } from 'react';
import Svg, { Path, Rect, Defs, LinearGradient, Stop, G } from 'react-native-svg';
import { palette } from '../theme/tokens';

interface Props {
  size?: number;
  /**
   * `onBrand` draws the mark in white for placement on a blue/gradient
   * surface; `mono` flattens it to a single colour for watermarks.
   */
  variant?: 'colour' | 'onBrand' | 'mono';
  monoColor?: string;
}

/**
 * Thiqty (ثقتي) brand mark — a speech bubble containing three ascending bars.
 *
 * The bubble is the interview; the bars rising left-to-right are growing
 * confidence, with the tallest in gold as the payoff. Redrawn as vector so it
 * stays sharp at 24px in a tab bar and at 512px on a splash, and so the
 * colours track the design tokens instead of being baked into a PNG.
 *
 * Geometry is traced from logo/f2286abe (the mark-only artwork) on a 96×96
 * grid. Bar heights are 3 : 5 : 7 — a deliberate, readable progression.
 */
export function Logo({ size = 96, variant = 'colour', monoColor }: Props) {
  // react-native-svg renders into the shared document on web, so two Logos on
  // one screen would collide on a fixed gradient id and the second would
  // inherit the first's fill. useId() namespaces each instance.
  const gradId = `thiqty-${useId().replace(/:/g, '')}`;

  const onBrand = variant === 'onBrand';
  const mono = variant === 'mono';
  const ink = mono ? (monoColor ?? palette.n900) : onBrand ? '#FFFFFF' : palette.brand700;

  const bars = mono || onBrand
    ? [ink, ink, ink]
    : [palette.brand400, palette.brand800, palette.gold500];

  return (
    <Svg width={size} height={size} viewBox="0 0 96 96" fill="none">
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={palette.brand500} />
          <Stop offset="1" stopColor={palette.brand800} />
        </LinearGradient>
      </Defs>

      <G>
        {/* Speech bubble, stroked — tail at the lower-start edge for RTL. */}
        <Path
          d="M28 12h40c8.8 0 16 7.2 16 16v28c0 8.8-7.2 16-16 16H40L22 88V72h-.5C13.5 72 7 65.5 7 57.5V28c0-8.8 7.2-16 16-16h5Z"
          stroke={mono || onBrand ? ink : `url(#${gradId})`}
          strokeWidth={7}
          strokeLinejoin="round"
          fill="none"
        />
        {/* Ascending bars: 3 : 5 : 7 */}
        <Rect x="30" y="46" width="10" height="16" rx="5" fill={bars[0]} />
        <Rect x="45" y="36" width="10" height="26" rx="5" fill={bars[1]} />
        <Rect x="60" y="26" width="10" height="36" rx="5" fill={bars[2]} />
      </G>
    </Svg>
  );
}
