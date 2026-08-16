import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import type { CataloguePlan, CatalogueResponse } from './types';

/**
 * The catalogue, read from the endpoint the paywall reads.
 *
 * WHY A USER-FACING ENDPOINT. GET /api/payments/config is unauthenticated and
 * returns exactly what a customer is offered — the plans, the prices, and
 * whether the gateway is switched on at all. There is no admin twin of it, and
 * adding one would be adding a second copy of the price list: the panel's whole
 * job here is to show what the customer sees, so it has to read the customer's
 * source. Nothing here is written; the catalogue is code, not data.
 *
 * It is cached for the session. Prices only move on a deploy, and refetching a
 * static file on every page focus is noise on a shared host.
 */
export function useCatalogue() {
  return useQuery<CatalogueResponse>({
    queryKey: qk.catalogue.all(),
    queryFn: async ({ signal }) =>
      (await api.get<CatalogueResponse>('/payments/config', { signal })).data,
    staleTime: 10 * 60 * 1000,
    // A 401 here would be meaningless (the route takes no auth), so the shared
    // retry policy is fine — but a failure must not blank a page that is mostly
    // about something else, which is why every consumer renders a fallback.
  });
}

/**
 * Arabic name for a plan code, from the catalogue.
 *
 * Falls back to the raw code rather than to a dash: retired codes
 * (`yearly_legacy`), the manual-grant marker (`manual_minutes`) and legacy
 * Google-Play codes are all real rows the catalogue cannot describe, and hiding
 * which plan a customer actually bought is worse than printing its identifier.
 */
export function planLabel(plans: CataloguePlan[] | undefined, code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  return plans?.find((p) => p.code === code)?.labelAr;
}
