ALTER TABLE `execution_history` ADD `failed_items` text; -- JSON array of {item: MediaItemVO, error: string}
