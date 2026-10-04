CREATE TABLE `bill_payments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`bill_id` bigint unsigned NOT NULL,
	`period_key` varchar(32) NOT NULL,
	`paid_at` date NOT NULL,
	`transaction_id` bigint unsigned,
	CONSTRAINT `bill_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_billpay` UNIQUE(`user_id`,`bill_id`,`period_key`)
);
--> statement-breakpoint
CREATE TABLE `bills` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`name` varchar(64) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`category_id` bigint unsigned,
	`due_day` tinyint NOT NULL,
	`remind_days_before` tinyint NOT NULL DEFAULT 3,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `bills_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `budget_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`at` date NOT NULL,
	`mode` enum('month','week') NOT NULL,
	`month_budget` decimal(12,2) NOT NULL,
	`week_budget_override` decimal(12,2),
	`cycle_start_day` tinyint NOT NULL,
	`week_starts_on` tinyint NOT NULL,
	`note` varchar(128),
	`created_at` datetime NOT NULL,
	CONSTRAINT `budget_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`name` varchar(32) NOT NULL,
	`icon` varchar(16) NOT NULL DEFAULT '',
	`color` varchar(16) NOT NULL DEFAULT '#64748b',
	`sort` int NOT NULL DEFAULT 0,
	`type` varchar(16) NOT NULL DEFAULT 'expense',
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_cat_user_name` UNIQUE(`user_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`user_id` bigint unsigned NOT NULL,
	`key` varchar(64) NOT NULL,
	`value` json,
	CONSTRAINT `settings_user_id_key_pk` PRIMARY KEY(`user_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`type` enum('expense','refund') NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`category_id` bigint unsigned,
	`merchant` varchar(128),
	`note` varchar(256),
	`occurred_at` date NOT NULL,
	`source` enum('manual','ocr','import','bank-email') NOT NULL DEFAULT 'manual',
	`refund_of_id` bigint unsigned,
	`status` enum('pending','confirmed') NOT NULL DEFAULT 'confirmed',
	`created_at` datetime NOT NULL,
	CONSTRAINT `transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`username` varchar(64) NOT NULL,
	`password_hash` varchar(100) NOT NULL,
	`display_name` varchar(64) NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
ALTER TABLE `bill_payments` ADD CONSTRAINT `bill_payments_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_payments` ADD CONSTRAINT `bill_payments_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bills` ADD CONSTRAINT `bills_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bills` ADD CONSTRAINT `bills_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `budget_events` ADD CONSTRAINT `budget_events_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `categories_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settings` ADD CONSTRAINT `settings_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_evt_user_at` ON `budget_events` (`user_id`,`at`);--> statement-breakpoint
CREATE INDEX `idx_tx_user_occurred` ON `transactions` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_tx_user_category` ON `transactions` (`user_id`,`category_id`);