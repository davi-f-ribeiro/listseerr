ALTER TABLE `provider_cache` RENAME COLUMN `provider` TO `cache_key`;--> statement-breakpoint
DROP INDEX IF EXISTS `provider_cache_provider_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_cache_cache_key_unique` ON `provider_cache` (`cache_key`);--> statement-breakpoint
DELETE FROM `provider_cache` WHERE `cache_key` = 'stevenlu';--> statement-breakpoint
UPDATE `media_lists` SET `url` = 'https://popular-movies-data.stevenlu.com/movies.json', `display_url` = NULL WHERE `provider` = 'stevenlu';
