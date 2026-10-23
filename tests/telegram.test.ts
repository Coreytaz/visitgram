import { test } from "node:test";
import assert from "node:assert/strict";
import { GrammyError } from "grammy";
import { createPolling } from "../src/services/telegram/polling.js";
import { createTelegramBot } from "../src/services/telegram/app.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("polling is idempotent, stops the active loop, and can restart", async () => {
  let starts = 0,
    stops = 0,
    running = false;
  let finish: (() => void) | undefined;
  const polling = createPolling(
    {
      async start(options) {
        assert.deepEqual(options, {
          timeout: 5,
          allowed_updates: ["message", "callback_query"],
        });
        starts++;
        running = true;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      isRunning: () => running,
      async stop() {
        stops++;
        running = false;
        finish?.();
      },
    },
    "123",
  );
  polling.start();
  polling.start();
  assert.equal(starts, 1);
  await polling.stop();
  assert.equal(stops, 1);
  polling.start();
  assert.equal(starts, 2);
  await polling.stop();
  await polling.stop();
  assert.equal(stops, 2);
});

test("polling retries after five seconds and stop wakes the retry delay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "error", () => {});
  let starts = 0;
  const polling = createPolling(
    {
      async start() {
        starts++;
        throw new Error("test failure");
      },
      isRunning: () => false,
      async stop() {
        throw new Error("not running");
      },
    },
    "123",
  );
  polling.start();
  await flush();
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(starts, 2);
  await polling.stop();
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(starts, 2);
  polling.start();
  await flush();
  assert.equal(starts, 3);
  await polling.stop();
});

test("polling tolerates disabled configuration and validates owner before starting", async () => {
  const disabled = createPolling(undefined, undefined);
  disabled.start();
  await disabled.stop();
  const invalid = createPolling(
    {
      async start() {
        assert.fail();
      },
      async stop() {},
      isRunning: () => false,
    },
    "-123",
  );
  assert.throws(() => invalid.start(), /private chat ID/);
});

test("bot factory does no network work and leaves API retries to the durable queue", async () => {
  let requests = 0;
  const bot = createTelegramBot({
    token: "123:test",
    owner: "123",
    fetch: async () => {
      requests++;
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          description: "Too Many Requests",
          parameters: { retry_after: 45 },
        }),
        { status: 429 },
      );
    },
  });
  assert.equal(requests, 0);
  assert.equal(bot.isRunning(), false);
  await assert.rejects(
    bot.api.sendMessage("123", "hello"),
    (error) =>
      error instanceof GrammyError && error.parameters.retry_after === 45,
  );
  assert.equal(requests, 1);
});

test("command hints register localized commands and the menu button only for the owner", async () => {
  const { registerCommandHints } =
    await import("../src/services/telegram/commands.js");
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const bot = createTelegramBot({
    token: "123:test",
    fetch: async (url, options) => {
      calls.push({
        method: String(url).split("/").pop()!,
        body: JSON.parse(String(options?.body)),
      });
      return new Response(JSON.stringify({ ok: true, result: true }));
    },
  });
  await registerCommandHints(bot.api, "123");
  assert.deepEqual(
    calls.map((call) => call.method),
    ["setMyCommands", "setMyCommands", "setChatMenuButton"],
  );
  for (const call of calls.slice(0, 2)) {
    assert.deepEqual(call.body.scope, { type: "chat", chat_id: 123 });
    const commands = call.body.commands as {
      command: string;
      description: string;
    }[];
    assert.deepEqual(
      commands.map((item) => item.command),
      ["start", "menu", "cancel"],
    );
    assert.ok(
      commands.every(
        (item) => item.description.length > 0 && item.description.length <= 256,
      ),
    );
  }
  assert.equal(calls[0].body.language_code, undefined);
  assert.match(JSON.stringify(calls[0].body.commands), /главное меню/);
  assert.equal(calls[1].body.language_code, "en");
  assert.match(JSON.stringify(calls[1].body.commands), /main menu/);
  assert.deepEqual(calls[2].body, {
    chat_id: 123,
    menu_button: { type: "commands" },
  });
  await assert.rejects(
    registerCommandHints(bot.api, "-123"),
    /private chat ID/,
  );
  assert.equal(calls.length, 3);
});

test("polling retries command setup before starting and does not repeat it during polling retries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "error", () => {});
  let preparations = 0,
    starts = 0;
  const polling = createPolling(
    {
      async start() {
        starts++;
        throw Error("network");
      },
      async stop() {},
      isRunning: () => false,
    },
    "123",
    async () => {
      preparations++;
      if (preparations === 1) throw Error("setup unavailable");
    },
  );
  polling.start();
  await flush();
  assert.equal(starts, 0);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(preparations, 2);
  assert.equal(starts, 1);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(preparations, 2);
  assert.equal(starts, 2);
  await polling.stop();
});
