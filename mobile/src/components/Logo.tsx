import { useId } from 'react';
import Svg, { Path, Defs, LinearGradient, Stop, G } from 'react-native-svg';
import { palette } from '../theme/tokens';

interface Props {
  size?: number;
  /**
   * `onBrand` draws the mark for placement on a blue/gradient surface — the
   * front bubble goes white while the outline STAYS gold, because flattening
   * both to white merges them into one shape and loses the idea. `mono` is the
   * single-colour version for watermarks and Android 13 themed icons, where
   * only the silhouette survives.
   */
  variant?: 'colour' | 'onBrand' | 'mono';
  monoColor?: string;
}

/**
 * Interprova brand mark — two overlapping speech bubbles.
 *
 * The one behind is an outline: the rehearsal. The one in front is solid: the
 * real interview. The offset reads as progress from one to the other, and as
 * two people in a conversation — which is the product.
 *
 * Redrawn as vector rather than shipped as a PNG so it stays sharp at 24px in
 * a tab bar and at 512px on a splash, and so the colours track the design
 * tokens instead of being baked in. Geometry is authored on a 96×96 grid to
 * the proportions of `logo/4349a99f` (the mark-only artwork): the front bubble
 * covers the back one's lower-right quadrant, and each tail points away from
 * the overlap so neither is swallowed by it.
 */
export function Logo({ size = 96, variant = 'colour', monoColor }: Props) {
  // react-native-svg renders into the shared document on web, so two Logos on
  // one screen would collide on a fixed gradient id and the second would
  // inherit the first's fill. useId() namespaces each instance.
  const gradId = `interprova-${useId().replace(/:/g, '')}`;

  const onBrand = variant === 'onBrand';
  const mono = variant === 'mono';

  const ink = monoColor ?? palette.n900;
  const outline = mono ? ink : palette.gold500;
  const frontFill = mono ? ink : onBrand ? '#FFFFFF' : `url(#${gradId})`;

  return (
    <Svg width={size} height={size} viewBox="0 0 96 96" fill="none">
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={palette.brand500} />
          <Stop offset="1" stopColor={palette.brand800} />
        </LinearGradient>
      </Defs>

      <G>
        {/* The rehearsal — outline only, tail at the lower LEFT, away from the
            overlap. Drawn first so the solid bubble sits on top of it. */}
        <Path
          d="M21 16H53A11 11 0 0 1 64 27V47A11 11 0 0 1 53 58H30L17 70V58H21A11 11 0 0 1 10 47V27A11 11 0 0 1 21 16Z"
          stroke={outline}
          strokeWidth={5.5}
          strokeLinejoin="round"
          fill="none"
        />
        {/* The interview — solid, tail at the lower RIGHT. */}
        <Path
          d="M45 36H75A11 11 0 0 1 86 47V86L72 74H45A11 11 0 0 1 34 63V47A11 11 0 0 1 45 36Z"
          fill={frontFill}
        />
      </G>
    </Svg>
  );
}
