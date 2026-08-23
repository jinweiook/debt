CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`username` varchar(64) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`role` varchar(16) NOT NULL DEFAULT 'admin',
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT '2026-08-22 06:55:53.714',
	`updated_at` datetime(3) NOT NULL DEFAULT '2026-08-22 06:55:53.714',
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_users_username` UNIQUE(`username`)
);
--> statement-breakpoint
ALTER TABLE `advances` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-22 06:55:53.714';--> statement-breakpoint
ALTER TABLE `debt_accounts` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-22 06:55:53.713';--> statement-breakpoint
ALTER TABLE `debt_accounts` MODIFY COLUMN `updated_at` datetime(3) NOT NULL DEFAULT '2026-08-22 06:55:53.713';--> statement-breakpoint
ALTER TABLE `persons` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-22 06:55:53.713';--> statement-breakpoint
ALTER TABLE `persons` MODIFY COLUMN `updated_at` datetime(3) NOT NULL DEFAULT '2026-08-22 06:55:53.713';--> statement-breakpoint
ALTER TABLE `repayments` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-22 06:55:53.713';--> statement-breakpoint
CREATE INDEX `idx_users_status` ON `users` (`status`);