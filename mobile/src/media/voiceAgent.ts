/**
 * TypeScript-only shim.
 *
 * Metro resolves `./voiceAgent` to `voiceAgent.web.ts` on web and
 * `voiceAgent.native.ts` on device, so this file is never bundled. Pointing it
 * at the native implementation means the native surface is the one
 * typechecked; both annotate their export with `UseVoiceAgent`, so drift
 * between them is a compile error rather than a runtime one.
 */
export * from './voiceAgent.native';
