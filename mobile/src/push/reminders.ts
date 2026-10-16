/**
 * TypeScript-only shim, like ./device: Metro picks `reminders.web.ts` or
 * `reminders.native.ts`, and TypeScript typechecks the native one.
 */
export * from './reminders.native';
