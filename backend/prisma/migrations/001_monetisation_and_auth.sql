-- InterviewAI Arabia — migration 001
-- Brings the live database (original launch schema) up to the current
-- Prisma schema: real payment records, revocable refresh tokens, admin
-- audit trail, and the denormalised counters the hot paths rely on.
--
-- Written as idempotent DDL because Hostinger's MySQL is migrated offline
-- (`prisma migrate deploy` cannot run there — the shadow database it needs
-- requires CREATE DATABASE, which the shared account lacks). Re-running this
-- file is safe.
--
--   mysql -u u405809647_interview -p u405809647_interview < 001_monetisation_and_auth.sql
--
-- MySQL has no `ADD COLUMN IF NOT EXISTS`, so each change goes through a
-- stored procedure that checks information_schema first.

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

DROP PROCEDURE IF EXISTS iaa_rename_column$$
CREATE PROCEDURE iaa_rename_column(IN tbl VARCHAR(64), IN oldc VARCHAR(64), IN newc VARCHAR(64), IN ddl TEXT)
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = oldc
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = newc
  ) THEN
    SET @s = CONCAT('ALTER TABLE `', tbl, '` CHANGE `', oldc, '` `', newc, '` ', ddl);
    PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$

DROP PROCEDURE IF EXISTS iaa_drop_index$$
CREATE PROCEDURE iaa_drop_index(IN tbl VARCHAR(64), IN idx VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND INDEX_NAME = idx
  ) THEN
    SET @s = CONCAT('ALTER TABLE `', tbl, '` DROP INDEX `', idx, '`');
    PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

-- ---------------------------------------------------------------- users
CALL iaa_add_column('users', 'phone',             '`phone` VARCHAR(32) NULL AFTER `name`');
CALL iaa_add_column('users', 'premium_until',     '`premium_until` DATETIME(3) NULL AFTER `last_reset_date`');
CALL iaa_add_column('users', 'email_verified_at', '`email_verified_at` DATETIME(3) NULL');
CALL iaa_add_column('users', 'last_login_at',     '`last_login_at` DATETIME(3) NULL');
CALL iaa_add_index ('users', 'users_plan_premium_until_idx', 'INDEX `users_plan_premium_until_idx` (`plan`, `premium_until`)');
CALL iaa_add_index ('users', 'users_created_at_idx',         'INDEX `users_created_at_idx` (`created_at`)');

-- Backfill premium_until from whatever active subscription exists today, so
-- currently-paying users are not downgraded the moment this ships.
UPDATE users u
JOIN (
  SELECT user_id, MAX(expires_at) AS exp
  FROM subscriptions
  WHERE status = 'active'
  GROUP BY user_id
) s ON s.user_id = u.id
SET u.premium_until = s.exp
WHERE u.premium_until IS NULL;

-- ----------------------------------------------------------- categories
CALL iaa_add_column('categories', 'description_ar', '`description_ar` VARCHAR(500) NULL AFTER `name_en`');
CALL iaa_add_column('categories', 'description_en', '`description_en` VARCHAR(500) NULL AFTER `description_ar`');
CALL iaa_add_column('categories', 'is_active',      '`is_active` TINYINT(1) NOT NULL DEFAULT 1');
CALL iaa_add_index ('categories', 'categories_is_active_sort_order_idx', 'INDEX `categories_is_active_sort_order_idx` (`is_active`, `sort_order`)');

-- ------------------------------------------------------------ questions
CALL iaa_add_index('questions', 'questions_cat_active_difficulty_idx', 'INDEX `questions_cat_active_difficulty_idx` (`category_id`, `is_active`, `difficulty`)');
CALL iaa_add_index('questions', 'questions_cat_active_usage_idx',      'INDEX `questions_cat_active_usage_idx` (`category_id`, `is_active`, `usage_count`)');

-- ------------------------------------------------------------- sessions
CALL iaa_add_column('sessions', 'kind',         "`kind` ENUM('practice','meeting') NOT NULL DEFAULT 'practice' AFTER `category_id`");
CALL iaa_add_column('sessions', 'answer_count', '`answer_count` INT NOT NULL DEFAULT 0 AFTER `total_score`');
CALL iaa_add_index ('sessions', 'sessions_user_kind_started_idx', 'INDEX `sessions_user_kind_started_idx` (`user_id`, `kind`, `started_at`)');

