import {
  isEventType,
  eventNotification,
  newEventTypes,
} from "../server/event-types.js";
import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNull,
  ne,
  sql,
  count,
  countDistinct,
} from "drizzle-orm";
import {
  db,
  tables as t,
  take,
  write,
  type QueryDatabase,
} from "./connection.js";
import { migrateDatabase } from "./migrate.js";
import {
  normalizeOrigins,
  type Site,
  type InputState,
} from "../server/site-types.js";
import { validateTemplate, type TemplateKind } from "../server/templates.js";

export async function migrateSites() {
  await migrateDatabase();
  await write(async (tx) => {
    if (
      (
        await tx
          .select()
          .from(t.app_migrations)
          .where(eq(t.app_migrations.name, "sites-v1"))
      ).length
    )
      return;
    const events = (process.env.TELEGRAM_EVENTS || "pageview,click").split(",");
    const raw = (process.env.VISITGRAM_ALLOWED_ORIGINS || "").trim();
    const origins = raw
      ? [
          ...new Set(
            raw
              .split(",")
              .filter((s) => s.trim())
              .flatMap(normalizeOrigins),
          ),
        ]
      : [];
    const hosts = new Map<string, string[]>();
    for (const origin of origins) {
      const id = randomUUID(),
        host = new URL(origin).host;
      await tx.insert(t.sites).values({
        id,
        name: host,
        created_at: Date.now(),
        notify_pageview: Number(events.includes("pageview")),
        notify_click: Number(events.includes("click")),
      });
      await tx.insert(t.site_origins).values({ origin, site_id: id });
      hosts.set(host, [...(hosts.get(host) || []), id]);
    }
    // Legacy events are adopted in pages without relying on dialect JSON functions.
    let cursor = 0;
    for (;;) {
      const batch = await take(
        tx
          .select({
            id: t.tracking_events.id,
            payload: t.tracking_events.payload,
          })
          .from(t.tracking_events)
          .where(
            and(
              isNull(t.tracking_events.site_id),
              sql`${t.tracking_events.id} > ${cursor}`,
            ),
          )
          .orderBy(asc(t.tracking_events.id)),
        500,
      );
      if (!batch.length) break;
      for (const row of batch) {
        try {
          const ids = hosts.get(JSON.parse(row.payload).site);
          if (ids?.length === 1)
            await tx
              .update(t.tracking_events)
              .set({ site_id: ids[0] })
              .where(eq(t.tracking_events.id, row.id));
        } catch {
          /* Corrupt or ambiguous legacy history is retained unassigned. */
        }
      }
      cursor = batch.at(-1)!.id;
    }
    await tx
      .update(t.tracking_events)
      .set({ status: "disabled" })
      .where(
        and(
          isNull(t.tracking_events.site_id),
          eq(t.tracking_events.status, "pending"),
        ),
      );
    await tx.insert(t.app_migrations).values({ name: "sites-v1" });
  });
}

export async function getSite(
  id: string,
  source: QueryDatabase = db,
): Promise<Site | undefined> {
  const [row] = await source.select().from(t.sites).where(eq(t.sites.id, id));
  if (!row) return;
  const origins = await source
    .select()
    .from(t.site_origins)
    .where(eq(t.site_origins.site_id, id))
    .orderBy(asc(t.site_origins.origin));
  return {
    id: row.id,
    name: row.name,
    paused: Boolean(row.paused),
    archived: Boolean(row.archived),
    notifyPageview: Boolean(row.notify_pageview),
    notifyClick: Boolean(row.notify_click),
    eventNotifications: Object.fromEntries(
      (
        await source
          .select()
          .from(t.site_event_notifications)
          .where(eq(t.site_event_notifications.site_id, id))
      ).map((r) => [r.event_type, Boolean(r.enabled)]),
    ),
    origins: origins.map((r) => r.origin),
    templateDefault: row.template_default,
    templateClick: row.template_click,
    templatePageview: row.template_pageview,
  };
}
export async function listSites(archived = false): Promise<Site[]> {
  const rows = await db
    .select({ id: t.sites.id })
    .from(t.sites)
    .where(eq(t.sites.archived, Number(archived)))
    .orderBy(asc(t.sites.created_at), asc(t.sites.id));
  return (await Promise.all(rows.map((row) => getSite(row.id)))).filter(
    (site): site is Site => !!site,
  );
}
export async function findLegacySite(origin: string) {
  const rows = await db
    .select()
    .from(t.site_origins)
    .where(eq(t.site_origins.origin, origin));
  return rows.length === 1 ? getSite(rows[0].site_id) : undefined;
}
export async function createSite(text: string) {
  const origins = normalizeOrigins(text),
    id = randomUUID();
  await write(async (tx) => {
    await tx
      .insert(t.sites)
      .values({ id, name: new URL(origins[0]).host, created_at: Date.now() });
    for (const origin of origins)
      await tx.insert(t.site_origins).values({ origin, site_id: id });
  });
  return (await getSite(id))!;
}
// Explicit dependent cleanup supports existing schemas without a migration.
export async function deleteSite(id: string) {
  await write(async (tx) => {
    for (const table of [
      t.tracking_events,
      t.visitor_sessions,
      t.site_visitors,
      t.site_event_notifications,
      t.site_origins,
    ])
      await tx.delete(table).where(eq(table.site_id, id));
    // Input state is JSON text across all supported dialects.
    for (const row of await tx.select().from(t.bot_input)) {
      let state: InputState;
      try {
        state = JSON.parse(row.state);
      } catch {
        // Malformed input is handled by getInput.
        continue;
      }
      if (state?.siteId === id)
        await tx.delete(t.bot_input).where(eq(t.bot_input.owner, row.owner));
    }
    await tx.delete(t.sites).where(eq(t.sites.id, id));
  });
}

