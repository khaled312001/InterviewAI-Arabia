-- InterviewAI Arabia — migration 002_minute_metering.sql
--
-- Replaces the daily question quota with a minute balance: a free 10-minute
-- trial, purchasable time packs that never expire, and a monthly subscription
-- allowance that does.
--
-- Idempotent DDL, same reason as 001: Hostinger's MySQL is migrated offline
-- (`prisma migrate deploy` needs a shadow database, which requires
-- CREATE DATABASE, which the shared account lacks). Re-running is safe.
--
--   mysql -u u405809647_interview -p u405809647_interview < 002_minute_metering.sql
--
-- ADDITIVE ONLY. Nothing is dropped and nothing existing is narrowed, so the
-- currently-deployed backend keeps running unchanged against this schema —
-- which is what makes "migrate first, deploy second" safe, with no cutover
-- window. `daily_questions_used` and `last_reset_date` are deliberately LEFT
-- IN PLACE; migration 003 drops them one release later, once no rollback
-- target still reads them.

DELIMITER $$

DROP PROCEDURE IF EXISTS iaa_add_column$$
CREATE PROCEDURE iaa_add_column(IN tbl VARCHAR(64), IN col VARCHAR(64), IN ddl TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col
  ) THEN
    SET @s = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN ', ddl);
    PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$

DROP PROCEDURE IF EXISTS iaa_add_index$$
CREATE PROCEDURE iaa_add_index(IN tbl VARCHAR(64), IN idx VARCHAR(64), IN ddl TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND INDEX_NAME = idx
  ) THEN
    SET @s = CONCAT('ALTER TABLE `', tbl, '` ADD ', ddl);
    PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

-- ================================================================== users
-- Seconds, not minutes: minutes are a display unit, and storing the display
-- unit is how you end up rounding a single charge twice.
CALL iaa_add_column('users', 'balance_seconds',
  '`balance_seconds` INT NOT NULL DEFAULT 0 AFTER `premium_until`');
CALL iaa_add_column('users', 'sub_seconds',
  '`sub_seconds` INT NOT NULL DEFAULT 0 AFTER `balance_seconds`');
CALL iaa_add_column('users', 'sub_seconds_expires_at',
  '`sub_seconds_expires_at` DATETIME(3) NULL AFTER `sub_seconds`');
CALL iaa_add_column('users', 'held_seconds',
  '`held_seconds` INT NOT NULL DEFAULT 0 AFTER `sub_seconds_expires_at`');
CALL iaa_add_column('users', 'trial_granted_at',
  '`trial_granted_at` DATETIME(3) NULL AFTER `held_seconds`');
CALL iaa_add_column('users', 'trial_seconds',
  '`trial_seconds` INT NOT NULL DEFAULT 0 AFTER `trial_granted_at`');

-- The subscription-allowance expiry sweep scans on this.
CALL iaa_add_index('users', 'users_sub_seconds_expires_at_idx',
  'INDEX `users_sub_seconds_expires_at_idx` (`sub_seconds_expires_at`)');

-- NOTE: no backfill. `trial_granted_at` stays NULL for every existing account,
-- so every current user is granted the 10 free minutes on their next meeting.
-- With zero paid payments in the system this is a launch gift, not a leak —
-- and it is deliberate: back-dating the trial would silently strand the small
-- population that used the product during the beta.

