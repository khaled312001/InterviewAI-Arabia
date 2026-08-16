/**
 * The authoritative list of integration settings the admin may change.
 *
 * This registry is a allow-list, not documentation: PUT /admin/integrations/:key
 * rejects anything absent from it. That is what stops the endpoint from
 * becoming a generic "write any env-shaped key" primitive — the most obvious
 * way an admin-panel credential store turns into remote code configuration.
 *
 * EASYKASH_MOCK is deliberately ABSENT and must stay absent. It simulates
 * successful payments and grants premium for free (services/payments/easykash.js),
 * so it is an env-file-only switch that no admin session can flip.
 *
 * Arabic labels live in the admin app (features/integrations/registry.ts); this
 * file owns types, secrecy, and validation only.
 */

/**
 * @typedef {'secret'|'text'|'url'|'path'|'boolean'|'select'|'csv'} CredentialType
 * @typedef {Object} CredentialDef
 * @property {string} key            Also the env var name — the value falls back to env[key].
 * @property {'payments'|'ai'} group
 * @property {CredentialType} type
 * @property {boolean} secret        Secrets are encrypted and never returned by any GET.
 * @property {string[]} [options]    For type 'select'.
 * @property {boolean} [testable]    Whether POST /:key/test can reach a provider.
 */

/** @type {CredentialDef[]} */
export const CREDENTIALS = [
  /* ----------------------------- EasyKash ----------------------------- */
  { key: 'EASYKASH_ENABLED', group: 'payments', type: 'boolean', secret: false },
  { key: 'EASYKASH_BASE_URL', group: 'payments', type: 'url', secret: false },
  { key: 'EASYKASH_PAY_PATH', group: 'payments', type: 'path', secret: false },
  { key: 'EASYKASH_API_KEY', group: 'payments', type: 'secret', secret: true, testable: true },
  { key: 'EASYKASH_WEBHOOK_SECRET', group: 'payments', type: 'secret', secret: true },
  { key: 'EASYKASH_SIGNATURE_HEADER', group: 'payments', type: 'text', secret: false },
  {
    key: 'EASYKASH_SIGNATURE_ALGO',
    group: 'payments',
    type: 'select',
    secret: false,
    options: ['sha256', 'sha512', 'sha1', 'md5'],
  },
  { key: 'EASYKASH_SIGNATURE_FIELDS', group: 'payments', type: 'csv', secret: false },
  { key: 'EASYKASH_PAYMENT_OPTIONS', group: 'payments', type: 'csv', secret: false },

  /* -------------------------------- AI -------------------------------- */
  { key: 'AI_ENABLED', group: 'ai', type: 'boolean', secret: false },
  {
    key: 'AI_PROVIDER',
    group: 'ai',
    type: 'select',
    secret: false,
    options: ['claude', 'gemini', 'groq'],
  },
  { key: 'CLAUDE_MODEL', group: 'ai', type: 'text', secret: false },
  { key: 'AI_MODEL', group: 'ai', type: 'text', secret: false },
  { key: 'ANTHROPIC_API_KEY', group: 'ai', type: 'secret', secret: true, testable: true },
  { key: 'GEMINI_API_KEY', group: 'ai', type: 'secret', secret: true, testable: true },
  { key: 'GROQ_API_KEY', group: 'ai', type: 'secret', secret: true, testable: true },
];

const BY_KEY = new Map(CREDENTIALS.map((c) => [c.key, c]));

/** @returns {CredentialDef|undefined} */
export function credentialDef(key) {
  return BY_KEY.get(key);
}

export function isKnownCredential(key) {
  return BY_KEY.has(key);
}

/**
 * Turn a stored string into the shape the app expects, mirroring exactly what
 * config/env.js does for the same key. A DB override that produced a different
 * JS type than the env fallback would break callers in ways only visible in
 * production.
 */
export function coerce(type, raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw);
  switch (type) {
    case 'boolean':
      return /^(true|1|yes|on)$/i.test(s.trim());
    case 'csv':
      return s.split(',').map((v) => v.trim()).filter(Boolean);
    default:
      return s;
  }
}

/**
 * Validate an incoming value for a key. Returns the canonical string to store.
 * @throws {Error} with a message safe to show an admin — it never contains the value.
 */
export function validateValue(def, value) {
  if (typeof value !== 'string') throw new Error('Value must be a string');
  const v = value.trim();
  if (!v) throw new Error('Value must not be empty');

  switch (def.type) {
    case 'boolean':
      if (!/^(true|false|1|0|yes|no|on|off)$/i.test(v)) throw new Error('Value must be a boolean');
      return /^(true|1|yes|on)$/i.test(v) ? 'true' : 'false';
    case 'select':
      if (!def.options?.includes(v)) throw new Error(`Value must be one of: ${def.options?.join(', ')}`);
      return v;
    case 'url':
      try {
        const u = new URL(v);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad protocol');
      } catch {
        throw new Error('Value must be an http(s) URL');
      }
      return v.replace(/\/$/, '');
    case 'path':
      if (!v.startsWith('/')) throw new Error('Path must start with /');
      return v;
    case 'csv':
      return v.split(',').map((x) => x.trim()).filter(Boolean).join(',');
    case 'secret':
      if (v.length < 8) throw new Error('Secret looks too short to be valid');
      if (/\s/.test(v)) throw new Error('Secret must not contain whitespace');
      return v;
    case 'text':
    default:
      if (v.length > 500) throw new Error('Value is too long');
      return v;
  }
}