export async function updateSite(
  id: string,
  change: {
    name?: string;
    origins?: string;
    toggle?: "paused" | "notify_pageview" | "notify_click";
    archived?: boolean;
  },
) {
  await write(async (tx) => {
    const [row] = await tx.select().from(t.sites).where(eq(t.sites.id, id));
    if (!row) throw Error("Сайт больше не существует.");
    if (row.archived && change.archived !== false)
      throw Error("Сначала восстановите сайт из архива.");
    const update: Partial<typeof t.sites.$inferInsert> = {};
    if (change.name !== undefined) {
      const name = change.name.trim();
      // eslint-disable-next-line no-control-regex -- Reject control characters in site names.
      if (!name || name.length > 80 || /[\x00-\x1f]/.test(name))
        throw Error(
          "Название должно содержать от 1 до 80 символов без переносов строк.",
        );
      update.name = name;
    }
    if (change.origins !== undefined) {
      const origins = normalizeOrigins(change.origins);
      await tx.delete(t.site_origins).where(eq(t.site_origins.site_id, id));
      for (const origin of origins)
        await tx.insert(t.site_origins).values({ origin, site_id: id });
    }
    if (change.toggle) {
      if (
        !["paused", "notify_pageview", "notify_click"].includes(change.toggle)
      )
        throw Error("Неизвестная настройка.");
      update[change.toggle] = 1 - row[change.toggle];
    }
    if (change.archived !== undefined)
      update.archived = Number(change.archived);
    if (Object.keys(update).length)
      await tx.update(t.sites).set(update).where(eq(t.sites.id, id));
    const current = { ...row, ...update };
    const allPending = and(
      eq(t.tracking_events.site_id, id),
      eq(t.tracking_events.status, "pending"),
    );
    if (current.paused || current.archived)
      await tx
        .update(t.tracking_events)
        .set({ status: "disabled" })
        .where(allPending);
    else {
      for (const [type, enabled] of [
        ["pageview", current.notify_pageview],
        ["click", current.notify_click],
      ] as const)
        if (!enabled)
          await tx
            .update(t.tracking_events)
            .set({ status: "disabled" })
            .where(and(allPending, eq(t.tracking_events.event_type, type)));
    }
  });
  return (await getSite(id))!;
}
export async function toggleEventNotification(id: string, type: string) {
  if (!isEventType(type) || !(newEventTypes as string[]).includes(type))
    throw Error("Неизвестная настройка.");
  await write(async (tx) => {
    const site = await getSite(id, tx);
    if (!site || site.archived) throw Error("Сайт больше не существует.");
    const enabled = !eventNotification(site, type);
    await tx
      .delete(t.site_event_notifications)
      .where(
        and(
          eq(t.site_event_notifications.site_id, id),
          eq(t.site_event_notifications.event_type, type),
        ),
      );
    await tx
      .insert(t.site_event_notifications)
      .values({ site_id: id, event_type: type, enabled: Number(enabled) });
    if (!enabled)
      await tx
        .update(t.tracking_events)
        .set({ status: "disabled" })
        .where(
          and(
            eq(t.tracking_events.site_id, id),
            eq(t.tracking_events.event_type, type),
            eq(t.tracking_events.status, "pending"),
          ),
        );
  });
  return (await getSite(id))!;
}
export async function setInput(
  owner: string,
  state?: Omit<InputState, "expires">,
) {
  await write(async (tx) => {
    await tx.delete(t.bot_input).where(eq(t.bot_input.owner, owner));
    if (state)
      await tx.insert(t.bot_input).values({
        owner,
        state: JSON.stringify({ ...state, expires: Date.now() + 600000 }),
      });
  });
}
export async function getInput(owner: string): Promise<InputState | undefined> {
  const [row] = await db
    .select()
    .from(t.bot_input)
    .where(eq(t.bot_input.owner, owner));
  if (!row) return;
  let state: InputState;
  try {
    state = JSON.parse(row.state);
  } catch {
    await setInput(owner);
    return;
  }
  if (state.expires <= Date.now()) {
    await setInput(owner);
    return;
  }
  return state;
}
export async function setSiteTemplate(
  id: string,
  kind: TemplateKind,
  source: string | null,
) {
  if (!["default", "click", "pageview"].includes(kind))
    throw Error("Неизвестный тип шаблона.");
  if (source !== null) validateTemplate(source);
  await write(async (tx) => {
    const [site] = await tx.select().from(t.sites).where(eq(t.sites.id, id));
    if (!site || site.archived)
      throw Error("Сайт недоступен или находится в архиве.");
    await tx
      .update(t.sites)
      .set({ [`template_${kind}`]: source })
      .where(eq(t.sites.id, id));
  });
}
export async function siteStats(id: string, days: 1 | 7 | 30) {
  const since = Date.now() - days * 86400000,
    e = t.tracking_events;
  const active = and(eq(e.site_id, id), gte(e.timestamp, since));
  const [totals] = await db
    .select({
      views: sql<number>`coalesce(sum(case when ${e.event_type} = 'pageview' then 1 else 0 end), 0)`,
      clicks: sql<number>`coalesce(sum(case when ${e.event_type} = 'click' then 1 else 0 end), 0)`,
      visitors: sql<number>`count(distinct case when ${e.identity_mode} = 'persistent' then nullif(${e.visitor_id}, '') end)`,
      sessions: sql<number>`count(distinct case when ${e.identity_mode} <> 'persistent' then nullif(${e.visitor_id}, '') end)`,
    })
    .from(e)
    .where(active);
  const pages = await take(
    db
      .select({ path: e.event_path, count: count() })
      .from(e)
      .where(and(active, eq(e.event_type, "pageview")))
      .groupBy(e.event_path)
      .orderBy(desc(count()), asc(e.event_path)),
    5,
  );
  const [cohorts] = await db
    .select({
      newVisitors: countDistinct(
        sql`case when ${t.site_visitors.first_seen} >= ${since} then ${e.visitor_id} end`,
      ),
      returningVisitors: countDistinct(
        sql`case when ${t.site_visitors.first_seen} < ${since} then ${e.visitor_id} end`,
      ),
    })
    .from(e)
    .innerJoin(
      t.site_visitors,
      and(
        eq(t.site_visitors.site_id, e.site_id),
        eq(t.site_visitors.visitor_id, e.visitor_id),
      ),
    )
    .where(
      and(active, eq(e.identity_mode, "persistent"), ne(e.visitor_id, "")),
    );
  const eventCounts: Record<string, number> = {};
  const milestones: Record<string, Record<string, number>> = {};
  // Read JSON in bounded pages to keep this portable across SQL dialects.
  let cursor = 0;
  for (;;) {
    const batch = await take(
      db
        .select({ id: e.id, type: e.event_type, payload: e.payload })
        .from(e)
        .where(and(active, sql`${e.id} > ${cursor}`))
        .orderBy(asc(e.id)),
      500,
    );
    if (!batch.length) break;
    for (const row of batch) {
      if (
        !row.type ||
        !newEventTypes.includes(row.type as (typeof newEventTypes)[number])
      )
        continue;
      eventCounts[row.type] = (eventCounts[row.type] || 0) + 1;
      if (
        ["scroll_depth", "active_time", "video_progress"].includes(row.type)
      ) {
        try {
          const data = JSON.parse(row.payload);
          const milestone = String(data.threshold ?? data.stage ?? "");
          const counts = (milestones[row.type] ??= {});
          counts[milestone] = (counts[milestone] || 0) + 1;
        } catch {
          /* Retain corrupt history without a milestone. */
        }
      }
    }
    cursor = batch.at(-1)!.id;
  }
  return {
    eventCounts,
    milestones,
    views: Number(totals.views),
    clicks: Number(totals.clicks),
    visitors: Number(totals.visitors),
    sessionVisitors: Number(totals.sessions),
    newVisitors: Number(cohorts.newVisitors),
    returningVisitors: Number(cohorts.returningVisitors),
    pages: pages.map((row) => ({
      path: row.path || "",
      count: Number(row.count),
    })),
  };
}
