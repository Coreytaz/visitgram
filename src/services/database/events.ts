import { notificationsEnabled } from "../server/event-types.js";
import { and, asc, desc, eq, gte, lt, lte } from "drizzle-orm";
import { db, tables as t, take, write } from "./connection.js";
import { eventColumns } from "./migrate.js";
import { getSite } from "./sites.js";
import type { MessageEvent } from "../server/notifications.js";

export type TrackedEvent = MessageEvent & {
  type: string;
  path: string;
  visitor: string;
  session: string;
  identityMode: string;
};
export type EventRow = typeof t.tracking_events.$inferSelect;
export async function cleanEvents(days: number) {
  await write(async (tx) => {
    await tx
      .delete(t.tracking_events)
      .where(lt(t.tracking_events.timestamp, Date.now() - days * 86400000));
    await tx
      .delete(t.visitor_sessions)
      .where(lt(t.visitor_sessions.last_seen, Date.now() - days * 86400000));
  });
}
export async function pendingEvent() {
  return (
    await take(
      db
        .select()
        .from(t.tracking_events)
        .where(
          and(
            eq(t.tracking_events.status, "pending"),
            lte(t.tracking_events.next_attempt, Date.now()),
          ),
        )
        .orderBy(asc(t.tracking_events.id)),
      1,
    )
  )[0];
}
export async function updatePending(
  id: number,
  update: Partial<Pick<EventRow, "status" | "attempts" | "next_attempt">>,
) {
  await write(async (tx) => {
    await tx
      .update(t.tracking_events)
      .set(update)
      .where(
        and(
          eq(t.tracking_events.id, id),
          eq(t.tracking_events.status, "pending"),
        ),
      );
  });
}
export async function recentEvents(siteId?: string) {
  return take(
    db
      .select({
        id: t.tracking_events.id,
        timestamp: t.tracking_events.timestamp,
        payload: t.tracking_events.payload,
        status: t.tracking_events.status,
        attempts: t.tracking_events.attempts,
        next_attempt: t.tracking_events.next_attempt,
        site_id: t.tracking_events.site_id,
      })
      .from(t.tracking_events)
      .where(siteId ? eq(t.tracking_events.site_id, siteId) : undefined)
      .orderBy(desc(t.tracking_events.id)),
    100,
  );
}
export async function insertEvent(
  siteId: string,
  origin: string,
  input: TrackedEvent,
  now: number,
  telegramEnabled: boolean,
): Promise<202 | 204 | 403 | 404> {
  return write(async (tx) => {
    const site = await getSite(siteId, tx);
    if (!site || site.archived) return 404;
    if (!site.origins.includes(origin)) return 403;
    if (site.paused) return 204;
    // Work on a fresh copy because a serializable transaction can be retried.
    const event = { ...input };
    const status =
      telegramEnabled && notificationsEnabled(site, event.type)
        ? "pending"
        : "disabled";
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (
      event.identityMode === "persistent" &&
      uuid.test(event.visitor) &&
      uuid.test(event.session)
    ) {
      const key = and(
        eq(t.site_visitors.site_id, siteId),
        eq(t.site_visitors.visitor_id, event.visitor),
      );
      const [known] = await tx.select().from(t.site_visitors).where(key);
      const visitKey = and(
        eq(t.visitor_sessions.site_id, siteId),
        eq(t.visitor_sessions.visitor_id, event.visitor),
        eq(t.visitor_sessions.session_id, event.session),
      );
      const [visit] = await tx
        .select()
        .from(t.visitor_sessions)
        .where(visitKey);
      const isNew =
        event.type !== "pageview" && visit && now - visit.last_seen < 1800000
          ? Boolean(visit.is_new)
          : !known;
      event.visitorStatus = isNew ? "new" : "returning";
      if (known)
        await tx
          .update(t.site_visitors)
          .set({ last_seen: Math.max(now, known.last_seen) })
          .where(key);
      else
        await tx.insert(t.site_visitors).values({
          site_id: siteId,
          visitor_id: event.visitor,
          first_seen: now,
          last_seen: now,
        });
      if (visit)
        await tx
          .update(t.visitor_sessions)
          .set({
            is_new: Number(isNew),
            last_seen: Math.max(now, visit.last_seen),
          })
          .where(visitKey);
      else
        await tx.insert(t.visitor_sessions).values({
          site_id: siteId,
          visitor_id: event.visitor,
          session_id: event.session,
          is_new: Number(isNew),
          last_seen: now,
        });
    } else if (event.identityMode === "persistent")
      event.identityMode = "memory";
    await tx.insert(t.tracking_events).values({
      timestamp: now,
      payload: JSON.stringify(event),
      status,
      site_id: siteId,
      ...eventColumns(event),
    });
    return 202;
  });
}

// Useful for integration assertions without exposing a driver to HTTP or bot code.
export async function eventsSince(siteId: string, timestamp: number) {
  return db
    .select()
    .from(t.tracking_events)
    .where(
      and(
        eq(t.tracking_events.site_id, siteId),
        gte(t.tracking_events.timestamp, timestamp),
      ),
    )
    .orderBy(asc(t.tracking_events.id));
}
