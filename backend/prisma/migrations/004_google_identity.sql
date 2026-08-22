-- InterviewAI Arabia — migration 004_google_identity.sql
--
-- Follows 003. Additive and idempotent, same reason and same shape: Hostinger's
-- MySQL is migrated offline (`prisma migrate deploy` wants a shadow database,
-- which needs CREATE DATABASE, which the shared account does not have).
--
--   mysql -u u405809647_interview -p u405809647_interview < 004_google_identity.sql
--
-- WHAT IT IS FOR: "sign in with Google", and the three public client ids that
-- switch it on.
--
-- Nothing here narrows or removes a column, so the currently-deployed backend
-- keeps running against this schema — a rollback does not need a down migration.

-- ================================================================= users

-- Google's stable subject id, and the profile picture that comes with it.
--
-- `google_sub` and NOT the email. A Google account's address can be changed by
-- its owner; the subject cannot. Keying on email would turn a rename into a
-- second account with a second free trial, and would also mean that whoever
-- later acquires the abandoned address inherits the account.
--
-- Nullable, because every existing user has a password and no Google link.
-- UNIQUE, because two rows claiming the same Google identity is the bug that
-- makes "which account do I log into?" unanswerable.
--
-- MySQL has no `ADD COLUMN IF NOT EXISTS`, so re-running this is made safe by
-- checking information_schema first. Same shape as 002/003.

SET @add_google_sub := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `users` ADD COLUMN `google_sub` VARCHAR(64) NULL AFTER `last_login_at`',
    'SELECT "users.google_sub already present"')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'google_sub'
);
PREPARE stmt FROM @add_google_sub; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @add_avatar := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `users` ADD COLUMN `avatar_url` VARCHAR(512) NULL AFTER `google_sub`',
    'SELECT "users.avatar_url already present"')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'avatar_url'
);
PREPARE stmt FROM @add_avatar; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @add_google_idx := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `users` ADD UNIQUE INDEX `users_google_sub_key` (`google_sub`)',
    'SELECT "users_google_sub_key already present"')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'users_google_sub_key'
);
PREPARE stmt FROM @add_google_idx; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================================== app_settings

-- The three OAuth client ids. PUBLIC values — they ship inside the web bundle
-- and the APK — so they belong in app_settings rather than in the encrypted
-- provider-credentials store, and can be pasted into the admin panel without a
-- deploy.
--
-- Seeded EMPTY on purpose. An empty audience list means "Google sign-in is not
-- configured", the /auth/google route rejects every token, and the client hides
-- the button rather than showing one that fails when tapped. The alternative —
-- treating an empty list as "accept anything" — would accept an ID token minted
-- for any other Google app on the internet.
INSERT IGNORE INTO `app_settings` (`key`, `value`, `updated_at`) VALUES
  ('google_client_id_web',     '', NOW(3)),
  ('google_client_id_android', '', NOW(3)),
  ('google_client_id_ios',     '', NOW(3));
