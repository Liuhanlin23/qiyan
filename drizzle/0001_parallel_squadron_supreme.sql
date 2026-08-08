DROP INDEX `idx_uw_state`;--> statement-breakpoint
ALTER TABLE `user_word` ADD `join_time` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_uw_state` ON `user_word` (`state`,`join_time`);