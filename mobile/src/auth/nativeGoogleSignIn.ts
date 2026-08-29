/**
 * Google's own account sheet, inside the app — no browser tab.
 *
 * Why this exists
 *   `expo-auth-session` runs OAuth the only way a browser can: it opens a
 *   Chrome Custom Tab, the person signs in on accounts.google.com, and the tab
 *   hands an authorization code back through a custom-scheme redirect. It
 *   works, but it looks like leaving the app to visit a website — the address
 *   bar, the loading spinner, the "return to Interprova" bounce — and on a
 *   phone that reads as a detour, not a sign-in.
 *
 *   Android already has the accounts. Google Play services knows every account
 *   on the device, so `@react-native-google-signin/google-signin` can show a
 *   native sheet listing them and return an ID token without a browser ever
 *   opening. Same protocol, same token, same backend verification — a
 *   different door.
 *
 * Which client id
 *   The **web** one, counter-intuitively. The Android OAuth client authorises
 *   the app (Google matches the installed package name and the signing
 *   certificate's SHA-1 against it) but never appears in the code; the token's
 *   `aud` is the web client id you pass to `configure()`. The backend already
 *   accepts that value — it is the same id the web button uses — so nothing
 *   changes server-side. See backend/src/routes/auth.js, googleAudiences().
 *
 * When it will NOT work, and why that is not fatal
 *   Two conditions take the native path away, and both fall back to the
 *   browser flow rather than failing:
 *
 *     • no Google Play services (custom ROMs, some Huawei devices)
 *     • DEVELOPER_ERROR — the installed build's signing certificate has no
 *       matching Android OAuth client. This is the one that bites: an app
 *       installed from Play is signed with the PLAY APP SIGNING key, while the
 *       same build installed from a local APK carries the UPLOAD key, and each
 *       fingerprint needs its own Android client. One registered fingerprint
 *       means sign-in works from exactly one of those two sources.
 *
 *   Falling back keeps the button working while the console is put right, and
 *   the warning below says exactly what to add.
 */

import { Platform } from 'react-native';

export type NativeSignInResult =
  /** Success. Post this to POST /auth/google. */
  | { kind: 'token'; idToken: string }
  /** The person closed the sheet. Not a failure; say nothing. */
  | { kind: 'cancelled' }
  /** The native path cannot run here. Caller should use the browser flow. */
  | { kind: 'unavailable'; reason: string }
  /** A real failure worth telling the user about. */
  | { kind: 'error'; reason: string };

/** `undefined` = not looked up yet, `null` = not installed / not native. */
let cached: any | null | undefined;

function load(): any | null {
  if (cached !== undefined) return cached;
  cached = null;
  // Web has its own working flow and must not pull in the native module: the
  // require would resolve to a package whose Android/iOS bindings do not exist
  // in a browser, for no benefit.
  if (Platform.OS === 'web') return cached;
  try {
    // Deliberately require(), not import: this file is imported by the shared
    // hook, and a static import would make the module a hard dependency of the
    // web bundle too.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    cached = require('@react-native-google-signin/google-signin');
  } catch {
    // Expo Go, or a build made before the package was added. The browser flow
    // still works, so this is a downgrade, not an outage.
    cached = null;
  }
  return cached;
}

/** True when the native sheet is even a possibility on this platform/build. */
export function nativeGoogleAvailable(): boolean {
  return load() !== null;
}

/** The last id we configured with, so a repeated config fetch is a no-op. */
let configuredWith: string | null = null;

/**
 * Idempotent. Safe to call on every config change.
 *
 * @param webClientId The WEB client id — see the header. Without it the sheet
 *   still signs in but returns no ID token, which is the only thing we want.
 */
export function configureNativeGoogle(webClientId: string, iosClientId?: string | null): void {
  const mod = load();
  if (!mod || !webClientId || configuredWith === webClientId) return;
  try {
    mod.GoogleSignin.configure({
      webClientId,
      // Only meaningful on iOS, and harmless as undefined elsewhere. There is
      // no iOS build yet; this is here so adding one is a config change.
      iosClientId: iosClientId || undefined,
      // We want identity, not API access on the user's behalf: no refresh
      // token, no server-side calls as them, nothing to store and leak.
      offlineAccess: false,
      scopes: ['profile', 'email'],
    });
    configuredWith = webClientId;
  } catch {
    // A configure() that throws leaves configuredWith unset, so the next call
    // retries. signIn() below will report `unavailable` in the meantime.
  }
}

/**
 * Show the account sheet and return an ID token.
 *
 * Never throws: every outcome is one of the four result kinds, because the
 * caller's job is to decide between "sign them in", "say nothing", "use the
 * browser instead" and "show an error" — and an exception makes all four look
 * the same.
 */
export async function signInWithNativeGoogle(): Promise<NativeSignInResult> {
  const mod = load();
  if (!mod) return { kind: 'unavailable', reason: 'module not present' };
  if (!configuredWith) return { kind: 'unavailable', reason: 'not configured' };

  const { GoogleSignin, statusCodes } = mod;

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  } catch (err: any) {
    return { kind: 'unavailable', reason: `play services: ${err?.code || err?.message || 'unknown'}` };
  }

  // Sign out first so the sheet always ASKS which account.
  //
  // Without it the library reuses the last account silently, and people job
  // hunt from a personal address while their phone is signed into a work one —
  // the previous browser flow passed `selectAccount: true` for the same reason.
  // Failure here is ignored: not being signed in is exactly the state we want.
  try { await GoogleSignin.signOut(); } catch { /* already signed out */ }

  try {
    const res: any = await GoogleSignin.signIn();

    // v13+ returns {type, data}; older versions returned the user object
    // directly. Reading both costs one `??` and means a routine dependency
    // bump cannot silently turn every sign-in into "cancelled".
    if (res?.type === 'cancelled') return { kind: 'cancelled' };
    const idToken: string | null = res?.data?.idToken ?? res?.idToken ?? null;
    if (idToken) return { kind: 'token', idToken };

    // Signed in, but no ID token: configure() ran without a webClientId.
    return { kind: 'unavailable', reason: 'no id token in response' };
  } catch (err: any) {
    const code = err?.code;
    if (code === statusCodes?.SIGN_IN_CANCELLED) return { kind: 'cancelled' };
    if (code === statusCodes?.IN_PROGRESS) return { kind: 'cancelled' };

    if (code === statusCodes?.PLAY_SERVICES_NOT_AVAILABLE) {
      return { kind: 'unavailable', reason: 'play services missing' };
    }

    // DEVELOPER_ERROR means Google could not match this install to an Android
    // OAuth client: wrong package, or — far more often — the right package
    // signed with a certificate whose SHA-1 was never registered.
    if (String(code) === '10' || code === statusCodes?.DEVELOPER_ERROR) {
      // eslint-disable-next-line no-console
      console.warn(
        '[google] DEVELOPER_ERROR: no Android OAuth client matches this build.\n'
        + 'Add an Android client (same Google Cloud project as the web client) for\n'
        + 'package com.interprova.app with the SHA-1 of the certificate this copy\n'
        + 'was signed with. A Play install uses the PLAY APP SIGNING key; a local\n'
        + 'APK uses the UPLOAD key. Both need their own client.\n'
        + 'Falling back to the browser sign-in for now.',
      );
      return { kind: 'unavailable', reason: 'developer error (SHA-1 / package mismatch)' };
    }

    return { kind: 'error', reason: String(code || err?.message || 'unknown') };
  }
}
