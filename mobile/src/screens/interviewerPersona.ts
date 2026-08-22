/**
 * The two interviewer personas, shared by the setup screen and the call.
 *
 * The portrait is a BUNDLED asset, not a URL.
 *
 * It used to be a DiceBear SVG fetched from api.dicebear.com at call time.
 * That was wrong in four separate ways, and only the first one was visible:
 *
 *   1. It is line-art. The call screen is a video-call stage — a cartoon in the
 *      seat where a person should be is the single loudest "this is a toy" cue
 *      in the product.
 *   2. It was a third-party request on a metered screen. No network, no face:
 *      the candidate's paid interview opened with a blank circle.
 *   3. On native the setup screen never rendered it at all — `<img>` does not
 *      exist there, so the picker fell back to a coloured initial and the two
 *      screens disagreed about what the interviewer looked like.
 *   4. It put a vendor in the data-sharing disclosure to draw a face.
 *
 * A `require`d asset has none of those properties: it is in the bundle, it
 * renders identically on web and device through one `<Image>`, and replacing
 * the art is a file swap with no code change.
 *
 * `color` is still identity rather than a theme role — it is the ring and the
 * fallback fill, and the picker and the stage must not disagree by a digit.
 */

import type { ImageSourcePropType } from 'react-native';

export type InterviewerGender = 'male' | 'female';

interface Persona {
  /** Ring and fallback fill. Sampled from the portrait's own backdrop. */
  color: string;
  portrait: ImageSourcePropType;
}

export const PERSONA: Record<InterviewerGender, Persona> = {
  female: {
    color: '#3A4A78',
    portrait: require('../../assets/interviewers/sara.png'),
  },
  male: {
    color: '#2E4E80',
    portrait: require('../../assets/interviewers/ahmed.png'),
  },
};

/** The portrait to paint for a persona. */
export function personaPortrait(gender: InterviewerGender): ImageSourcePropType {
  return PERSONA[gender].portrait;
}
