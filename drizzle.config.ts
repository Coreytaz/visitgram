import { defineConfig } from "drizzle-kit";
import { databaseConfig } from "./src/services/database/config.js";
const { dialect, url, authToken } = databaseConfig();
const schemaDialect = dialect === "libsql" ? "sqlite" : dialect;
export default defineConfig({
  dialect: schemaDialect === "cockroachdb" ? "cockroach" : schemaDialect,
  schema: `./src/services/database/schema/${schemaDialect}.ts`,
  out: `./drizzle/${schemaDialect}`,
  dbCredentials: { url, ...(dialect === "libsql" ? { authToken } : {}) },
} as Parameters<typeof defineConfig>[0]);
