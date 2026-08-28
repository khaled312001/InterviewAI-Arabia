/**
 * Finish an OAuth redirect that landed in THIS window — exactly once, and
 * without trusting anything that can be taken away by a cross-origin policy.
 *
 * ── Bug 1: called twice, and it is single-use ──────────────────────────────
 * `WebBrowser.maybeCompleteAuthSession()` looks for a handle in `localStorage`
 * that the opener wrote, and DELETES it on success. A second call finds nothing
 * and returns `failed`.
 *
 * It was called at module scope in two files, and ES module bodies always
 * evaluate before the body of the module importing them:
 *
 *   App.tsx → RootNavigator → LoginScreen → useGoogleSignIn.ts  ← called FIRST
 *   …then App.tsx's own body                                    ← called SECOND
 *
 * So App.tsx's call could never win. Both call sites were individually correct;
 * only their order was wrong, and nothing in either file hinted the other
 * existed. Fixed by calling it once, here — a module body runs at most once per
 * program however many modules import it.
 *
 * ── Bug 2: the verdict itself is not trustworthy ───────────────────────────
 * Gating on that function's return value was still wrong, because it can report
 * `failed` on a redirect that genuinely succeeded. It compares the landed URL
 * against a stored one and needs the opener's handle to still be present — and
 * the popup has just been navigated through Google's sign-in pages, which send
 * `Cross-Origin-Opener-Policy: same-origin`. That severs the opener
 * relationship, and any of its bookkeeping can be lost with it.
 *
 * So this file no longer asks the library whether a redirect happened. It reads
 * the ground truth: **is there an `id_token` in the URL fragment?** Only an
 * OAuth implicit-flow redirect puts one there. That fact survives COOP, a lost
 * handle, a renamed storage key, and a URL-normalisation mismatch, because it
 * is in the address bar rather than in anyone's storage.
 *
 * The library is still called — it does its own internal cleanup and may
 * succeed in messaging the opener when COOP has not interfered — but its
 * verdict is advisory. Nothing here depends on it.
 */

import * as WebBrowser from 'expo-web-browser';

/**
 * Where the popup leaves the redirect URL for the opener to find.
 *
 * ── Why a second channel is needed at all ──────────────────────────────────
 * Closing the popup fixes what the user SEES and breaks what they get.
 *
 * The opener resolves `openAuthSessionAsync()` from whichever of three things
 * happens first:
 *
 *   a. a `message` from the popup — sent to `window.opener ?? window.parent`.
 *      COOP severs `opener`, and the fallback `window.parent` of a top-level
 *      window is the window ITSELF, so the popup posts the token to itself.
 *
 *   b. an AppState change to 'active' — which would read the URL back out of
 *      storage, except that on web AppState follows `visibilitychange`, and the
 *      opener document is never hidden by a popup opening in front of it. The
 *      state never CHANGES, so the listener never runs.
 *
 *   c. a 1-second interval that sees `popupWindow.closed` and resolves
 *      **`dismiss`**.
 *
 * With (a) and (b) dead, closing the popup guarantees (c): the flow ends as
 * "the user cancelled" and the hook correctly does nothing. The window would
 * vanish and the person would still be signed out — which looks like success
 * and is therefore worse than the bug it replaced.
 *
 * `localStorage` is shared by every same-origin window and fires a `storage`
 * event in the others. It is not a window reference, so COOP cannot touch it.
 */
export const AUTH_RELAY_KEY = 'interprova.auth.relay';

/** The implicit flow returns its result in the FRAGMENT, never the query. */
function idTokenInFragment(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash || '';
  const hash = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!hash) return null;
  try {
    return new URLSearchParams(hash).get('id_token');
  } catch {
    return null;
  }
}

/**
 * True when this window is an OAuth redirect landing.
 *
 * Read from the address bar, not from storage, and not from the library — see
 * "Bug 2" above for why every other signal here is defeatable.
 */
export const authRedirectLanded = idTokenInFragment() !== null;

// Advisory only. Wrapped because it throws a CodedError when it cannot find any
// window to message, and a throw at module scope would take down the bundle —
// leaving a blank page instead of a sign-in.
try {
  WebBrowser.maybeCompleteAuthSession();
} catch {
  /* the relay below is the channel that actually matters */
}

if (authRedirectLanded && typeof window !== 'undefined') {
  /*
   * Order matters. Hand the token over FIRST, then close: a close that beats
   * the write loses the sign-in entirely, and the window is gone so there is
   * nothing left to retry from.
   */
  try {
    window.localStorage.setItem(AUTH_RELAY_KEY, window.location.href);
  } catch {
    /* private mode or storage disabled — the library's channel is all that is
       left, and it may still work if COOP did not sever the opener */
  }

  try {
    window.close();
  } catch {
    /* A window that script did not open cannot be closed by script. App.tsx
       shows a brief "completing sign-in" state and then falls through to the
       normal app, where the same relay value signs this window in instead. */
  }
}
