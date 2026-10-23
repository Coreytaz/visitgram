import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { databaseConfig } from "./config.js";
import type * as SQLiteSchema from "./schema/sqlite.js";

export type QueryDatabase = Pick<
  LibSQLDatabase,
  "select" | "selectDistinct" | "insert" | "update" | "delete"
>;
type RuntimeDatabase = QueryDatabase & {
  transaction<T>(
    fn: (tx: QueryDatabase) => Promise<T>,
    options?: object,
  ): Promise<T>;
};

export const config = databaseConfig();
async function connect() {
  const { dialect, url, authToken } = config;
  if (dialect === "sqlite" || dialect === "libsql") {
    const [{ createClient }, { drizzle }, schema] = await Promise.all([
      import("@libsql/client"),
      import("drizzle-orm/libsql"),
      import("./schema/sqlite.js"),
    ]);
    const client = createClient({ url, authToken });
    return {
      db: drizzle({ client, logger: false }),
      schema,
      raw: async (statement: string) =>
        (await client.execute(statement)).rows as Record<string, unknown>[],
      close: async () => client.close(),
    };
  }
  if (dialect === "postgresql" || dialect === "cockroachdb") {
    const { Pool } = await import("pg");
    const client = new Pool({ connectionString: url, max: 5 });
    client.on("error", () => console.error("Database pool connection failed"));
    const db =
      dialect === "postgresql"
        ? (await import("drizzle-orm/node-postgres")).drizzle({ client })
        : (await import("drizzle-orm/cockroach")).drizzle({ client });
    const schema =
      dialect === "postgresql"
        ? await import("./schema/postgresql.js")
        : await import("./schema/cockroachdb.js");
    return {
      db,
      schema,
      raw: async (statement: string) =>
        (await client.query(statement)).rows as Record<string, unknown>[],
      close: () => client.end(),
    };
  }
  if (dialect === "mysql" || dialect === "singlestore") {
    const { createPool } = await import("mysql2/promise");
    const client = createPool({
      uri: url,
      connectionLimit: 5,
      supportBigNumbers: true,
    });
    const db =
      dialect === "mysql"
        ? (await import("drizzle-orm/mysql2")).drizzle({ client })
        : (await import("drizzle-orm/singlestore")).drizzle({ client });
    const schema =
      dialect === "mysql"
        ? await import("./schema/mysql.js")
        : await import("./schema/singlestore.js");
    return {
      db,
      schema,
      raw: async (statement: string) => {
        const [result] = await client.query(statement);
        return Array.isArray(result)
          ? (result as unknown as Record<string, unknown>[])
          : [];
      },
      close: () => client.end(),
    };
  }
  const [{ ConnectionPool }, { drizzle, getMsSqlConnectionParams }, schema] =
    await Promise.all([
      import("mssql"),
      import("drizzle-orm/node-mssql"),
      import("./schema/mssql.js"),
    ]);
  const options = getMsSqlConnectionParams(url);
  if (typeof options !== "string") {
    const parsed = new URL(url);
    options.user = decodeURIComponent(parsed.username);
    options.password = decodeURIComponent(parsed.password);
    options.port = parsed.port ? Number(parsed.port) : 1433;
  }
  const client = await new ConnectionPool(options).connect();
  client.on("error", () => console.error("Database pool connection failed"));
  return {
    db: drizzle({ client }),
    schema,
    raw: async (statement: string) =>
      ((await client.request().query(statement)).recordset as Record<
        string,
        unknown
      >[]) || [],
    close: () => client.close(),
  };
}

const connection = await connect().catch(() => {
  throw new Error(
    "Database initialization failed; check connection configuration",
  );
});
// These adapters share the select/insert/update/delete surface and identical column
// models. Dialect-specific builders (LIMIT, transactions, migrations) stay here.
// The cast does not substitute SQLite tables: actual driver and tables remain native.
export const db = connection.db as unknown as RuntimeDatabase;
export const tables = connection.schema as unknown as typeof SQLiteSchema;
export const rawMigrationQuery = connection.raw;
export const closeDatabase = connection.close;

export async function take<T>(
  query: PromiseLike<T> & { limit(n: number): PromiseLike<T> },
  n: number,
): Promise<T> {
  if (config.dialect === "mssql") {
    const native = query as unknown as {
      offset(n: number): { fetch(n: number): PromiseLike<T> };
    };
    return await native.offset(0).fetch(n);
  }
  return await query.limit(n);
}

let tail: Promise<unknown> = Promise.resolve();
function retryable(error: unknown): boolean {
  for (let depth = 0; error && depth < 6; depth++) {
    const e = error as { code?: unknown; number?: unknown; cause?: unknown };
    if (
      [
        "40001",
        "40P01",
        "SQLITE_BUSY",
        "SQLITE_BUSY_SNAPSHOT",
        "ER_LOCK_DEADLOCK",
        "ER_LOCK_WAIT_TIMEOUT",
      ].includes(String(e.code)) ||
      e.number === 1205
    )
      return true;
    error = e.cause;
  }
  return false;
}
export function write<T>(fn: (tx: QueryDatabase) => Promise<T>): Promise<T> {
  const operation = tail.then(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const options = ["sqlite", "libsql"].includes(config.dialect)
          ? { behavior: "immediate" }
          : config.dialect === "singlestore"
            ? undefined
            : { isolationLevel: "serializable" };
        return await db.transaction(fn, options);
      } catch (error) {
        if (attempt >= 2 || !retryable(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  });
  tail = operation.catch(() => {});
  return operation;
}
