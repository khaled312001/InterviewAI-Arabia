-- Interprova — migration 010_career_platform.sql
--
-- Follows 009. Additive and idempotent: every table is CREATE TABLE IF NOT
-- EXISTS, so re-running the file is safe, the same as every migration here.
--
--   mysql -u u405809647_interview -p u405809647_interview < 010_career_platform.sql
--
-- WHAT IT IS FOR: the career platform — a global job index fed by public job
-- APIs, the user's master CV, CV versions tailored to a job, the application
-- tracker, and saved searches with email alerts.
--
-- WHY THESE TABLES ARE NOT IN schema.prisma. Every query on them goes through
-- mysql2 (src/db/mysql.js). Job search is FULLTEXT + facets — exactly the kind
-- of findMany that panics Prisma's engine on this host — and keeping them out
-- of the Prisma client means shipping this feature needs no `prisma generate`
-- on the server, which is the step that fails under the thread limit.
--
-- SIZE. `description` is plain text capped at 20,000 characters by the
-- ingester. Jobs not seen in their feed for a while are marked inactive and
-- deleted after 45 days (services/jobs/store.js:prune), so the table stays in
-- the tens of thousands of rows, not millions.

-- ------------------------------------------------------------- jobs

CREATE TABLE IF NOT EXISTS `jobs` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Which feed it came from ('arbeitnow', 'greenhouse', ...) and that feed's id.
  `source`           VARCHAR(32)   NOT NULL,
  `source_board`     VARCHAR(64)   NULL,
  `external_id`      VARCHAR(191)  NOT NULL,
  -- Same job seen through two feeds (a company board AND an aggregator) is one
  -- row: normalised title + company + country.
  `dedup_hash`       CHAR(40)      NOT NULL,
  `title`            VARCHAR(255)  NOT NULL,
  `company`          VARCHAR(191)  NOT NULL,
  `company_logo`     VARCHAR(500)  NULL,
  `url`              VARCHAR(700)  NOT NULL,
  `apply_url`        VARCHAR(700)  NULL,
  `location`         VARCHAR(255)  NULL,
  -- ISO 3166-1 alpha-2, or NULL when the posting names no country ("Worldwide").
  `country`          CHAR(2)       NULL,
  `city`             VARCHAR(120)  NULL,
  `workplace`        ENUM('onsite','hybrid','remote') NOT NULL DEFAULT 'onsite',
  `employment_type`  ENUM('full_time','part_time','contract','internship','temporary') NULL,
  `seniority`        ENUM('intern','junior','mid','senior','lead','executive') NULL,
  `category`         VARCHAR(64)   NULL,
  `salary_min`       INT UNSIGNED  NULL,
  `salary_max`       INT UNSIGNED  NULL,
  `salary_currency`  CHAR(3)       NULL,
  `salary_period`    ENUM('year','month','hour') NULL,
  `description`      MEDIUMTEXT    NOT NULL,
  -- Comma-separated canonical skill keys, for matching (services/jobs/skills.js).
  `skills`           VARCHAR(1000) NULL,
  `language`         CHAR(2)       NULL,
  `posted_at`        DATETIME      NOT NULL,
  `first_seen_at`    DATETIME      NOT NULL,
  `last_seen_at`     DATETIME      NOT NULL,
  `is_active`        TINYINT(1)    NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `jobs_source_ext` (`source`, `external_id`),
  KEY `jobs_dedup` (`dedup_hash`),
  KEY `jobs_active_posted` (`is_active`, `posted_at`),
  KEY `jobs_country` (`country`, `is_active`, `posted_at`),
  KEY `jobs_workplace` (`workplace`, `is_active`),
  KEY `jobs_source_seen` (`source`, `last_seen_at`),
  FULLTEXT KEY `jobs_ft` (`title`, `company`, `skills`),
  FULLTEXT KEY `jobs_ft_desc` (`title`, `company`, `skills`, `description`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per feed fetch. The admin panel and the ingester both read it: the
-- ingester to decide which feed is due, the operator to see which one broke.
CREATE TABLE IF NOT EXISTS `job_source_runs` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source`       VARCHAR(64)  NOT NULL,
  `started_at`   DATETIME     NOT NULL,
  `finished_at`  DATETIME     NULL,
  `fetched`      INT          NOT NULL DEFAULT 0,
  `inserted`     INT          NOT NULL DEFAULT 0,
  `updated`      INT          NOT NULL DEFAULT 0,
  `ok`           TINYINT(1)   NOT NULL DEFAULT 0,
  `error`        VARCHAR(500) NULL,
  PRIMARY KEY (`id`),
  KEY `runs_source_started` (`source`, `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------- career

-- The master CV: everything the person has done, structured. Every tailored
-- version is derived from it and nothing is ever invented beyond it.
CREATE TABLE IF NOT EXISTS `career_profiles` (
  `user_id`        BIGINT       NOT NULL,
  `data`           JSON         NOT NULL,
  -- Canonical skill keys pulled from `data`, cached for matching.
  `skills`         VARCHAR(1000) NULL,
  `target_title`   VARCHAR(191) NULL,
  `target_country` CHAR(2)      NULL,
  `open_to_remote` TINYINT(1)   NOT NULL DEFAULT 1,
  `years`          DECIMAL(4,1) NULL,
  `created_at`     DATETIME     NOT NULL,
  `updated_at`     DATETIME     NOT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `career_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A CV as sent: the master, or a copy tailored to one job.
CREATE TABLE IF NOT EXISTS `cv_versions` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      BIGINT       NOT NULL,
  `job_id`       BIGINT UNSIGNED NULL,
  `title`        VARCHAR(191) NOT NULL,
  `template`     VARCHAR(32)  NOT NULL DEFAULT 'classic',
  `language`     CHAR(2)      NOT NULL DEFAULT 'en',
  `data`         JSON         NOT NULL,
  `cover_letter` TEXT         NULL,
  `ats_score`    TINYINT UNSIGNED NULL,
  `created_at`   DATETIME     NOT NULL,
  `updated_at`   DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `cv_versions_user` (`user_id`, `updated_at`),
  CONSTRAINT `cv_versions_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The tracker. A job may come from the index (`job_id`) or be typed in by
-- hand for a posting we never saw, which is why title/company live here too.
CREATE TABLE IF NOT EXISTS `job_applications` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`        BIGINT       NOT NULL,
  `job_id`         BIGINT UNSIGNED NULL,
  `title`          VARCHAR(255) NOT NULL,
  `company`        VARCHAR(191) NOT NULL,
  `url`            VARCHAR(700) NULL,
  `location`       VARCHAR(255) NULL,
  `status`         ENUM('saved','applied','screening','interview','offer','accepted','rejected','withdrawn') NOT NULL DEFAULT 'saved',
  `notes`          TEXT         NULL,
  `cv_version_id`  BIGINT UNSIGNED NULL,
  `match_score`    TINYINT UNSIGNED NULL,
  `applied_at`     DATETIME     NULL,
  `next_action_at` DATETIME     NULL,
  `created_at`     DATETIME     NOT NULL,
  `updated_at`     DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `job_applications_user_job` (`user_id`, `job_id`),
  KEY `job_applications_user_status` (`user_id`, `status`, `updated_at`),
  CONSTRAINT `job_applications_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A search the person wants to hear about. `query` is the same JSON the search
-- endpoint takes, so an alert runs exactly the search that was saved.
CREATE TABLE IF NOT EXISTS `saved_searches` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       BIGINT       NOT NULL,
  `name`          VARCHAR(120) NOT NULL,
  `query`         JSON         NOT NULL,
  `frequency`     ENUM('off','daily','weekly') NOT NULL DEFAULT 'daily',
  `last_sent_at`  DATETIME     NULL,
  `created_at`    DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `saved_searches_user` (`user_id`),
  KEY `saved_searches_due` (`frequency`, `last_sent_at`),
  CONSTRAINT `saved_searches_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================== verification
SELECT 'migration 010 applied' AS result;
SELECT TABLE_NAME FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN ('jobs','job_source_runs','career_profiles','cv_versions','job_applications','saved_searches');
