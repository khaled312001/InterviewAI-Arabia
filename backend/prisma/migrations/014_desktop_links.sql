-- Interprova — migration 014_desktop_links.sql
--
-- Follows 013. Additive and idempotent: one CREATE TABLE IF NOT EXISTS, so
-- re-running the file on every deploy (scripts/deploy.sh) is safe.
--
-- WHAT IT IS FOR: the customer dashboard shows the desktop app's plan next to
-- everything else. The desktop app has its own accounts on its own server; a
-- customer links theirs once by entering its email and password, which the
-- desktop server checks (routes/account.js). One desktop account belongs to one
-- site account (the UNIQUE email), and one site account links one desktop
-- account (the primary key).

CREATE TABLE IF NOT EXISTS `desktop_links` (
  `user_id`        BIGINT        NOT NULL,
  `desktop_email`  VARCHAR(191)  NOT NULL,
  `linked_at`      DATETIME      NOT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `desktop_links_email_key` (`desktop_email`),
  CONSTRAINT `desktop_links_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================== verification
SELECT 'migration 014 applied' AS result;
SELECT COUNT(*) AS desktop_links_table_present
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'desktop_links';
