CREATE TABLE `login_attempts` (
	`username` varchar(64) NOT NULL,
	`fail_count` int NOT NULL DEFAULT 0,
	`locked_until` datetime(3),
	`updated_at` datetime(3) NOT NULL DEFAULT '2026-08-30 05:14:00.014',
	CONSTRAINT `login_attempts_username` PRIMARY KEY(`username`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(36) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT '2026-08-30 05:14:00.013',
	`expires_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL DEFAULT '2026-08-30 05:14:00.013',
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `advances` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-30 05:14:00.013';--> statement-breakpoint
ALTER TABLE `debt_accounts` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-30 05:14:00.013';--> statement-breakpoint
ALTER TABLE `debt_accounts` MODIFY COLUMN `updated_at` datetime(3) NOT NULL DEFAULT '2026-08-30 05:14:00.013';--> statement-breakpoint
ALTER TABLE `persons` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-30 05:14:00.013';--> statement-breakpoint
ALTER TABLE `persons` MODIFY COLUMN `updated_at` datetime(3) NOT NULL DEFAULT '2026-08-30 05:14:00.013';--> statement-breakpoint
ALTER TABLE `repayments` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-30 05:14:00.013';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-30 05:14:00.013';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `updated_at` datetime(3) NOT NULL DEFAULT '2026-08-30 05:14:00.013';--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires_at`);