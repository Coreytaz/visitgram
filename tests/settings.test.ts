import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("settings persist the owner's language across bot instances, menus, previews and notifications", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "analog-language-"));
  process.env.VISITGRAM_SQLITE_URL = `file:${path.join(dir, "events.db").replaceAll("\\", "/")}`;
  process.env.TELEGRAM_CHAT_ID = "123";
  delete process.env.TELEGRAM_BOT_TOKEN;
  const { migrateSites, getInput, setInput } =
    await import("../src/services/database/sites.js");
  const { languagePreferences } =
    await import("../src/services/database/preferences.js");
  const { closeDatabase } =
    await import("../src/services/database/connection.js");
  const { notificationLocale } =
    await import("../src/services/server/telegram.js");
  const { createTelegramBot } = await import("../src/services/telegram/app.js");
  const calls: {
    method: string;
    body: {
      text?: string;
      commands?: { description: string }[];
      reply_markup?: {
        inline_keyboard: { text: string; callback_data: string }[][];
      };
    };
  }[] = [];
  const makeBot = () =>
    createTelegramBot({
      token: "123:test",
      owner: "123",
      preferences: languagePreferences,
      fetch: async (url, options) => {
        const method = String(url).split("/").pop()!;
        const body = JSON.parse(String(options?.body || "{}"));
        calls.push({ method, body });
        return new Response(
          JSON.stringify({
            ok: true,
            result:
              method === "getMe"
                ? {
                    id: 1,
                    is_bot: true,
                    first_name: "Test",
                    username: "test_bot",
                  }
                : true,
          }),
        );
      },
    });
  let bot = makeBot(),
    sequence = 0;
  const callback = (data: string, id = 123) =>
    bot.handleUpdate({
      update_id: ++sequence,
      callback_query: {
        id: String(sequence),
        chat_instance: "test",
        from: { id, is_bot: false, first_name: "User", language_code: "ru" },
        data,
        message: {
          message_id: 1,
          date: 1,
          chat: { id, type: "private", first_name: "User" },
          text: "menu",
        },
      },
    });
  const menu = () =>
    bot.handleUpdate({
      update_id: ++sequence,
      message: {
        message_id: sequence,
        date: 1,
        from: {
          id: 123,
          is_bot: false,
          first_name: "User",
          language_code: "ru",
        },
        chat: { id: 123, type: "private", first_name: "User" },
        text: "/menu",
        entities: [{ type: "bot_command", offset: 0, length: 5 }],
      },
    });
  const last = () => calls.filter((c) => c.body.text).at(-1)!.body;
  try {
    await migrateSites();
    await bot.init();
    assert.equal(await languagePreferences.get("123"), undefined);
    await menu();
    assert.ok(
      last()
        .reply_markup!.inline_keyboard.flat()
        .some(
          (b) => b.callback_data === "settings" && b.text.includes("Настройки"),
        ),
    );
    await setInput("123", { action: "add" });
    await callback("settings");
    assert.equal(await getInput("123"), undefined);
    assert.match(last().text!, /Выберите язык/);
    assert.ok(
      last()
        .reply_markup!.inline_keyboard.flat()
        .some((b) => b.text === "✅ Русский"),
    );
    await callback("language:en");
    assert.equal(await languagePreferences.get("123"), "en");
    assert.equal(await notificationLocale(), "en");
    assert.match(last().text!, /Choose the bot language/);
    assert.ok(
      last()
        .reply_markup!.inline_keyboard.flat()
        .some((b) => b.text === "✅ English"),
    );
    const registrations = calls.filter((c) => c.method === "setMyCommands");
    assert.equal(registrations.length, 3);
    assert.ok(
      registrations.every((c) =>
        c.body.commands!.some(
          (item) => item.description === "Open the main menu",
        ),
      ),
    );
    bot = makeBot();
    await bot.init();
    await menu();
    assert.match(last().text!, /Website management/);
    assert.ok(
      last()
        .reply_markup!.inline_keyboard.flat()
        .some((b) => b.text.includes("Settings")),
    );
    await callback("settings");
    assert.match(last().text!, /Choose the bot language/);
    await callback("language:ru", 999);
    assert.equal(await languagePreferences.get("123"), "en");
    await callback("language:de");
    assert.equal(await languagePreferences.get("123"), "en");
    await callback("language:ru");
    assert.equal(await notificationLocale(), "ru");
    assert.match(last().text!, /Выберите язык/);
    await assert.rejects(languagePreferences.set("123", "de" as "ru"));
    await migrateSites();
    assert.equal(await languagePreferences.get("123"), "ru");
    assert.equal(await languagePreferences.get("999"), undefined);
  } finally {
    await closeDatabase();
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});
