-- Interprova — migration 008_device_news_opt_out.sql
--
-- Follows 007. Additive and idempotent, same shape and same reason: Hostinger's
-- MySQL is migrated offline with the mysql client.
--
--   mysql -u u405809647_interview -p u405809647_interview < 008_device_news_opt_out.sql
--
-- WHAT IT IS FOR: the "Product news and offers" switch in the app's Settings.
-- It used to be saved on the phone and nowhere else, so a reader who turned it
-- off went on receiving every admin broadcast — the switch was decoration.
--
-- WHY ON THE DEVICE AND NOT ON THE USER: broadcasts are addressed to devices
-- (signed-out installs included), and the preference is made on a device. The
-- same column also carries the master "Notifications" switch: turning that off
-- only detached the account from the token, which silenced the per-account
-- notifications and left the handset in every broadcast.
--
-- Scope: broadcasts only (audiences 'all', 'subscribers', 'trial', 'recent').
-- Notifications about the reader's own account — evaluation ready, low balance
-- — go to audience 'user' and are not affected.

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

DELIMITER ;

-- 0 for every existing row: an install that has never sent the field is on a
-- build without the switch, and has not opted out of anything.
CALL iaa_add_column('device_tokens', 'news_opt_out',
  '`news_opt_out` TINYINT(1) NOT NULL DEFAULT 0 AFTER `app_version`');

-- ========================================================== verification
SELECT 'migration 008 applied' AS result;
SELECT COUNT(*) AS news_opt_out_present
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME = 'device_tokens'
   AND COLUMN_NAME = 'news_opt_out';
