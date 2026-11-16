CREATE TABLE `household_invite` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`code` text NOT NULL,
	`created_by` text,
	`used_by` text,
	`used_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`used_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_invite_code_unique` ON `household_invite` (`code`);--> statement-breakpoint
CREATE INDEX `household_invite_household_idx` ON `household_invite` (`household_id`);--> statement-breakpoint
CREATE TABLE `household_item_preference` (
	`household_id` text NOT NULL,
	`item_id` text NOT NULL,
	`category` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`household_id`, `item_id`),
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `purchase_event` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`item_id` text,
	`name` text NOT NULL,
	`quantity` real,
	`unit` text,
	`purchased_at` integer NOT NULL,
	`user_id` text,
	`source` text DEFAULT 'list' NOT NULL,
	`list_item_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `purchase_event_household_item_idx` ON `purchase_event` (`household_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `purchase_event_list_item_idx` ON `purchase_event` (`list_item_id`);--> statement-breakpoint
CREATE TABLE `shopping_list` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'named' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shopping_list_household_idx` ON `shopping_list` (`household_id`);--> statement-breakpoint
CREATE TABLE `shopping_list_item` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`item_id` text,
	`name` text NOT NULL,
	`quantity` real,
	`unit` text,
	`note` text,
	`sources` text DEFAULT '[]' NOT NULL,
	`added_by` text,
	`checked_at` integer,
	`checked_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_list`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`added_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`checked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shopping_list_item_list_idx` ON `shopping_list_item` (`list_id`,`checked_at`);--> statement-breakpoint
CREATE INDEX `shopping_list_item_item_idx` ON `shopping_list_item` (`item_id`);