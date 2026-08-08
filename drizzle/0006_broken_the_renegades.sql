ALTER TABLE `user_book_annotation` ADD `page` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_book_bookmark` ADD `page` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_book_annotation` DROP COLUMN `fraction`;--> statement-breakpoint
ALTER TABLE `user_book_bookmark` DROP COLUMN `fraction`;
