/**
 * Connection tests for provider credentials.
 *
 * Contract, and the reason this file is separate: a probe result NEVER
 * contains the value it tested. Everything returned is derived from the HTTP
 * status alone. An admin panel that echoes back "we tried key sk-ant-…" turns
 * a read-only XSS into credential exfiltration.
 *
 * Each probe hits the cheapest authenticated read the provider offers — a
 * model list — so a test costs nothing and creates nothing.
 */

import { cfg, peekValue } from './store.js';
import { credentialDef } from './registry.js';
import { logger } from '../../utils/logger.js';

const TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Maps an HTTP status to a stable, value-free outcome. */
function fromStatus(status) {
  if (status >= 200 && status < 300) return { ok: true, verified: true, code: 'ok' };
  if (status === 401 || status === 403) return { ok: false, verified: true, code: 'unauthorized' };
  if (status === 429) return { ok: false, verified: true, code: 'rate_limited' };
  if (status >= 500) return { ok: false, verified: false, code: 'provider_error' };
  return { ok: false, verified: false, code: 'unexpected_status' };
}

const PROBES = {
  async ANTHROPIC_API_KEY(value) {
    const res = await fetchWithTimeout('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': value, 'anthropic-version': '2023-06-01' },
    });
    return { ...fromStatus(res.status), status: res.status };
  },

  async GEMINI_API_KEY(value) {
    const res = await fetchWithTimeout(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
      { headers: { 'x-goog-api-key': value } },
    );
    return { ...fromStatus(res.status), status: res.status };
  },

  async GROQ_API_KEY(value) {
    const res = await fetchWithTimeout('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${value}` },
    });
    return { ...fromStatus(res.status), status: res.status };
  },

  /**
   * EasyKash publishes no key-verification endpoint, and the only authenticated
   * call available (Direct Pay) CREATES a payment. Probing it would put junk
   * orders in the merchant dashboard, so this checks reachability of the
   * configured host only and says so: `verified: false` is what makes the UI
   * stop claiming the key is good.
   */
  async EASYKASH_API_KEY() {
    const base = String(cfg('EASYKASH_BASE_URL') || '').replace(/\/$/, '');
    if (!base) return { ok: false, verified: false, code: 'no_base_url', status: null };
    try {
      const res = await fetchWithTimeout(base, { method: 'GET' });
      return { ok: res.status < 500, verified: false, code: 'reachable_only', status: res.status };
    } catch {
      return { ok: false, verified: false, code: 'unreachable', status: null };
    }
  },
};

/**
 * @param {string} key
 * @param {string|null} candidate  A value being entered but not yet saved.
 *                                 When null, the stored/env value is tested.
 * @returns {Promise<{supported:boolean, ok:boolean, verified:boolean, code:string, status:number|null, testedStored:boolean}>}
 */
export async function probeCredential(key, candidate) {
  const def = credentialDef(key);
  if (!def?.testable || !PROBES[key]) {
    return { supported: false, ok: false, verified: false, code: 'unsupported', status: null, testedStored: false };
  }

  const value = candidate || peekValue(key);
  if (!value) {
    return { supported: true, ok: false, verified: false, code: 'no_value', status: null, testedStored: !candidate };
  }

  try {
    const result = await PROBES[key](value);
    return { supported: true, testedStored: !candidate, ...result };
  } catch (err) {
    // The message is logged, never returned: provider SDKs have been known to
    // include the request headers in it.
    logger.warn('[credentials] probe failed', { key, message: err.message });
    const aborted = err?.name === 'AbortError';
    return {
      supported: true,
      ok: false,
      verified: false,
      code: aborted ? 'timeout' : 'network_error',
      status: null,
      testedStored: !candidate,
    };
  }
}
