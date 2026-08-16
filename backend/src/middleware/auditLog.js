// Router-level capture of admin mutations for `admin_audit_logs`.
//
// Individual handlers may call writeAudit() from services/audit.js when losing
// the trail is unacceptable (credential and role changes, which must roll back
// with their audit row). This middleware is the floor underneath that: every
// other successful non-GET admin request is recorded automatically, derived
// from the method and path, so the trail cannot rot when a handler is
// rewritten and no destructive action goes unrecorded by omission.

import { logAudit } from '../services/audit.js';

/** Anything whose key looks like a credential never reaches the log. */
const SECRET_KEY = /(password|passwd|secret|token|api[-_]?key|authorization|credential|signature)/i;
const REDACTED = '[redacted]';
const MAX_STRING_CHARS = 300;
const AUDIT_WRITE_TIMEOUT_MS = 1500;

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[deep]';

  if (Array.isArray(value)) {
    // A bulk import can carry 500 questions; record the shape, not the payload.
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

/** The request body with every credential-shaped field stripped. */
export function sanitizeMetadata(body) {
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) return null;
  const safe = redact(body);
  return safe && Object.keys(safe).length > 0 ? safe : null;
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
  const verb = tail && !isNumericId(tail) ? tail : (VERB_BY_METHOD[method] || method.toLowerCase());

  return { action: `${resource}.${verb}`, entityType, entityId };
}

export function clientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : null;
  return first || req.ip || null;
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => { setTimeout(resolve, ms); })]);
}

/**
 * The audit write is awaited *before* the response is flushed rather than on
 * `res.on('finish')`: on Vercel the function can be frozen the instant the
 * response is sent, which would silently drop the row we just decided to write.
 * A stalled write cannot hold the response hostage — it is capped by a timeout.
 */
export function auditAdminMutations() {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

    // Captured up front: handlers are free to mutate req.body.
    const metadata = sanitizeMetadata(req.body);
    const originalJson = res.json.bind(res);

    res.json = (payload) => {
      res.json = originalJson; // never re-enter
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      const adminId = req.admin?.id;
      if (!ok || !adminId) return originalJson(payload);

      const { action, entityType, entityId } = describeRequest(req.method, req.path);
      withTimeout(
        logAudit({ adminId, action, entityType, entityId, metadata, ip: clientIp(req) }),
        AUDIT_WRITE_TIMEOUT_MS,
      ).then(() => originalJson(payload));
      return res;
    };

    next();
  };
}
