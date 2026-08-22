import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import {
  expireSubscriptions, purgeExpiredTokens, sweepAbandonedMeetings,
  grantSubscriptionCycles, expireSubscriptionMinutes, reconcileBalances,
  remindDormantTrials,
} from './maintenance.js';

/**
 * In-process scheduler.
 *
 * This file used to carry its own copies of the maintenance jobs, and both
 * copies were wrong in ways that quietly destroyed entitlements:
 *
 * 1. THE SWEEP downgraded every user who had ANY expired subscription —
 *    `UPDATE users SET plan='free' WHERE id IN (<users with a lapsed row>)` —
 *    ignoring whatever other subscription still covered them, so renewing
 *    early cancelled your own access. It also never cleared `premium_until`,
 *    leaving plan='free' beside a future expiry: the exact inconsistent pair
 *    services/quota.js cannot resolve. It would have erased a hand-made grant
 *    within the hour. services/maintenance.js:expireSubscriptions() is the
 *    corrected version, is what the HTTP cron route already calls, and is now
 *    the only implementation.
 *
 * 2. THE MIDNIGHT QUOTA RESET rewrote `daily_questions_used` and
 *    `last_reset_date` for every user in the table. The counter has rolled over
 *    lazily per user, in Africa/Cairo terms, inside the atomic consume in
 *    services/quota.js since that module was written; the bulk reset was dead
 *    weight that took a write lock on the whole users table nightly and, on a
 *    missed run, hid the rollover bug it was masking. routes/cron.js documents
 *    its removal. It is gone here too.
 */
export function startCronJobs() {
  // Expire lapsed subscriptions hourly, downgrading only users with no
  // remaining coverage and clearing the premium mirror when they have none.
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await expireSubscriptions();
      if (result.subscriptionsExpired > 0) logger.info('Subscription sweep complete', result);
    } catch (err) {
      logger.error('Subscription expiry job failed', { message: err.message });
    }
  }, { timezone: 'Africa/Cairo' });

  // Refresh and password-reset tokens that can no longer be used, dropped
  // nightly. Nothing else purges them, and they accumulate forever.
  cron.schedule('30 3 * * *', async () => {
    try {
      const result = await purgeExpiredTokens();
      logger.info('Token purge complete', result);
    } catch (err) {
      logger.error('Token purge failed', { message: err.message });
    }
  }, { timezone: 'Africa/Cairo' });

  /* --------------------------- minute metering ---------------------------
   * Every one of these is also exposed on routes/cron.js, because an
   * in-process scheduler is exactly the thing a Passenger recycle loses. If
   * that happens, an external pinger keeps the meter honest.
   * -------------------------------------------------------------------- */

  // EVERY MINUTE. This is the job that guarantees a killed app cannot hold a
  // user's minutes hostage: a live meeting whose heartbeat went stale is
  // settled for what it actually used and its reservation released.
  cron.schedule('* * * * *', async () => {
    try {
      const result = await sweepAbandonedMeetings();
      if (result.meetingsAbandoned > 0) logger.info('Abandoned meetings swept', result);
    } catch (err) {
      logger.error('Meeting sweep failed', { message: err.message });
    }
  }, { timezone: 'Africa/Cairo' });

  // Hourly: expired allowances OUT first, then the new cycle in.
  //
  // The order is not cosmetic. A grant into the subscription bucket REPLACES
  // the counter (`sub_seconds = <amount>`), so granting first destroys whatever
  // was left of the previous cycle and then leaves expireSubscriptionMinutes()
  // looking at a freshly-stamped FUTURE expiry that no longer matches its
  // filter — the seconds vanish with no expiry row, and the nightly
  // reconciliation reports drift on every renewal.
  cron.schedule('5 * * * *', async () => {
    try {
      const expired = await expireSubscriptionMinutes();
      const granted = await grantSubscriptionCycles();
      if (granted.subscriptionCyclesGranted > 0 || expired.allowancesExpired > 0) {
        logger.info('Subscription minutes sweep', { ...granted, ...expired });
      }
    } catch (err) {
      logger.error('Subscription minutes job failed', { message: err.message });
    }
  }, { timezone: 'Africa/Cairo' });

  // Nightly: assert the cached counters still agree with the ledger. Drift is
  // reported, never auto-corrected — only the derived hold is repaired.
  cron.schedule('45 3 * * *', async () => {
    try {
      const result = await reconcileBalances();
      logger.info('Balance reconciliation complete', result);
    } catch (err) {
      logger.error('Balance reconciliation failed', { message: err.message });
    }
  }, { timezone: 'Africa/Cairo' });

  // Daily, AT AN HOUR A PHONE MAY REASONABLY RING. Every other job in this file
  // is scheduled for whenever it is cheapest — 03:30, 03:45, on the hour —
  // because nobody is woken by a token purge. This one is the only job here
  // that lights up a handset, so it deliberately does NOT join them at half
  // past three: a "your free minutes are waiting" notification that arrives at
  // 03:30 is uninstalled at 03:31.
  //
  // Safe to run beside the external pinger on /api/cron/trial-reminders: the
  // reminder is claimed with a conditional UPDATE, so whichever runner gets
  // there first is the only one that sends. See remindDormantTrials().
  cron.schedule('0 18 * * *', async () => {
    try {
      const result = await remindDormantTrials();
      if (result.trialRemindersClaimed > 0) logger.info('Trial reminders sent', result);
    } catch (err) {
      logger.error('Trial reminder job failed', { message: err.message });
    }
  }, { timezone: 'Africa/Cairo' });

  logger.info('Cron jobs scheduled (Africa/Cairo TZ)');
}
