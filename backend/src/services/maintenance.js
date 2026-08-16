/**
 * Periodic maintenance jobs, callable from both the in-process scheduler
 * (services/cron.js) and the HTTP cron routes.
 */

import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Expire lapsed subscriptions and downgrade only the users who genuinely
 * have no remaining coverage.
 *
 * The previous implementation ran:
 *   UPDATE users SET plan='free' WHERE id IN (<every user with an expired row>)
 * which downgraded customers who had *just renewed* — their new active
 * subscription was ignored because the query only looked at the expired one.
 * Renewing early therefore cancelled your own access.
 */
export async function expireSubscriptions(now = new Date()) {
  const lapsed = await prisma.subscription.findMany({
    where: { status: 'active', expiresAt: { lt: now } },
    select: { id: true, userId: true },
  });

  if (!lapsed.length) return { subscriptionsExpired: 0, usersDowngraded: 0 };

  await prisma.subscription.updateMany({
    where: { id: { in: lapsed.map((s) => s.id) } },
    data: { status: 'expired' },
  });

  const affectedUserIds = [...new Set(lapsed.map((s) => s.userId))];
  let downgraded = 0;

  for (const userId of affectedUserIds) {
    // Does any other subscription still cover this user?
    const covering = await prisma.subscription.findFirst({
      where: { userId, status: 'active', expiresAt: { gt: now } },
      orderBy: { expiresAt: 'desc' },
      select: { expiresAt: true },
    });

    if (covering) {
      await prisma.user.update({
        where: { id: userId },
        data: { plan: 'premium', premiumUntil: covering.expiresAt },
      });
    } else {
      await prisma.user.update({
        where: { id: userId },
        data: { plan: 'free', premiumUntil: null },
      });
      downgraded += 1;
    }
  }

  logger.info('Subscription sweep', {
    subscriptionsExpired: lapsed.length,
    usersDowngraded: downgraded,
  });

  return { subscriptionsExpired: lapsed.length, usersDowngraded: downgraded };
}

/** Drop refresh tokens and password-reset tokens that can no longer be used. */
export async function purgeExpiredTokens(now = new Date()) {
  const [refresh, resets] = await Promise.all([
    prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] },
    }),
    prisma.passwordReset.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
    }),
  ]);
  return { refreshTokensPurged: refresh.count, passwordResetsPurged: resets.count };
}

/**
 * Reconcile the denormalised `premiumUntil` mirror against the subscriptions
 * table. Cheap insurance against drift if a webhook is ever mis-processed.
 */
export async function reconcilePremiumMirror(now = new Date()) {
  const active = await prisma.subscription.findMany({
    where: { status: 'active', expiresAt: { gt: now } },
    select: { userId: true, expiresAt: true },
    orderBy: { expiresAt: 'desc' },
  });

  const latest = new Map();
  for (const s of active) {
    if (!latest.has(s.userId.toString())) latest.set(s.userId.toString(), s.expiresAt);
  }

  let fixed = 0;
  for (const [userId, expiresAt] of latest) {
    const r = await prisma.user.updateMany({
      where: {
        id: BigInt(userId),
        OR: [{ plan: 'free' }, { premiumUntil: null }, { premiumUntil: { not: expiresAt } }],
      },
      data: { plan: 'premium', premiumUntil: expiresAt },
    });
    fixed += r.count;
  }

  return { premiumMirrorFixed: fixed };
}
