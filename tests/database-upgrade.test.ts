import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";

test("legacy SQLite upgrades without changing payloads, IDs, templates or queue statuses; corrupt JSON is retained", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "analog-upgrade-"));
  process.env.VISITGRAM_SQLITE_URL = `file:${path.join(folder, "legacy.db").replaceAll("\\", "/")}`;
  process.env.VISITGRAM_ALLOWED_ORIGINS = "";
  const old = createClient({ url: process.env.VISITGRAM_SQLITE_URL });
  await old.execute(
    `CREATE TABLE sites(id TEXT PRIMARY KEY,name TEXT NOT NULL,paused INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,notify_pageview INTEGER NOT NULL DEFAULT 1,notify_click INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,template_default TEXT,template_pageview TEXT,template_click TEXT)`,
  );
  await old.execute(
    `CREATE TABLE tracking_events(id INTEGER PRIMARY KEY AUTOINCREMENT,timestamp INTEGER NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,site_id TEXT)`,
  );
  await old.execute(`CREATE TABLE app_migrations(name TEXT PRIMARY KEY)`);
  await old.execute(`INSERT INTO app_migrations(name) VALUES('sites-v1')`);
  const id = "00000000-0000-4000-8000-000000000001",
    now = Date.now();
  await old.execute({
    sql: "INSERT INTO sites(id,name,created_at,template_default) VALUES(?,?,?,?)",
    args: [id, "Старый сайт", now, "<b>{action}</b>"],
  });
  for (const [eventId, payload, status] of [
    [7, "{broken-json", "pending"],
    [
      99,
      JSON.stringify({
        type: "pageview",
        path: "/old",
        visitor: "old-visitor",
      }),
      "sent",
    ],
  ] as const) {
    await old.execute({
      sql: "INSERT INTO tracking_events(id,timestamp,payload,status,attempts,next_attempt,site_id) VALUES(?,?,?,?,?,?,?)",
      args: [eventId, now, payload, status, 2, now + 50000, id],
    });
  }
  const before = (
    await old.execute("SELECT * FROM tracking_events ORDER BY id")
  ).rows;
  old.close();
  const { db, t, eventRows, insertFixture, closeDatabase } =
    await import("./fixtures.js");
  const { migrateSites, getSite, siteStats } =
    await import("../src/services/database/sites.js");
  try {
    await migrateSites();
    for (let repeat = 0; repeat < 2; repeat++) {
      const rows = await eventRows();
      assert.equal(rows.length, before.length);
      for (let index = 0; index < rows.length; index++) {
        for (const field of [
          "id",
          "timestamp",
          "payload",
          "status",
          "attempts",
          "next_attempt",
          "site_id",
        ] as const)
          assert.equal(rows[index][field], before[index][field]);
      }
      assert.equal(rows[0].event_type, null);
      assert.equal(rows[1].event_path, "/old");
      assert.equal((await getSite(id))!.templateDefault, "<b>{action}</b>");
      assert.equal((await siteStats(id, 1)).views, 1);
      await migrateSites();
    }
    await insertFixture({
      site_id: id,
      timestamp: now,
      payload: JSON.stringify({ type: "click", path: "/next" }),
      status: "disabled",
    });
    assert.equal((await eventRows()).at(-1)!.id, 100);
    assert.ok((await db.select().from(t.app_migrations)).length >= 3);
  } finally {
    await closeDatabase();
    if (process.platform !== "win32")
      await rm(folder, { recursive: true, force: true });
  }
});
