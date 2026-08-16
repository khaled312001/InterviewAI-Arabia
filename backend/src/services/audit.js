/**
 * Admin audit trail.
 *
 * `admin_audit_logs` has existed since migration 001 with zero writers: role
 * grants, deletions and credential changes all left no trace. This is the
 * writer.
 *
 * Two modes on purpose:
 *  - `writeAudit(tx, entry)` inside a transaction — for actions where an
 *    untraceable success is unacceptable (credentials, role changes). If the
 *    audit insert fails the whole action rolls back.
 *  - `logAudit(entry)` best-effort — for actions where losing the trail is
 *    better than failing the operation.
 *
 * A third, automatic path exists alongside these: middleware/auditLog.js
 * records every successful admin mutation derived from the method and path, so
 * an action is never left untraced merely because a handler forgot to call in
 * here. Handlers that want richer detail than the generic row still call
 * writeAudit/logAudit explicitly.
 *
 * `metadata` must never carry a secret. Callers pass shape, not content:
 * `{ hadPreviousValue: true }`, never the value.
 */

import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';

function normalise({ adminId, action, entityType, entityId, metadata, ip }) {
  return {
    adminId: typeof adminId === 'bigint' ? adminId : BigInt(adminId),
    action: String(action).slice(0, 64),
    entityType: String(entityType).slice(0, 64),
    entityId: entityId === null || entityId === undefined ? null : String(entityId).slice(0, 64),
    metadata: metadata ? JSON.stringify(metadata).slice(0, 4000) : null,
    ip: ip ? String(ip).slice(0, 64) : null,
  };
}

/** Transactional — throws, so the caller's write rolls back with it. */
export function writeAudit(tx, entry) {
  return tx.adminAuditLog.create({ data: normalise(entry) });
}

/** Best-effort — never throws. */
export async function logAudit(entry) {
  try {
    await prisma.adminAuditLog.create({ data: normalise(entry) });
  } catch (err) {
    logger.warn('audit write failed', { action: entry?.action, message: err.message });
  }
}
