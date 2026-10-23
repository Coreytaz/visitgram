import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";

test("SQLite tracking, access controls, Telegram retry and durable outbox", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "analog-test-"));
  process.env.VISITGRAM_SQLITE_URL = `file:${path.join(dir, "events.db").replaceAll("\\", "/")}`;
  process.env.VISITGRAM_TOKEN = "test-admin";
  process.env.VISITGRAM_ALLOWED_ORIGINS = "https://example.org";
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "123";
  const { initTracking, handleTracking, stopTracking } =
    await import("../src/services/server/tracking.js");
  const { eventRows, t, write, closeDatabase } = await import("./fixtures.js");
  const realFetch = globalThis.fetch;
  let attempts = 0;
  const messages: string[] = [];
  globalThis.fetch = (async (url, options) => {
    if (String(url).startsWith("https://api.telegram.org/")) {
      assert.ok(
        options?.signal instanceof AbortSignal,
        "grammY cancellation must use a native AbortSignal for Node fetch",
      );
      attempts++;
      if (attempts === 1)
        return new Response(
          JSON.stringify({
            ok: false,
            error_code: 429,
            description: "Too Many Requests",
            parameters: { retry_after: 45 },
          }),
          { status: 429 },
        );
      const data = JSON.parse(String(options?.body));
      messages.push(data.text);
      assert.equal(data.chat_id, "123");
      assert.equal(data.parse_mode, "HTML");
      assert.deepEqual(data.link_preview_options, { is_disabled: true });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return realFetch(url, options);
  }) as typeof fetch;
  const server = http.createServer((req, res) => {
    void handleTracking(req, res)
      .then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      })
      .catch(() => {
        res.writeHead(500);
        res.end();
      });
  });
  try {
    await initTracking();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const post = (payload: unknown, origin = "https://example.org") =>
      fetch(`${base}/api/track`, {
        method: "POST",
        headers: {
          Origin: origin,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36",
          "X-Forwarded-For": "8.8.8.8",
        },
        body: JSON.stringify(payload),
      });
    assert.equal(
      (await post({ type: "pageview", path: "/" }, "https://other.org")).status,
      404,
    );
    assert.equal((await fetch(`${base}/api/visits`)).status, 401);
    assert.equal((await post({ type: "password", path: "/" })).status, 400);
    assert.equal(
      (await post({ type: "click", path: "/", label: "x".repeat(5000) }))
        .status,
      413,
    );
    const preflight = await fetch(`${base}/api/track`, {
      method: "OPTIONS",
      headers: { Origin: "https://example.org" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "https://example.org",
    );
    assert.equal(
      (
        await post({
          type: "click",
          path: "/pricing?token=secret#fragment",
          visitor: "v1",
          label: "Buy <now>",
          referrer: "https://search.org/query?q=private",
          title: "Тарифы",
          language: "ru-RU",
          timezone: "Asia/Yekaterinburg",
          screen: { width: 1920, height: 1080 },
          viewport: { width: "1920", height: -5 },
          elapsedSeconds: 12.9,
          campaign: { utm_source: "telegram", password: "private" },
        })
      ).status,
      202,
    );
    const visit = (
      await (
        await fetch(`${base}/api/visits`, {
          headers: { Authorization: "Basic test-admin" },
        })
      ).json()
    )[0];
    assert.equal(visit.payload.path, "/pricing");
    assert.equal(visit.payload.referrer, "https://search.org");
    assert.equal(visit.payload.site, "example.org");
    assert.equal(visit.payload.ip, "127.0.0.1");
    assert.equal(visit.payload.browser, "Chrome 130");
    assert.equal(visit.payload.os, "Windows");
    assert.equal(visit.payload.screen, "1920 × 1080");
    assert.equal(visit.payload.viewport, "");
    assert.equal(visit.payload.elapsedSeconds, 12);
    assert.deepEqual(visit.payload.campaign, { utm_source: "telegram" });
    assert.equal((await eventRows()).length, 1);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(attempts, 1);
    assert.equal((await eventRows())[0].attempts, 1);
    assert.ok(Number((await eventRows())[0].next_attempt) > Date.now() + 40000);
    stopTracking();
    // Delivery resolves the latest template, including events already in the durable queue.
    const repo = await import("../src/services/server/sites.js");
    const queuedSite = (await repo.listSites())[0];
    await repo.setSiteTemplate(
      queuedSite.id,
      "default",
      "CUSTOM <b>Нажатие кнопки</b> {element} <code>{path}</code> {browser} {timezone} utm_source={utm_source}",
    );
    await write(async (tx) => {
      await tx.update(t.tracking_events).set({ next_attempt: 0 });
    });
    await initTracking(); // Reopening the worker preserves and sends the pending row.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(messages.length, 1);
    assert.match(messages[0], /^CUSTOM /);
    assert.match(messages[0], /Buy &lt;now&gt;/);
    assert.doesNotMatch(messages[0], /Buy <now>/);
    assert.match(messages[0], /<b>Нажатие кнопки<\/b>/);
    assert.match(messages[0], /<code>\/pricing<\/code>/);
    assert.match(messages[0], /Chrome 130/);
    assert.match(messages[0], /Asia\/Yekaterinburg/);
    assert.match(messages[0], /utm_source=telegram/);
    assert.doesNotMatch(messages[0], /secret|private/);
    assert.equal((await eventRows())[0].status, "sent");
    assert.equal((await fetch(`${base}/tracker.js`)).status, 200);
  } finally {
    stopTracking();
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase();
    // libsql's Windows native binding can retain its file handle until process exit.
    if (process.platform !== "win32")
      await rm(dir, { recursive: true, force: true });
  }
});
