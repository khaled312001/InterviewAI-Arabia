/**
 * Which job market the interview is for.
 *
 * The server keeps the facts — currency, working week, the employment rules a
 * candidate is genuinely asked about, and how HR actually speaks in each
 * country (see backend services/ai/markets.js). This module only decides WHICH
 * of them applies, and sends the code along with the rest of the interview
 * context.
 *
 * The default is the device's region, not a picker.
 *
 * A candidate in Riyadh should not have to find a setting before the
 * interviewer stops asking them about a two-month Egyptian notice period. The
 * phone already knows where it is, that answer is right nearly every time, and
 * a wrong guess costs nothing because the whole thing is overridable in
 * Settings. A picker as the ONLY route would mean the feature reaches only the
 * people who go looking for it — which is close to nobody.
 *
 * `null` here means "follow the device", not "no market": it is a live
 * deferral, so a user who travels or changes their phone's region gets the
 * new market without touching anything. An explicit choice is stored as a
 * code and then never second-guessed.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';

/**
 * Must match MARKET_CODES in backend/src/services/ai/markets.js.
 *
 * Duplicated rather than fetched: it is a handful of ISO country codes that
 * change about once a year, and the alternative is an extra network round trip
 * on a screen whose whole job is to start quickly. The server validates the
 * code against its own table anyway (`z.enum`), so the worst a stale copy here
 * can do is send a code the server rejects into its default — never a bad
 * prompt.
 */
export const MARKET_CODES = ['EG', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'JO'] as const;
export type MarketCode = (typeof MARKET_CODES)[number];

/** `null` = follow the device. */
export type MarketPreference = MarketCode | null;

function isSupported(code: string | null | undefined): code is MarketCode {
  return !!code && (MARKET_CODES as readonly string[]).includes(code.toUpperCase());
}

/**
 * The device's region, when we support it.
 *
 * Returns null for a phone set to a country we have no profile for — France,
 * say, or a Gulf expat whose handset is still set to their home region. That
 * is the honest answer: the server then falls back to its own default rather
 * than us asserting a market we have no evidence for.
 */
export function deviceMarket(): MarketCode | null {
  try {
    for (const locale of getLocales()) {
      const region = locale.regionCode;
      if (isSupported(region)) return region.toUpperCase() as MarketCode;
    }
  } catch {
    // getLocales can throw on web engines with no Intl region data.
  }
  return null;
}

interface MarketState {
  /** The user's explicit choice, or null to follow the device. */
  preference: MarketPreference;
  setPreference: (m: MarketPreference) => void;
}

export const useMarketPreference = create<MarketState>()(
  persist(
    (set) => ({
      preference: null,
      setPreference: (preference) => set({ preference }),
    }),
    { name: 'market-pref', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/**
 * The code to send with an interview — preference first, device second.
 *
 * Callable outside React (the setup screen builds its payload in a callback),
 * so it reads the store imperatively rather than through the hook.
 */
export function activeMarket(): MarketCode | null {
  return useMarketPreference.getState().preference ?? deviceMarket();
}

/** Hook form, for screens that need to re-render when the choice changes. */
export function useActiveMarket(): MarketCode | null {
  const preference = useMarketPreference((s) => s.preference);
  return preference ?? deviceMarket();
}
