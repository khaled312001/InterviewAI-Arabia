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

/** A template picked in the site's CV gallery: build a CV in it, by upload or by hand. */
export interface CvIntent { template: string; start: 'import' | 'manual' }
let cvIntent: CvIntent | null = null;

if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('signup') === '1') authEntry = 'SignUp';
    else if (params.get('login') === '1') authEntry = 'Login';
    openTarget = OPEN[String(params.get('open') || '').toLowerCase()]
      // "Buy minutes" on the pricing section links to /app?upgrade=1.
      ?? (params.get('upgrade') === '1' ? 'Subscription' : null);
    const tpl = String(params.get('tpl') || '').toLowerCase();
    if (/^[a-z0-9-]{2,40}$/.test(tpl)) {
      cvIntent = { template: tpl, start: params.get('start') === 'import' ? 'import' : 'manual' };
      openTarget = openTarget ?? 'CvBuilder';
    }
    if (['signup', 'login', 'open', 'upgrade', 'tpl', 'start'].some((k) => params.has(k))) {
      params.delete('tpl');
      params.delete('start');
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

/** The template a website link asked to build a CV in, at most once. */
export function takeCvIntent(): CvIntent | null {
  const value = cvIntent;
  cvIntent = null;
  return value;
}

/** The screen a website link asked to open, at most once. */
export function takeWebOpenTarget(): OpenTarget | null {
  const value = openTarget;
  openTarget = null;
  return value;
}
