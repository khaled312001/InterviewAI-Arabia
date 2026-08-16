-- Integration credentials for the admin panel's /integrations/* pages.
--
-- Separate from `app_settings` on purpose: that table is returned unredacted
-- by GET /admin/settings to every admin role, so a payment gateway key stored
-- there would be readable by a content_editor. This one is only ever read by
-- super_admin routes, and secrets are AES-256-GCM encrypted before they land
-- in `value_enc` (see backend/src/services/secrets/crypto.js).
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS `provider_credentials` (
  `key`         VARCHAR(100) NOT NULL,
  -- Secrets go to value_enc; non-secret config (base URL, model name, provider)
  -- stays in value_plain because the owner needs to read it back.
  `is_secret`   TINYINT(1)   NOT NULL DEFAULT 1,
  `value_enc`   TEXT         NULL,
  `value_plain` TEXT         NULL,
  -- The last four characters of a secret: enough for an operator to confirm
  -- which key is installed, useless to anyone who steals the row.
  `last4`       VARCHAR(8)   NULL,
  `updated_by`  BIGINT       NULL,
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`key`),
  KEY `provider_credentials_updated_by_idx` (`updated_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No FK to admin_users: deleting an admin must not cascade away the record of
-- which credentials they installed, and ON DELETE SET NULL would need the
-- column nullable anyway (it is). The admin name is resolved with a LEFT JOIN.
