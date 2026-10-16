/**
 * Reminders, web side — inert, for the same reason as device.web.ts: the web
 * build has no notification scheduler, and expo-notifications' web entry can
 * throw at import time in a hardened browser. The Settings screen hides the
 * reminder rows there.
 */

import type { Activity } from '../store/progress';
import type { TopicPrefs } from './topics';

export const REMINDERS_CHANNEL_ID = 'reminders';

export interface ReminderPlan {
  signedIn: boolean;
  topics: TopicPrefs;
  activity: Activity | null;
  now?: Date;
}

export async function planReminders(_plan: ReminderPlan): Promise<void> {}

export async function cancelReminders(): Promise<void> {}
