// Admin audit trail.
//
// `admin_audit_logs` has existed since migration 001 and had zero writers, so
// deleting a user, dropping a category, cancelling a subscription or granting a
// role all left no trace whatsoever. Rather than sprinkle bespoke calls through
// every handler (which quietly rot the moment a handler is rewritten), the
// trail is captured by one router-level middleware: every non-GET admin request
// that succeeds is recorded, derived from the method and the path.

import { prisma } from '../db/prisma.js';

/** Anything whose key looks like a credential never reaches the log. */
const SECRET_KEY = /(password|passwd|secret|token|api[-_]?key|authorization|credential|signature)/i;
const REDACTED = '[redacted]';
const MAX_METADATA_CHARS = 2000;
const MAX_STRING_CHARS = 300;
const AUDIT_WRITE_TIMEOUT_MS = 1500;

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[deep]';

  if (Array.isArray(value)) {
    // Bulk imports can carry 500 questions; the audit row records the shape,
    // not the payload.
    if (value.length > 10) return `[${value.length} items]`;
    return value.map((v) => redact(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }

  if (typeof value === 'string' && value.length > MAX_STRING_CHARS) {
    return `${value.slice(0, MAX_STRING_CHARS)}…`;
  }

  if (typeof value === 'bigint') return value.toString();
  return value;
}

/** JSON-serialised request body with every credential-shaped field stripped. */
export function sanitizeMetadata(body) {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) return null;
  try {
    const json = JSON.stringify(redact(body));
    if (!json || json === '{}') return null;
    return json.length > MAX_METADATA_CHARS ? `${json.slice(0, MAX_METADATA_CHARS)}…` : json;
  } catch {
    return null;
  }
}

/** Plural route segment -> the singular noun stored in `entity_type`. */
const ENTITY_TYPE = {
  users: 'user',
  questions: 'question',
  categories: 'category',
  subscriptions: 'subscription',
  reports: 'report',
  admins: 'admin',
  settings: 'setting',
  payments: 'payment',
  integrations: 'integration',
  auth: 'auth',
};

const VERB_BY_METHOD = { POST: 'create', PATCH: 'update', PUT: 'update', DELETE: 'delete' };

const isNumericId = (s) => /^\d+$/.test(s);

/**
 * `POST /reports/12/resolve` -> { action: 'reports.resolve', entityType: 'report', entityId: '12' }
 * `DELETE /users/5`          -> { action: 'users.delete',    entityType: 'user',   entityId: '5' }
 * `POST /questions/bulk`     -> { action: 'questions.bulk',  entityType: 'question' }
 */
export function describeRequest(method, path) {
  const segments = String(path || '').split('/').filter(Boolean);
  const resource = segments[0] || 'unknown';
  const entityType = ENTITY_TYPE[resource] || resource;

  const rest = segments.slice(1);
  const entityId = rest.find(isNumericId) ?? null;
  // A trailing non-numeric segment is the action itself (`resolve`, `refund`,
  // `bulk`, `test`); otherwise fall back to the HTTP verb.
  const tail = rest[rest.length - 1];
  const verb =
    tail && !isNumericId(tail) ? tail : (VERB_BY_METHOD[method] || method.toLowerCase());

  return { action: `${resource}.${verb}`.slice(0, 64), entityType: entityType.slice(0, 64), entityId };
}

export function clientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : null;
  return (first || req.ip || '').slice(0, 64) || null;
}

/** Never throws: an audit failure must not fail the operation it describes. */
export async function recordAudit({ adminId, action, entityType, entityId, metadata, ip }) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId: BigInt(adminId),
        action,
        entityType,
        entityId: entityId ? String(entityId).slice(0, 64) : null,
        metadata: metadata ?? null,
        ip: ip ?? null,
      },
    });
  } catch (err) {
    console.error('[audit] could not record admin action:', err?.message);
  }
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

/**
 * Router-level middleware recording every successful admin mutation.
 *
 * The write is awaited *before* the response is flushed rather than on
 * `res.on('finish')`: on Vercel the function can be frozen the instant the
 * response is sent, which would drop the row we just decided to write.
 */
export function auditAdminMutations() {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

    // Captured up front — handlers are free to mutate req.body.
    const metadata = sanitizeMetadata(req.body);
    const originalJson = res.json.bind(res);

    res.json = (payload) => {
      res.json = originalJson; // never re-enter
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      const adminId = req.admin?.id;
      // A handler that writes its own audit row inside its transaction sets
      // this: the derived-from-the-URL row would be a strictly worse duplicate
      // (`integrations.EASYKASH_API_KEY` with a null entity id).
      if (!ok || !adminId || req.skipAutoAudit) return originalJson(payload);

      const { action, entityType, entityId } = describeRequest(req.method, req.path);
      withTimeout(
        recordAudit({ adminId, action, entityType, entityId, metadata, ip: clientIp(req) }),
        AUDIT_WRITE_TIMEOUT_MS,
      ).then(() => originalJson(payload));
      return res;
    };

    next();
  };
}
