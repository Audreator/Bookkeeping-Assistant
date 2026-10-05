CREATE TABLE `bill_allocations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`transaction_id` bigint unsigned NOT NULL,
	`bill_id` bigint unsigned NOT NULL,
	`period_key` date NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	CONSTRAINT `bill_allocations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bill_allocation` UNIQUE(`user_id`,`transaction_id`,`bill_id`,`period_key`)
);
--> statement-breakpoint
ALTER TABLE `bill_allocations` ADD CONSTRAINT `bill_allocations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_allocations` ADD CONSTRAINT `bill_allocations_transaction_id_transactions_id_fk` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_allocations` ADD CONSTRAINT `bill_allocations_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_bill_allocation_occurrence` ON `bill_allocations` (`user_id`,`bill_id`,`period_key`);
--> statement-breakpoint
-- Backfill only wholly valid legacy links. Ambiguous dates, pending/refund rows,
-- foreign ownership and combined amounts exceeding the original payment are skipped.
INSERT INTO `bill_allocations` (`user_id`, `transaction_id`, `bill_id`, `period_key`, `amount`)
SELECT bp.user_id, bp.transaction_id, bp.bill_id, bp.period_key, b.amount
FROM bill_payments bp
JOIN bills b ON b.id = bp.bill_id AND b.user_id = bp.user_id
JOIN (
  SELECT p.user_id, p.transaction_id
  FROM bill_payments p
  LEFT JOIN transactions t ON t.id = p.transaction_id AND t.user_id = p.user_id
  LEFT JOIN bills planned ON planned.id = p.bill_id AND planned.user_id = p.user_id
  WHERE p.transaction_id IS NOT NULL
  GROUP BY p.user_id, p.transaction_id
  HAVING COUNT(*) = SUM(CASE WHEN
    t.type = 'expense' AND t.status = 'confirmed' AND planned.amount > 0
    AND p.period_key REGEXP '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
    AND CAST(RIGHT(p.period_key, 2) AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(LEFT(p.period_key, 7), '-01')))
    THEN 1 ELSE 0 END)
    AND SUM(planned.amount) <= MAX(t.amount)
) eligible ON eligible.user_id = bp.user_id AND eligible.transaction_id = bp.transaction_id;
