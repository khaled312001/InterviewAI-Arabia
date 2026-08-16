/**
 * TypeScript-only shim.
 *
 * Metro resolves `./capabilities` to `capabilities.web.*` on web and `capabilities.native.*` on device,
 * so this file is never bundled. TypeScript has no concept of platform
 * extensions, so without it `./capabilities` would not resolve at all. Pointing it at
 * the native implementation means the native surface is the one typechecked;
 * both implementations annotate their exports with the shared contract types,
 * so drift between them is still a compile error.
 */
export * from './capabilities.native';
