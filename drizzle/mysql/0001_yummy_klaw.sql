CREATE TABLE `role_permissions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`role_id` bigint NOT NULL,
	`permission_code` varchar(64) NOT NULL,
	CONSTRAINT `role_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_role_perm` UNIQUE(`role_id`,`permission_code`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(64) NOT NULL,
	`description` varchar(255),
	`data_scope` varchar(16) NOT NULL DEFAULT 'self',
	`is_system` smallint NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_roles_code` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`role_id` bigint NOT NULL,
	CONSTRAINT `user_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_user_role` UNIQUE(`user_id`,`role_id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `display_name` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `note` varchar(512);--> statement-breakpoint
CREATE INDEX `idx_role_perm_role` ON `role_permissions` (`role_id`);--> statement-breakpoint
CREATE INDEX `idx_user_role_user` ON `user_roles` (`user_id`);