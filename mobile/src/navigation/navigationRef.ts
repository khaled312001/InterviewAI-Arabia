/**
 * A navigation handle reachable from outside React.
 *
 * A notification tap arrives on a module-scope listener, not inside a screen,
 * so there is no `useNavigation()` in scope and no props to thread it through.
 * The ref is the only way the push layer can act on a tap at all.
 *
 * `isReady()` is the part that is easy to get wrong: a tap that launched the app
 * from cold is delivered *before* `NavigationContainer` has mounted, and
 * `navigate()` on an unmounted container is dropped on the floor with a warning
 * that nobody sees in a release build — the notification simply opens the home
 * screen and the user never reaches what they tapped. Callers queue through
 * `whenNavigationReady()` instead of calling `navigate()` directly, and
 * `onNavigationReady` (wired to the container's `onReady`) flushes the queue.
 */

import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './RootNavigator';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let pending: (() => void) | null = null;

/** Run `fn` now if the container is mounted, otherwise the moment it is. */
export function whenNavigationReady(fn: () => void) {
  if (navigationRef.isReady()) {
    fn();
    return;
  }
  // Only the newest survives. Two notifications tapped before the app finished
  // launching should land on the one the user tapped last, not replay both and
  // leave a stack the back button has to unwind.
  pending = fn;
}

/** Wired to `NavigationContainer`'s `onReady` in App.tsx. */
export function onNavigationReady() {
  const fn = pending;
  pending = null;
  if (fn) fn();
}
