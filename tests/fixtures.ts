import { asc, eq } from "drizzle-orm";
import { db, tables as t, write } from "../src/services/database/connection.js";
import { eventColumns } from "../src/services/database/migrate.js";
export { db, t, write };
export { closeDatabase } from "../src/services/database/connection.js";
export { and, eq, count } from "drizzle-orm";
export function eventRows() {
  return db.select().from(t.tracking_events).orderBy(asc(t.tracking_events.id));
}
export function insertFixture(row: typeof t.tracking_events.$inferInsert) {
  return write(async (tx) => {
    await tx
      .insert(t.tracking_events)
      .values({ ...row, ...eventColumns(row.payload) });
  });
}
export function expireInput(owner: string, state: unknown) {
  return write(async (tx) => {
    await tx
      .update(t.bot_input)
      .set({ state: JSON.stringify({ ...(state as object), expires: 0 }) })
      .where(eq(t.bot_input.owner, owner));
  });
}
