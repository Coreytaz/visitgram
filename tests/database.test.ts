import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { databaseConfig, DIALECTS } from "../src/services/database/config.js";

test("database configuration preserves SQLite fallback and validates selection without exposing credentials", () => {
  assert.equal(databaseConfig({}).url, "file:./analytics.db");
  assert.equal(
    databaseConfig({ VISITGRAM_SQLITE_URL: "file:legacy.db" }).url,
    "file:legacy.db",
  );
  assert.equal(
    databaseConfig({
      VISITGRAM_SQLITE_URL: "file:legacy.db",
      VISITGRAM_DATABASE_URL: "file:new.db",
    }).url,
    "file:new.db",
  );
  assert.throws(
    () =>
      databaseConfig({
        VISITGRAM_DB_DIALECT: "unknown",
        VISITGRAM_DATABASE_URL: "private-secret",
      }),
    /Unsupported VISITGRAM_DB_DIALECT/,
  );
  assert.throws(
    () => databaseConfig({ VISITGRAM_DB_DIALECT: "postgresql" }),
    /Set VISITGRAM_DATABASE_URL/,
  );
  assert.throws(
    () => databaseConfig({ VISITGRAM_DATABASE_URL: "https://secret.invalid" }),
    /local file/,
  );
});

for (const dialect of DIALECTS) {
  const key = `VISITGRAM_TEST_${dialect.toUpperCase()}_URL`;
  // libsql's local transport exercises its adapter even without a Turso account.
  const local = dialect === "sqlite" || dialect === "libsql";
  test(
    `database repository contract: ${dialect}`,
    {
      skip:
        !local && !process.env[key]
          ? `Set ${key} to a dedicated test database`
          : false,
    },
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), `analog-${dialect}-`));
      const url =
        process.env[key] ||
        `file:${path.join(folder, "contract.db").replaceAll("\\", "/")}`;
      const child = spawn(
        process.execPath,
        [
          "--use-env-proxy",
          "--import",
          "tsx",
          "tests/support/database-contract.ts",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            VISITGRAM_DB_DIALECT: dialect,
            VISITGRAM_DATABASE_URL: url,
            VISITGRAM_DATABASE_AUTH_TOKEN:
              process.env.VISITGRAM_TEST_LIBSQL_AUTH_TOKEN || "",
            VISITGRAM_ALLOWED_ORIGINS: "",
            TELEGRAM_BOT_TOKEN: "",
            TELEGRAM_CHAT_ID: "",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const timeout = setTimeout(() => child.kill(), 45000);
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr.on("data", () => {}); // Drivers can include credentials in errors.
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
      clearTimeout(timeout);
      assert.equal(
        code,
        0,
        output || `${dialect} contract failed; verify test connection`,
      );
      if (process.platform !== "win32")
        await rm(folder, { recursive: true, force: true });
    },
  );
}
