/**
 * Root-level push wiring: listeners in, taps routed out.
 *
 * Mounted once, from `App`, above `NavigationContainer`. It does four things
 * that have to happen exactly once per app process:
 *
 *   - re-asserts this device's registration whenever the signed-in account
 *     changes, so a sign-in re-attaches the token to the new user and does not
 *     leave it pointing at the previous one;
 *   - re-registers when FCM rolls the device token out from under us — a rolled
 *     token is silently undeliverable, and the server has no way to learn the
 *     new one except from here;
 *   - routes a tap to the screen named in `data.route`;
 *   - refreshes the minute balance on a foreground message.
 *
 * Deep links are checked against an allow-list rather than passed straight to
 * `navigate()`. Two reasons, both of which have teeth: a route the current
 * navigator does not contain is dropped by React Navigation with a console
 * error and no user-visible effect, and the screens that *are* mounted are not
 * all safe to open cold — `Interview`, `Feedback` and `Meeting` take a live
 * session and its first question as params, so opening one from a notification
 * lands the user in an interview with no question and no session to spend
 * minutes against.
 */

import { useEffect } from 'react';
import { CommonActions } from '@react-navigation/native';

import { navigationRef, whenNavigationReady } from '../navigation/navigationRef';
import { useAuth } from '../store/auth';
import { useBalance } from '../store/balance';
import type { PushMessage } from './contract';
import {
  isPushSupported,
  lastTap,
  onMessageReceived,
  onMessageTapped,
  onTokenRotated,
} from './device';
import { syncPushRegistration } from './registration';

/** Tabs inside `Main`. Reached through the parent, never by their own name. */
const PUSH_TAB_ROUTES = new Set(['Home', 'History', 'Stats', 'Profile']);

/** Stack screens a notification may open directly. Everything absent from both
 *  sets is ignored — including `Interview`, `Feedback` and `Meeting`, which
 *  cannot be reconstructed from a data payload. */
const PUSH_STACK_ROUTES = new Set([
  'CategoryDetails',
  'SessionSummary',
  'Subscription',
  'Ledger',
  'Settings',
  'MeetingSetup',
]);

/**
 * Params for a deep-linked screen.
 *
 * `null` means "required params are missing, do not navigate at all" — opening
 * `SessionSummary` without a `sessionId` renders a screen that immediately
 * fails its own fetch, which reads as a broken notification rather than a
 * malformed one.
 */
function pushParams(route: string, data: Record<string, string>): Record<string, unknown> | null {
  if (route === 'SessionSummary') {
    return data.sessionId ? { sessionId: data.sessionId } : null;
  }
  if (route === 'CategoryDetails') {
    const categoryId = Number(data.categoryId);
    if (!Number.isFinite(categoryId)) return null;
    return { categoryId, nameAr: data.nameAr ?? '', nameEn: data.nameEn ?? '' };
  }
  if (route === 'MeetingSetup') {
    const categoryId = Number(data.categoryId);
    return Number.isFinite(categoryId) ? { categoryId } : {};
  }
  return {};
}

function openPushRoute(data: Record<string, string>) {
  const route = data.route;
  if (!route) return;

  whenNavigationReady(() => {
    // Every deep-linkable screen lives in the signed-in half of RootNavigator.
    // Pushing one while the signed-out stack is mounted is not handled by any
    // navigator, so stop here and let the user land on Onboarding as usual.
    if (!useAuth.getState().token) return;

    // Dispatched rather than `navigationRef.navigate(name, params)`, whose
    // signature demands a literal key of `RootStackParamList` — a route name
    // that only exists at runtime can only be forced past it with a `never`
    // cast, which throws away the check instead of satisfying it. The
    // allow-lists above are the real guarantee that the name is a screen.
    if (PUSH_TAB_ROUTES.has(route)) {
      // The nested form: a tab is not addressable from the stack by its own
      // name, only through the navigator that owns it.
      navigationRef.dispatch(CommonActions.navigate({ name: 'Main', params: { screen: route } }));
      return;
    }

    if (!PUSH_STACK_ROUTES.has(route)) return;
    const params = pushParams(route, data);
    if (params === null) return;
    navigationRef.dispatch(CommonActions.navigate({ name: route, params }));
  });
}

export function usePushNotifications() {
  const token = useAuth((s) => s.token);

  // Re-runs on sign-in and on sign-out. `force` skips the "same payload as last
  // time" shortcut, because the payload is identical across accounts — only the
  // bearer token the request carries is different, and that is the whole point.
  useEffect(() => {
    if (!isPushSupported) return;
    void syncPushRegistration({ force: true });
  }, [token]);

  useEffect(() => {
    if (!isPushSupported) return;

    // A cold-start tap can be delivered twice: once by the response listener,
    // which replays the pending response to a listener attached after launch,
    // and once by `lastTap()`. Both paths are kept — neither is reliable alone
    // across platforms — and the identifier is what stops the double navigate.
    const handled = new Set<string>();
    const routeOnce = (message: PushMessage) => {
      if (handled.has(message.id)) return;
      handled.add(message.id);
      openPushRoute(message.data);
    };

    const offTapped = onMessageTapped(routeOnce);

    const offRotated = onTokenRotated(() => {
      void syncPushRegistration({ force: true });
    });

    const offReceived = onMessageReceived(() => {
      // A foreground message is the one moment we know the server has news
      // about this account, and the two automatic notifiers ('low balance',
      // 'evaluation ready') both make the number already on screen stale.
      // One small GET beats showing a balance the notification contradicts.
      if (useAuth.getState().token) void useBalance.getState().refresh();
    });

    let cancelled = false;
    void lastTap().then((message) => {
      if (message && !cancelled) routeOnce(message);
    });

    return () => {
      cancelled = true;
      offTapped();
      offRotated();
      offReceived();
    };
  }, []);
}
