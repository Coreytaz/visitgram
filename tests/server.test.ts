import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("SQLite-only server serves tracker and health without a dashboard", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "analog-server-"));
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/services/server/index.ts"],
    {
      windowsHide: true,
      env: {
        ...process.env,
        VISITGRAM_SQLITE_URL: `file:${path.join(dir, "events.db").replaceAll("\\", "/")}`,
        VISITGRAM_TOKEN: "admin-test",
        VISITGRAM_ALLOWED_ORIGINS: "https://example.org",
        VISITGRAM_PORT_SERVER: "0",
        TELEGRAM_BOT_TOKEN: "",
        TELEGRAM_CHAT_ID: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stopped = new Promise((resolve) => child.on("exit", resolve));
  try {
    // The original server logs the configured port, so use its printed actual port.
    const port = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Server startup timeout")),
        10000,
      );
      child.once("error", reject);
      child.stderr.on("data", (data) => {
        clearTimeout(timeout);
        reject(new Error(String(data)));
      });
      child.stdout.on("data", (data) => {
        const match = String(data).match(/port (\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
    });
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/`)).status, 404);
    assert.equal((await fetch(`${base}/tracker-demo.html`)).status, 404);
    assert.equal((await fetch(`${base}/api/events`)).status, 404);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.match(
      await (await fetch(`${base}/tracker.js`)).text(),
      /data-analog-event/,
    );
    assert.equal(
      (
        await fetch(`${base}/api/track`, {
          method: "POST",
          headers: { Origin: "https://example.org" },
          body: JSON.stringify({ type: "pageview", path: "/hello" }),
        })
      ).status,
      202,
    );
    const visits = await (
      await fetch(`${base}/api/visits`, {
        headers: { Authorization: "Basic admin-test" },
      })
    ).json();
    assert.equal(visits[0].payload.path, "/hello");
    assert.equal(visits[0].status, "disabled");
  } finally {
    child.kill();
    await stopped;
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
