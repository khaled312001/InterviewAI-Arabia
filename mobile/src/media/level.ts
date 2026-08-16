/**
 * TypeScript-only shim.
 *
 * Metro resolves `./level` to `level.web.*` on web and `level.native.*` on device,
 * so this file is never bundled. TypeScript has no concept of platform
 * extensions, so without it `./level` would not resolve at all. Pointing it at
 * the native implementation means the native surface is the one typechecked;
 * both implementations annotate their exports with the shared contract types,
 * so drift between them is still a compile error.
 */
export * from './level.native';
