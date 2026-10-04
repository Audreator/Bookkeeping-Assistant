ALTER TABLE `transactions` ADD `occurred_time` varchar(8);--> statement-breakpoint
ALTER TABLE `transactions` ADD `ingest_key` varchar(64);--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `uq_tx_user_ingest` UNIQUE(`user_id`,`ingest_key`);