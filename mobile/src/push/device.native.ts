/**
 * Firebase Cloud Messaging, native side.
 *
 * Everything in this file is a silent-failure trap rather than a mechanism,
 * which is the only reason it is a file and not four inline calls:
 *
 *   1. **The channel.** Android 8+ drops a notification whose `channelId` names
 *      a channel the app never created. No exception, no log, nothing in the
 *      tray — indistinguishable from the backend never having sent it. Our
 *      backend stamps every message with `channelId: 'default'`, so
 *      `ensureChannels()` must have run before the first message arrives.
 *   2. **The token.** `getDevicePushTokenAsync()` returns the raw FCM
 *      registration token, which is what `firebase-admin` on the server sends
 *      to. `getExpoPushTokenAsync()` returns an `ExponentPushToken[...]` string
 *      that only Expo's relay understands and that `sendToTokens()` would
 *      reject one token at a time, forever.
 *   3. **The permission.** Asking is a one-shot on Android 13+ and on iOS. A
 *      denial is permanent until the user walks into system settings. Nothing
 *      here asks on its own — `registration.ts` owns *when*, and this file only
 *      does what it is told.
 *
 * Every call is wrapped. A build without google-services.json, an emulator with
 * no Play Services, a first launch in airplane mode and a revoked permission
 * all arrive here as an exception, and not one of them is a reason to take an
 * interview app down.
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import i18n from '../i18n';
import { colors } from '../theme/tokens';
import {
  DEFAULT_CHANNEL_ID,
  type DeviceToken,
  type EnsureChannels,
  type LastTap,
  type OnMessageReceived,
  type OnMessageTapped,
  type OnTokenRotated,
  type PermissionStatus,
  type PushMessage,
  type PushPermission,
  type RequestPermission,
} from './contract';

export const isPushSupported = true;

/**
 * Foreground presentation, installed at module scope on purpose.
 *
 * expo-notifications reads this handler at the moment a notification lands, and
 * a notification can land during the very first render. Setting it from an
 * effect means the first foreground push of a cold start is swallowed with no
 * banner and no way to get it back.
 *
 * The badge is deliberately left alone: nothing in this app maintains an unread
 * count, and a badge that only ever increments is worse than no badge.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    /*
     * SDK 52+ split the old `shouldShowAlert` into two, because iOS 14 did:
     * a notification can appear as a banner, in Notification Centre's list,
     * or both. Both are wanted here — the banner catches someone looking at
     * the screen, the list catches someone who was not.
     *
     * `shouldShowAlert` is kept alongside them for older native runtimes that
     * still read it; the newer fields are ignored there and vice versa.
     */
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/* ---- channels ---- */

export const ensureChannels: EnsureChannels = async () => {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL_ID, {
      // The name and description are what the user reads in the OS notification
      // settings for this app, so they are translated. Re-setting an existing
      // channel updates both, which is how a language switch stays honest.
      name: i18n.t('push.channelDefault'),
      description: i18n.t('push.channelDefaultHint'),
      // HIGH, not DEFAULT: the backend sends `priority: high` to wake a dozing
      // device, and a low-importance channel throws that away — the message
      // then arrives whenever Android next feels like it, which for "your
      // evaluation is ready" can be an hour.
      importance: Notifications.AndroidImportance.HIGH,
      // Notification bodies quote the user's own interview results. Private
      // keeps them off a locked screen without hiding that something arrived.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      lightColor: colors.primary,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
      showBadge: false,
    });
  } catch {
    // Nothing the user can act on and nothing worth retrying in a loop: if the
    // channel cannot be created, messages will be dropped by Android and the
    // next launch gets another attempt.
  }
};

/* ---- permission ---- */

function toPermission(status: Notifications.NotificationPermissionsStatus): PushPermission {
  // iOS "provisional" authorisation delivers quietly to the notification centre
  // without ever having prompted. Messages do arrive, so it is granted.
  if (status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return 'granted';
  }
  // `canAskAgain: false` is the one state a switch in our own UI cannot fix.
  return status.canAskAgain ? 'undetermined' : 'blocked';
}

export const permissionStatus: PermissionStatus = async () => {
  try {
    return toPermission(await Notifications.getPermissionsAsync());
  } catch {
    return 'unsupported';
  }
};

export const requestPermission: RequestPermission = async () => {
  try {
    return toPermission(
      await Notifications.requestPermissionsAsync({
        // Badge is not requested because nothing sets one; asking for a
        // capability we never use is a permission line the user pays for and
        // gets nothing back from.
        ios: { allowAlert: true, allowBadge: false, allowSound: true },
      }),
    );
  } catch {
    return 'unsupported';
  }
};

/* ---- token ---- */

export const deviceToken: DeviceToken = async () => {
  // The iOS Simulator has no APNs connection at all and throws here. An Android
  // emulator with Play Services *does* get a real FCM token, so `Device.isDevice`
  // must not gate both platforms — doing that makes on-emulator testing of the
  // whole feature impossible.
  if (Platform.OS === 'ios' && !Device.isDevice) return null;
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    // `data` is typed `any` for the implicit platform variant and is an object
    // (not a string) on web. Only a non-empty string is an FCM/APNs token.
    return typeof token.data === 'string' && token.data.length > 0 ? token.data : null;
  } catch {
    // No google-services.json baked into the build, no Play Services, or no
    // network on first launch. All three are "ask again later".
    return null;
  }
};

/* ---- listeners ---- */

function toMessage(notification: Notifications.Notification): PushMessage {
  const content = notification.request.content;
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(content.data ?? {})) {
    if (value !== null && value !== undefined) data[key] = String(value);
  }
  return {
    id: notification.request.identifier,
    title: content.title ?? null,
    body: content.body ?? null,
    data,
  };
}

export const onTokenRotated: OnTokenRotated = (listener) => {
  const subscription = Notifications.addPushTokenListener((token) => {
    if (typeof token.data === 'string' && token.data.length > 0) listener(token.data);
  });
  return () => subscription.remove();
};

export const onMessageReceived: OnMessageReceived = (listener) => {
  const subscription = Notifications.addNotificationReceivedListener((notification) => {
    listener(toMessage(notification));
  });
  return () => subscription.remove();
};

export const onMessageTapped: OnMessageTapped = (listener) => {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    listener(toMessage(response.notification));
  });
  return () => subscription.remove();
};

export const lastTap: LastTap = async () => {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;
    const message = toMessage(response.notification);
    try {
      // Android keeps the last response across app restarts. Left uncleared,
      // every future cold start re-opens a notification the user tapped once,
      // days ago — the app appears to "jump" to a random screen on launch.
      await Notifications.clearLastNotificationResponseAsync();
    } catch {
      // Not implemented on every platform; the caller de-duplicates by id.
    }
    return message;
  } catch {
    return null;
  }
};
