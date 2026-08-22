/**
 * Firebase Cloud Messaging, web side — deliberately inert.
 *
 * The web bundle is deployed to interview.khaledahmed.net/app, and browser push
 * is a different mechanism end to end: a service worker, a VAPID key pair and a
 * `PushSubscription` object, none of which this deployment has and none of
 * which the backend can address — `sendToTokens()` talks to firebase-admin,
 * which sends to FCM *device* tokens and nothing else.
 *
 * Why this file exists rather than a `Platform.OS` check at each call site:
 * expo-notifications' web entry reaches for `navigator.serviceWorker` and
 * `Notification` while the module is evaluating. In a browser that blocks
 * either — a hardened profile, an insecure origin, an in-app webview — that is
 * a throw at *import* time, before React renders anything, and an import-time
 * throw in the root bundle is a white page, not a degraded feature.
 *
 * So every answer here is "no", in exactly the shape `device.native.ts`
 * returns. Callers never branch on the platform; they read `isPushSupported`,
 * and the Settings screen simply does not render the row.
 */

import type {
  DeviceToken,
  EnsureChannels,
  LastTap,
  OnMessageReceived,
  OnMessageTapped,
  OnTokenRotated,
  PermissionStatus,
  RequestPermission,
} from './contract';

export const isPushSupported = false;

const noop = () => {};

export const ensureChannels: EnsureChannels = async () => {};

export const permissionStatus: PermissionStatus = async () => 'unsupported';

export const requestPermission: RequestPermission = async () => 'unsupported';

export const deviceToken: DeviceToken = async () => null;

export const onTokenRotated: OnTokenRotated = () => noop;

export const onMessageReceived: OnMessageReceived = () => noop;

export const onMessageTapped: OnMessageTapped = () => noop;

export const lastTap: LastTap = async () => null;
