ALTER TABLE `advances` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-29 01:59:38.251';--> statement-breakpoint
ALTER TABLE `debt_accounts` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-29 01:59:38.251';--> statement-breakpoint
ALTER TABLE `debt_accounts` MODIFY COLUMN `updated_at` datetime(3) NOT NULL DEFAULT '2026-08-29 01:59:38.251';--> statement-breakpoint
ALTER TABLE `persons` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-29 01:59:38.250';--> statement-breakpoint
ALTER TABLE `persons` MODIFY COLUMN `updated_at` datetime(3) NOT NULL DEFAULT '2026-08-29 01:59:38.250';--> statement-breakpoint
ALTER TABLE `repayments` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-29 01:59:38.251';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` varchar(16) NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-29 01:59:38.251';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `updated_at` datetime(3) NOT NULL DEFAULT '2026-08-29 01:59:38.251';--> statement-breakpoint
ALTER TABLE `persons` ADD `owner_user_id` bigint unsigned NULL;--> statement-breakpoint
UPDATE `persons` SET `owner_user_id` = COALESCE(
  (SELECT `id` FROM `users` WHERE `role` = 'admin' ORDER BY `id` LIMIT 1),
  (SELECT `id` FROM `users` ORDER BY `id` LIMIT 1),
  0
) WHERE `owner_user_id` IS NULL;--> statement-breakpoint
ALTER TABLE `persons` MODIFY COLUMN `owner_user_id` bigint unsigned NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_persons_owner` ON `persons` (`owner_user_id`,`status`);