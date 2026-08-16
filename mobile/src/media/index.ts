/**
 * Media layer barrel — the only specifier the call screen imports from.
 *
 * How one import gets two implementations
 *   Metro resolves platform extensions ahead of the bare name, for directory
 *   `index` files as well as flat ones:
 *
 *     web    →  ./camera/index.web.tsx   →  ./camera/index.ts
 *     native →  ./camera/index.native.tsx →  ./camera/index.ts
 *
 *   TypeScript understands none of that and always resolves `./camera` to
 *   `./camera/index.ts`, which is a one-line re-export of the native build.
 *   That is why every implementation annotates its hook with the matching
 *   `UseX` type from `./contract`: the module graph will never compare the two
 *   builds, so the contract has to.
 *
 * Consequences worth knowing before editing this file
 *   • This barrel is a plain `.ts` on purpose. Give it a `.web`/`.native`
 *     variant and the indirection above stops working, because Metro would
 *     resolve the *barrel* per platform and never reach the leaves.
 *   • `MeetingScreen` must import from here and never from a leaf, otherwise a
 *     platform name reappears in the screen — the thing this layer exists to
 *     remove.
 *   • Tuning constants are deliberately absent: they come from `../media/tuning`
 *     directly, so a screen that only wants `SILENCE_MS` does not pull the whole
 *     camera/recorder graph into its bundle.
 */

export * from './contract';

export { capabilities } from './capabilities';
export { useCamera } from './camera';
export { useSpeechRecognizer } from './speech';
export { useInterviewerVoice } from './tts';
export { useLevelMeter } from './level';
export { useSessionRecorder } from './recorder';
