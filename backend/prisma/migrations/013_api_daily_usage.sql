-- Interprova — migration 013_api_daily_usage.sql
--
-- Follows 012. Additive and idempotent: one CREATE TABLE IF NOT EXISTS, so
-- re-running the file on every deploy (scripts/deploy.sh) is safe.
--
-- WHAT IT IS FOR: some job feeds come with a small request allowance (Jooble's
-- free key: 500 requests). Live search would spend that in a day, so each call
-- first takes one unit from today's row here and is skipped once the daily cap
-- (app setting `jooble_daily_calls`) is reached. One row per provider per day;
-- the increment is a single atomic upsert, so every copy of the app shares it.

CREATE TABLE IF NOT EXISTS `api_daily_usage` (
  `provider`  VARCHAR(32)  NOT NULL,
  `day`       DATE         NOT NULL,
  `calls`     INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`provider`, `day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================== verification
SELECT 'migration 013 applied' AS result;
SELECT COUNT(*) AS api_daily_usage_table_present
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'api_daily_usage';
