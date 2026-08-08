CREATE TABLE `lookup_history` (
	`term` text PRIMARY KEY NOT NULL,
	`looked_up_at` integer NOT NULL,
	`explain` text DEFAULT '' NOT NULL
);
