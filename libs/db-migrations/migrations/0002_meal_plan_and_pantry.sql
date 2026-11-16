CREATE TABLE `meal_plan_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`date` text NOT NULL,
	`slot` text DEFAULT 'dinner' NOT NULL,
	`recipe_id` text,
	`title` text NOT NULL,
	`servings` integer,
	`note` text,
	`cooked_at` integer,
	`added_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`added_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `meal_plan_entry_household_date_idx` ON `meal_plan_entry` (`household_id`,`date`);--> statement-breakpoint
CREATE TABLE `pantry_item` (
	`household_id` text NOT NULL,
	`item_id` text NOT NULL,
	`staple` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'have' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`household_id`, `item_id`),
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE cascade
);
