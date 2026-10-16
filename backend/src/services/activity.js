/**
 * Practice activity: streaks and the week at a glance.
 *
 * Pure functions over a list of session start times, so the arithmetic can be
 * checked without a database (scripts/check-activity.mjs) and so the app's
 * three screens that show a streak — Home, Stats, Profile — all read the same
 * number from the same place instead of each counting its own way.
 *
 * Days are the READER's days. A session at 01:00 in Cairo is 23:00 UTC the
 * previous evening; counting in UTC would credit it to the wrong day and break
 * a streak the reader kept. The client sends its offset from UTC in minutes
 * (the negation of JavaScript's getTimezoneOffset()), clamped to the real
 * range of time zones.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Clamp a client-supplied offset to what a real time zone can be (UTC-12 … UTC+14). */
export function clampOffset(raw) {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) return 0;
  return Math.max(-12 * 60, Math.min(14 * 60, n));
}

/** Local day number (days since the epoch, in the reader's time zone) of an instant. */
function localDay(date, offsetMinutes) {
  return Math.floor((date.getTime() + offsetMinutes * 60_000) / DAY_MS);
}

/**
 * @param {Date[]} startedAt   Session start instants, any order.
 * @param {number} offsetMinutes Minutes to add to UTC to get the reader's local time.
 * @param {Date}   now
 * @returns {{
 *   streakDays: number,       // consecutive days up to today (or yesterday) with ≥1 session
 *   bestStreakDays: number,   // longest run ever seen in the window
 *   practicedToday: boolean,
 *   sessionsThisWeek: number, // the last 7 local days, today included
 *   activeDaysThisWeek: number,
 *   lastSevenDays: number[],  // sessions per day, oldest → today (7 entries)
 * }}
 */
export function activitySummary(startedAt, offsetMinutes, now = new Date()) {
  const today = localDay(now, offsetMinutes);
  const perDay = new Map();
  for (const d of startedAt) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) continue;
    const day = localDay(d, offsetMinutes);
    if (day > today) continue; // clock skew: a session "tomorrow" counts for nothing
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  // Current streak. A streak is still alive on a day the reader has not
  // practised YET — it ends at midnight, not at breakfast — so counting starts
  // from yesterday when today is empty.
  const practicedToday = perDay.has(today);
  let streakDays = 0;
  for (let day = practicedToday ? today : today - 1; perDay.has(day); day -= 1) streakDays += 1;

  // Best streak: the longest run of consecutive days anywhere in the data.
  const days = [...perDay.keys()].sort((a, b) => a - b);
  let bestStreakDays = 0;
  let run = 0;
  for (let i = 0; i < days.length; i += 1) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    if (run > bestStreakDays) bestStreakDays = run;
  }

  const lastSevenDays = [];
  for (let day = today - 6; day <= today; day += 1) lastSevenDays.push(perDay.get(day) ?? 0);

  return {
    streakDays,
    bestStreakDays: Math.max(bestStreakDays, streakDays),
    practicedToday,
    sessionsThisWeek: lastSevenDays.reduce((a, b) => a + b, 0),
    activeDaysThisWeek: lastSevenDays.filter((n) => n > 0).length,
    lastSevenDays,
  };
}
