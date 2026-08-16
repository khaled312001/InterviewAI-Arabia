/**
 * Feature flags gate pages whose backend does not exist yet. A hidden nav item
 * is correct; a stubbed page showing invented numbers is not.
 */
export type FeatureFlag = 'payments' | 'integrations' | 'audit';

const truthy = (v: unknown) => v === '1' || v === 'true';

const FLAGS: Record<FeatureFlag, boolean> = {
  payments: truthy(import.meta.env.VITE_FEATURE_PAYMENTS),
  integrations: truthy(import.meta.env.VITE_FEATURE_INTEGRATIONS),
  audit: truthy(import.meta.env.VITE_FEATURE_AUDIT),
};

export function isEnabled(flag?: string): boolean {
  if (!flag) return true;
  return FLAGS[flag as FeatureFlag] ?? false;
}

export const IS_PRODUCTION = import.meta.env.PROD;
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '0.2.0';
