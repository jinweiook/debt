CREATE TABLE `advances` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`person_id` bigint unsigned NOT NULL,
	`bill_id` bigint unsigned NOT NULL,
	`amount_cents` bigint NOT NULL,
	`advance_date` date NOT NULL,
	`generated_account_id` bigint unsigned NOT NULL,
	`note` varchar(512),
	`created_at` datetime(3) NOT NULL DEFAULT '2026-08-16 05:42:59.274',
	CONSTRAINT `advances_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_advances_bill` UNIQUE(`bill_id`)
);
--> statement-breakpoint
CREATE TABLE `debt_accounts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`person_id` bigint unsigned NOT NULL,
	`type` varchar(16) NOT NULL,
	`title` varchar(128) NOT NULL,
	`source` varchar(64),
	`principal_cents` bigint NOT NULL,
	`remaining_principal_cents` bigint NOT NULL,
	`interest_type` varchar(16) NOT NULL DEFAULT 'none',
	`fixed_interest_cents` bigint,
	`annual_rate_bps` int,
	`accrued_interest_cents` bigint NOT NULL DEFAULT 0,
	`paid_interest_cents` bigint NOT NULL DEFAULT 0,
	`last_accrual_month` char(7),
	`start_date` date NOT NULL,
	`term_months` int,
	`status` varchar(16) NOT NULL DEFAULT 'open',
	`origin` varchar(16) NOT NULL DEFAULT 'manual',
	`advance_id` bigint unsigned,
	`note` varchar(512),
	`created_at` datetime(3) NOT NULL DEFAULT '2026-08-16 05:42:59.273',
	`updated_at` datetime(3) NOT NULL DEFAULT '2026-08-16 05:42:59.273',
	CONSTRAINT `debt_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `installment_bills` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`account_id` bigint unsigned NOT NULL,
	`period_no` int NOT NULL,
	`due_date` date NOT NULL,
	`principal_cents` bigint NOT NULL,
	`interest_cents` bigint NOT NULL,
	`total_cents` bigint NOT NULL,
	`paid_cents` bigint NOT NULL DEFAULT 0,
	`paid_interest_cents` bigint NOT NULL DEFAULT 0,
	`paid_principal_cents` bigint NOT NULL DEFAULT 0,
	`advanced` tinyint NOT NULL DEFAULT 0,
	`advance_id` bigint unsigned,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`note` varchar(512),
	CONSTRAINT `installment_bills_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_bill_account_period` UNIQUE(`account_id`,`period_no`)
);
--> statement-breakpoint
CREATE TABLE `persons` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`note` varchar(512),
	`contact` varchar(128),
	`default_repay_day` tinyint unsigned,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT '2026-08-16 05:42:59.273',
	`updated_at` datetime(3) NOT NULL DEFAULT '2026-08-16 05:42:59.273',
	CONSTRAINT `persons_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `repayments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`person_id` bigint unsigned NOT NULL,
	`target_type` varchar(16) NOT NULL,
	`bill_id` bigint unsigned,
	`account_id` bigint unsigned,
	`amount_cents` bigint NOT NULL,
	`interest_part_cents` bigint NOT NULL,
	`principal_part_cents` bigint NOT NULL,
	`batch_id` char(36),
	`repaid_at` date NOT NULL,
	`note` varchar(512),
	`created_at` datetime(3) NOT NULL DEFAULT '2026-08-16 05:42:59.274',
	CONSTRAINT `repayments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_adv_person` ON `advances` (`person_id`);--> statement-breakpoint
CREATE INDEX `idx_accounts_person` ON `debt_accounts` (`person_id`,`type`,`status`);--> statement-breakpoint
CREATE INDEX `idx_accounts_status` ON `debt_accounts` (`status`);--> statement-breakpoint
CREATE INDEX `idx_bills_due` ON `installment_bills` (`due_date`,`status`);--> statement-breakpoint
CREATE INDEX `idx_persons_status` ON `persons` (`status`);--> statement-breakpoint
CREATE INDEX `idx_rep_person` ON `repayments` (`person_id`,`repaid_at`);--> statement-breakpoint
CREATE INDEX `idx_rep_bill` ON `repayments` (`bill_id`);--> statement-breakpoint
CREATE INDEX `idx_rep_account` ON `repayments` (`account_id`);