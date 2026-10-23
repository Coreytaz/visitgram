import { isEventType } from "../server/event-types.js";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { asc, eq, gt, like } from "drizzle-orm";
import {
  db,
  tables,
  config,
  rawMigrationQuery,
  take,
  write,
} from "./connection.js";

async function exists(kind: "table" | "index", name: string): Promise<boolean> {
  // Identifiers come only from checked-in migration files, never user input.
  if (!/^[a-zA-Z0-9_]+$/.test(name))
    throw Error("Invalid migration identifier");
  if (["sqlite", "libsql"].includes(config.dialect))
    return (
      (
        await rawMigrationQuery(
          `SELECT name FROM sqlite_master WHERE type='${kind}' AND name='${name}'`,
        )
      ).length > 0
    );
  if (config.dialect === "mssql")
    return (
      (
        await rawMigrationQuery(
          kind === "table"
            ? `SELECT name FROM sys.tables WHERE name='${name}'`
            : `SELECT name FROM sys.indexes WHERE name='${name}'`,
        )
      ).length > 0
    );
  if (["mysql", "singlestore"].includes(config.dialect))
    return (
      (
        await rawMigrationQuery(
          kind === "table"
            ? `SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='${name}'`
            : `SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND index_name='${name}'`,
        )
      ).length > 0
    );
  return (
    (
      await rawMigrationQuery(
        kind === "table"
          ? `SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename='${name}'`
          : `SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname='${name}'`,
      )
    ).length > 0
  );
}

export function eventColumns(payload: unknown) {
  let event: Record<string, unknown> = {};
  try {
    const parsed: unknown =
      typeof payload === "string" ? JSON.parse(payload) : payload;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      event = parsed as Record<string, unknown>;
  } catch {
    /* Preserve corrupt history; leave its derived fields empty. */
  }
  const valid = isEventType(event.type);
  return {
    event_type: valid ? String(event.type) : null,
    event_path:
      valid && typeof event.path === "string" && event.path.length <= 1024
        ? event.path
        : null,
    visitor_id:
      valid && typeof event.visitor === "string" && event.visitor.length <= 64
        ? event.visitor
        : null,
    identity_mode: valid
      ? ["persistent", "session", "memory"].includes(String(event.identityMode))
        ? String(event.identityMode)
        : "legacy"
      : null,
  };
}

export async function backfillEventColumns() {
  let cursor = 0;
  for (;;) {
    const batch = await take(
      db
        .select({
          id: tables.tracking_events.id,
          payload: tables.tracking_events.payload,
        })
        .from(tables.tracking_events)
        .where(gt(tables.tracking_events.id, cursor))
        .orderBy(asc(tables.tracking_events.id)),
      500,
    );
    if (!batch.length) return;
    await write(async (tx) => {
      for (const row of batch)
        await tx
          .update(tables.tracking_events)
          .set(eventColumns(row.payload))
          .where(eq(tables.tracking_events.id, row.id));
    });
    cursor = batch.at(-1)!.id;
  }
}

async function adoptSQLite() {
  const additions: Record<string, Record<string, string>> = {
    sites: {
      template_default: "TEXT",
      template_pageview: "TEXT",
      template_click: "TEXT",
    },
    tracking_events: {
      site_id: "TEXT REFERENCES sites(id)",
      event_type: "TEXT",
      event_path: "TEXT",
      visitor_id: "TEXT",
      identity_mode: "TEXT",
    },
  };
  for (const [table, columns] of Object.entries(additions)) {
    if (!(await exists("table", table))) continue;
    const existing = await rawMigrationQuery(`PRAGMA table_info(${table})`);
    for (const [column, type] of Object.entries(columns))
      if (!existing.some((row) => row.name === column))
        await rawMigrationQuery(
          `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`,
        );
  }
}

function caseSensitiveDDL(statement: string) {
  // Normalized origins and identifiers must not inherit case-insensitive collations.
  if (["mysql", "singlestore"].includes(config.dialect))
    return statement.replace(
      /(varchar\(\d+\))/g,
      "$1 CHARACTER SET utf8mb4 COLLATE utf8mb4_bin",
    );
  if (config.dialect === "mssql")
    return statement.replace(
      /(n?varchar\((?:\d+|max)\))/g,
      "$1 COLLATE Latin1_General_100_BIN2",
    );
  return statement;
}

let migrating: Promise<void> | undefined;
export function migrateDatabase() {
  if (!migrating)
    migrating = applyMigrations().finally(() => {
      migrating = undefined;
    });
  return migrating;
}
async function applyMigrations() {
  const dialect = config.dialect === "libsql" ? "sqlite" : config.dialect;
  if (dialect === "sqlite") await adoptSQLite();
  const folder = new URL(`../../../drizzle/${dialect}/`, import.meta.url);
  const entries = (await readdir(folder, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (let i = 0; i < entries.length; i++) {
    const name = entries[i];
    const source = await readFile(
      new URL(`${name}/migration.sql`, folder),
      "utf8",
    );
    const key = `drizzle:${name}:`,
      hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
    const hasJournal = await exists("table", "app_migrations");
    if (hasJournal) {
      const applied = await db
        .select()
        .from(tables.app_migrations)
        .where(like(tables.app_migrations.name, `${key}%`));
      if (applied.length) {
        if (applied[0].name !== key + hash)
          throw Error("An applied database migration was modified");
        continue;
      }
    }
    for (let statement of source
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const table = /^CREATE TABLE ["`[]?(\w+)/i.exec(statement);
      const index = /^CREATE (?:UNIQUE )?INDEX ["`[]?(\w+)/i.exec(statement);
      // The baseline adopts legacy SQLite and can resume after non-transactional DDL.
      if (i === 0 && table && (await exists("table", table[1]))) continue;
      if (i === 0 && index && (await exists("index", index[1]))) continue;
      statement = caseSensitiveDDL(statement);
      // FK ALTER statements may already have committed before an interrupted bootstrap.
      const fk = /ADD CONSTRAINT ["`[]?(\w+)/i.exec(statement);
      if (i === 0 && fk && (await constraintExists(fk[1]))) continue;
      await rawMigrationQuery(statement);
    }
    await write(async (tx) => {
      await tx.insert(tables.app_migrations).values({ name: key + hash });
    });
  }
  const normalized = "normalized-events-v1";
  if (
    !(
      await db
        .select()
        .from(tables.app_migrations)
        .where(eq(tables.app_migrations.name, normalized))
    ).length
  ) {
    await backfillEventColumns();
    await write(async (tx) => {
      await tx.insert(tables.app_migrations).values({ name: normalized });
    });
  }
}
async function constraintExists(name: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw Error("Invalid constraint name");
  if (config.dialect === "mssql")
    return (
      (
        await rawMigrationQuery(
          `SELECT name FROM sys.foreign_keys WHERE name='${name}'`,
        )
      ).length > 0
    );
  return (
    (
      await rawMigrationQuery(
        `SELECT constraint_name FROM information_schema.table_constraints WHERE constraint_name='${name}' AND constraint_type='FOREIGN KEY'`,
      )
    ).length > 0
  );
}
