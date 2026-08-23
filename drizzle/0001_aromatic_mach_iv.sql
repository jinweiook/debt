ALTER TABLE `advances` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-22 04:08:20.079';--> statement-breakpoint
ALTER TABLE `debt_accounts` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-22 04:08:20.079';--> statement-breakpoint
ALTER TABLE `debt_accounts` MODIFY COLUMN `updated_at` datetime(3) NOT NULL DEFAULT '2026-08-22 04:08:20.079';--> statement-breakpoint
ALTER TABLE `persons` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-22 04:08:20.079';--> statement-breakpoint
ALTER TABLE `persons` MODIFY COLUMN `updated_at` datetime(3) NOT NULL DEFAULT '2026-08-22 04:08:20.079';--> statement-breakpoint
ALTER TABLE `repayments` MODIFY COLUMN `created_at` datetime(3) NOT NULL DEFAULT '2026-08-22 04:08:20.079';--> statement-breakpoint
ALTER TABLE `debt_accounts` ADD `interest_mode` varchar(16) DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE `debt_accounts` ADD `dynamic_plan` varchar(16);