-- ============================================================ time_ledger
CREATE TABLE IF NOT EXISTS `time_ledger` (
  `id`                 BIGINT NOT NULL AUTO_INCREMENT,
  `user_id`            BIGINT NOT NULL,
  `kind`               ENUM('trial_grant','purchase','subscription_grant','promo_grant',
                            'admin_grant','consumption','refund','expiry','adjustment') NOT NULL,
  `bucket`             ENUM('perpetual','subscription') NOT NULL DEFAULT 'perpetual',
  -- Signed: +3600 for a 60-minute pack, -442 for a 7m22s interview.
  `seconds`            INT NOT NULL,
  `perpetual_after`    INT NOT NULL,
  `subscription_after` INT NOT NULL,
  `payment_id`         BIGINT NULL,
  `subscription_id`    BIGINT NULL,
  `meeting_session_id` BIGINT NULL,
  `admin_id`           BIGINT NULL,
  -- The one thing that makes a grant safe to retry. `payment:<id>`,
  -- `trial:<userId>`, `sub:<subId>:cycle:<n>`, `meeting:<id>:settle:<n>`.
  `idempotency_key`    VARCHAR(191) NULL,
  `note`               VARCHAR(255) NULL,
  `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `time_ledger_idempotency_key_key` (`idempotency_key`),
  INDEX `time_ledger_user_id_created_at_idx` (`user_id`, `created_at`),
  INDEX `time_ledger_kind_created_at_idx` (`kind`, `created_at`),
  CONSTRAINT `time_ledger_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `time_ledger_payment_id_fkey`
    FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ======================================================= meeting_sessions
CREATE TABLE IF NOT EXISTS `meeting_sessions` (
  `id`                     BIGINT NOT NULL AUTO_INCREMENT,
  `user_id`                BIGINT NOT NULL,
  `category_id`            INT NOT NULL,
  -- Linked at /finish. NULL for meetings that produced nothing worth showing.
  `session_id`             BIGINT NULL,
  `status`                 ENUM('live','ended','abandoned','exhausted') NOT NULL DEFAULT 'live',
  `held_seconds`           INT NOT NULL DEFAULT 0,
  `billed_seconds`         INT NOT NULL DEFAULT 0,
  -- Wall-clock deliberately NOT charged: network drops, backgrounded app,
  -- phone asleep. Shown to the user after the interview.
  `skipped_seconds`        INT NOT NULL DEFAULT 0,
  `sub_seconds_used`       INT NOT NULL DEFAULT 0,
  `perpetual_seconds_used` INT NOT NULL DEFAULT 0,
  `turn_count`             INT NOT NULL DEFAULT 0,
  -- `billed_seconds` at the previous /turn. The turn floor is measured against
  -- the wall-clock accrued since the last TURN, not since the last tick.
  `billed_at_last_turn`    INT NOT NULL DEFAULT 0,
  -- Server clock only. A client timestamp never touches these columns.
  `started_at`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_tick_at`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ended_at`               DATETIME(3) NULL,
  `end_reason`             VARCHAR(32) NULL,
  `client`                 VARCHAR(32) NULL,
  `created_at`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- No DEFAULT and no ON UPDATE, matching exactly what Prisma's @updatedAt
  -- generates. The client always supplies this value; letting MySQL fill it
  -- would stamp the SERVER's local clock into a column every reader treats
  -- as UTC — a three-hour lie on any box not running UTC.
  `updated_at`             DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `meeting_sessions_user_id_started_at_idx` (`user_id`, `started_at`),
  -- The abandoned-session sweeper's index.
  INDEX `meeting_sessions_status_last_tick_at_idx` (`status`, `last_tick_at`),
  CONSTRAINT `meeting_sessions_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `meeting_sessions_session_id_fkey`
    FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Covers a database where an earlier run of this file created the table before
-- the column existed. CREATE TABLE IF NOT EXISTS would silently skip it.
CALL iaa_add_column('meeting_sessions', 'billed_at_last_turn',
  '`billed_at_last_turn` INT NOT NULL DEFAULT 0 AFTER `turn_count`');

-- The ledger's FK to meeting_sessions is added only after that table exists.
SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'time_ledger'
    AND CONSTRAINT_NAME = 'time_ledger_meeting_session_id_fkey'
);
SET @s := IF(@has_fk > 0, 'SELECT 1', 'ALTER TABLE `time_ledger`
  ADD CONSTRAINT `time_ledger_meeting_session_id_fkey`
  FOREIGN KEY (`meeting_session_id`) REFERENCES `meeting_sessions`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================== sessions
-- Denormalised duration so History renders "٧ دقائق" without joining the
-- billing table, in the same spirit as the existing `answer_count`.
CALL iaa_add_column('sessions', 'billed_seconds',
  '`billed_seconds` INT NOT NULL DEFAULT 0 AFTER `answer_count`');

-- =========================================================== trial_claims
-- One row per identity signal a free trial was claimed against. The unique
-- index is the entire anti-abuse mechanism: it stops casual double-dipping
-- and, until email verification exists, nothing more.
CREATE TABLE IF NOT EXISTS `trial_claims` (
  `id`         BIGINT NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT NOT NULL,
  `claim_type` ENUM('install','phone','email') NOT NULL,
  -- SHA-256(TRIAL_CLAIM_SALT || value). Hashed so a database leak is not a
  -- device-to-account map.
  `claim_hash` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `trial_claims_claim_type_claim_hash_key` (`claim_type`, `claim_hash`),
  INDEX `trial_claims_user_id_idx` (`user_id`),
  CONSTRAINT `trial_claims_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================== app_settings
-- Every metering constant is tunable without a deploy, and `free_trial_seconds`
-- doubles as the kill switch: set it to 0 and trial farming stops instantly.
-- INSERT IGNORE, never REPLACE — re-running must not stamp on an admin's edit.
INSERT IGNORE INTO `app_settings` (`key`, `value`, `updated_at`) VALUES
  ('free_trial_seconds',        '600',  NOW(3)),
  ('meeting_tick_seconds',      '15',   NOW(3)),
  ('meeting_max_gap_seconds',   '40',   NOW(3)),
  ('meeting_abandon_seconds',   '120',  NOW(3)),
  ('meeting_hold_seconds',      '300',  NOW(3)),
  ('meeting_min_start_seconds', '60',   NOW(3)),
  ('meeting_min_turn_seconds',  '30',   NOW(3)),
  ('meeting_low_water_seconds', '120',  NOW(3)),
  ('cv_prepare_seconds',        '60',   NOW(3)),
  ('practice_answer_seconds',   '30',   NOW(3)),
  ('subscription_cycle_seconds','18000',NOW(3));  -- 300 minutes per 30-day cycle

-- The daily-quota setting is retired. Left in the table so the admin UI can
-- render it as "retired" rather than silently forgetting it existed.
UPDATE `app_settings` SET `value` = '0', `updated_at` = NOW(3)
 WHERE `key` = 'free_daily_question_limit';

-- ======================================================== retire "yearly"
-- Report first, so the operator SEES the (expected: zero) paid exposure
-- before anything is renamed.
SELECT 'paid yearly payments (expected 0)' AS check_name, COUNT(*) AS n
  FROM payments WHERE plan_code = 'yearly' AND status = 'paid';

-- Pending yearly checkouts can never complete — the plan is gone from the
-- catalogue, so the webhook would find nothing purchasable to activate. Close
-- them with a readable reason instead of leaving them pending forever in the
-- webhook's lookup path.
UPDATE payments
   SET status = 'expired',
       failure_reason = 'plan_retired:yearly',
       updated_at = NOW(3)
 WHERE plan_code = 'yearly' AND status = 'pending';

-- Rename the seed/demo subscription rows so the retired code can never be
-- confused with a purchasable one, while the rows keep working: the cycle-grant
-- job treats any active subscription with an unrecognised plan code as the
-- monthly allowance, so demo accounts keep functioning until their own expiry
-- and then lapse normally through expireSubscriptions().
UPDATE subscriptions SET plan_code = 'yearly_legacy', updated_at = NOW(3)
 WHERE plan_code = 'yearly';
UPDATE payments SET plan_code = 'yearly_legacy', updated_at = NOW(3)
 WHERE plan_code = 'yearly';

-- =============================================================== cleanup
DROP PROCEDURE IF EXISTS iaa_add_column;
DROP PROCEDURE IF EXISTS iaa_add_index;

-- ========================================================== verification
SELECT 'migration 002 applied' AS result;
SELECT COUNT(*) AS users_with_balance_column FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'balance_seconds';
SELECT COUNT(*) AS ledger_rows FROM time_ledger;
SELECT COUNT(*) AS live_meetings FROM meeting_sessions WHERE status = 'live';
SELECT COUNT(*) AS purchasable_yearly FROM subscriptions WHERE plan_code = 'yearly';
