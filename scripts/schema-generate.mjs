import { mkdir, writeFile } from "node:fs/promises";
// One column inventory generates concrete, type-checked schemas for all dialects.
const tables = {
  sites: {
    id: ["key", 36, "pk"],
    name: ["str", 80, "required"],
    paused: ["int", 0, 0],
    archived: ["int", 0, 0],
    notify_pageview: ["int", 0, 1],
    notify_click: ["int", 0, 1],
    created_at: ["epoch", 0, "required"],
    template_default: ["text"],
    template_pageview: ["text"],
    template_click: ["text"],
  },
  site_event_notifications: {
    site_id: ["key", 36, "required"],
    event_type: ["key", 32, "required"],
    enabled: ["int", 0, "required"],
  },
  site_origins: {
    origin: ["key", 320, "required"],
    site_id: ["key", 36, "required"],
  },
  app_migrations: { name: ["key", 100, "pk"] },
  bot_preferences: { owner: ["key", 32, "pk"], locale: ["str", 2, "required"] },
  bot_input: { owner: ["key", 32, "pk"], state: ["text", 0, "required"] },
  site_visitors: {
    site_id: ["key", 36, "required"],
    visitor_id: ["key", 64, "required"],
    first_seen: ["epoch", 0, "required"],
    last_seen: ["epoch", 0, "required"],
  },
  visitor_sessions: {
    site_id: ["key", 36, "required"],
    visitor_id: ["key", 64, "required"],
    session_id: ["key", 64, "required"],
    is_new: ["int", 0, "required"],
    last_seen: ["epoch", 0, "required"],
  },
  tracking_events: {
    id: ["id"],
    timestamp: ["epoch", 0, "required"],
    payload: ["text", 0, "required"],
    status: ["str", 16, "required"],
    attempts: ["int", 0, 0],
    next_attempt: ["epoch", 0, 0],
    site_id: ["key", 36],
    event_type: ["str", 16],
    event_path: ["str", 1024],
    visitor_id: ["key", 64],
    identity_mode: ["str", 16],
  },
};
const pks = {
  site_origins: ["origin", "site_id"],
  site_event_notifications: ["site_id", "event_type"],
  site_visitors: ["site_id", "visitor_id"],
  visitor_sessions: ["site_id", "visitor_id", "session_id"],
};
const indexes = {
  tracking_events: {
    tracking_delivery: ["status", "next_attempt"],
    tracking_site_time: ["site_id", "timestamp"],
  },
};
await mkdir("src/services/database/schema", { recursive: true });
for (const dialect of [
  "sqlite",
  "postgresql",
  "mysql",
  "singlestore",
  "mssql",
  "cockroachdb",
]) {
  const core = {
    sqlite: "sqlite-core",
    postgresql: "pg-core",
    mysql: "mysql-core",
    singlestore: "singlestore-core",
    mssql: "mssql-core",
    cockroachdb: "cockroach-core",
  }[dialect];
  const table = {
    sqlite: "sqliteTable",
    postgresql: "pgTable",
    mysql: "mysqlTable",
    singlestore: "singlestoreTable",
    mssql: "mssqlTable",
    cockroachdb: "cockroachTable",
  }[dialect];
  const imports = new Set([table, "primaryKey", "index"]);
  function col(name, [kind, length, flag]) {
    let expression;
    const call = (fn, args = "") => {
      imports.add(fn);
      return `${fn}('${name}'${args ? `, ${args}` : ""})`;
    };
    if (dialect === "sqlite")
      expression =
        kind === "id"
          ? `${call("integer")}.primaryKey({ autoIncrement: true })`
          : ["int", "epoch"].includes(kind)
            ? call("integer")
            : call("text");
    else if (kind === "id") {
      if (dialect === "postgresql")
        expression = `${call("bigserial", "{ mode: 'number' }")}.primaryKey()`;
      else if (dialect === "cockroachdb")
        expression = `${call("bigint", "{ mode: 'number' }")}.primaryKey().generatedByDefaultAsIdentity()`;
      else if (dialect === "mssql")
        expression = `${call("bigint", "{ mode: 'number' }")}.identity().primaryKey()`;
      else
        expression = `${call("bigint", "{ mode: 'number' }")}.autoincrement().primaryKey()`;
    } else if (kind === "epoch")
      expression = call("bigint", "{ mode: 'number' }");
    else if (kind === "int")
      expression = call(
        dialect === "postgresql"
          ? "integer"
          : dialect === "cockroachdb"
            ? "int4"
            : "int",
      );
    else if (dialect === "mssql")
      expression = call(
        kind === "key" ? "varchar" : "nvarchar",
        `{ length: ${kind === "text" ? "'max'" : length} }`,
      );
    else if (kind === "text") expression = call("text");
    else expression = call("varchar", `{ length: ${length} }`);
    if (flag === "pk") expression += ".primaryKey()";
    if (flag === "required" || typeof flag === "number")
      expression += ".notNull()";
    if (typeof flag === "number") expression += `.default(${flag})`;
    if (name === "site_id" && dialect !== "singlestore")
      expression += ".references(() => sites.id)";
    return `  ${name}: ${expression},`;
  }
  const blocks = [];
  for (const [name, columns] of Object.entries(tables)) {
    const fields = Object.entries(columns).map(([name, descriptor]) =>
      col(name, descriptor),
    );
    const extras = [];
    if (pks[name])
      extras.push(
        `primaryKey({ columns: [${pks[name].map((c) => `t.${c}`).join(", ")}] })`,
      );
    for (const [idx, cols] of Object.entries(indexes[name] || {}))
      extras.push(
        `index('${idx}').on(${cols.map((c) => `t.${c}`).join(", ")})`,
      );
    blocks.push(
      `export const ${name} = ${table}('${name}', {\n${fields.join("\n")}\n}${extras.length ? `, (t) => [${extras.join(", ")}]` : ""});`,
    );
  }
  await writeFile(
    `src/services/database/schema/${dialect}.ts`,
    `// Generated by scripts/schema-generate.mjs; edit its column inventory.\nimport { ${[...imports].join(", ")} } from 'drizzle-orm/${core}';\n\n${blocks.join("\n\n")}\n`,
  );
}
