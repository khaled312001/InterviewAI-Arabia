/**
 * The three notification topics under the master switch in Settings.
 *
 * They used to be three switches that saved a boolean and did nothing else —
 * no reminder was ever scheduled and "product news: off" did not keep a single
 * broadcast away. Each one now has a job:
 *
 *   - `practice`: a local reminder at the reader's chosen hour, on days they have
 *     not practised yet (see ./reminders).
 *   - `weekly`: a local nudge once a week to look at their progress.
 *   - `product`: sent to the server with the device registration. Off means
 *     the device is left out of admin broadcasts; the reader's own account
 *     notifications — evaluation ready, low balance — are not affected.
 *
 * Stored under the same key the decorative switches used, so a choice someone
 * already made carries over instead of being reset by the update.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type NotificationTopic = 'practice' | 'weekly' | 'product';

export interface TopicPrefs {
  practice: boolean;
  weekly: boolean;
  product: boolean;
  /** Local hour (0–23) the practice reminder fires at. */
  reminderHour: number;
}

const STORAGE_KEY = 'settings:notifications';

/**
 * Everything opt-in. The permission prompt promises "one notification when
 * your evaluation is ready and a warning before your minutes run out" — a
 * daily reminder nobody asked for would break that promise the first evening.
 */
export const DEFAULT_TOPICS: TopicPrefs = {
  practice: false,
  weekly: false,
  product: false,
  reminderHour: 20,
};

/** The reminder times offered in Settings (local hours). */
export const REMINDER_HOURS = [9, 13, 18, 20, 22] as const;

let cached: TopicPrefs | null = null;
const listeners = new Set<(prefs: TopicPrefs) => void>();

function sanitise(raw: unknown): TopicPrefs {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<TopicPrefs>;
  const hour = Number(src.reminderHour);
  return {
    practice: typeof src.practice === 'boolean' ? src.practice : DEFAULT_TOPICS.practice,
    weekly: typeof src.weekly === 'boolean' ? src.weekly : DEFAULT_TOPICS.weekly,
    product: typeof src.product === 'boolean' ? src.product : DEFAULT_TOPICS.product,
    reminderHour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_TOPICS.reminderHour,
  };
}

export async function readTopics(): Promise<TopicPrefs> {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    cached = sanitise(raw ? JSON.parse(raw) : null);
  } catch {
    cached = { ...DEFAULT_TOPICS };
  }
  return cached;
}

export async function writeTopics(patch: Partial<TopicPrefs>): Promise<TopicPrefs> {
  const next = sanitise({ ...(await readTopics()), ...patch });
  cached = next;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // In memory is still right for this session.
  }
  listeners.forEach((fn) => fn(next));
  return next;
}

export function onTopicsChanged(fn: (prefs: TopicPrefs) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
