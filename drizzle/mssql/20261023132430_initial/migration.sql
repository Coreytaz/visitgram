CREATE TABLE [app_migrations] (
	[name] varchar(100),
	CONSTRAINT [app_migrations_pkey] PRIMARY KEY([name])
);
--> statement-breakpoint
CREATE TABLE [bot_input] (
	[owner] varchar(32),
	[state] nvarchar(max) NOT NULL,
	CONSTRAINT [bot_input_pkey] PRIMARY KEY([owner])
);
--> statement-breakpoint
CREATE TABLE [bot_preferences] (
	[owner] varchar(32),
	[locale] nvarchar(2) NOT NULL,
	CONSTRAINT [bot_preferences_pkey] PRIMARY KEY([owner])
);
--> statement-breakpoint
CREATE TABLE [site_event_notifications] (
	[site_id] varchar(36),
	[event_type] varchar(32),
	[enabled] int NOT NULL,
	CONSTRAINT [site_event_notifications_pkey] PRIMARY KEY([site_id],[event_type])
);
--> statement-breakpoint
CREATE TABLE [site_origins] (
	[origin] varchar(320),
	[site_id] varchar(36) NOT NULL,
	CONSTRAINT [site_origins_pkey] PRIMARY KEY([origin])
);
--> statement-breakpoint
CREATE TABLE [site_visitors] (
	[site_id] varchar(36),
	[visitor_id] varchar(64),
	[first_seen] bigint NOT NULL,
	[last_seen] bigint NOT NULL,
	CONSTRAINT [site_visitors_pkey] PRIMARY KEY([site_id],[visitor_id])
);
--> statement-breakpoint
CREATE TABLE [sites] (
	[id] varchar(36),
	[name] nvarchar(80) NOT NULL,
	[paused] int NOT NULL CONSTRAINT [sites_paused_default] DEFAULT ((0)),
	[archived] int NOT NULL CONSTRAINT [sites_archived_default] DEFAULT ((0)),
	[notify_pageview] int NOT NULL CONSTRAINT [sites_notify_pageview_default] DEFAULT ((1)),
	[notify_click] int NOT NULL CONSTRAINT [sites_notify_click_default] DEFAULT ((1)),
	[created_at] bigint NOT NULL,
	[template_default] nvarchar(max),
	[template_pageview] nvarchar(max),
	[template_click] nvarchar(max),
	CONSTRAINT [sites_pkey] PRIMARY KEY([id])
);
--> statement-breakpoint
CREATE TABLE [tracking_events] (
	[id] bigint IDENTITY(1, 1),
	[timestamp] bigint NOT NULL,
	[payload] nvarchar(max) NOT NULL,
	[status] nvarchar(16) NOT NULL,
	[attempts] int NOT NULL CONSTRAINT [tracking_events_attempts_default] DEFAULT ((0)),
	[next_attempt] bigint NOT NULL CONSTRAINT [tracking_events_next_attempt_default] DEFAULT ((0)),
	[site_id] varchar(36),
	[event_type] nvarchar(16),
	[event_path] nvarchar(1024),
	[visitor_id] varchar(64),
	[identity_mode] nvarchar(16),
	CONSTRAINT [tracking_events_pkey] PRIMARY KEY([id])
);
--> statement-breakpoint
CREATE TABLE [visitor_sessions] (
	[site_id] varchar(36),
	[visitor_id] varchar(64),
	[session_id] varchar(64),
	[is_new] int NOT NULL,
	[last_seen] bigint NOT NULL,
	CONSTRAINT [visitor_sessions_pkey] PRIMARY KEY([site_id],[visitor_id],[session_id])
);
--> statement-breakpoint
ALTER TABLE [site_event_notifications] ADD CONSTRAINT [site_event_notifications_site_id_sites_id_fk] FOREIGN KEY ([site_id]) REFERENCES [sites]([id]);--> statement-breakpoint
ALTER TABLE [site_origins] ADD CONSTRAINT [site_origins_site_id_sites_id_fk] FOREIGN KEY ([site_id]) REFERENCES [sites]([id]);--> statement-breakpoint
ALTER TABLE [site_visitors] ADD CONSTRAINT [site_visitors_site_id_sites_id_fk] FOREIGN KEY ([site_id]) REFERENCES [sites]([id]);--> statement-breakpoint
ALTER TABLE [tracking_events] ADD CONSTRAINT [tracking_events_site_id_sites_id_fk] FOREIGN KEY ([site_id]) REFERENCES [sites]([id]);--> statement-breakpoint
ALTER TABLE [visitor_sessions] ADD CONSTRAINT [visitor_sessions_site_id_sites_id_fk] FOREIGN KEY ([site_id]) REFERENCES [sites]([id]);--> statement-breakpoint
CREATE INDEX [tracking_delivery] ON [tracking_events] ([status],[next_attempt]);--> statement-breakpoint
CREATE INDEX [tracking_site_time] ON [tracking_events] ([site_id],[timestamp]);