-- InterviewAI Arabia — migration 007_trial_reminder_marker.sql
--
-- Follows 006. Additive and idempotent, same reason and same shape: Hostinger's
-- MySQL is migrated offline (`prisma migrate deploy` wants a shadow database,
-- which needs CREATE DATABASE, which the shared account does not have).
--
--   mysql -u u405809647_interview -p u405809647_interview < 007_trial_reminder_marker.sql
--
-- WHAT IT IS FOR: one column, so the "your free minutes are waiting" reminder
-- can be sent AT MOST ONCE per account.
--
-- WHY A COLUMN AND NOT A LOOKUP AGAINST `notifications`: the reminder is fired
-- by a cron job that runs in two places at once — the in-process scheduler in
-- services/cron.js and an external pinger hitting /api/cron/trial-reminders,
-- because a Passenger recycle kills the first one. "SELECT the users with no
-- trial_reminder row, then send" is read-then-write: two runners in the same
-- minute both read the same empty set and both send. A conditional UPDATE
-- whose WHERE clause IS the check has no such window, which is the same
-- reasoning that made `trial_granted_at IS NULL` the trial's own lock in
-- services/billing/minutes.js.

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

-- Stamped by the atomic claim in services/maintenance.js:remindDormantTrials().
-- NULL means "never reminded", and it is the only value the claim will write
-- over — so the column is a one-way latch, not a timestamp anyone updates.
--
-- Deliberately NOT back-filled and deliberately NOT nullable-with-a-default:
-- every existing account starts at NULL, i.e. eligible, and the job's own age
-- window (see TRIAL_REMINDER_UNTIL_DAYS) is what stops the first run mailing
-- the entire back catalogue at once.
CALL iaa_add_column('users', 'trial_reminded_at',
  '`trial_reminded_at` DATETIME(3) NULL AFTER `trial_seconds`');

-- The job's selection is "granted a while ago, never reminded". Without this
-- it is a full scan of `users` once a day; with it, it is a range read.
CALL iaa_add_index('users', 'users_trial_reminder_idx',
  'INDEX `users_trial_reminder_idx` (`trial_reminded_at`, `trial_granted_at`)');

-- ========================================================== verification
SELECT 'migration 007 applied' AS result;
SELECT COUNT(*) AS trial_reminded_at_present
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME = 'users'
   AND COLUMN_NAME = 'trial_reminded_at';
