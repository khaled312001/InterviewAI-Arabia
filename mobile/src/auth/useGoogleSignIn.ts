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

/*
 * NOT called here.
 *
 * `maybeCompleteAuthSession()` is single-use, and this module's body evaluates
 * BEFORE App.tsx's (RootNavigator -> LoginScreen -> here). So a call at this
 * line consumed the handle first and left App.tsx's call returning `failed`
 * forever — the popup then rendered the whole app instead of closing.
 *
 * It now lives in ./completeAuthSession, which runs exactly once for the whole
 * program no matter who imports it first. Importing it here as well is
 * harmless and deliberate: it guarantees the redirect is completed even if
 * this screen is somehow reached without App.tsx having been evaluated.
 */
import './completeAuthSession';
import { AUTH_RELAY_KEY } from './completeAuthSession';

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
  /** Cancels the "was that a cancel or a success?" grace period. */
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  /*
   * The relay: pick the token up from localStorage instead of waiting for a
   * postMessage that COOP has already killed.
   *
   * Web only — on native the popup is a Custom Tab and the library's own
   * channel works, so this would be dead weight and a second source of truth.
   *
   * Both a `storage` event AND a poll, deliberately. The event is instant but
   * fires only in OTHER windows, and only if the popup actually reached its
   * write; the poll is the floor that catches a value written before this
   * listener was attached, or in a browser that coalesced the event away.
   */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;

    let done = false;
    const consume = () => {
      if (done) return;
      let href: string | null = null;
      try { href = window.localStorage.getItem(AUTH_RELAY_KEY); } catch { return; }
      if (!href) return;

      // Remove it before using it: a token left behind would be replayed on the
      // next mount and sign the user in again out of nowhere.
      try { window.localStorage.removeItem(AUTH_RELAY_KEY); } catch { /* ignore */ }

      // The implicit flow returns everything in the FRAGMENT, not the query.
      const hash = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
      const idToken = new URLSearchParams(hash).get('id_token');
      if (!idToken) return;

      done = true;
      // The token won the race; stop the grace period from clearing busy a
      // second time (harmless) and, more importantly, keep the two paths from
      // disagreeing about what happened.
      if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
      setBusy(false);
      handler.current(idToken);
    };

    const onStorage = (e: StorageEvent) => { if (e.key === AUTH_RELAY_KEY) consume(); };
    window.addEventListener('storage', onStorage);
    const timer = setInterval(consume, 500);
    consume();

    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(timer);
      if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
    };
  }, []);

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

    /*
     * 'cancel' and 'dismiss' are the user closing the sheet. Not failures, and
     * telling them their own action failed is noise.
     *
     * On web 'dismiss' is ALSO what the library reports when our own popup
     * closes itself after a successful sign-in — its 1s "is the popup gone?"
     * timer cannot tell the two apart. So the busy state is not cleared here on
     * web: the relay effect above clears it when the token lands, and this
     * would otherwise flip the button back to idle a moment before the user is
     * signed in, which reads as "it did nothing".
     */
    if (Platform.OS !== 'web' || response.type !== 'dismiss') {
      setBusy(false);
    } else {
      /*
       * Web + 'dismiss' is ambiguous: either the sign-in succeeded and our
       * popup closed itself, or the person shut the window. Wait briefly for
       * the relay to decide it, then give up — otherwise a real cancel leaves
       * the button spinning forever, which is the failure mode that made the
       * previous version look broken even when it worked.
       *
       * The relay writes BEFORE the popup closes, so by the time this fires it
       * has either landed or is never coming. Two seconds is generous.
       */
      dismissTimer.current = setTimeout(() => setBusy(false), 2000);
    }
    if (response.type === 'error') setFailed(true);
  }, [response]);

  const start = useCallback(() => {
    if (!request) return;
    setFailed(false);
    setBusy(true);
    // Clear any leftover from an abandoned attempt, so the relay effect cannot
    // consume a stale token the moment this one starts.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try { window.localStorage.removeItem(AUTH_RELAY_KEY); } catch { /* ignore */ }
    }
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
