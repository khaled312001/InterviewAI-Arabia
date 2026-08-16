import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDaysYmd, daysBetweenYmd, startOfMonthYmd, todayYmd } from '../format';

/**
 * Analytics date range, mirrored into the query string so a view is linkable
 * and survives a reload — the same contract as useServerPagination.
 *
 * Days are Cairo calendar days ('YYYY-MM-DD'), matching the backend's window
 * maths. Presets are stored as a preset id rather than resolved dates, so a
 * shared "last 7 days" link stays relative instead of freezing last week.
 */

export type RangePresetId = '7d' | '30d' | '90d' | 'mtd' | 'custom';

export interface RangePreset {
  id: RangePresetId;
  labelAr: string;
}

export const RANGE_PRESETS: RangePreset[] = [
  { id: '7d', labelAr: 'آخر ٧ أيام' },
  { id: '30d', labelAr: 'آخر ٣٠ يومًا' },
  { id: '90d', labelAr: 'آخر ٩٠ يومًا' },
  { id: 'mtd', labelAr: 'هذا الشهر' },
  { id: 'custom', labelAr: 'مدى مخصص' },
];

/** The backend caps /analytics/timeseries at 180 days. */
export const MAX_RANGE_DAYS = 180;

export interface DateRange {
  from: string;
  to: string;
}

function resolvePreset(id: Exclude<RangePresetId, 'custom'>): DateRange {
  const to = todayYmd();
  switch (id) {
    case '7d':
      return { from: addDaysYmd(to, -6), to };
    case '90d':
      return { from: addDaysYmd(to, -89), to };
    case 'mtd':
      return { from: startOfMonthYmd(to), to };
    case '30d':
    default:
      return { from: addDaysYmd(to, -29), to };
  }
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const isYmd = (v: string | null): v is string => !!v && YMD_RE.test(v);

export interface UseDateRangeResult {
  preset: RangePresetId;
  range: DateRange;
  /** Number of inclusive days in the range. */
  days: number;
  setPreset: (id: RangePresetId) => void;
  setCustom: (next: Partial<DateRange>) => void;
  /** Non-null when the current custom range cannot be requested. */
  error: string | null;
  maxDay: string;
}

export function useDateRange(defaultPreset: Exclude<RangePresetId, 'custom'> = '30d'): UseDateRangeResult {
  const [params, setParams] = useSearchParams();

  const rawPreset = params.get('preset');
  const rawFrom = params.get('from');
  const rawTo = params.get('to');

  // An explicit from/to pair in the URL is a custom range even without the
  // preset marker, so a hand-edited link behaves the way it reads.
  const preset: RangePresetId =
    rawPreset === 'custom' || (isYmd(rawFrom) && isYmd(rawTo) && rawPreset === null)
      ? 'custom'
      : (RANGE_PRESETS.find((p) => p.id === rawPreset)?.id ?? defaultPreset);

  const range = useMemo<DateRange>(() => {
    if (preset !== 'custom') return resolvePreset(preset);
    const today = todayYmd();
    return {
      from: isYmd(rawFrom) ? rawFrom : addDaysYmd(today, -29),
      to: isYmd(rawTo) ? rawTo : today,
    };
  }, [preset, rawFrom, rawTo]);

  const days = daysBetweenYmd(range.from, range.to) + 1;

  const error =
    days < 1
      ? 'تاريخ البداية بعد تاريخ النهاية.'
      : days > MAX_RANGE_DAYS
        ? `أقصى مدى مسموح ${MAX_RANGE_DAYS} يومًا.`
        : null;

  const setPreset = useCallback(
    (id: RangePresetId) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('preset', id);
          if (id === 'custom') {
            // Seed the custom fields from whatever is on screen, so switching
            // to "custom" never blanks the chart.
            const seed = isYmd(prev.get('from')) && isYmd(prev.get('to'))
              ? { from: prev.get('from')!, to: prev.get('to')! }
              : resolvePreset(defaultPreset);
            next.set('from', seed.from);
            next.set('to', seed.to);
          } else {
            next.delete('from');
            next.delete('to');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams, defaultPreset],
  );

  const setCustom = useCallback(
    (next: Partial<DateRange>) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          out.set('preset', 'custom');
          if (next.from !== undefined) out.set('from', next.from);
          if (next.to !== undefined) out.set('to', next.to);
          return out;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { preset, range, days, setPreset, setCustom, error, maxDay: todayYmd() };
}
