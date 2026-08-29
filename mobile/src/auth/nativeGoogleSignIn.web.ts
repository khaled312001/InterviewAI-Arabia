/**
 * The web half of ./nativeGoogleSignIn — deliberately empty.
 *
 * Metro resolves `.web.ts` ahead of `.ts` when bundling for web, so this file
 * is what the browser gets and the native module is never reached by the web
 * bundler at all.
 *
 * That matters more than it looks. A `require()` inside a `Platform.OS` guard
 * is skipped at RUNTIME but still followed at BUILD time: Metro walks every
 * require it can see and bundles the target regardless of the branch that
 * guards it. `@react-native-google-signin/google-signin` publishes no browser
 * entry, so pulling it into the web bundle means shipping a module whose
 * bindings do not exist there — and its top-level code would run before ours.
 * A throw at module scope takes down the whole bundle rather than one screen;
 * that is how `/app/` went dark once already.
 *
 * Web has a complete, working sign-in of its own — the popup flow in
 * ./useGoogleSignIn — so there is nothing to implement here. `unavailable` is
 * the honest answer, and the caller already knows what to do with it: use the
 * browser flow.
 */

import type { NativeSignInResult } from './nativeGoogleSignIn';

export type { NativeSignInResult };

export function nativeGoogleAvailable(): boolean {
  return false;
}

export function configureNativeGoogle(_webClientId: string, _iosClientId?: string | null): void {
  /* no native sheet in a browser */
}

export async function signInWithNativeGoogle(): Promise<NativeSignInResult> {
  return { kind: 'unavailable', reason: 'web' };
}
