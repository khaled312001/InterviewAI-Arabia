/**
 * The web half of the Google connect flow: coming back.
 *
 * The backend's OAuth callback redirects the browser to `/app/?calendar=…`.
 * The whole SPA reloads, so whatever was on screen is gone and Home is the
 * first thing rendered. This module reads the result out of the address bar
 * ONCE, at load, removes it (so a refresh does not replay it) and holds it
 * until Home hands it to the Calendar screen.
 *
 * `Platform.OS` is the guard, not `typeof window`: React Native defines
 * `window` but not `window.location` (see auth/completeAuthSession.ts, Bug 3).
 */

import { Platform } from 'react-native';

export interface CalendarReturn {
  status: 'connected' | 'error';
  reason: string | null;
}

let pending: CalendarReturn | null = null;

if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
  try {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('calendar');
    if (status === 'connected' || status === 'error') {
      pending = { status, reason: params.get('reason') };
      params.delete('calendar');
      params.delete('reason');
      const rest = params.toString();
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`,
      );
    }
  } catch {
    /* a browser without URLSearchParams/history — nothing to hand over */
  }
}

/** The result of a web connect flow that just landed, at most once. */
export function takeCalendarReturn(): CalendarReturn | null {
  const value = pending;
  pending = null;
  return value;
}
