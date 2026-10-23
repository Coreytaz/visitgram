import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTelegramBot } from "../src/services/telegram/app.js";
import {
  i18n,
  resolveLocale,
  translator,
} from "../src/services/telegram/i18n.js";
import { mainKeyboard } from "../src/services/telegram/ui.js";
import { translatedError } from "../src/services/telegram/errors.js";
import {
  formatTelegramMessage,
  renderTemplate,
} from "../src/services/server/notifications.js";

test("both Fluent catalogs have matching keys and valid interpolations", () => {
  const ru = readFileSync(
    new URL("../src/services/telegram/locales/ru.ftl", import.meta.url),
    "utf8",
  );
  const en = readFileSync(
    new URL("../src/services/telegram/locales/en.ftl", import.meta.url),
    "utf8",
  );
  const keys = (source: string) =>
    [...source.matchAll(/^([a-z0-9-]+) = /gm)].map((m) => m[1]);
  assert.deepEqual(keys(ru), keys(en));
  assert.equal(new Set(keys(ru)).size, keys(ru).length);
  for (const locale of ["ru", "en"] as const)
    for (const key of keys(ru)) {
      const result = i18n.t(locale, key, {
        value1: "VALUE",
        value2: "VALUE",
        value3: "VALUE",
        value4: "VALUE",
        value5: "VALUE",
        value6: "VALUE",
        value7: "VALUE",
        value8: "VALUE",
        value9: "VALUE",
      });
      assert.notEqual(result, key);
      assert.doesNotMatch(result, /\{\s*\$value/);
      if (locale === "en") assert.doesNotMatch(result, /[А-Яа-яЁё]/);
    }
  assert.match(
    i18n.t("ru", "commands-website-management-add-websites-get-tracking"),
    /\n\n/,
  );
  assert.match(
    i18n.t("en", "templates-variables-value1-missing-values-zero-is", {
      value1: "help",
    }),
    /\{\{ and \}\}/,
  );
});

test("locale negotiation, keyboard labels and domain errors", () => {
  assert.equal(resolveLocale("en-US"), "en");
  assert.equal(resolveLocale("EN_gb"), "en");
  assert.equal(resolveLocale("ru-RU"), "ru");
  assert.equal(resolveLocale("de"), "ru");
  assert.equal(resolveLocale(), "ru");
  const ru = mainKeyboard(translator("ru")).inline_keyboard;
  const en = mainKeyboard(translator("en")).inline_keyboard;
  assert.match(en[0][0].text, /My websites/);
  assert.match(ru[0][0].text, /Мои сайты/);
  assert.deepEqual(
    ru.map((row) =>
      row.map((b) => ("callback_data" in b ? b.callback_data : "")),
    ),
    en.map((row) =>
      row.map((b) => ("callback_data" in b ? b.callback_data : "")),
    ),
  );
  assert.equal(
    translatedError(
      translator("en"),
      new Error("Не удалось распознать домен."),
      "fallback",
    ),
    "Could not recognize the domain.",
  );
  assert.equal(
    translatedError(translator("en"), new Error("secret token"), "fallback"),
    "fallback",
  );
});

test("real middleware translates messages and callbacks and supports explicit locale", async () => {
  for (const language of ["en-US", "ru", "de", undefined]) {
    const texts: string[] = [];
    const bot = createTelegramBot({
      token: "123:test",
      owner: "123",
      fetch: async (url, init) => {
        const method = String(url).split("/").pop();
        const payload = JSON.parse(String(init?.body ?? "{}"));
        if (payload.text) texts.push(payload.text);
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
    await bot.init();
    const from = {
      id: 123,
      is_bot: false,
      first_name: "User",
      language_code: language,
    };
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        from,
        chat: { id: 123, type: "private", first_name: "Owner" },
        text: "/unknown",
      },
    });
    await bot.handleUpdate({
      update_id: 2,
      callback_query: {
        id: "2",
        chat_instance: "test",
        from,
        data: "forged",
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 123, type: "private", first_name: "Owner" },
          text: "menu",
        },
      },
    });
    assert.equal(
      texts[0],
      language === "en-US"
        ? "Use /menu or /cancel."
        : "Используйте /menu или /cancel.",
    );
    assert.equal(
      texts[1],
      language === "en-US"
        ? "This button has expired. Open /menu."
        : "Эта кнопка устарела. Откройте /menu.",
    );
  }
  const bot = createTelegramBot({
    token: "123:test",
    owner: "123",
    locale: "en",
  });
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === "sendMessage")
      assert.equal((payload as { text: string }).text, "Use /menu or /cancel.");
    return {
      ok: true,
      result:
        method === "getMe"
          ? { id: 1, is_bot: true, first_name: "Test", username: "test_bot" }
          : true,
    } as never;
  });
  await bot.init();
  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 1,
      from: {
        id: 123,
        is_bot: false,
        first_name: "Owner",
        language_code: "ru",
      },
      chat: { id: 123, type: "private", first_name: "Owner" },
      text: "/unknown",
    },
  });
});

test("notifications localize built-in text and variables without translating user templates", () => {
  const event = {
    type: "click",
    label: "<Buy & save>",
    visitorStatus: "new" as const,
    timezone: "UTC",
    elapsedSeconds: 0,
  };
  const en = formatTelegramMessage(event, 0, "en");
  assert.match(en, /Button click/);
  assert.match(en, /New visitor/);
  assert.match(en, /January/);
  assert.match(en, /&lt;Buy &amp; save&gt;/);
  assert.doesNotMatch(en, /[А-Яа-яЁё]/);
  assert.match(formatTelegramMessage(event, 0), /Новый посетитель/);
  assert.equal(
    renderTemplate("Мой шаблон {action} {visitor_status}", event, 0, "en"),
    "Мой шаблон Clicked “&lt;Buy &amp; save&gt;” New",
  );
});
