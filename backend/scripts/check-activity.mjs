// node scripts/check-activity.mjs — asserts the streak arithmetic in src/services/activity.js.
import assert from 'node:assert/strict';
import { activitySummary, clampOffset } from '../src/services/activity.js';

const now = new Date('2026-09-21T10:00:00Z');           // 13:00 in Cairo (UTC+3)
const at = (iso) => new Date(iso);
const CAIRO = 180;

// No sessions at all.
let s = activitySummary([], CAIRO, now);
assert.deepEqual([s.streakDays, s.bestStreakDays, s.sessionsThisWeek, s.practicedToday], [0, 0, 0, false]);
assert.deepEqual(s.lastSevenDays, [0, 0, 0, 0, 0, 0, 0]);

// Today, yesterday, the day before: a 3-day streak.
s = activitySummary([at('2026-09-21T08:00Z'), at('2026-09-20T08:00Z'), at('2026-09-19T08:00Z')], CAIRO, now);
assert.equal(s.streakDays, 3); assert.equal(s.practicedToday, true);

// Nothing yet today, but yesterday and before: the streak is still alive.
s = activitySummary([at('2026-09-20T08:00Z'), at('2026-09-19T08:00Z')], CAIRO, now);
assert.equal(s.streakDays, 2); assert.equal(s.practicedToday, false);

// Last session two days ago: the streak is over, the best run remembers it.
s = activitySummary([at('2026-09-19T08:00Z'), at('2026-09-18T08:00Z')], CAIRO, now);
assert.equal(s.streakDays, 0); assert.equal(s.bestStreakDays, 2);

// 22:30 UTC on the 20th is 01:30 on the 21st in Cairo — it counts as TODAY there.
s = activitySummary([at('2026-09-20T22:30Z')], CAIRO, now);
assert.equal(s.practicedToday, true);
s = activitySummary([at('2026-09-20T22:30Z')], 0, now);
assert.equal(s.practicedToday, false, 'in UTC the same session was yesterday');

// Two sessions on one day are one day of streak, two sessions of the week.
s = activitySummary([at('2026-09-21T07:00Z'), at('2026-09-21T09:00Z')], CAIRO, now);
assert.equal(s.streakDays, 1); assert.equal(s.sessionsThisWeek, 2); assert.equal(s.activeDaysThisWeek, 1);
assert.equal(s.lastSevenDays[6], 2);

// Offsets are clamped to real time zones, and garbage is UTC.
assert.equal(clampOffset('9999'), 840); assert.equal(clampOffset('-9999'), -720); assert.equal(clampOffset('x'), 0);

console.log('activity: all checks passed');
