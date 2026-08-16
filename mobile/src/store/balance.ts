/**
 * The minute balance, client side.
 *
 * The app used to meter questions per day and the client mirrored the server's
 * limit as a constant (`FREE_DAILY_QUESTIONS = 5`) because no endpoint returned
 * it. That is exactly the drift this store exists to end: **every number here
 * comes from the API**. Nothing in the UI may invent a minute count, a price, a
 * trial length or a flat fee — if the server does not send it, it is not shown.
 *
 * `GET /api/user/balance` is also where the free trial is granted (lazily, on
 * first read), so calling `refresh()` on the Home screen is what puts the ten
 * free minutes on a brand-new account before it taps anything.
 *
 * Freshness rules, learned from the daily counter this replaces:
 *   - `refresh()` after anything that spends or buys (an answer, an interview,
 *     a completed checkout).
 *   - `apply()` when a response already carried a balance, so the extra GET is
 *     skipped — `/sessions/:id/answer` and `/sessions/start` both send one.
 *   - `setAvailableSeconds()` during a live interview, where the meeting tick is
 *     the freshest source there is.
 */

import { create } from 'zustand';
import { api } from '../api/client';

/** Flat charges, stated rather than hidden. Zero for subscribers. */
export interface MinuteCosts {
  /** Charged per evaluated practice answer. */
  practiceAnswerSeconds: number;
  /** Charged once per CV analysis at interview setup. */
  cvAnalysisSeconds: number;
  /** The per-turn minimum in a live interview. */
  minTurnSeconds: number;
  /** Below this an interview will not open at all. */
  minStartSeconds: number;
}

/** The shape of `GET /api/user/balance` (and of the `balance` block that the
 *  session routes attach to their own responses, which omits `costs`). */
export interface BalanceSnapshot {
  balanceSeconds: number;
  subSeconds: number;
  subExpiresAt: string | null;
  heldSeconds: number;
  /** What can still be spent: both buckets, minus outstanding reservations. */
  availableSeconds: number;
  /** `availableSeconds` floored to whole minutes — the server floors it too. */
  minutesRemaining: number;
  trialGranted: boolean;
  trialSeconds: number;
  plan: 'free' | 'premium';
  premiumUntil: string | null;
  lowWaterSeconds: number;
  costs?: MinuteCosts;
  /** True only on the single response that granted the trial. */
  trialJustGranted?: boolean;
}

interface BalanceState {
  balance: BalanceSnapshot | null;
  loading: boolean;
  failed: boolean;
  refresh: () => Promise<void>;
  apply: (snapshot: Partial<BalanceSnapshot> | null | undefined) => void;
  setAvailableSeconds: (seconds: number) => void;
  clear: () => void;
}

/** Whole minutes, always rounded DOWN — mirrors the server. Understating by
 *  less than a minute errs in the user's favour; rounding up produces "it said
 *  5 minutes and cut me off at 4". */
export function minutesOf(seconds: number | null | undefined): number {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? Math.floor(n / 60) : 0;
}

/** `mm:ss` for the live countdown and the statement, where the seconds matter. */
export function formatClock(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * One in-flight request at a time.
 *
 * Home, the paywall and the interview screen all refresh on focus, and three
 * concurrent GETs would race to write the same state — the last one to land
 * wins, which is not necessarily the newest.
 */
let inflight: Promise<void> | null = null;

export const useBalance = create<BalanceState>((set, get) => ({
  balance: null,
  loading: false,
  failed: false,

  refresh: async () => {
    if (inflight) return inflight;
    set({ loading: true });
    inflight = (async () => {
      try {
        const { data } = await api.get<BalanceSnapshot>('/user/balance');
        set({ balance: data, failed: false });
      } catch {
        // A stale balance is survivable; a blanked screen is not. Keep whatever
        // was already on display and let the caller decide whether to say so.
        set({ failed: true });
      } finally {
        set({ loading: false });
        inflight = null;
      }
    })();
    return inflight;
  },

  apply: (snapshot) => {
    if (!snapshot) return;
    const current = get().balance;
    // Merged, not replaced: the session routes send a balance without `costs`,
    // and dropping the flat fees would blank the "each answer costs 30s" line
    // for the rest of the session.
    set({
      balance: { ...(current ?? ({} as BalanceSnapshot)), ...snapshot } as BalanceSnapshot,
      failed: false,
    });
  },

  setAvailableSeconds: (seconds) => {
    const current = get().balance;
    if (!current) return;
    const available = Math.max(0, Math.floor(seconds));
    set({
      balance: {
        ...current,
        availableSeconds: available,
        minutesRemaining: minutesOf(available),
      },
    });
  },

  clear: () => set({ balance: null, failed: false, loading: false }),
}));
