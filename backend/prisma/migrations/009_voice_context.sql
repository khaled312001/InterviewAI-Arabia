-- Interprova — migration 009_voice_context.sql
--
-- Follows 008. Additive and idempotent, same shape and same reason: Hostinger's
-- MySQL is migrated offline with the mysql client.
--
--   mysql -u u405809647_interview -p u405809647_interview < 009_voice_context.sql
--
-- WHAT IT IS FOR: one column holding the interview context — company, role,
-- job description, CV summary, market — for the duration of a live voice call.
--
-- WHY IT NEEDS A COLUMN WHEN THE TYPED INTERVIEW DOES NOT. In the typed flow
-- the client posts the context with every /turn, and that is fine there: the
-- client is the only party in the conversation and the CV is its own user's.
-- The voice flow adds a third party. Deepgram holds the websocket and calls
-- /api/voice/think for each turn, so the interviewer's instructions have to be
-- reconstructed from somewhere the CLIENT cannot reach — otherwise the prompt
-- would be whatever arrives over HTTP from the public internet, and the CV and
-- the persona would be editable by the candidate being interviewed.
--
-- WHY NOT THE TOKEN: the same data in a JWT is roughly ten kilobytes in an
-- HTTP header on every single turn, which is both wasteful and close enough to
-- common header limits to fail in production rather than in testing.
--
-- LIFETIME: written at /api/voice/session, read on each turn, and meaningful
-- only while the meeting is live. It is not cleared on /end — a finished
-- meeting's context is exactly what the final evaluation is written against,
-- and the row is already scoped to one user and one interview.

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

-- NULL for every existing row, and for every meeting that never opens a voice
-- session. The typed interview neither writes nor reads it.
CALL iaa_add_column('meeting_sessions', 'voice_context',
  '`voice_context` TEXT NULL AFTER `client`');

-- ========================================================== verification
SELECT 'migration 009 applied' AS result;
SELECT COUNT(*) AS voice_context_present
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME = 'meeting_sessions'
   AND COLUMN_NAME = 'voice_context';
