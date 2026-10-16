/**
 * The reader's progress: `GET /api/user/stats`, fetched once and shared.
 *
 * Home shows the streak and the week, Stats shows everything, Profile shows a
 * summary. Each used to be its own request with its own idea of the numbers —
 * so the streak on Home could say 3 while Stats, loaded a minute later, said 4.
 * One store, one response, one number.
 *
 * The streak is counted by the SERVER in the reader's own days: the request
 * carries the device's offset from UTC (`tz`, in minutes), because a session at
 * 01:00 Cairo time is still "yesterday" in UTC and would otherwise break a
 * streak the reader actually kept.
 */

import { create } from 'zustand';
import { api } from '../api/client';

export interface Activity {
  /** Consecutive days up to today — or up to yesterday, if today is still open. */
  streakDays: number;
  bestStreakDays: number;
  practicedToday: boolean;
  /** Sessions in the last seven days, today included. */
  sessionsThisWeek: number;
  activeDaysThisWeek: number;
  /** Sessions per day, oldest first, today last. Always seven entries. */
  lastSevenDays: number[];
}

export interface StatsResponse {
  totalSessions: number;
  totalAnswers: number;
  averageScore: number;
  categoryBreakdown: {
    categoryId: number;
    _count?: { _all?: number };
    _avg?: { totalScore?: number };
  }[];
  /** Absent on a server older than the streak feature — every reader handles that. */
  activity?: Activity;
}

interface ProgressState {
  stats: StatsResponse | null;
  failed: boolean;
  refresh: () => Promise<StatsResponse | null>;
  clear: () => void;
}

/** Minutes to ADD to UTC for local time — the opposite sign of getTimezoneOffset(). */
export function utcOffsetMinutes(now = new Date()): number {
  return -now.getTimezoneOffset();
}

let inflight: Promise<StatsResponse | null> | null = null;

export const useProgress = create<ProgressState>((set, get) => ({
  stats: null,
  failed: false,

  // Same one-at-a-time rule as the balance store: Home and Stats both refresh
  // on focus, and two concurrent GETs would race to write the same state.
  refresh: async () => {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const { data } = await api.get<StatsResponse>('/user/stats', {
          params: { tz: utcOffsetMinutes() },
        });
        set({ stats: data, failed: false });
        return data;
      } catch {
        // Keep what is on screen; a stale streak beats a blank card.
        set({ failed: true });
        return get().stats;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },

  clear: () => set({ stats: null, failed: false }),
}));

/** The weekly target the Home card measures against: active days, not sessions. */
export const WEEKLY_GOAL_DAYS = 5;
