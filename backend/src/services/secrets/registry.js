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
 * @property {'payments'|'ai'|'push'} group
 * @property {CredentialType} type
 * @property {boolean} secret        Secrets are encrypted and never returned by any GET.
 * @property {string[]} [options]    For type 'select'.
 * @property {boolean} [testable]    Whether POST /:key/test can reach a provider.
 * @property {string[]} [allowedHosts] For type 'url': registrable domains this URL may
 *                                   point at (the domain itself or any subdomain).
 *                                   REQUIRED for any URL the server sends a secret to.
 */

/** @type {CredentialDef[]} */
export const CREDENTIALS = [
  /* ----------------------------- EasyKash ----------------------------- */
  { key: 'EASYKASH_ENABLED', group: 'payments', type: 'boolean', secret: false },
  /**
   * Host-pinned, and that pin is load-bearing rather than tidiness.
   *
   * EASYKASH_API_KEY is write-only by design: no endpoint returns it. But
   * services/payments/easykash.js builds the checkout URL from this key and
   * sends the API key to it as the Authorization header. Without a pin, a
   * super_admin who cannot READ the key could still point this at a host they
   * control and have the server hand the live key over on the next checkout —
   * defeating the write-only guarantee through a non-secret sibling setting.
   *
   * The same pin is re-checked at send time (easykash.js) so a row written
   * before this existed, or straight into MySQL, cannot leak either.
   */
  {
    key: 'EASYKASH_BASE_URL',
    group: 'payments',
    type: 'url',
    secret: false,
    allowedHosts: ['easykash.net'],
  },
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

  /* ------------------------------- Push ------------------------------- */
  /**
   * The Firebase service account, base64-encoded JSON.
   *
   * Base64 because the private key is multi-line PEM and neither a `.env` line
   * nor a single-line form field can carry a newline. Encoding it makes it one
   * opaque token, which is also what stops an operator from pasting half of it.
   *
   * SECRET, and more dangerous than it looks: this key can push a notification
   * to every install, read the Realtime Database and mint custom auth tokens
   * for any user. It is write-only here like every other secret — no endpoint
   * returns it, and the panel shows only the last four characters.
   */
  { key: 'FIREBASE_SERVICE_ACCOUNT_B64', group: 'push', type: 'secret', secret: true, testable: true },
  { key: 'PUSH_ENABLED', group: 'push', type: 'boolean', secret: false },
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
 * Is `hostname` inside one of `domains` (the domain itself or a subdomain)?
 *
 * Compares labels, not substrings: `endsWith('easykash.net')` alone would also
 * accept `notreallyeasykash.net`, which is exactly the shape of a look-alike
 * host an exfiltration attempt would use.
 */
function hostMatches(hostname, domains) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return domains.some((d) => {
    const domain = d.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  });
}

/**
 * Guard for the request path: re-checks a URL the app is about to send a
 * credential to against the registry pin. Kept here so the allow-list has one
 * definition and the check cannot drift from what PUT validates.
 *
 * @param {string} key    Registry key whose `allowedHosts` applies.
 * @param {string} url    The absolute URL about to be requested.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkOutboundUrl(key, url) {
  const def = credentialDef(key);
  if (!def?.allowedHosts?.length) return { ok: true };

  let u;
  try {
    u = new URL(String(url));
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'must use https' };
  if (u.username || u.password) return { ok: false, reason: 'must not embed credentials' };
  if (!hostMatches(u.hostname, def.allowedHosts)) {
    return { ok: false, reason: `host ${u.hostname} is not an allowed ${key} host` };
  }
  return { ok: true };
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
    case 'url': {
      let u;
      try {
        u = new URL(v);
      } catch {
        throw new Error('Value must be an http(s) URL');
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new Error('Value must be an http(s) URL');
      }
      // A pinned URL is one the server sends a credential to, so the two ways
      // of getting the credential onto the wire in the clear are both refused:
      // an off-list host, and plain http to an on-list one.
      if (def.allowedHosts?.length) {
        if (u.username || u.password) throw new Error('URL must not contain a username or password');
        if (u.protocol !== 'https:') throw new Error('URL must use https');
        if (!hostMatches(u.hostname, def.allowedHosts)) {
          throw new Error(`Host must be ${def.allowedHosts.join(' or ')} (or a subdomain of it)`);
        }
      }
      return v.replace(/\/$/, '');
    }
    case 'path':
      if (!v.startsWith('/')) throw new Error('Path must start with /');
      // The path is concatenated onto a pinned base URL. `//host/...` would
      // parse as a new authority and move the request — and its Authorization
      // header — off the pinned host, so a leading `//` is not a valid path.
      if (v.startsWith('//')) throw new Error('Path must not start with //');
      if (!/^\/[A-Za-z0-9\-._~/%?=&:@+,;$!*'()[\]]*$/.test(v)) {
        throw new Error('Path contains characters that are not allowed');
      }
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
