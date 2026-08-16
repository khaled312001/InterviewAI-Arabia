/**
 * The two interviewer personas, shared by the setup screen and the call.
 *
 * These colours are *identity*, not theme roles: each one is baked into the
 * DiceBear avatar URL as that avatar's background. If the picker on
 * MeetingSetupScreen and the stage on MeetingScreen disagreed by a single hex
 * digit, the interviewer the candidate chose would visibly change colour
 * between the two screens — which is exactly what happens when the constant is
 * copy-pasted into both files and only one is later edited. Hence one module.
 */

export type InterviewerGender = 'male' | 'female';

export const PERSONA: Record<InterviewerGender, { seed: string; color: string }> = {
  female: { seed: 'sara-hr', color: '#E85D75' },
  male: { seed: 'ahmed-hr', color: '#2D6CE0' },
};

/**
 * DiceBear "personas" — friendly, professional, free, and CORS-clean.
 *
 * Built by string concatenation rather than `URLSearchParams`: this module is
 * imported by screens that also render on native, where React Native's URL
 * polyfill still throws on parts of that API. Every value here is a fixed,
 * URL-safe literal, so there is nothing to escape.
 */
export function personaAvatarUrl(gender: InterviewerGender): string {
  const persona = PERSONA[gender];
  return (
    'https://api.dicebear.com/7.x/personas/svg'
    + `?seed=${persona.seed}`
    + `&backgroundColor=${persona.color.replace('#', '')}`
    + '&radius=50'
  );
}
