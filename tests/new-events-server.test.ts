import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";

test("new events persist, aggregate, honor independent toggles and expose Telegram controls", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "analog-new-events-"));
  process.env.VISITGRAM_SQLITE_URL = `file:${path.join(dir, "events.db").replaceAll("\\", "/")}`;
  process.env.VISITGRAM_TOKEN = "test";
  process.env.VISITGRAM_ALLOWED_ORIGINS = "";
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  const tracking = await import("../src/services/server/tracking.js");
  const repo = await import("../src/services/server/sites.js");
  const { insertEvent, pendingEvent } =
    await import("../src/services/database/events.js");
  const { newEventTypes, notificationsEnabled } =
    await import("../src/services/server/event-types.js");
  const { eventRows, closeDatabase } = await import("./fixtures.js");
  const { createTelegramBot } = await import("../src/services/telegram/app.js");
  const server = http.createServer((req, res) => {
    void tracking.handleTracking(req, res);
  });
  try {
    await tracking.initTracking();
    const site = await repo.createSite("https://example.org");
    const other = await repo.createSite("https://other.org");
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const post = (payload: unknown) =>
      fetch(`${base}/api/track?site_id=${site.id}`, {
        method: "POST",
        headers: { Origin: "https://example.org" },
        body: JSON.stringify(payload),
      });
    for (const type of newEventTypes) {
      const extras =
        type === "scroll_depth"
          ? { threshold: 50 }
          : type === "active_time"
            ? { threshold: 30 }
            : type === "video_progress"
              ? { stage: "half" }
              : type === "contact_click"
                ? { channel: "telegram" }
                : ["file_download", "outbound_click"].includes(type)
                  ? { linkUrl: "https://target.org/file.pdf?token=secret#hash" }
                  : { elementId: "request" };
      assert.equal(
        (await post({ type, path: "/landing", ...extras })).status,
        202,
        type,
      );
    }
    let rows = await eventRows();
    assert.equal(rows.length, 10);
    assert.ok(
      rows.every((row) => row.event_type && row.event_path === "/landing"),
    );
    assert.doesNotMatch(rows.map((row) => row.payload).join(), /secret|#hash/);
    for (const invalid of [
      { type: "active_time", threshold: 5 },
      { type: "video_progress", stage: "quarter" },
      { type: "contact_click", channel: "invalid" },
    ])
      assert.equal((await post({ ...invalid, path: "/" })).status, 400);
    assert.equal(
      (await post({ type: "form_success", path: "/", label: "a".repeat(5000) }))
        .status,
      413,
    );
    const stats = await repo.siteStats(site.id, 1);
    for (const type of newEventTypes) assert.equal(stats.eventCounts[type], 1);
    assert.deepEqual(stats.milestones, {
      scroll_depth: { "50": 1 },
      active_time: { "30": 1 },
      video_progress: { half: 1 },
    });
    for (const days of [7, 30] as const)
      assert.equal(
        (await repo.siteStats(site.id, days)).eventCounts.form_success,
        1,
      );
    assert.equal(
      Object.keys((await repo.siteStats(other.id, 1)).eventCounts).length,
      0,
    );
    const event = {
      type: "form_success",
      path: "/",
      visitor: "",
      session: "",
      identityMode: "memory",
    };
    await insertEvent(site.id, site.origins[0], event, Date.now(), true);
    assert.equal((await pendingEvent())?.status, "pending");
    const disabled = await repo.toggleEventNotification(
      site.id,
      "form_success",
    );
    assert.equal(notificationsEnabled(disabled, "form_success"), false);
    assert.equal(await pendingEvent(), undefined);
    assert.equal(notificationsEnabled(other, "form_success"), true);
    await insertEvent(site.id, site.origins[0], event, Date.now(), true);
    rows = await eventRows();
    assert.equal(rows.at(-1)!.status, "disabled");
    await repo.toggleEventNotification(site.id, "scroll_depth");
    await repo.migrateSites();
    assert.equal(
      notificationsEnabled((await repo.getSite(site.id))!, "scroll_depth"),
      true,
    );
    assert.equal(
      notificationsEnabled((await repo.getSite(site.id))!, "form_success"),
      false,
    );

    const messages: {
      text?: string;
      reply_markup?: {
        inline_keyboard: { callback_data: string; text: string }[][];
      };
    }[] = [];
    const bot = createTelegramBot({
      token: "123:test",
      owner: "123",
      fetch: async (url, options) => {
        const method = String(url).split("/").pop();
        const payload = JSON.parse(String(options?.body || "{}"));
        if (payload.text) messages.push(payload);
        const result =
          method === "getMe"
            ? { id: 1, is_bot: true, first_name: "Test", username: "test_bot" }
            : method === "editMessageText"
              ? {
                  message_id: 1,
                  date: 1,
                  chat: { id: 123, type: "private" },
                  text: payload.text,
                }
              : true;
        return new Response(JSON.stringify({ ok: true, result }));
      },
    });
    await bot.init();
    let sequence = 0;
    const callback = (action: string) =>
      bot.handleUpdate({
        update_id: ++sequence,
        callback_query: {
          id: String(sequence),
          chat_instance: "test",
          from: {
            id: 123,
            is_bot: false,
            first_name: "Owner",
            language_code: "en",
          },
          data: `s:${site.id}:${action}`,
          message: {
            message_id: 1,
            date: 1,
            chat: { id: 123, type: "private", first_name: "Owner" },
            text: "menu",
          },
        },
      });
    await callback("notify");
    const buttons = messages.at(-1)!.reply_markup!.inline_keyboard.flat();
    for (const type of newEventTypes) {
      const button = buttons.find(
        (b) => b.callback_data === `s:${site.id}:n:${type}`,
      );
      assert.ok(button, type);
      assert.ok(Buffer.byteLength(button.callback_data) <= 64);
    }
    await callback("n:form_success");
    assert.equal(
      notificationsEnabled((await repo.getSite(site.id))!, "form_success"),
      true,
    );
    await callback("stats:7");
    assert.match(messages.at(-1)!.text!, /Form submitted successfully: 3/);
    await repo.updateSite(site.id, { archived: true });
    await assert.rejects(repo.toggleEventNotification(site.id, "form_start"));
    assert.equal((await post({ type: "form_start", path: "/" })).status, 404);
  } finally {
    await tracking.stopTracking();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase();
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});
