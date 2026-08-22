-- InterviewAI Arabia — migration 005_provider_credentials.sql
--
-- Follows 004. Additive and idempotent, same reason and same shape: Hostinger's
-- MySQL is migrated offline (`prisma migrate deploy` wants a shadow database,
-- which needs CREATE DATABASE, which the shared account does not have).
--
--   mysql -u u405809647_interview -p u405809647_interview < 005_provider_credentials.sql
--
-- WHAT IT IS FOR: the table that `ProviderCredential` in schema.prisma has
-- always described and that nothing ever created.
--
-- HOW IT WAS FOUND: every request was logging
--   warn: Table 'u405809647_interview.provider_credentials' doesn't exist
-- and a diff of the 19 `@@map` names in schema.prisma against `SHOW TABLES`
-- returned exactly one missing name — this one. Prisma never noticed because
-- the migrations here are hand-written SQL, not `prisma migrate`, so a model
-- added to the schema without a matching .sql file simply never exists.
--
-- WHAT WAS BROKEN BY IT: the whole Admin → التكاملات credential store. Every
-- provider key had to come from `.env`, which means a deploy — so "set the
-- EasyKash key from the admin panel" and "swap the AI provider key without
-- redeploying" were both impossible, silently. That is why an exhausted Gemini
-- free-tier quota took the interview offline with no way for an operator to
-- fix it from the panel.
--
-- Nothing here narrows or removes anything, so a rolled-back backend keeps
-- running: it simply goes back to ignoring the table.

CREATE TABLE IF NOT EXISTS `provider_credentials` (
  -- The setting name, e.g. 'ANTHROPIC_API_KEY'. Matches the registry in
  -- backend/src/services/secrets/registry.js.
  `key`         VARCHAR(100) NOT NULL,

  -- Secrets go to `value_enc`, encrypted; clear configuration (a base URL, a
  -- model name) goes to `value_plain`. Exactly one is populated. Splitting
  -- them is what lets the admin API return a plain value as-is and a secret as
  -- nothing but `last4`.
  `is_secret`   TINYINT(1)   NOT NULL DEFAULT 1,
  `value_enc`   TEXT         NULL,
  `value_plain` TEXT         NULL,

  -- The only fragment of a secret any response may contain, so an operator can
  -- tell which key is installed without the panel ever being able to leak it.
  `last4`       VARCHAR(8)   NULL,

  -- The admin who last wrote it. Deliberately NOT a foreign key: a deleted
  -- admin must not cascade into deleting the credential that keeps payments
  -- working, and must not block the delete either.
  `updated_by`  BIGINT       NULL,
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                             ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Proof, in the migration output, that the table the backend has been warning
-- about on every request now exists.
SELECT COUNT(*) AS provider_credentials_table_present
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'provider_credentials';
