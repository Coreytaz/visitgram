import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import type { QueryDatabase } from "../src/services/database/connection.js";
import type * as Shape from "../src/services/database/schema/sqlite.js";

const adapters = [
  ["postgresql", "drizzle-orm/node-postgres"],
  ["mysql", "drizzle-orm/mysql2"],
  ["singlestore", "drizzle-orm/singlestore"],
  ["mssql", "drizzle-orm/node-mssql"],
  ["cockroachdb", "drizzle-orm/cockroach"],
] as const;
for (const [dialect, adapter] of adapters) {
  test(`native Drizzle query compilation: ${dialect}`, async () => {
    const driver = await import(adapter);
    const db = driver.drizzle.mock() as QueryDatabase;
    const t = (await import(
      `../src/services/database/schema/${dialect}.js`
    )) as typeof Shape;
    const insert = db
      .insert(t.tracking_events)
      .values({
        timestamp: Date.now(),
        payload: "{}",
        status: "pending",
        event_type: "pageview",
        event_path: "/test",
        visitor_id: "id",
        identity_mode: "persistent",
      })
      .toSQL();
    assert.match(insert.sql.toLowerCase(), /insert into/);
    assert.ok(insert.params.includes("pending"));
    const update = db
      .update(t.sites)
      .set({ template_default: "{action}", paused: 1 })
      .where(eq(t.sites.id, "site-id"))
      .toSQL();
    assert.ok(update.params.includes("{action}"));
    assert.ok(update.params.includes("site-id"));
    const query = db
      .select({ id: t.tracking_events.id })
      .from(t.tracking_events)
      .where(eq(t.tracking_events.status, "pending"))
      .orderBy(t.tracking_events.id);
    const limited =
      dialect === "mssql"
        ? (
            query as unknown as {
              offset(n: number): {
                fetch(n: number): {
                  toSQL(): { sql: string; params: unknown[] };
                };
              };
            }
          )
            .offset(0)
            .fetch(1)
            .toSQL()
        : query.limit(1).toSQL();
    assert.match(
      limited.sql.toLowerCase(),
      dialect === "mssql" ? /fetch next/ : /limit/,
    );
    const aggregate = db
      .select({
        views: sql`coalesce(sum(case when ${t.tracking_events.event_type} = 'pageview' then 1 else 0 end), 0)`,
      })
      .from(t.tracking_events)
      .toSQL();
    assert.match(aggregate.sql.toLowerCase(), /case when/);
    assert.doesNotMatch(aggregate.sql, /json_extract|jsonb_/);
    assert.doesNotThrow(() =>
      db.delete(t.bot_input).where(eq(t.bot_input.owner, "123")).toSQL(),
    );
  });
}
