/**
 * When we are allowed to ask for the notification permission, and what we do
 * with the answer.
 *
 * The prompt is a one-shot. On Android 13+ and on iOS a user who taps "Don't
 * allow" can only be recovered by walking into system settings, which
 * approximately nobody does. So a prompt fired on first launch — before the app
 * has delivered anything at all — does not cost us one notification, it costs
 * us every future notification for that install, permanently, and there is no
 * release we can ship that fixes it.
 *
 * This module therefore never asks on launch. There are exactly two sanctioned
 * moments, and both of them are after the user has been given something:
 *
 *   1. `maybeAskForPush()` — called from the session summary, once the user has
 *      finished an interview and is looking at their score. Only now is "we'll
 *      tell you when your evaluation is ready" a promise about something they
 *      have already seen the value of. It shows our own Arabic prompt first, so
 *      a "no" costs us the soft prompt and leaves the system one unspent.
 *   2. The Settings switch — the user reached for it themselves. `enablePush()`
 *      may prompt immediately there; nothing needs deferring when the tap *is*
 *      the request.
 *
 * The preference is per install, not per account: the OS permission is
 * device-wide and so is the FCM token. What *is* per account is the attachment.
 * Sign-out detaches the row (`unregisterPush`) and sign-in re-attaches it
 * (`syncPushRegistration`); skipping either is how the next person to sign in
 * on a shared phone starts receiving the previous person's notifications.
 *
 * Nothing here throws. Every entry point is called from a place — sign-out, a
 * settings toggle, a screen effect — where a rejected promise is a worse
 * outcome than no notifications.
 */

import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

import { api } from '../api/client';
import i18n from '../i18n';
import type { PushPermission } from './contract';
import {
  deviceToken,
  ensureChannels,
  isPushSupported,
  permissionStatus,
  requestPermission,
} from './device';

const PREFS_KEY = 'push:prefs';

/** How long a "not now" is honoured before the soft prompt may appear again. */
const SOFT_ASK_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

/** Two soft prompts across the life of the install. After that, Settings is the
 *  only way in — a third nag is how a "not now" turns into an uninstall. */
const MAX_SOFT_ASKS = 2;

interface PushPrefs {
  /** `null` means the user has never been asked and has never touched the
   *  switch. It is not the same as `false`, which is a decision we must not
   *  quietly overturn by asking again. */
  enabled: boolean | null;
  lastSoftAskAt: number | null;
  softAsks: number;
}

const DEFAULT_PREFS: PushPrefs = { enabled: null, lastSoftAskAt: null, softAsks: 0 };

let cachedPrefs: PushPrefs | null = null;

async function readPrefs(): Promise<PushPrefs> {
  if (cachedPrefs) return cachedPrefs;
  let prefs: PushPrefs;
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    prefs = raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS };
  } catch {
    // Unreadable storage means "never asked", which is the safe default: the
    // worst case is one soft prompt the user has seen before.
    prefs = { ...DEFAULT_PREFS };
  }
  cachedPrefs = prefs;
  return prefs;
}

async function writePrefs(patch: Partial<PushPrefs>): Promise<PushPrefs> {
  const next = { ...(await readPrefs()), ...patch };
  cachedPrefs = next;
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // In-memory is still correct for this session.
  }
  return next;
}

/* ---- registration ---- */

export type PushFailure = 'unsupported' | 'undetermined' | 'blocked' | 'no-token' | 'network';

export interface PushResult {
  ok: boolean;
  reason?: PushFailure;
  permission: PushPermission;
}

/**
 * The last payload we successfully POSTed.
 *
 * The token is re-sent on every launch, every sign-in and every rotation, and
 * the server upsert is idempotent — but a round trip per screen mount is not,
 * so an unchanged payload is skipped. Cleared on failure so the next attempt
 * actually retries.
 */
let lastSentPayload: string | null = null;

function registrationBody(token: string) {
  const appVersion = Constants.expoConfig?.version as string | undefined;
  return {
    token,
    platform: Platform.OS,
    // The backend groups recipients by language and sends one FCM message per
    // group, so this field is the difference between an Arabic reader getting
    // the Arabic copy and getting the English one.
    language: i18n.language.startsWith('en') ? 'en' : 'ar',
    // Absent, never null. The server has this field as `z.string().optional()`
    // (`routes/user.js` → pushRegisterSchema) and zod reads an explicit null as
    // a type error rather than as absence, so sending one 400s the entire
    // registration over a label nothing is addressed by. `Constants.expoConfig`
    // is null outside a managed build — bare, web, some dev clients — which is
    // exactly where the token matters and where the catch below would file the
    // rejection as 'network' and leave the device unregistered with no log.
    ...(appVersion ? { appVersion } : null),
  };
}

/**
 * Get a token and hand it to the server.
 *
 * `ask` defaults to false and that default is the point: everywhere except the
 * two sanctioned moments this function checks the permission and stops rather
 * than prompting.
 */
export async function registerForPush(
  opts: { ask?: boolean; force?: boolean } = {},
): Promise<PushResult> {
  if (!isPushSupported) return { ok: false, reason: 'unsupported', permission: 'unsupported' };

  // Before the token, not after. A message can arrive within seconds of the
  // permission being granted, and a message whose channel does not exist yet is
  // dropped by Android with no trace at either end.
  await ensureChannels();

  let permission = await permissionStatus();
  if (permission === 'undetermined' && opts.ask) permission = await requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission, permission };

  const token = await deviceToken();
  if (!token) return { ok: false, reason: 'no-token', permission };

  const body = registrationBody(token);
  const payload = JSON.stringify(body);
  if (!opts.force && payload === lastSentPayload) return { ok: true, permission };

  try {
    // Auth is optional on this endpoint by design — `device_tokens.user_id` is
    // nullable so a signed-out install is still reachable. The api client
    // attaches the bearer token and X-Install-Id when it has them.
    await api.post('/user/push/register', body);
    lastSentPayload = payload;
    return { ok: true, permission };
  } catch {
    // Offline, or the backend is mid-deploy. Nothing is lost: the next launch,
    // sign-in or token rotation re-sends it, so this never reaches the user as
    // an error.
    lastSentPayload = null;
    return { ok: false, reason: 'network', permission };
  }
}

