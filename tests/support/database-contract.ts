import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { and, eq } from "drizzle-orm";

try {
  const {
    db,
    tables: t,
    write,
    closeDatabase,
  } = await import("../../src/services/database/connection.js");
  const sites = await import("../../src/services/database/sites.js");
  const { insertEvent, eventsSince, pendingEvent, updatePending } =
    await import("../../src/services/database/events.js");
  const tag = randomUUID(),
    owner = tag.slice(0, 30),
    created: string[] = [];
  try {
    await sites.migrateSites();
    const a = await sites.createSite(`https://${tag}.example`);
    created.push(a.id);
    const b = await sites.createSite(`https://other-${tag}.example`);
    created.push(b.id);
    await assert.rejects(sites.createSite(a.origins[0]));
    await assert.rejects(
      sites.updateSite(a.id, {
        name: "should rollback",
        origins: b.origins[0],
      }),
    );
    assert.equal((await sites.getSite(a.id))!.name, a.name);
    await assert.rejects(
      write(async (tx) => {
        await tx
          .update(t.sites)
          .set({ name: "rolled back" })
          .where(eq(t.sites.id, a.id));
        throw Error("rollback");
      }),
    );
    assert.equal((await sites.getSite(a.id))!.name, a.name);
    const now = Date.now(),
      visitor = randomUUID(),
      session = randomUUID();
    const event = {
      type: "pageview",
      path: "/test",
      visitor,
      session,
      identityMode: "persistent",
      visitorStatus: "unknown" as const,
    };
    const concurrent = await Promise.all(
      Array.from({ length: 6 }, () =>
        insertEvent(a.id, a.origins[0], event, now, true),
      ),
    );
    assert.ok(concurrent.every((status) => status === 202));
    let rows = await eventsSince(a.id, now);
    assert.equal(rows.length, 6);
    assert.equal(
      rows.filter((row) => JSON.parse(row.payload).visitorStatus === "new")
        .length,
      1,
    );
    assert.equal(
      rows.filter(
        (row) => JSON.parse(row.payload).visitorStatus === "returning",
      ).length,
      5,
    );
    assert.equal(
      await insertEvent(
        a.id,
        a.origins[0],
        { ...event, session: randomUUID(), type: "click" },
        now + 1,
        true,
      ),
      202,
    );
    rows = await eventsSince(a.id, now);
    assert.equal(JSON.parse(rows.at(-1)!.payload).visitorStatus, "returning");
    const stats = await sites.siteStats(a.id, 1);
    assert.equal(stats.visitors, 1);
    assert.equal(stats.views, 6);
    assert.equal(stats.clicks, 1);
    assert.equal((await sites.siteStats(b.id, 1)).views, 0);
    await sites.setSiteTemplate(a.id, "default", "<b>{site_name}</b> {action}");
    await sites.setSiteTemplate(a.id, "click", "{element}");
    assert.equal((await sites.getSite(b.id))!.templateDefault, null);
    await sites.setInput(owner, {
      action: "template",
      siteId: a.id,
      templateKind: "default",
      draft: "{action}",
      draftToken: "12345678",
      phase: "preview",
    });
    await sites.migrateSites();
    assert.equal((await sites.getInput(owner))!.draft, "{action}");
    assert.equal((await sites.getSite(a.id))!.templateClick, "{element}");
    assert.equal((await eventsSince(a.id, now)).length, 7);
    const restart = spawn(
      process.execPath,
      [
        "--use-env-proxy",
        "--import",
        "tsx",
        "tests/support/persistence-check.ts",
      ],
      {
        env: {
          ...process.env,
          VISITGRAM_CONTRACT_SITE_ID: a.id,
          VISITGRAM_CONTRACT_OWNER: owner,
        },
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    assert.equal(
      await new Promise((resolve, reject) => {
        restart.once("error", reject);
        restart.once("exit", resolve);
      }),
      0,
    );
    const pending = await pendingEvent();
    assert.ok(pending);
    await updatePending(rows[0].id, { status: "sent", attempts: 1 });
    await sites.updateSite(a.id, { toggle: "notify_click" });
    assert.equal((await eventsSince(a.id, now)).at(-1)!.status, "disabled");
    await sites.updateSite(a.id, { toggle: "paused" });
    assert.equal(
      await insertEvent(a.id, a.origins[0], event, now + 2, true),
      204,
    );
    assert.equal(
      (await eventsSince(a.id, now)).filter((row) => row.status === "pending")
        .length,
      0,
    );
    await sites.updateSite(a.id, { archived: true });
    await assert.rejects(sites.setSiteTemplate(a.id, "default", "no"));
    assert.equal(
      await insertEvent(a.id, a.origins[0], event, now + 3, true),
      404,
    );
    await sites.updateSite(a.id, { archived: false });
    await sites.setSiteTemplate(a.id, "click", null);
    assert.equal((await sites.getSite(a.id))!.templateClick, null);
    // A settings write racing an insert has a single ordered outcome and no pending sends.
    await sites.updateSite(b.id, { toggle: "paused" });
    await Promise.all([
      sites.updateSite(b.id, { toggle: "paused" }),
      insertEvent(b.id, b.origins[0], event, now + 4, true),
      sites.updateSite(b.id, { archived: true }),
    ]);
    assert.equal(
      (await eventsSince(b.id, now)).filter((row) => row.status === "pending")
        .length,
      0,
    );
    await write(async (tx) => {
      await tx
        .update(t.bot_input)
        .set({ state: JSON.stringify({ action: "add", expires: 0 }) })
        .where(eq(t.bot_input.owner, owner));
    });
    assert.equal(await sites.getInput(owner), undefined);
    assert.equal(
      (
        await db
          .select()
          .from(t.site_visitors)
          .where(
            and(
              eq(t.site_visitors.site_id, a.id),
              eq(t.site_visitors.visitor_id, visitor),
            ),
          )
      ).length,
      1,
    );
    console.log("Repository contract passed");
  } finally {
    try {
      if (created.length) await sites.setInput(owner);
      await write(async (tx) => {
        for (const id of created) {
          await tx
            .delete(t.tracking_events)
            .where(eq(t.tracking_events.site_id, id));
          await tx
            .delete(t.visitor_sessions)
            .where(eq(t.visitor_sessions.site_id, id));
          await tx
            .delete(t.site_visitors)
            .where(eq(t.site_visitors.site_id, id));
          await tx.delete(t.site_origins).where(eq(t.site_origins.site_id, id));
          await tx.delete(t.sites).where(eq(t.sites.id, id));
        }
      });
    } finally {
      await closeDatabase();
    }
  }
} catch {
  console.log("Repository contract failed (connection/error details hidden)");
  process.exitCode = 1;
}