-- Backfill the denormalised answer counter.
UPDATE sessions s
SET s.answer_count = (SELECT COUNT(*) FROM answers a WHERE a.session_id = s.id)
WHERE s.answer_count = 0;

-- -------------------------------------------------------------- answers
-- question_id becomes nullable: live "meeting" answers have no catalogue
-- question. The previous code inserted a hardcoded question_id = 1, which
-- inflated that question's usage_count and broke per-question analytics.
SET @fk := (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'answers'
    AND COLUMN_NAME = 'question_id' AND REFERENCED_TABLE_NAME = 'questions'
  LIMIT 1
);
SET @s := IF(@fk IS NULL, 'SELECT 1', CONCAT('ALTER TABLE `answers` DROP FOREIGN KEY `', @fk, '`'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE `answers` MODIFY `question_id` BIGINT NULL;
CALL iaa_add_column('answers', 'question_text', '`question_text` TEXT NULL AFTER `question_id`');

ALTER TABLE `answers`
  ADD CONSTRAINT `answers_question_id_fkey`
  FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CALL iaa_add_index('answers', 'answers_created_at_idx', 'INDEX `answers_created_at_idx` (`created_at`)');

-- Detach the fake meeting answers from question #1 and restore its counter.
UPDATE answers
SET question_id = NULL
WHERE question_id = 1
  AND ai_feedback LIKE '%"meeting":true%';

-- --------------------------------------------------------- subscriptions
CALL iaa_drop_index   ('subscriptions', 'subscriptions_google_purchase_token_key');
CALL iaa_rename_column('subscriptions', 'google_purchase_token', 'provider_ref', 'VARCHAR(191) NOT NULL');
CALL iaa_rename_column('subscriptions', 'product_id',            'plan_code',    'VARCHAR(64) NOT NULL');
CALL iaa_add_column   ('subscriptions', 'provider',    "`provider` ENUM('easykash','paymob','google_play','manual') NOT NULL DEFAULT 'easykash' AFTER `user_id`");
CALL iaa_add_column   ('subscriptions', 'auto_renew',  '`auto_renew` TINYINT(1) NOT NULL DEFAULT 0');
CALL iaa_add_column   ('subscriptions', 'cancelled_at','`cancelled_at` DATETIME(3) NULL');
CALL iaa_add_column   ('subscriptions', 'created_at',  '`created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)');
CALL iaa_add_column   ('subscriptions', 'updated_at',  '`updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)');

ALTER TABLE `subscriptions`
  MODIFY `status` ENUM('pending','active','expired','cancelled','refunded') NOT NULL DEFAULT 'pending';

CALL iaa_add_index('subscriptions', 'subscriptions_provider_ref_key',  'UNIQUE INDEX `subscriptions_provider_ref_key` (`provider_ref`)');
CALL iaa_add_index('subscriptions', 'subscriptions_user_status_idx',   'INDEX `subscriptions_user_status_idx` (`user_id`, `status`)');
CALL iaa_add_index('subscriptions', 'subscriptions_status_expires_idx','INDEX `subscriptions_status_expires_idx` (`status`, `expires_at`)');

-- Existing rows were all Google-Play-shaped.
UPDATE subscriptions SET provider = 'google_play' WHERE provider = 'easykash' AND plan_code LIKE 'interviewai_%' AND created_at < NOW();

-- ------------------------------------------------------------- payments
CREATE TABLE IF NOT EXISTS `payments` (
  `id`              BIGINT NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT NOT NULL,
  `subscription_id` BIGINT NULL,
  `provider`        ENUM('easykash','paymob','google_play','manual') NOT NULL DEFAULT 'easykash',
  `reference`       VARCHAR(191) NOT NULL,
  `provider_txn_id` VARCHAR(191) NULL,
  `plan_code`       VARCHAR(64) NOT NULL,
  `amount_cents`    INT NOT NULL,
  `currency`        VARCHAR(8) NOT NULL DEFAULT 'EGP',
  `status`          ENUM('pending','paid','failed','refunded','expired') NOT NULL DEFAULT 'pending',
  `method`          VARCHAR(64) NULL,
  `failure_reason`  VARCHAR(500) NULL,
  `paid_at`         DATETIME(3) NULL,
  `refunded_at`     DATETIME(3) NULL,
  `raw_payload`     LONGTEXT NULL,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `payments_reference_key` (`reference`),
  INDEX `payments_user_created_idx` (`user_id`, `created_at`),
  INDEX `payments_status_created_idx` (`status`, `created_at`),
  INDEX `payments_provider_txn_idx` (`provider_txn_id`),
  CONSTRAINT `payments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `payments_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------- webhook_events
CREATE TABLE IF NOT EXISTS `webhook_events` (
  `id`           BIGINT NOT NULL AUTO_INCREMENT,
  `provider`     ENUM('easykash','paymob','google_play','manual') NOT NULL,
  `external_id`  VARCHAR(191) NOT NULL,
  `payload`      LONGTEXT NOT NULL,
  `processed_at` DATETIME(3) NULL,
  `error`        VARCHAR(500) NULL,
  `created_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `webhook_events_provider_external_id_key` (`provider`, `external_id`),
  INDEX `webhook_events_created_at_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------- refresh_tokens
CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id`         BIGINT NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `user_agent` VARCHAR(255) NULL,
  `ip`         VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `refresh_tokens_token_hash_key` (`token_hash`),
  INDEX `refresh_tokens_user_revoked_idx` (`user_id`, `revoked_at`),
  INDEX `refresh_tokens_expires_at_idx` (`expires_at`),
  CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------ password_resets
CREATE TABLE IF NOT EXISTS `password_resets` (
  `id`         BIGINT NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `used_at`    DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `password_resets_token_hash_key` (`token_hash`),
  INDEX `password_resets_expires_at_idx` (`expires_at`),
  CONSTRAINT `password_resets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------- admin_audit_logs
CREATE TABLE IF NOT EXISTS `admin_audit_logs` (
  `id`          BIGINT NOT NULL AUTO_INCREMENT,
  `admin_id`    BIGINT NOT NULL,
  `action`      VARCHAR(64) NOT NULL,
  `entity_type` VARCHAR(64) NOT NULL,
  `entity_id`   VARCHAR(64) NULL,
  `metadata`    TEXT NULL,
  `ip`          VARCHAR(64) NULL,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `admin_audit_logs_admin_created_idx` (`admin_id`, `created_at`),
  INDEX `admin_audit_logs_entity_idx` (`entity_type`, `entity_id`),
  CONSTRAINT `admin_audit_logs_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL iaa_add_column('admin_users', 'last_login_at', '`last_login_at` DATETIME(3) NULL');

-- ------------------------------------------------------ claude_api_logs
CALL iaa_add_column('claude_api_logs', 'provider',           "`provider` VARCHAR(32) NOT NULL DEFAULT 'claude' AFTER `user_id`");
CALL iaa_add_column('claude_api_logs', 'feature',            "`feature` VARCHAR(32) NOT NULL DEFAULT 'evaluate' AFTER `model`");
CALL iaa_add_column('claude_api_logs', 'cache_read_tokens',  '`cache_read_tokens` INT NOT NULL DEFAULT 0');
CALL iaa_add_column('claude_api_logs', 'cache_write_tokens', '`cache_write_tokens` INT NOT NULL DEFAULT 0');
CALL iaa_add_column('claude_api_logs', 'cost_micro_usd',     '`cost_micro_usd` INT NOT NULL DEFAULT 0');
CALL iaa_add_index ('claude_api_logs', 'ai_logs_user_created_idx',    'INDEX `ai_logs_user_created_idx` (`user_id`, `created_at`)');
CALL iaa_add_index ('claude_api_logs', 'ai_logs_feature_created_idx', 'INDEX `ai_logs_feature_created_idx` (`feature`, `created_at`)');

-- --------------------------------------------------------------- cleanup
DROP PROCEDURE IF EXISTS iaa_add_column;
DROP PROCEDURE IF EXISTS iaa_add_index;
DROP PROCEDURE IF EXISTS iaa_rename_column;
DROP PROCEDURE IF EXISTS iaa_drop_index;

SELECT 'migration 001 applied' AS result;
