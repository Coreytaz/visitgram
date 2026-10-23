CREATE TABLE `app_migrations` (
	`name` varchar(100) PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `bot_input` (
	`owner` varchar(32) PRIMARY KEY,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bot_preferences` (
	`owner` varchar(32) PRIMARY KEY,
	`locale` varchar(2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_event_notifications` (
	`site_id` varchar(36) NOT NULL,
	`event_type` varchar(32) NOT NULL,
	`enabled` int NOT NULL,
	CONSTRAINT PRIMARY KEY(`site_id`,`event_type`)
);
--> statement-breakpoint
CREATE TABLE `site_origins` (
	`origin` varchar(320) NOT NULL,
	`site_id` varchar(36) NOT NULL,
	CONSTRAINT PRIMARY KEY(`origin`,`site_id`)
);
--> statement-breakpoint
CREATE TABLE `site_visitors` (
	`site_id` varchar(36) NOT NULL,
	`visitor_id` varchar(64) NOT NULL,
	`first_seen` bigint NOT NULL,
	`last_seen` bigint NOT NULL,
	CONSTRAINT PRIMARY KEY(`site_id`,`visitor_id`)
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` varchar(36) PRIMARY KEY,
	`name` varchar(80) NOT NULL,
	`paused` int NOT NULL DEFAULT 0,
	`archived` int NOT NULL DEFAULT 0,
	`notify_pageview` int NOT NULL DEFAULT 1,
	`notify_click` int NOT NULL DEFAULT 1,
	`created_at` bigint NOT NULL,
	`template_default` text,
	`template_pageview` text,
	`template_click` text
);
--> statement-breakpoint
CREATE TABLE `tracking_events` (
	`id` bigint AUTO_INCREMENT PRIMARY KEY,
	`timestamp` bigint NOT NULL,
	`payload` text NOT NULL,
	`status` varchar(16) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`next_attempt` bigint NOT NULL DEFAULT 0,
	`site_id` varchar(36),
	`event_type` varchar(16),
	`event_path` varchar(1024),
	`visitor_id` varchar(64),
	`identity_mode` varchar(16)
);
--> statement-breakpoint
CREATE TABLE `visitor_sessions` (
	`site_id` varchar(36) NOT NULL,
	`visitor_id` varchar(64) NOT NULL,
	`session_id` varchar(64) NOT NULL,
	`is_new` int NOT NULL,
	`last_seen` bigint NOT NULL,
	CONSTRAINT PRIMARY KEY(`site_id`,`visitor_id`,`session_id`)
);
--> statement-breakpoint
CREATE INDEX `tracking_delivery` ON `tracking_events` (`status`,`next_attempt`);--> statement-breakpoint
CREATE INDEX `tracking_site_time` ON `tracking_events` (`site_id`,`timestamp`);--> statement-breakpoint
ALTER TABLE `site_event_notifications` ADD CONSTRAINT `site_event_notifications_site_id_sites_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`);--> statement-breakpoint
ALTER TABLE `site_origins` ADD CONSTRAINT `site_origins_site_id_sites_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`);--> statement-breakpoint
ALTER TABLE `site_visitors` ADD CONSTRAINT `site_visitors_site_id_sites_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`);--> statement-breakpoint
ALTER TABLE `tracking_events` ADD CONSTRAINT `tracking_events_site_id_sites_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`);--> statement-breakpoint
ALTER TABLE `visitor_sessions` ADD CONSTRAINT `visitor_sessions_site_id_sites_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`);