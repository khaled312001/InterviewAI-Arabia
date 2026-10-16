-- Interprova — migration 012_free_first_use.sql
--
-- Follows 011. Additive and idempotent: one CREATE TABLE IF NOT EXISTS, so
-- re-running the file on every deploy (scripts/deploy.sh) is safe.
--
-- WHAT IT IS FOR: "your first one is free". The first time a person uses each
-- AI career tool (CV import, tailoring a CV to a job, a cover letter, rewriting
-- bullets, a CV written from scratch) it costs no balance. One row per person
-- per tool records that the free use was taken; the primary key makes taking
-- it a single atomic INSERT IGNORE, so two parallel requests cannot both be
-- free. If the AI call then fails, the row is deleted and the free use is
-- still there for the next try.
--
-- Turned off without a deploy by the app setting `career_first_use_free`.

CREATE TABLE IF NOT EXISTS `career_free_uses` (
  `user_id`   BIGINT       NOT NULL,
  `feature`   VARCHAR(32)  NOT NULL,
  `used_at`   DATETIME     NOT NULL,
  PRIMARY KEY (`user_id`, `feature`),
  CONSTRAINT `career_free_uses_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================== verification
SELECT 'migration 012 applied' AS result;
SELECT COUNT(*) AS career_free_uses_table_present
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'career_free_uses';
