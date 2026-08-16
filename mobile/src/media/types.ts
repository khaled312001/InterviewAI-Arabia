/**
 * Alias for `./contract`, which is where the shared surface actually lives.
 *
 * Both names were in circulation while this layer was being written in
 * parallel. Rather than leave half the modules importing a path that does not
 * exist, this file makes `../media/types` resolve to the same bindings —
 * re-exports share one module instance, so `SPEECH_LOCALE` is still a single
 * object and the `CaptureHandle` brand is still nominal across both specifiers.
 *
 * `./contract` is the canonical import. Delete this file once nothing points at
 * `./types`.
 */

export * from './contract';
