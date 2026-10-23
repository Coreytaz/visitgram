import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import http from "node:http";

test("persistent browser identity, visit labels, unique cohorts and old-event separation", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "analog-visitors-"));
  process.env.VISITGRAM_SQLITE_URL = `file:${path.join(dir, "events.db").replaceAll("\\", "/")}`;
  process.env.VISITGRAM_TOKEN = "admin";
  process.env.VISITGRAM_ALLOWED_ORIGINS = "";
  process.env.TELEGRAM_BOT_TOKEN = "";
  process.env.TELEGRAM_CHAT_ID = "";
  const { db, t, write, and, eq, eventRows, closeDatabase } =
    await import("./fixtures.js");
  const {
    initTracking,
    handleTracking,
    stopTracking,
    cleanTracking,
    formatTelegramMessage,
  } = await import("../src/services/server/tracking.js");
  const { createSite, siteStats, updateSite } =
    await import("../src/services/server/sites.js");
  await initTracking();
  const a = await createSite("a.example"),
    b = await createSite("b.example");
  const server = http.createServer((req, res) => {
    void handleTracking(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const visitor = randomUUID(),
    visitor2 = randomUUID(),
    session = randomUUID();
  const post = async (
    v: string = visitor,
    s: string = session,
    type = "pageview",
    site = a,
    mode = "persistent",
  ) => {
    const response = await fetch(`${base}/api/track?site_id=${site.id}`, {
      method: "POST",
      headers: { Origin: site.origins[0] },
      body: JSON.stringify({
        type,
        path: "/",
        visitor: v,
        session: s,
        identityMode: mode,
      }),
    });
    assert.equal(response.status, 202);
    return JSON.parse(String((await eventRows()).at(-1)!.payload));
  };
  try {
    assert.equal((await post()).visitorStatus, "new");
    const click = await post(visitor, session, "click");
    assert.equal(click.visitorStatus, "new");
    assert.match(formatTelegramMessage(click, Date.now()), /Новый посетитель/);
    // Reopening a page in the same tab must recognize the known browser.
    assert.equal((await post()).visitorStatus, "returning");
    assert.equal(
      (await post(visitor, session, "click")).visitorStatus,
      "returning",
    );
    const repeat = await post(visitor, randomUUID());
    assert.equal(repeat.visitorStatus, "returning");
    assert.match(
      formatTelegramMessage(repeat, Date.now()),
      /Повторный посетитель/,
    );
    await post(visitor2, randomUUID());
    let stats = await siteStats(a.id, 1);
    assert.equal(stats.visitors, 2);
    assert.equal(stats.newVisitors, 2);
    assert.equal(stats.returningVisitors, 0);
    assert.equal(
      (await post(visitor, randomUUID(), "pageview", b)).visitorStatus,
      "new",
    );
    assert.equal((await siteStats(b.id, 1)).visitors, 1);
    await write(async (tx) => {
      await tx
        .update(t.site_visitors)
        .set({ first_seen: Date.now() - 2 * 86400000 })
        .where(
          and(
            eq(t.site_visitors.site_id, a.id),
            eq(t.site_visitors.visitor_id, visitor),
          ),
        );
    });
    stats = await siteStats(a.id, 1);
    assert.equal(stats.newVisitors, 1);
    assert.equal(stats.returningVisitors, 1);
    assert.equal((await siteStats(a.id, 7)).newVisitors, 2);
    await post("legacy-session", randomUUID(), "pageview", a, "legacy");
    await post("invalid-persistent", randomUUID());
    stats = await siteStats(a.id, 1);
    assert.equal(stats.visitors, 2);
    assert.equal(stats.sessionVisitors, 2);
    await write(async (tx) => {
      await tx
        .update(t.visitor_sessions)
        .set({ last_seen: Date.now() - 1800001 })
        .where(
          and(
            eq(t.visitor_sessions.site_id, a.id),
            eq(t.visitor_sessions.visitor_id, visitor),
            eq(t.visitor_sessions.session_id, session),
          ),
        );
    });
    assert.equal((await post()).visitorStatus, "returning");
    // Clearing retained event logs must not forget an already known browser.
    await write(async (tx) => {
      await tx
        .update(t.tracking_events)
        .set({ timestamp: Date.now() - 31 * 86400000 })
        .where(eq(t.tracking_events.site_id, a.id));
    });
    await cleanTracking();
    assert.equal((await siteStats(a.id, 1)).visitors, 0);
    assert.equal(
      (await post(visitor, randomUUID())).visitorStatus,
      "returning",
    );
    assert.equal((await siteStats(a.id, 1)).visitors, 1);
    const pausedVisitor = randomUUID();
    await updateSite(a.id, { toggle: "paused" });
    const paused = await fetch(`${base}/api/track?site_id=${a.id}`, {
      method: "POST",
      headers: { Origin: a.origins[0] },
      body: JSON.stringify({
        type: "pageview",
        path: "/",
        visitor: pausedVisitor,
        session: randomUUID(),
        identityMode: "persistent",
      }),
    });
    assert.equal(paused.status, 204);
    assert.equal(
      (
        await db
          .select()
          .from(t.site_visitors)
          .where(
            and(
              eq(t.site_visitors.site_id, a.id),
              eq(t.site_visitors.visitor_id, pausedVisitor),
            ),
          )
      ).length,
      0,
    );
  } finally {
    await stopTracking();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase();
    if (process.platform !== "win32")
      await rm(dir, { recursive: true, force: true });
  }
});