/**
 * Detach this device's token from the account.
 *
 * Must run **before** the access token is cleared on sign-out: the server
 * decides whose row to detach from the caller's bearer token, and a request
 * sent after the credentials are gone detaches nothing. A token left attached
 * to a signed-out account sends the next user's notifications to the previous
 * one.
 */
export async function unregisterPush(): Promise<void> {
  if (!isPushSupported) return;
  lastSentPayload = null;
  try {
    const token = await deviceToken();
    if (!token) return;
    await api.post('/user/push/unregister', { token });
  } catch {
    // Never throws to its caller: this runs inside sign-out, and a failed
    // detach must not strand the user on a screen they asked to leave.
  }
}

/* ---- the Settings switch ---- */

export interface PushSnapshot {
  supported: boolean;
  enabled: boolean;
  permission: PushPermission;
}

/**
 * What the switch should show.
 *
 * The *effective* state, not the stored preference: a preference of "on"
 * against a permission the user revoked in system settings is off, and a
 * settings screen that says otherwise is a settings screen nobody believes
 * again.
 */
export async function pushSnapshot(): Promise<PushSnapshot> {
  if (!isPushSupported) return { supported: false, enabled: false, permission: 'unsupported' };
  const [prefs, permission] = await Promise.all([readPrefs(), permissionStatus()]);
  return {
    supported: true,
    enabled: prefs.enabled === true && permission === 'granted',
    permission,
  };
}

/** Switch flipped on. This is a sanctioned moment to prompt: the tap is the request. */
export async function enablePush(): Promise<PushResult> {
  const result = await registerForPush({ ask: true, force: true });
  // Record what actually happened, not what was asked for. Storing `true` after
  // a denial leaves a switch that reads "on" while nothing is ever delivered.
  await writePrefs({ enabled: result.ok });
  return result;
}

/** Switch flipped off. The row is detached, never deleted — the server keeps it
 *  so the same device turning notifications back on is an update, not a new row
 *  racing the old one. */
export async function disablePush(): Promise<void> {
  await writePrefs({ enabled: false });
  await unregisterPush();
}

/* ---- launch, sign-in, token rotation ---- */

/**
 * Re-assert this device's registration. Called on launch, whenever the auth
 * token changes, and when FCM rolls the device token.
 *
 * Never prompts. If the user has not opted in there is nothing to re-assert,
 * and if they opted in and later revoked the permission from system settings,
 * this is where we find out and stop lying about it.
 */
export async function syncPushRegistration(opts: { force?: boolean } = {}): Promise<void> {
  if (!isPushSupported) return;

  // The channel is created even when push is off. The user can turn it on from
  // Settings at any moment, and a channel created only after the first message
  // has already been dropped is a channel created too late.
  await ensureChannels();

  const prefs = await readPrefs();
  if (prefs.enabled !== true) return;

  const permission = await permissionStatus();
  if (permission === 'blocked' || permission === 'undetermined') {
    // Revoked from system settings since we last looked. The row on the server
    // is now a token that can never display anything, and FCM will never report
    // it dead — retire it here, and let the switch show the truth.
    await writePrefs({ enabled: false });
    await unregisterPush();
    return;
  }

  await registerForPush({ ask: false, force: opts.force });
}

/* ---- the deferred ask ---- */

/**
 * The soft prompt, shown after the user has finished an interview.
 *
 * Returns silently in every case where asking would be wrong: already decided,
 * already blocked at the OS level, asked too recently, or asked twice already.
 * The Arabic prompt is ours, so a "not now" is recoverable; only "فعّل" spends
 * the system prompt.
 */
export async function maybeAskForPush(): Promise<void> {
  if (!isPushSupported) return;

  const prefs = await readPrefs();
  if (prefs.enabled !== null) return;
  if (prefs.softAsks >= MAX_SOFT_ASKS) return;
  if (prefs.lastSoftAskAt && Date.now() - prefs.lastSoftAskAt < SOFT_ASK_COOLDOWN_MS) return;

  const permission = await permissionStatus();
  // `blocked` cannot be undone from here — only system settings can, and the
  // Settings row is where we say so. `unsupported` has nothing to ask about.
  // `granted` still gets the prompt: on Android 12 and below POST_NOTIFICATIONS
  // does not exist and the OS reports granted from the very first launch, so
  // without this branch push would never register at all on those devices.
  if (permission === 'blocked' || permission === 'unsupported') return;

  await writePrefs({ lastSoftAskAt: Date.now(), softAsks: prefs.softAsks + 1 });

  Alert.alert(
    i18n.t('push.askTitle'),
    i18n.t('push.askBody'),
    [
      // "Not now" leaves `enabled` at null on purpose: it is a deferral, not a
      // decision, and the cooldown above is what keeps it from becoming a nag.
      { text: i18n.t('push.askLater'), style: 'cancel' },
      { text: i18n.t('push.askAccept'), onPress: () => { void enablePush(); } },
    ],
    { cancelable: true },
  );
}
