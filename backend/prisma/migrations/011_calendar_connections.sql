-- Interprova — migration 011_calendar_connections.sql
--
-- Follows 010. Additive and idempotent: one CREATE TABLE IF NOT EXISTS, so
-- re-running the file on every deploy (scripts/deploy.sh) is safe.
--
--   mysql -u u405809647_interview -p u405809647_interview < 011_calendar_connections.sql
--
-- WHAT IT IS FOR: the Google Calendar / Meet / Tasks integration
-- (routes/calendar.js, services/calendar/google.js). One row per user who has
-- connected a Google account: the long-lived refresh token, encrypted, and the
-- scopes Google actually granted. Access tokens are short-lived and are kept in
-- process memory only — they never touch this table.
--
-- WHY NOT IN schema.prisma: same reason as 010 — every query goes through
-- mysql2 (src/db/mysql.js), so shipping this needs no `prisma generate`.
--
-- ENCRYPTION: `refresh_token_enc` is the AES-256-GCM envelope from
-- services/secrets/crypto.js (`v1.<iv>.<tag>.<ct>`), with the AAD bound to the
-- user id. A blob copied onto another user's row fails to authenticate instead
-- of handing that user someone else's calendar.

CREATE TABLE IF NOT EXISTS `calendar_connections` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`            BIGINT        NOT NULL,
  -- Only 'google' today. A column rather than an assumption so Outlook can be
  -- added without a second table.
  `provider`           VARCHAR(16)   NOT NULL DEFAULT 'google',
  -- The Google account the person picked on the consent screen — shown in the
  -- app so they can see WHICH calendar is connected.
  `google_email`       VARCHAR(191)  NULL,
  `refresh_token_enc`  TEXT          NOT NULL,
  -- Space-separated, exactly as Google returned them. Google lets people
  -- untick individual scopes, so Tasks may be missing while Calendar is not.
  `scopes`             VARCHAR(1000) NOT NULL DEFAULT '',
  `created_at`         DATETIME      NOT NULL,
  `updated_at`         DATETIME      NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `calendar_connections_user` (`user_id`),
  CONSTRAINT `calendar_connections_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================== verification
SELECT 'migration 011 applied' AS result;
SELECT COUNT(*) AS calendar_connections_table_present
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calendar_connections';
