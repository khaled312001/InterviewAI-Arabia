/**
 * The push layer's shared surface — every type both platforms must agree on.
 *
 * Why a contract file at all
 *   Metro resolves `./device` to `device.web.ts` on web and `device.native.ts`
 *   on device; TypeScript understands neither and only ever sees `device.ts`.
 *   So the two implementations are never typechecked against each other by the
 *   module graph, and the web one is the one nobody runs on a phone — it is
 *   exactly where a silently wrong signature survives to production. Each
 *   implementation annotates its exports with the function types below, which
 *   makes drift a compile error instead of a dead notification on one platform.
 *
 * The rule for this file
 *   Types and plain data only. No `expo-notifications` import, no `react-native`
 *   runtime import, no DOM global — it is parsed on every platform and by every
 *   module in `src/push`, so anything with a side effect here becomes
 *   everyone's problem.
 */

/**
 * The Android notification channel every message from our backend targets.
 *
 * This string is a contract with the server, not a local choice:
 * `backend/src/services/push/fcm.js` → `buildMessage()` stamps
 * `android.notification.channelId = 'default'` on every message it builds.
 * Android 8+ **silently drops** a notification whose channel the app never
 * created — no error, no log line, nothing in the tray — so if this id and the
 * server's ever stop matching, push does not break loudly, it just stops
 * existing.
 */
export const DEFAULT_CHANNEL_ID = 'default';

/**
 * What the OS currently allows.
 *
 * `blocked` is the state that matters: the user was asked once and said no, and
 * on both Android 13+ and iOS nothing in the app can ask again. Only system
 * settings can undo it, which is why it is a separate value from
 * `undetermined` rather than both collapsing into "not granted" — the UI has to
 * say two different things.
 */
export type PushPermission = 'granted' | 'undetermined' | 'blocked' | 'unsupported';

/**
 * A notification, flattened to the only three things this app reads.
 *
 * `data` is stringified on the way in. FCM carries data payloads as strings on
 * the wire, but the two native bridges disagree about what they hand back for
 * a numeric-looking value, and `data.route === 'SessionSummary'` must not
 * depend on which platform parsed the message.
 */
export interface PushMessage {
  /** The platform's own notification identifier — used to avoid handling the
   *  same tap twice when a cold start delivers it through both paths. */
  id: string;
  title: string | null;
  body: string | null;
  data: Record<string, string>;
}

export type Unsubscribe = () => void;

/* ---- The device surface, pinned ---- */

/** Creates the Android channel(s). Safe to call repeatedly; a no-op elsewhere. */
export type EnsureChannels = () => Promise<void>;

/** Reads the current permission without any user-facing effect. */
export type PermissionStatus = () => Promise<PushPermission>;

/** Shows the system prompt. One shot per install — see `registration.ts`. */
export type RequestPermission = () => Promise<PushPermission>;

/** The raw FCM/APNs registration token, or null when there is none to be had. */
export type DeviceToken = () => Promise<string | null>;

/** Fires when the push service rolls the token out from under us. */
export type OnTokenRotated = (listener: (token: string) => void) => Unsubscribe;

/** Fires while the app is in the foreground. */
export type OnMessageReceived = (listener: (message: PushMessage) => void) => Unsubscribe;

/** Fires when the user taps a notification. */
export type OnMessageTapped = (listener: (message: PushMessage) => void) => Unsubscribe;

/** The tap that launched the app from cold, if there was one. */
export type LastTap = () => Promise<PushMessage | null>;
