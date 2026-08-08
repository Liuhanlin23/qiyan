DROP TABLE `user_setting`;
--> statement-breakpoint
CREATE TABLE `user_setting` (
	`setting_key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`edit_time` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_us_dirty` ON `user_setting` (`dirty`) WHERE dirty = 1;
