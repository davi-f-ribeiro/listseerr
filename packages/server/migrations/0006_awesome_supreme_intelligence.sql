PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_media_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`display_url` text,
	`provider` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`max_items` integer DEFAULT 20 NOT NULL,
	`seerr_user_id_override` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_media_lists`("id", "user_id", "name", "url", "display_url", "provider", "enabled", "max_items", "seerr_user_id_override", "created_at", "updated_at") SELECT "id", "user_id", "name", "url", "display_url", "provider", "enabled", "max_items", "seerr_user_id_override", "created_at", "updated_at" FROM `media_lists`;--> statement-breakpoint
DROP TABLE `media_lists`;--> statement-breakpoint
ALTER TABLE `__new_media_lists` RENAME TO `media_lists`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `media_lists_user_id_idx` ON `media_lists` (`user_id`);--> statement-breakpoint
ALTER TABLE `execution_history` ADD `failed_items` text;