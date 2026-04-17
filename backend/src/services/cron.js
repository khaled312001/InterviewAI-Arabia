import cron from 'node-cron';
import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';

export function startCronJobs() {
  // Daily quota reset at 00:00 server time.
  cron.schedule('0 0 * * *', async () => {
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const result = await prisma.user.updateMany({
        data: { dailyQuestionsUsed: 0, lastResetDate: today },
      });
      logger.info('Daily quota reset complete', { usersReset: result.count });
    } catch (err) {
      logger.error('Daily quota reset failed', { message: err.message });
    }
  }, { timezone: 'Africa/Cairo' });

  // Expire past subscriptions every hour.
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      const expired = await prisma.subscription.findMany({
        where: { status: 'active', expiresAt: { lt: now } },
        select: { id: true, userId: true },
      });
      if (!expired.length) return;
      await prisma.$transaction([
        prisma.subscription.updateMany({
          where: { id: { in: expired.map((s) => s.id) } },
          data: { status: 'expired' },
        }),
        prisma.user.updateMany({
          where: { id: { in: expired.map((s) => s.userId) } },
          data: { plan: 'free' },
        }),
      ]);
      logger.info('Expired subscriptions processed', { count: expired.length });
    } catch (err) {
      logger.error('Subscription expiry job failed', { message: err.message });
    }
  }, { timezone: 'Africa/Cairo' });

  logger.info('Cron jobs scheduled (Africa/Cairo TZ)');
}
