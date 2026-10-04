CREATE TABLE `day_overrides` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`date` date NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`note` varchar(128),
	`created_at` datetime NOT NULL,
	CONSTRAINT `day_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_day_override` UNIQUE(`user_id`,`date`)
);
--> statement-breakpoint
ALTER TABLE `day_overrides` ADD CONSTRAINT `day_overrides_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;