CREATE TABLE `dict` (
	`dict_id` integer PRIMARY KEY NOT NULL,
	`term` text NOT NULL,
	`term_type` integer NOT NULL,
	`uk_phonetic` text,
	`us_phonetic` text,
	`uk_audio_url` text,
	`us_audio_url` text,
	`audio_url` text,
	`ec` text,
	`collins` text,
	`syno` text,
	`rel_word` text,
	`phrs` text,
	`individual` text,
	`example_sentence` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dict_term` ON `dict` (`term`);--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_review_log` (
	`dict_id` integer NOT NULL,
	`review_time` integer NOT NULL,
	`rating` integer NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`pre_state` integer NOT NULL,
	`pre_stability` real DEFAULT 0 NOT NULL,
	`pre_difficulty` real DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`dict_id`, `review_time`)
);
--> statement-breakpoint
CREATE INDEX `idx_url_dirty` ON `user_review_log` (`dirty`) WHERE dirty = 1;--> statement-breakpoint
CREATE INDEX `idx_url_time` ON `user_review_log` (`review_time`);--> statement-breakpoint
CREATE TABLE `user_setting` (
	`id` integer PRIMARY KEY NOT NULL,
	`new_per_day` integer DEFAULT 20 NOT NULL,
	`reviews_per_day` integer DEFAULT 50 NOT NULL,
	`new_review_mix` text DEFAULT 'mix' NOT NULL,
	`meaning_source` text DEFAULT 'concise' NOT NULL,
	`accent` text DEFAULT 'us' NOT NULL,
	`auto_play_audio` integer DEFAULT 1 NOT NULL,
	`edit_time` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_word` (
	`dict_id` integer PRIMARY KEY NOT NULL,
	`due` integer,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`scheduled_days` real DEFAULT 0 NOT NULL,
	`learning_steps` integer DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`state` integer DEFAULT 0 NOT NULL,
	`last_review` integer,
	`edit_time` integer DEFAULT 0 NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_uw_dirty` ON `user_word` (`dirty`) WHERE dirty = 1;--> statement-breakpoint
CREATE INDEX `idx_uw_due` ON `user_word` (`due`);--> statement-breakpoint
CREATE INDEX `idx_uw_state` ON `user_word` (`state`,`edit_time`);--> statement-breakpoint
CREATE TABLE `user_word_note` (
	`dict_id` integer PRIMARY KEY NOT NULL,
	`note` text NOT NULL,
	`edit_time` integer DEFAULT 0 NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_uwn_dirty` ON `user_word_note` (`dirty`) WHERE dirty = 1;