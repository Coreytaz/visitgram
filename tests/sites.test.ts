import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";

test("site migration, independent trackers, lifecycle, statistics and persistent input", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "analog-sites-"));
  process.env.VISITGRAM_SQLITE_URL = `file:${path.join(dir, "events.db").replaceAll("\\", "/")}`;
  process.env.VISITGRAM_TOKEN = "admin";
  process.env.VISITGRAM_ALLOWED_ORIGINS =
    "https://legacy.example,http://ambiguous.example,https://ambiguous.example";
  process.env.TELEGRAM_BOT_TOKEN = "";
  process.env.TELEGRAM_CHAT_ID = "";
  process.env.VISITGRAM_PUBLIC_URL = "https://tracker.example";
  // Only this pre-ORM fixture intentionally uses the historical SQLite schema.
  const { createClient } = await import("@libsql/client");
  const legacyClient = createClient({ url: process.env.VISITGRAM_SQLITE_URL! });
  const { eventRows, insertFixture, expireInput, closeDatabase } =
    await import("./fixtures.js");
  const repo = await import("../src/services/server/sites.js");
  const { initTracking, handleTracking, stopTracking } =
    await import("../src/services/server/tracking.js");
  await legacyClient.execute(
    "CREATE TABLE tracking_events(id INTEGER PRIMARY KEY AUTOINCREMENT,timestamp INTEGER NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0)",
  );
  for (const site of [
    "legacy.example",
    "ambiguous.example",
    "unknown.example",
  ]) {
    await legacyClient.execute({
      sql: "INSERT INTO tracking_events(timestamp,payload,status) VALUES(?,?,'pending')",
      args: [
        Date.now(),
        JSON.stringify({
          site,
          type: "pageview",
          path: "/old",
          visitor: "old",
        }),
      ],
    });
  }
  const server = http.createServer((req, res) => {
    void handleTracking(req, res)
      .then((ok) => {
        if (!ok) {
          res.writeHead(404);
          res.end();
        }
      })
      .catch(() => {
        res.writeHead(500);
        res.end();
      });
  });
  try {
    await initTracking();
    const seeded = await repo.listSites();
    assert.equal(seeded.length, 3);
    const legacy = await eventRows();
    legacyClient.close();
    assert.ok(legacy[0].site_id);
    assert.equal(legacy[1].site_id, null);
    assert.equal(legacy[2].status, "disabled");
    await repo.updateSite(String(legacy[0].site_id), {
      name: "Переименованный",
    });
    await repo.migrateSites();
    assert.equal((await repo.listSites()).length, 3);
    assert.equal(
      (await repo.getSite(String(legacy[0].site_id)))!.name,
      "Переименованный",
    );
    const a = await repo.createSite("a.example,https://www.a.example");
    const b = await repo.createSite("https://b.example");
    assert.deepEqual(a.origins, ["https://a.example", "https://www.a.example"]);
    assert.match(
      repo.trackerSnippet(a.id),
      /src="https:\/\/tracker.example\/tracker.js"/,
    );
    assert.ok(repo.trackerSnippet(a.id).includes(`data-site-id="${a.id}"`));
    await assert.rejects(repo.createSite("a.example"), /уже привязан/);
    assert.throws(() =>
      repo.normalizeOrigins("https://user:pass@example.com/"),
    );
    assert.throws(() => repo.normalizeOrigins("https://a.example/path"));
    assert.throws(() => repo.normalizeOrigins("https://*.example"));
    assert.throws(() => repo.normalizeOrigins("ftp://example.com"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const post = (
      id: string | null,
      origin: string,
      type = "pageview",
      visitor = "v1",
    ) =>
      fetch(`${base}/api/track${id ? `?site_id=${id}` : ""}`, {
        method: "POST",
        headers: { Origin: origin },
        body: JSON.stringify({ type, path: "/pricing", visitor }),
      });
    assert.equal((await post(a.id, "https://b.example")).status, 403);
    assert.equal((await post("unknown", "https://a.example")).status, 404);
    assert.equal((await post(a.id, "https://a.example")).status, 202);
    assert.equal((await post(a.id, "https://a.example", "click")).status, 202);
    assert.equal(
      (await post(b.id, "https://b.example", "pageview", "v2")).status,
      202,
    );
    assert.equal((await post(null, "https://a.example")).status, 202);
    const stats = await repo.siteStats(a.id, 1);
    assert.deepEqual(
      { views: stats.views, clicks: stats.clicks, visitors: stats.visitors },
      { views: 2, clicks: 1, visitors: 0 },
    );
    assert.deepEqual(stats.pages, [{ path: "/pricing", count: 2 }]);
    assert.equal((await repo.siteStats(b.id, 1)).views, 1);
    await insertFixture({
      timestamp: Date.now() - 2 * 86400000,
      payload: JSON.stringify({
        type: "pageview",
        path: "/older",
        visitor: "v3",
      }),
      status: "sent",
      site_id: a.id,
    });
    assert.equal((await repo.siteStats(a.id, 7)).views, 3);
    assert.equal((await repo.siteStats(a.id, 30)).sessionVisitors, 2);
    const filtered = await (
      await fetch(`${base}/api/visits?site_id=${b.id}`, {
        headers: { Authorization: "Basic admin" },
      })
    ).json();
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].site_id, b.id);
    await insertFixture({
      timestamp: Date.now(),
      payload: JSON.stringify({ type: "click", path: "/queued" }),
      status: "pending",
      site_id: a.id,
    });
    await repo.updateSite(a.id, { toggle: "notify_click" });
    assert.equal((await eventRows()).at(-1)!.status, "disabled");
    assert.equal((await post(a.id, "https://a.example", "click")).status, 202);
    await repo.updateSite(a.id, { toggle: "paused" });
    assert.equal(
      (await eventRows()).filter(
        (row) => row.site_id === a.id && row.status === "pending",
      ).length,
      0,
    );
    assert.equal((await post(a.id, "https://a.example")).status, 204);
    assert.equal((await post(b.id, "https://b.example")).status, 202);
    await repo.updateSite(a.id, { archived: true });
    assert.equal(
      (await eventRows()).filter((row) => row.site_id === a.id).length,
      6,
    );
    assert.equal((await post(a.id, "https://a.example")).status, 404);
    await assert.rejects(repo.createSite("a.example"), /уже привязан/);
    assert.equal((await repo.listSites(true)).length, 1);
    await repo.updateSite(a.id, { archived: false });
    await repo.updateSite(a.id, { toggle: "paused" });
    await assert.rejects(
      repo.updateSite(a.id, { origins: "b.example" }),
      /другому сайту/,
    );
    assert.equal((await repo.getSite(a.id))!.origins.length, 2);
    await repo.updateSite(a.id, { origins: "https://new-a.example" });
    assert.equal((await post(a.id, "https://a.example")).status, 403);
    assert.equal((await post(a.id, "https://new-a.example")).status, 202);
    await repo.setInput("123", { action: "name", siteId: a.id });
    assert.equal((await repo.getInput("123"))!.siteId, a.id);
    assert.equal(await repo.getInput("other"), undefined);
    await expireInput("123", { action: "add" });
    assert.equal(await repo.getInput("123"), undefined);
    await repo.setInput("123", { action: "add" });
    await repo.setInput("123");
    assert.equal(await repo.getInput("123"), undefined);
    await repo.migrateSites();
    assert.ok((await eventRows()).length);
  } finally {
    stopTracking();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    legacyClient.close();
    await closeDatabase();
    if (process.platform !== "win32")
      await rm(dir, { recursive: true, force: true });
  }
});
