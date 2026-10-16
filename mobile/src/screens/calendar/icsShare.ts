/**
 * TypeScript-only shim, like push/reminders: Metro picks `icsShare.web.ts` or
 * `icsShare.native.ts`, and TypeScript typechecks the native one.
 */
export * from './icsShare.native';
