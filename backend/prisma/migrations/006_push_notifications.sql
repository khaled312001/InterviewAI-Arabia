-- InterviewAI Arabia — migration 006_push_notifications.sql
--
-- Follows 005. Additive and idempotent, same reason and same shape: Hostinger's
-- MySQL is migrated offline (`prisma migrate deploy` wants a shadow database,
-- which needs CREATE DATABASE, which the shared account does not have).
--
--   mysql -u u405809647_interview -p u405809647_interview < 006_push_notifications.sql
--
-- WHAT IT IS FOR: push notifications over Firebase Cloud Messaging — where the
-- device addresses live, and what was sent to whom.

-- ========================================================= device_tokens

-- One row per (device, account).
--
-- The FCM registration token is the PRIMARY KEY rather than an autoincrement id.
-- That is the whole design: a token is globally unique and is what FCM
-- addresses, so making it the key means "the same device signed in again" is an
-- UPSERT rather than a duplicate row, and there is no way to end up with two
-- live rows pointing at one handset — which is how a push system starts
-- delivering everything twice.
--
-- `user_id` is nullable so a token can be registered before sign-in (for
-- announcements to signed-out installs) and survives sign-out by being nulled
-- rather than deleted — the device is still reachable, it just is not anybody's
-- any more. Deleting on sign-out is why "notify me again after I log back in"
-- silently stops working.
CREATE TABLE IF NOT EXISTS `device_tokens` (
  `token`       VARCHAR(255) NOT NULL,
  `user_id`     BIGINT       NULL,
  `platform`    VARCHAR(16)  NOT NULL DEFAULT 'android',
  -- Which language to send in. Held per DEVICE, not per account: the same
  -- person may read Arabic on their phone and English on the web.
  `language`    VARCHAR(8)   NOT NULL DEFAULT 'ar',
  -- The install id this device already sends as X-Install-Id, so a token can be
  -- tied back to an install without a second identifier.
  `install_id`  VARCHAR(191) NULL,
  `app_version` VARCHAR(32)  NULL,
  -- Set when FCM says the token is dead (UNREGISTERED / INVALID_ARGUMENT).
  -- Soft-retired rather than deleted so "how many devices went stale this week"
  -- is answerable, and so a broadcast's denominator is honest.
  `disabled_at` DATETIME(3)  NULL,
  `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`token`),
  -- The two queries that exist: "every live token for this user" and "every
  -- live token" for a broadcast.
  KEY `device_tokens_user_idx` (`user_id`, `disabled_at`),
  KEY `device_tokens_live_idx` (`disabled_at`, `platform`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================== notifications

-- What was sent, to whom, and whether it landed.
--
-- Exists so a broadcast is auditable and idempotent-ish: an operator who is not
-- sure whether they already sent the Ramadan announcement can look, rather than
-- send it twice to forty thousand people. `audience` records the intent
-- ('all' / 'user' / 'segment') and `sent`/`failed` the outcome, so a run that
-- reported success while every token was dead is visible as sent=0.
CREATE TABLE IF NOT EXISTS `notifications` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `title_ar`    VARCHAR(200) NOT NULL,
  `body_ar`     VARCHAR(500) NOT NULL,
  `title_en`    VARCHAR(200) NULL,
  `body_en`     VARCHAR(500) NULL,
  -- Where a tap should land, e.g. 'Subscription' or 'Ledger'. Read by the app
  -- from the FCM data payload.
  `route`       VARCHAR(64)  NULL,
  -- 'all' | 'user' | 'subscribers' | 'trial' — see services/push/audience.js.
  `audience`    VARCHAR(32)  NOT NULL DEFAULT 'all',
  `user_id`     BIGINT       NULL,
  -- 'manual' for an operator broadcast, or the event name for an automatic one
  -- ('low_balance', 'evaluation_ready'). Lets the automatic traffic be counted
  -- and, if it ever becomes annoying, switched off by kind.
  `kind`        VARCHAR(48)  NOT NULL DEFAULT 'manual',
  `sent_count`   INT         NOT NULL DEFAULT 0,
  `failed_count` INT         NOT NULL DEFAULT 0,
  `created_by`  BIGINT       NULL,
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `notifications_user_idx` (`user_id`, `created_at`),
  KEY `notifications_kind_idx` (`kind`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================== app_settings

-- Per-kind kill switches for the automatic notifications, so an operator can
-- silence one without silencing all of them and without a deploy. Seeded ON.
INSERT IGNORE INTO `app_settings` (`key`, `value`, `updated_at`) VALUES
  ('push_low_balance_enabled',      'true', NOW(3)),
  ('push_evaluation_ready_enabled', 'true', NOW(3)),
  ('push_trial_reminder_enabled',   'true', NOW(3));

SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device_tokens')  AS device_tokens_present,
  (SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications')  AS notifications_present;
