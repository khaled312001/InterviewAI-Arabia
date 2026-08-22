/**
 * TypeScript-only shim.
 *
 * Metro resolves `./device` to `device.web.*` on web and `device.native.*` on
 * device, so this file is never bundled. TypeScript has no concept of platform
 * extensions, so without it `./device` would not resolve at all. Pointing it at
 * the native implementation means the native surface is the one typechecked;
 * both implementations annotate their exports with the shared contract types,
 * so drift between them is still a compile error.
 */
export * from './device.native';
