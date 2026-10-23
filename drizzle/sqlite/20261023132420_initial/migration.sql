CREATE TABLE `app_migrations` (
	`name` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `bot_input` (
	`owner` text PRIMARY KEY,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bot_preferences` (
	`owner` text PRIMARY KEY,
	`locale` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_event_notifications` (
	`site_id` text NOT NULL,
	`event_type` text NOT NULL,
	`enabled` integer NOT NULL,
	CONSTRAINT `site_event_notifications_pk` PRIMARY KEY(`site_id`, `event_type`),
	CONSTRAINT `fk_site_event_notifications_site_id_sites_id_fk` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`)
);
--> statement-breakpoint
CREATE TABLE `site_origins` (
	`origin` text NOT NULL,
	`site_id` text NOT NULL,
	CONSTRAINT `site_origins_pk` PRIMARY KEY(`origin`, `site_id`),
	CONSTRAINT `fk_site_origins_site_id_sites_id_fk` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`)
);
--> statement-breakpoint
CREATE TABLE `site_visitors` (
	`site_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	CONSTRAINT `site_visitors_pk` PRIMARY KEY(`site_id`, `visitor_id`),
	CONSTRAINT `fk_site_visitors_site_id_sites_id_fk` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`)
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`paused` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`notify_pageview` integer DEFAULT 1 NOT NULL,
	`notify_click` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`template_default` text,
	`template_pageview` text,
	`template_click` text
);
--> statement-breakpoint
CREATE TABLE `tracking_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`timestamp` integer NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt` integer DEFAULT 0 NOT NULL,
	`site_id` text,
	`event_type` text,
	`event_path` text,
	`visitor_id` text,
	`identity_mode` text,
	CONSTRAINT `fk_tracking_events_site_id_sites_id_fk` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`)
);
--> statement-breakpoint
CREATE TABLE `visitor_sessions` (
	`site_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`session_id` text NOT NULL,
	`is_new` integer NOT NULL,
	`last_seen` integer NOT NULL,
	CONSTRAINT `visitor_sessions_pk` PRIMARY KEY(`site_id`, `visitor_id`, `session_id`),
	CONSTRAINT `fk_visitor_sessions_site_id_sites_id_fk` FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`)
);
--> statement-breakpoint
CREATE INDEX `tracking_delivery` ON `tracking_events` (`status`,`next_attempt`);--> statement-breakpoint
CREATE INDEX `tracking_site_time` ON `tracking_events` (`site_id`,`timestamp`);