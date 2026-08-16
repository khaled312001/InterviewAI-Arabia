/**
 * Runtime resolution of integration settings.
 *
 * `cfg(KEY)` is the single accessor every consumer uses instead of `env.KEY`.
 * It returns the value stored in `provider_credentials` when one exists, and
 * falls back to the env var otherwise. Secrets are decrypted once into an
 * in-process cache — they are never re-read per request, and never leave this
 * module except through cfg().
 *
 * Cache coherence: reads are synchronous (callers like easykash.isConfigured()
 * are sync), so the cache is refreshed at boot, immediately after any write,
 * and lazily in the background once it is older than TTL_MS. On the
 * single-process Hostinger deploy the write path alone is enough; the TTL is
 * what keeps a second serverless instance from serving a revoked key for
 * longer than a minute.
 */

import { query } from '../../db/mysql.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { decryptSecret, encryptSecret, isCryptoAvailable, last4 as tailOf } from './crypto.js';
import { CREDENTIALS, coerce, credentialDef } from './registry.js';

const TTL_MS = 60_000;

/** key -> { value: string|null, unreadable: boolean, last4: string|null } */
const cache = new Map();
let loadedAt = 0;
let inflight = null;

async function load() {
  const rows = await query(
    'SELECT `key`, is_secret AS isSecret, value_enc AS valueEnc, value_plain AS valuePlain, last4 FROM provider_credentials',
  );

  const next = new Map();
  for (const row of rows) {
    const def = credentialDef(row.key);
    // A row whose key left the registry is ignored rather than applied: the
    // allow-list is the security boundary and it is enforced on read too.
    if (!def) continue;

    if (row.isSecret) {
      try {
        next.set(row.key, { value: decryptSecret(row.valueEnc, row.key), unreadable: false, last4: row.last4 });
      } catch (err) {
        // Do NOT fall back to env here — an unreadable row is reported as
        // broken so the operator re-enters it, rather than silently reviving
        // whatever key the .env file still holds.
        logger.error('[credentials] failed to decrypt', { key: row.key, message: err.message });
        next.set(row.key, { value: null, unreadable: true, last4: row.last4 });
      }
    } else {
      next.set(row.key, { value: row.valuePlain, unreadable: false, last4: null });
    }
  }

  cache.clear();
  for (const [k, v] of next) cache.set(k, v);
  loadedAt = Date.now();
}

/** Best-effort warm-up. A DB hiccup at boot must not stop the app: cfg() falls back to env. */
export async function warmCredentials() {
  try {
    await load();
    logger.info('[credentials] loaded', { count: cache.size });
  } catch (err) {
    logger.warn('[credentials] warm-up failed, using env values', { message: err.message });
  }
}

export async function reloadCredentials() {
  if (!inflight) {
    inflight = load().finally(() => { inflight = null; });
  }
  return inflight;
}

function refreshIfStale() {
  if (Date.now() - loadedAt < TTL_MS || inflight) return;
  reloadCredentials().catch((err) =>
    logger.warn('[credentials] background refresh failed', { message: err.message }));
}

/**
 * The env-equivalent accessor. Same return type as `env[key]` for every key in
 * the registry — booleans stay booleans, csv stays an array.
 */
export function cfg(key) {
  const def = credentialDef(key);
  if (!def) return env[key];

  refreshIfStale();

  const row = cache.get(key);
  if (row?.unreadable) return def.type === 'boolean' ? false : (def.type === 'csv' ? [] : '');
  if (row && row.value !== null && row.value !== '') return coerce(def.type, row.value);
  return env[key];
}

/** Raw stored/env secret, for the test probe only. Never serialised to a response. */
export function peekValue(key) {
  const def = credentialDef(key);
  if (!def) return null;
  const row = cache.get(key);
  if (row?.unreadable) return null;
  if (row && row.value) return row.value;
  const fallback = env[key];
  return typeof fallback === 'string' ? fallback : null;
}

/**
 * Status of every registry key — the exact payload GET /admin/integrations
 * returns. Secrets contribute `isSet` and `last4` and nothing else.
 */
export async function credentialStatus() {
  await reloadCredentials().catch(() => {});

  const rows = await query(
    `SELECT c.\`key\`, c.value_plain AS valuePlain, c.last4, c.updated_at AS updatedAt,
            c.updated_by AS updatedBy, a.name AS updatedByName, a.email AS updatedByEmail
       FROM provider_credentials c
       LEFT JOIN admin_users a ON a.id = c.updated_by`,
  ).catch((err) => {
    logger.warn('[credentials] status query failed', { message: err.message });
    return [];
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return CREDENTIALS.map((def) => {
    const row = byKey.get(def.key);
    const cached = cache.get(def.key);
    const envValue = env[def.key];
    const envSet = Array.isArray(envValue)
      ? envValue.length > 0
      : envValue !== undefined && envValue !== '' && envValue !== null;

    const unreadable = Boolean(cached?.unreadable);
    const dbSet = Boolean(row) && !unreadable;

    /** Where the running app actually reads this value from. */
    const source = unreadable ? 'error' : dbSet ? 'db' : envSet ? 'env' : 'unset';

    return {
      key: def.key,
      group: def.group,
      type: def.type,
      secret: def.secret,
      options: def.options ?? null,
      testable: Boolean(def.testable),
      isSet: source === 'db' || source === 'env',
      source,
      // Secrets expose a 4-character tail and nothing more. Non-secrets are
      // config the owner needs to read, so they come back in the clear.
      last4: def.secret ? (dbSet ? row?.last4 || null : envSet ? tailOf(envValue) : null) : null,
      value: def.secret ? null : serialiseNonSecret(dbSet ? row.valuePlain : envValue),
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ? String(row.updatedBy) : null,
      updatedByName: row?.updatedByName ?? null,
      updatedByEmail: row?.updatedByEmail ?? null,
    };
  });
}

function serialiseNonSecret(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.join(',');
  return String(value);
}

/**
 * Upsert one credential. Called inside the route's transaction so the audit
 * row and the credential move together — a write with no trace is exactly the
 * thing the audit log exists to prevent.
 */
export async function writeCredential(tx, { def, value, adminId }) {
  const isSecret = def.secret;
  const valueEnc = isSecret ? encryptSecret(value, def.key) : null;
  const valuePlain = isSecret ? null : value;
  const tail = isSecret ? tailOf(value) : null;

  await tx.$executeRaw`
    INSERT INTO provider_credentials (\`key\`, is_secret, value_enc, value_plain, last4, updated_by, updated_at)
    VALUES (${def.key}, ${isSecret ? 1 : 0}, ${valueEnc}, ${valuePlain}, ${tail}, ${adminId}, NOW())
    ON DUPLICATE KEY UPDATE
      is_secret = VALUES(is_secret), value_enc = VALUES(value_enc), value_plain = VALUES(value_plain),
      last4 = VALUES(last4), updated_by = VALUES(updated_by), updated_at = NOW()
  `;
}

export async function deleteCredential(tx, key) {
  await tx.$executeRaw`DELETE FROM provider_credentials WHERE \`key\` = ${key}`;
}

export { isCryptoAvailable };
