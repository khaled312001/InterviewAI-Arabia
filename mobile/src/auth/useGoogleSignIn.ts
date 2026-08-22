/**
 * "Sign in with Google", on both platforms, from one hook.
 *
 * Shape of the flow
 *   The client never tells our backend who the user claims to be. It asks
 *   Google for an **ID token** — a short-lived JWT signed by Google and bound to
 *   one of our client ids — and posts only that. The backend verifies the
 *   signature, the issuer and the audience before it believes a single field in
 *   it. See backend/src/services/auth/googleIdentity.js.
 *
 * Why `expo-auth-session/providers/google` rather than a hand-rolled AuthRequest
 *   Because the two platforms need genuinely different OAuth flows, and getting
 *   that wrong produces a button that works in the browser and fails on every
 *   phone:
 *
 *     web      → implicit `response_type=id_token` against the WEB client id,
 *                redirecting to the page's own origin.
 *     Android  → authorization code + PKCE against the ANDROID client id,
 *                redirecting to `com.interprova.app:/oauthredirect`, then
 *                exchanging the code for the id token with no client secret.
 *
 *   A web client id will not accept a custom-scheme redirect, and an Android
 *   client id will not issue an implicit id_token — so the naive "one flow with
 *   the web client id everywhere" is rejected with `redirect_uri_mismatch` on
 *   device. The provider picks the right client id and the right flow per
 *   platform; this file only supplies the ids and reports the result.
 *
 * Why the ids come from the server
 *   They are public, but they are *deployment* facts. Baking them into the
 *   bundle would make a new Google Cloud project an app rebuild and a Play
 *   review. `GET /auth/google/config` reports them and reports `enabled:false`
 *   when unset — which is what hides the button. A control that is visible and
 *   cannot work is worse than no control.
 *
 * Why this is a callback and not `await start()`
 *   On Android the token does not exist when `promptAsync()` resolves: the
 *   provider still has to exchange the authorization code, which it does in its
 *   own effect and delivers through the `response` object. So the token arrives
 *   as an event, and awaiting the prompt would read `undefined` on every phone.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

import { api } from '../api/client';

// Closes the browser tab / Custom Tab that completed the flow. Must be called
// at module scope, which is why it is not inside the hook.
WebBrowser.maybeCompleteAuthSession();

/**
 * Where Google sends the popup back to, on web.
 *
 * Three things have to line up here, and getting any one wrong fails silently:
 *
 *  1. The page must be running our bundle. `maybeCompleteAuthSession()` is what
 *     posts the result to the opener and closes the popup, and it only runs if
 *     the app loaded. The default redirect is the bare origin, which on this
 *     deployment is the MARKETING page — the popup would sit there forever and
 *     the sign-in would resolve as "dismissed" with no error anywhere.
 *
 *  2. The TRAILING SLASH is load-bearing. `maybeCompleteAuthSession()` compares
 *     the landed URL against the requested one with `normalizeUrl`, which
 *     preserves the pathname verbatim. The server 301s `/app` → `/app/`, so a
 *     redirect registered without the slash arrives as `/app/` and fails the
 *     comparison with "Current URL and original redirect URL do not match".
 *     Requesting `/app/` outright means Google never triggers the redirect.
 *
 *  3. It must match a URI registered in Google Cloud Console character for
 *     character, or the flow dies at `redirect_uri_mismatch` before it starts.
 *
 * Native never uses this: `makeRedirectUri` returns the custom-scheme URI from
 * its `native` option first, so Android goes to com.interprova.app:/oauthredirect.
 */
export const WEB_REDIRECT_PATH = '/app/';

interface GoogleConfig {
  enabled: boolean;
  webClientId: string | null;
  androidClientId: string | null;
  iosClientId: string | null;
}

export interface GoogleSignInState {
  /** Render the button? False until the server says it is configured. */
  available: boolean;
  /** The browser is open, or the code is being exchanged. */
  busy: boolean;
  /** A failure the user should be told about. Cancels are NOT failures. */
  failed: boolean;
  clearFailure: () => void;
  /** Opens the Google sheet. The token arrives via `onIdToken`. */
  start: () => void;
}

/**
 * @param onIdToken Called once per successful sign-in with the raw ID token.
 *   Keep it stable or cheap — it is held in a ref, so a new identity each
 *   render is fine and will not re-run the flow.
 */
export function useGoogleSignIn(onIdToken: (idToken: string) => void): GoogleSignInState {
  const [config, setConfig] = useState<GoogleConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  const handler = useRef(onIdToken);
  useEffect(() => { handler.current = onIdToken; });

  useEffect(() => {
    mounted.current = true;
    api.get('/auth/google/config')
      .then((r) => { if (mounted.current) setConfig(r.data); })
      // A failure here means "no button", never a visible error: the user has
      // not asked for anything yet.
      .catch(() => { if (mounted.current) setConfig(null); })
      .finally(() => { /* keep the ref honest for the unmount guard below */ });
    return () => { mounted.current = false; };
  }, []);

  /*
   * The hook is called unconditionally, as React requires, and the ids are
   * empty strings until the config lands. Empty is deliberate rather than
   * `undefined`: the provider's `invariantClientId` THROWS on undefined, and a
   * throw here would take down the whole sign-in screen while the config
   * request is still in flight. An empty id builds a request nobody can
   * prompt, because `available` gates the only caller.
   */
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: config?.webClientId ?? '',
    androidClientId: config?.androidClientId ?? '',
    iosClientId: config?.iosClientId ?? '',
    // Let the user pick which Google account, rather than silently reusing the
    // one the phone is already signed into — people job-hunt from a personal
    // address and browse from a work one.
    selectAccount: true,
    // Explicit on web, and UNDEFINED on native so the provider falls through to
    // its own custom-scheme redirect. See WEB_REDIRECT_PATH.
    redirectUri: Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin + WEB_REDIRECT_PATH
      : undefined,
  });

  useEffect(() => {
    if (!response) return;

    if (response.type === 'success') {
      const idToken = (response.params as Record<string, string> | undefined)?.id_token
        || response.authentication?.idToken;
      if (idToken) {
        setBusy(false);
        handler.current(idToken);
      }
      // No `else`: on Android a 'success' with no id_token yet is the code
      // waiting to be exchanged, and the effect runs again when it lands.
      return;
    }

    // 'cancel' and 'dismiss' are the user closing the sheet. Not failures, and
    // telling them their own action failed is noise.
    setBusy(false);
    if (response.type === 'error') setFailed(true);
  }, [response]);

  const start = useCallback(() => {
    if (!request) return;
    setFailed(false);
    setBusy(true);
    // Fire and forget: the token arrives through `response`, not from here.
    promptAsync().catch(() => {
      setBusy(false);
      setFailed(true);
    });
  }, [promptAsync, request]);

  return {
    available: Boolean(config?.enabled && request),
    busy,
    failed,
    clearFailure: useCallback(() => setFailed(false), []),
    start,
  };
}
