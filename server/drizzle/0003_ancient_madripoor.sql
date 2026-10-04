CREATE TABLE `email_receipts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`message_id` varchar(255) NOT NULL,
	`from_addr` varchar(255) NOT NULL,
	`subject` varchar(255) NOT NULL DEFAULT '',
	`received_at` datetime,
	`status` enum('parsed','refund','ignored','unrecognized','duplicate','error') NOT NULL,
	`transaction_id` bigint unsigned,
	`note` varchar(255),
	`raw_text` text,
	`created_at` datetime NOT NULL,
	CONSTRAINT `email_receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_email_msg` UNIQUE(`user_id`,`message_id`)
);
--> statement-breakpoint
ALTER TABLE `email_receipts` ADD CONSTRAINT `email_receipts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_email_user` ON `email_receipts` (`user_id`,`id`);