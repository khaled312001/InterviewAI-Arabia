/**
 * Where a link from the website should land inside the web app.
 *
 * The site links to `/app?signup=1` ("Create account"), `/app?login=1`
 * ("Sign in") and `/app?open=dashboard` ("My dashboard"). This module reads
 * those once, at load, and removes them from the address bar so a refresh does
 * not replay them — the same pattern as calendar/calendarReturn.ts.
 *
 * `open` survives signing in: Home takes it on its first render, which for a
 * signed-out visitor is right after they sign in or create the account.
 */

import { Platform } from 'react-native';

export type AuthEntry = 'SignUp' | 'Login';
export type OpenTarget = 'Dashboard' | 'CareerHub' | 'CvBuilder' | 'Subscription' | 'Calendar' | 'AssistSetup';

const OPEN: Record<string, OpenTarget> = {
  dashboard: 'Dashboard',
  career: 'CareerHub',
  cv: 'CvBuilder',
  plans: 'Subscription',
  calendar: 'Calendar',
  assist: 'AssistSetup',
};

let authEntry: AuthEntry | null = null;
let openTarget: OpenTarget | null = null;

if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('signup') === '1') authEntry = 'SignUp';
    else if (params.get('login') === '1') authEntry = 'Login';
    openTarget = OPEN[String(params.get('open') || '').toLowerCase()]
      // "Buy minutes" on the pricing section links to /app?upgrade=1.
      ?? (params.get('upgrade') === '1' ? 'Subscription' : null);
    if (['signup', 'login', 'open', 'upgrade'].some((k) => params.has(k))) {
      params.delete('signup');
      params.delete('login');
      params.delete('open');
      params.delete('upgrade');
      const rest = params.toString();
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`,
      );
    }
  } catch {
    /* no URLSearchParams/history — the app opens as usual */
  }
}

/** The signed-out screen a website link asked for, if any. */
export function webAuthEntry(): AuthEntry | null {
  return authEntry;
}

/** The screen a website link asked to open, at most once. */
export function takeWebOpenTarget(): OpenTarget | null {
  const value = openTarget;
  openTarget = null;
  return value;
}
