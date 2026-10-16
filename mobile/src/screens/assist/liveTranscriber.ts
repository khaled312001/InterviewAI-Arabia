/**
 * TypeScript-only shim.
 *
 * Metro resolves `./liveTranscriber` to `liveTranscriber.web.ts` on web and
 * `liveTranscriber.native.ts` on device, so this file is never bundled. Both
 * annotate their hook with `UseLiveTranscriber`, so drift between them is a
 * compile error. Same arrangement as the media layer's shims.
 */
export * from './liveTranscriber.native';
