-- InterviewAI Arabia — migration 003_metering_hardening.sql
--
-- Follows 002. Additive and idempotent, same reason and same shape: Hostinger's
-- MySQL is migrated offline (`prisma migrate deploy` wants a shadow database,
-- which needs CREATE DATABASE, which the shared account does not have).
--
--   mysql -u u405809647_interview -p u405809647_interview < 003_metering_hardening.sql
--
-- NOTE: this is NOT the migration that drops `daily_questions_used` /
-- `last_reset_date`. That one still belongs one release later, once no rollback
-- target reads them; it can be numbered 004. Nothing here narrows or removes a
-- column, so the currently-deployed backend keeps running against this schema.
--
-- WHAT IT IS FOR: one new metering constant, and cleaning two rows out of
-- app_settings that advertise a price the checkout will not honour.

-- ========================================================== app_settings

-- The ceiling on billable time between two consecutive turns of a client that
-- sends NO heartbeat (the legacy /turn path). The max-gap rule bills a missing
-- heartbeat at zero because a missing heartbeat is evidence of silence — but a
-- client that never promised one gives no such evidence, and zeroing every
-- inter-turn interval for it made a 30-minute interview cost fifteen turn
-- floors: 450 seconds billed for 1800 seconds delivered.
--
-- The backend falls back to this same default when the row is absent, so the
-- insert is about making the number visible and editable in the admin panel.
INSERT IGNORE INTO `app_settings` (`key`, `value`, `updated_at`) VALUES
  ('meeting_turn_gap_seconds', '120', NOW(3));

-- Two rows that predate the minute metering and contradict it: the seed wrote
-- 29 EGP a month and 249 EGP a year, while the catalogue in
-- backend/src/services/payments/plans.js says 150 EGP a month and has no yearly
-- plan at all. Nothing READS either row — which is exactly why they could sit
-- there being wrong — but the admin settings screen renders them, and an
-- operator cannot tell a display-only number from a live price.
--
-- The yearly row goes: it describes a product that cannot be bought. The
-- monthly row is corrected rather than deleted, because the admin registry
-- still lists it (badged `not-wired`, pointing at the catalogue) and a field
-- showing the right number is better than one showing nothing.
DELETE FROM `app_settings` WHERE `key` = 'subscription_yearly_price_egp';
UPDATE `app_settings` SET `value` = '150', `updated_at` = NOW(3)
 WHERE `key` = 'subscription_monthly_price_egp';

-- ========================================================== verification
SELECT 'migration 003 applied' AS result;
SELECT `key`, `value` FROM `app_settings`
 WHERE `key` IN ('meeting_turn_gap_seconds', 'subscription_monthly_price_egp');
SELECT COUNT(*) AS retired_yearly_price_rows FROM `app_settings`
 WHERE `key` = 'subscription_yearly_price_egp';
