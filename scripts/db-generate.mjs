import { spawnSync } from "node:child_process";
// Forward CLI arguments such as --name=add_column to the installed, pinned Kit.
let result = spawnSync(process.execPath, ["scripts/schema-generate.mjs"], {
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status || 1);
result = spawnSync(
  process.execPath,
  ["node_modules/drizzle-kit/bin.cjs", "generate", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exitCode = result.status || (result.error ? 1 : 0);
