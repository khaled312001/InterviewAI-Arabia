/**
 * Push barrel.
 *
 * Screens and the root component import from here (`../push`) and never from
 * `./device` — `isPushSupported` is the only platform question a caller is
 * allowed to ask, and the two implementations behind it are an implementation
 * detail. `store/auth.ts` is the one exception: it imports `./registration`
 * directly, because this barrel pulls in `usePushNotifications`, which imports
 * the auth store, and that round trip is an import cycle.
 */

export { DEFAULT_CHANNEL_ID } from './contract';
export type { PushMessage, PushPermission } from './contract';

export { isPushSupported } from './device';

export {
  disablePush,
  enablePush,
  maybeAskForPush,
  pushSnapshot,
  registerForPush,
  syncPushRegistration,
  unregisterPush,
} from './registration';
export type { PushFailure, PushResult, PushSnapshot } from './registration';

export { usePushNotifications } from './usePushNotifications';
