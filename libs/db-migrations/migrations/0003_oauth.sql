CREATE TABLE `oauth_client` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`uri` text,
	`logo_uri` text,
	`fetched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_code` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`scopes` text NOT NULL,
	`resource` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_code_client_idx` ON `oauth_code` (`client_id`);--> statement-breakpoint
CREATE TABLE `oauth_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scopes` text NOT NULL,
	`resource` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`previous_refresh_token_hash` text,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grant_refresh_token_hash_unique` ON `oauth_grant` (`refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `oauth_grant_user_idx` ON `oauth_grant` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_grant_previous_idx` ON `oauth_grant` (`previous_refresh_token_hash`);--> statement-breakpoint
ALTER TABLE `api_token` ADD `grant_id` text REFERENCES oauth_grant(id);--> statement-breakpoint
CREATE INDEX `api_token_grant_idx` ON `api_token` (`grant_id`);