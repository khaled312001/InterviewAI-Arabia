/**
 * Keeps the local reminders in step with what the app knows.
 *
 * Mounted once, from App. Re-plans (see ./reminders) whenever any input
 * changes: the account signs in or out, the streak moves, a reminder switch is
 * flipped, the language changes (the reminder text is written at planning
 * time), and whenever the app comes back to the foreground — which is also
 * when the stats are re-read, since a session finished on the web counts too.
 */

import { useEffect } from 'react';
import { AppState } from 'react-native';

import { onLanguageChanged } from '../i18n';
import { useAuth } from '../store/auth';
import { useProgress } from '../store/progress';
import { planReminders } from './reminders';
import { onTopicsChanged, readTopics } from './topics';

/** Coalesces a burst of changes (sign-in brings a token, then stats) into one plan. */
const SETTLE_MS = 400;

export function useReminderPlanner() {
  const token = useAuth((s) => s.token);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const replan = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void (async () => {
          const topics = await readTopics();
          await planReminders({
            signedIn: !!useAuth.getState().token,
            topics,
            activity: useProgress.getState().stats?.activity ?? null,
          });
        })().catch(() => {});
      }, SETTLE_MS);
    };

    // Signed in: fetch the streak, which re-plans when it lands.
    if (token) void useProgress.getState().refresh();
    replan();

    const offStats = useProgress.subscribe((state, prev) => {
      if (state.stats?.activity !== prev.stats?.activity) replan();
    });
    const offTopics = onTopicsChanged(replan);
    const offLanguage = onLanguageChanged(replan);
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (useAuth.getState().token) void useProgress.getState().refresh();
      replan();
    });

    return () => {
      if (timer) clearTimeout(timer);
      offStats();
      offTopics();
      offLanguage();
      sub.remove();
    };
  }, [token]);
}
