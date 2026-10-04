ALTER TABLE `users` ADD `session_id` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `failed_attempts` tinyint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `locked_until` datetime;