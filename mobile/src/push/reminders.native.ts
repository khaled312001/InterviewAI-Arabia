/**
 * Local reminders: the daily practice nudge and the weekly progress nudge.
 *
 * Scheduled on the device, never sent by the server — they need no network,
 * they work for a reader who never enabled server push, and they cost nothing
 * to re-plan. Re-planning is the whole design: every time the app learns
 * something new (launch, back to the foreground, a finished session, a
 * changed switch) the pending reminders are thrown away and laid out again
 * from what is true NOW.
 *
 * That is what lets the daily reminder be polite. A repeating DAILY trigger
 * would fire at 8pm on the evening of a day the reader already practised,
 * which is exactly the notification that gets an app's notifications turned
 * off. Instead the next seven evenings are scheduled one by one, and today's
 * is skipped once there is a session today. The first one can then speak to
 * the reader's actual streak ("your streak is 4 days") because at planning
 * time that number is known.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import i18n from '../i18n';
import { colors } from '../theme/tokens';
import type { Activity } from '../store/progress';
import { dayCountLabel } from '../screens/mainShared';
import { permissionStatus } from './device';
import type { TopicPrefs } from './topics';

export const REMINDERS_CHANNEL_ID = 'reminders';

/** Every reminder we schedule carries this prefix, so re-planning cancels ours
 *  and nothing else. */
const ID_PREFIX = 'interprova-reminder:';
const DAYS_AHEAD = 7;
/** Friday evening: the weekend across Egypt and the Gulf, and a natural moment
 *  to look back at the week. `Date.getDay()` numbering (0 = Sunday). */
const WEEKLY_DAY = 5;
const WEEKLY_HOUR = 19;

async function ensureRemindersChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(REMINDERS_CHANNEL_ID, {
      // Its own channel, so a reader can silence reminders from the system
      // settings and keep "your evaluation is ready".
      name: i18n.t('reminders.channel'),
      description: i18n.t('reminders.channelHint'),
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: colors.primary,
      showBadge: false,
    });
  } catch {
    // Without the channel Android drops the reminder; the next plan retries.
  }
}

async function cancelPlanned() {
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter((r) => r.identifier.startsWith(ID_PREFIX))
        .map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier).catch(() => {})),
    );
  } catch {
    // Nothing scheduled, or the scheduler is unavailable: either way there is
    // nothing of ours to cancel.
  }
}

function list(key: string): string[] {
  const value = i18n.t(key, { returnObjects: true }) as unknown;
  return Array.isArray(value) ? value.map(String) : [];
}

function atHour(base: Date, dayOffset: number, hour: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, 0, 0, 0);
  return d;
}

function nextWeekly(now: Date): Date {
  const daysUntil = (WEEKLY_DAY - now.getDay() + 7) % 7;
  let at = atHour(now, daysUntil, WEEKLY_HOUR);
  if (at.getTime() <= now.getTime()) at = atHour(now, daysUntil + 7, WEEKLY_HOUR);
  return at;
}

export interface ReminderPlan {
  signedIn: boolean;
  topics: TopicPrefs;
  activity: Activity | null;
  now?: Date;
}

/**
 * Throw away our pending reminders and lay them out again.
 *
 * Never asks for permission — it only schedules when the reader has already
 * granted it. Settings is where asking happens, because that is where the
 * reader reached for a reminder switch.
 */
export async function planReminders({ signedIn, topics, activity, now = new Date() }: ReminderPlan): Promise<void> {
  await cancelPlanned();

  // A signed-out phone has nobody to remind: the streak belongs to an account.
  if (!signedIn || (!topics.practice && !topics.weekly)) return;
  if ((await permissionStatus()) !== 'granted') return;

  await ensureRemindersChannel();

  const schedule = (id: string, date: Date, title: string, body: string, route: string) =>
    Notifications.scheduleNotificationAsync({
      identifier: `${ID_PREFIX}${id}`,
      content: { title, body, data: { route } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: REMINDERS_CHANNEL_ID },
    }).catch(() => {});

  const jobs: Promise<unknown>[] = [];

  if (topics.practice) {
    const titles = list('reminders.practiceTitles');
    const bodies = list('reminders.practiceBodies');
    const practicedToday = activity?.practicedToday ?? false;
    const streak = activity?.streakDays ?? 0;
    let first = true;

    for (let day = 0; day < DAYS_AHEAD; day += 1) {
      if (day === 0 && practicedToday) continue;
      const at = atHour(now, day, topics.reminderHour);
      if (at.getTime() <= now.getTime() + 60_000) continue;

      // The streak line is only true for the very next evening: today when the
      // run is still open, tomorrow when today is already done. Any later and
      // the streak it quotes may well be gone.
      const streakApplies = first && streak > 0 && (day === 0 || (day === 1 && practicedToday));
      const pick = (arr: string[]) => (arr.length ? arr[(at.getDate() + day) % arr.length] : '');
      const title = streakApplies ? i18n.t('reminders.streakTitle') : pick(titles);
      const body = streakApplies
        ? i18n.t('reminders.streakBody', { label: dayCountLabel(streak, i18n.t.bind(i18n)) })
        : pick(bodies);
      first = false;
      if (title && body) jobs.push(schedule(`practice:${day}`, at, title, body, 'Home'));
    }
  }

  if (topics.weekly) {
    jobs.push(schedule(
      'weekly',
      nextWeekly(now),
      i18n.t('reminders.weeklyTitle'),
      i18n.t('reminders.weeklyBody'),
      'Stats',
    ));
  }

  await Promise.all(jobs);
}

/** Sign-out and "never mind": cancel everything of ours. */
export async function cancelReminders(): Promise<void> {
  await cancelPlanned();
}
