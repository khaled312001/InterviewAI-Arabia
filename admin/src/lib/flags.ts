/**
 * Feature flags gate pages whose backend does not exist yet. A hidden nav item
 * is correct; a stubbed page showing invented numbers is not.
 */
// `payments` is intentionally absent: GET /api/admin/payments now exists in
// backend/src/routes/admin.js, so the page shows real rows and no longer needs
// gating. A flag left on a shipped feature only hides it by accident.
//
// `integrations` is absent for the same reason: provider_credentials, the
// AES-256-GCM envelope and GET/PUT/DELETE /admin/integrations all exist now, so
// the two integration pages read and write real credentials.
export type FeatureFlag = 'audit';

const truthy = (v: unknown) => v === '1' || v === 'true';

const FLAGS: Record<FeatureFlag, boolean> = {
  audit: truthy(import.meta.env.VITE_FEATURE_AUDIT),
};

export function isEnabled(flag?: string): boolean {
  if (!flag) return true;
  return FLAGS[flag as FeatureFlag] ?? false;
}

export const IS_PRODUCTION = import.meta.env.PROD;
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '0.2.0';
