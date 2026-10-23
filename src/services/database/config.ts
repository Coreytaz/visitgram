export const DIALECTS = [
  "sqlite",
  "libsql",
  "postgresql",
  "mysql",
  "singlestore",
  "mssql",
  "cockroachdb",
] as const;
export type Dialect = (typeof DIALECTS)[number];
export function databaseConfig(env: NodeJS.ProcessEnv = process.env) {
  const dialect = env.VISITGRAM_DB_DIALECT || "sqlite";
  if (!DIALECTS.includes(dialect as Dialect))
    throw new Error("Unsupported VISITGRAM_DB_DIALECT");
  const url =
    env.VISITGRAM_DATABASE_URL ||
    (dialect === "sqlite"
      ? env.VISITGRAM_SQLITE_URL || "file:./analytics.db"
      : "");
  if (!url)
    throw new Error("Set VISITGRAM_DATABASE_URL for the selected database");
  if (dialect === "sqlite" && !url.startsWith("file:"))
    throw new Error("SQLite requires a local file: URL");
  if (dialect === "libsql" && !/^(file:|libsql:|https?:)/.test(url))
    throw new Error("Invalid libSQL URL protocol");
  return {
    dialect: dialect as Dialect,
    url,
    authToken: env.VISITGRAM_DATABASE_AUTH_TOKEN,
  };
}
