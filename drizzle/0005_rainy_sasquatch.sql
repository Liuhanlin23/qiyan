CREATE TABLE `user_book` (
	`book_hash` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`format` text DEFAULT 'epub' NOT NULL,
	`imported_at` integer NOT NULL,
	`edit_time` integer DEFAULT 0 NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ub_dirty` ON `user_book` (`dirty`) WHERE dirty = 1;--> statement-breakpoint
CREATE TABLE `user_book_annotation` (
	`annotation_id` text PRIMARY KEY NOT NULL,
	`book_hash` text NOT NULL,
	`cfi` text NOT NULL,
	`fraction` real DEFAULT 0 NOT NULL,
	`text` text NOT NULL,
	`color` text NOT NULL,
	`style` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`edit_time` integer DEFAULT 0 NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_uba_book` ON `user_book_annotation` (`book_hash`);--> statement-breakpoint
CREATE INDEX `idx_uba_dirty` ON `user_book_annotation` (`dirty`) WHERE dirty = 1;--> statement-breakpoint
CREATE TABLE `user_book_bookmark` (
	`bookmark_id` text PRIMARY KEY NOT NULL,
	`book_hash` text NOT NULL,
	`cfi` text NOT NULL,
	`fraction` real DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`edit_time` integer DEFAULT 0 NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ubb_book` ON `user_book_bookmark` (`book_hash`);--> statement-breakpoint
CREATE INDEX `idx_ubb_dirty` ON `user_book_bookmark` (`dirty`) WHERE dirty = 1;--> statement-breakpoint
CREATE TABLE `user_book_progress` (
	`book_hash` text PRIMARY KEY NOT NULL,
	`location` text NOT NULL,
	`fraction` real DEFAULT 0 NOT NULL,
	`last_read_at` integer NOT NULL,
	`edit_time` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ubp_dirty` ON `user_book_progress` (`dirty`) WHERE dirty = 1;--> statement-breakpoint
CREATE TABLE `user_reading_event` (
	`book_hash` text NOT NULL,
	`start_time` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`fraction` real DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`book_hash`, `start_time`)
);
--> statement-breakpoint
CREATE INDEX `idx_ure_dirty` ON `user_reading_event` (`dirty`) WHERE dirty = 1;--> statement-breakpoint
CREATE INDEX `idx_ure_time` ON `user_reading_event` (`start_time`);