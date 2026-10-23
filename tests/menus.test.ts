import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("owner-only inline menus, input, lifecycle and callback validation", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "analog-menu-"));
  process.env.VISITGRAM_SQLITE_URL = `file:${path.join(dir, "events.db").replaceAll("\\", "/")}`;
  process.env.VISITGRAM_ALLOWED_ORIGINS = "";
  process.env.VISITGRAM_PUBLIC_URL = "https://tracker.example";
  const { expireInput, closeDatabase } = await import("./fixtures.js");
  const repo = await import("../src/services/server/sites.js");
  const { createTelegramBot } = await import("../src/services/telegram/app.js");
  await repo.migrateSites();
  const calls: {
    method: string;
    payload: {
      text?: string;
      reply_markup: { inline_keyboard: { callback_data: string }[][] };
    };
  }[] = [];
  let sequence = 0;
  let failAnswer = false;
  let unchanged = false;
  const makeBot = () =>
    createTelegramBot({
      token: "123:test",
      owner: "123",
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = String(input).split("/").pop()!;
        const payload = JSON.parse(String(init?.body || "{}"));
        calls.push({ method, payload });
        if (
          (method === "answerCallbackQuery" && failAnswer) ||
          (method === "editMessageText" && unchanged)
        ) {
          return new Response(
            JSON.stringify({
              ok: false,
              error_code: 400,
              description:
                method === "editMessageText"
                  ? "Bad Request: message is not modified"
                  : "query is too old",
            }),
            { status: 400 },
          );
        }
        let result: unknown = true;
        if (method === "getMe")
          result = {
            id: 1,
            is_bot: true,
            first_name: "Test",
            username: "test_bot",
          };
        if (method === "sendMessage" || method === "editMessageText")
          result = {
            message_id: 100,
            date: 1,
            chat: { id: 123, type: "private", first_name: "Owner" },
            text: payload.text,
          };
        return new Response(JSON.stringify({ ok: true, result }));
      },
    });
  let bot = makeBot();
  await bot.init();
  const user = (id: number) => ({ id, is_bot: false, first_name: "User" });
  const text = async (value: string, id = 123) =>
    bot.handleUpdate({
      update_id: ++sequence,
      message: {
        message_id: sequence,
        date: 1,
        from: user(id),
        chat: { id, type: "private", first_name: "User" },
        text: value,
        ...(value.startsWith("/")
          ? {
              entities: [
                {
                  type: "bot_command" as const,
                  offset: 0,
                  length: value.split(" ")[0].length,
                },
              ],
            }
          : {}),
      },
    });
  const click = async (data: string, id = 123, chat = 123) =>
    bot.handleUpdate({
      update_id: ++sequence,
      callback_query: {
        id: String(sequence),
        chat_instance: "test",
        from: user(id),
        data,
        message: {
          message_id: 100,
          date: 1,
          chat: { id: chat, type: "private", first_name: "User" },
          text: "Menu",
        },
      },
    });
  const lastMessage = () =>
    calls
      .filter((c) => ["sendMessage", "editMessageText"].includes(c.method))
      .at(-1)!;
  try {
    await text("/start");
    assert.equal(
      lastMessage().payload.reply_markup.inline_keyboard[0][0].callback_data,
      "list:0",
    );
    const before = calls.length;
    await text("/start", 999);
    assert.equal(calls.length, before);
    await bot.handleUpdate({
      update_id: ++sequence,
      message: {
        message_id: sequence,
        date: 1,
        from: user(123),
        chat: { id: -123, type: "group", title: "Group" },
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    });
    assert.equal(calls.length, before);
    await click("add", 123, 999);
    assert.equal(await repo.getInput("123"), undefined);
    await click("add", 999);
    assert.equal(calls.at(-1)!.method, "answerCallbackQuery");
    assert.equal(await repo.getInput("123"), undefined);
    failAnswer = true;
    await click("add");
    assert.equal(await repo.getInput("123"), undefined);
    failAnswer = false;
    const ackBefore = calls.filter(
      (c) => c.method === "answerCallbackQuery",
    ).length;
    await click("add");
    assert.equal(
      calls.filter((c) => c.method === "answerCallbackQuery").length,
      ackBefore + 1,
    );
    assert.equal((await repo.getInput("123"))!.action, "add");
    await text("https://menu.example/path");
    assert.equal((await repo.listSites()).length, 0);
    assert.ok(await repo.getInput("123"));
    await text("menu.example");
    const site = (await repo.listSites())[0];
    assert.ok(site);
    assert.ok(String(lastMessage().payload.text).includes("data-site-id="));
    assert.equal(await repo.getInput("123"), undefined);
    await click(`s:${site.id}:name`);
    await text("Магазин <test>");
    assert.equal((await repo.getSite(site.id))!.name, "Магазин <test>");
    assert.match(String(lastMessage().payload.text), /&lt;test&gt;/);
    assert.match(
      String(lastMessage().payload.text),
      /Форма успешно отправлена — ✅ включены/,
    );
    assert.match(
      String(lastMessage().payload.text),
      /Глубина прокрутки — 🔕 выключены/,
    );
    const { newEventTypes } =
      await import("../src/services/server/event-types.js");
    const { translator } = await import("../src/services/telegram/i18n.js");
    for (const type of newEventTypes)
      assert.ok(
        String(lastMessage().payload.text).includes(
          translator("ru").t("event-" + type.replaceAll("_", "-")),
        ),
      );
    await click(`s:${site.id}:n:form_success`);
    await click(`s:${site.id}:card`);
    assert.match(
      String(lastMessage().payload.text),
      /Форма успешно отправлена — 🔕 выключены/,
    );
    await click(`s:${site.id}:n:form_success`);
    await click(`s:${site.id}:origins`);
    await text("https://menu.example,http://localhost:8080");
    assert.equal((await repo.getSite(site.id))!.origins.length, 2);
    const templateKey = `t:${site.id}:d`;
    await click(`t:${site.id}:menu`);
    await click(`${templateKey}:view`);
    assert.match(String(lastMessage().payload.text), /стандартное оформление/);
    await click(`${templateKey}:edit`, 999);
    assert.equal(await repo.getInput("123"), undefined);
    await click(`${templateKey}:edit`);
    await text("{unknown}");
    assert.match(String(lastMessage().payload.text), /Неизвестная переменная/);
    assert.equal((await repo.getSite(site.id))!.templateDefault, null);
    await text("<b>{site_name}</b> {action} {elapsed_seconds}");
    let draft = (await repo.getInput("123"))!;
    assert.equal(draft.phase, "preview");
    assert.equal((await repo.getSite(site.id))!.templateDefault, null);
    assert.match(String(lastMessage().payload.text), /Магазин &lt;test&gt;/);
    bot = makeBot();
    await bot.init();
    await click(`${templateKey}:vars:${draft.draftToken}`);
    assert.equal((await repo.getInput("123"))!.draft, draft.draft);
    await click(`${templateKey}:resume:${draft.draftToken}`);
    await click(`${templateKey}:p:v:${draft.draftToken}`);
    assert.match(String(lastMessage().payload.text), /Открыл страницу/);
    await click(`${templateKey}:fix:${draft.draftToken}`);
    await text("Сохранено {action}");
    const oldNonce = draft.draftToken;
    draft = (await repo.getInput("123"))!;
    await click(`${templateKey}:save:${oldNonce}`);
    assert.equal((await repo.getSite(site.id))!.templateDefault, null);
    await click(`${templateKey}:save:${draft.draftToken}`);
    assert.equal(
      (await repo.getSite(site.id))!.templateDefault,
      "Сохранено {action}",
    );
    assert.equal(await repo.getInput("123"), undefined);
    await repo.migrateSites();
    assert.equal(
      (await repo.getSite(site.id))!.templateDefault,
      "Сохранено {action}",
    );
    await click(`t:${site.id}:c:view`);
    assert.match(String(lastMessage().payload.text), /общий шаблон сайта/);
    await click(`t:${site.id}:c:edit`);
    await text("Клик {element}");
    draft = (await repo.getInput("123"))!;
    await click(`t:${site.id}:c:save:${draft.draftToken}`);
    assert.equal(
      (await repo.getSite(site.id))!.templateClick,
      "Клик {element}",
    );
    await click(`t:${site.id}:c:reset`);
    assert.equal((await repo.getSite(site.id))!.templateClick, null);
    assert.equal(
      (await repo.getSite(site.id))!.templateDefault,
      "Сохранено {action}",
    );
    await click(`${templateKey}:edit`);
    await text("Отменённый");
    await click(`${templateKey}:cancel`);
    assert.equal(await repo.getInput("123"), undefined);
    assert.equal(
      (await repo.getSite(site.id))!.templateDefault,
      "Сохранено {action}",
    );
    await click(`${templateKey}:edit`);
    await text("Истёкший");
    draft = (await repo.getInput("123"))!;
    await expireInput("123", draft);
    await click(`${templateKey}:save:${draft.draftToken}`);
    assert.match(String(lastMessage().payload.text), /истекли/);
    assert.equal(
      (await repo.getSite(site.id))!.templateDefault,
      "Сохранено {action}",
    );
    await click(`${templateKey}:edit`);
    await text("Уход из редактора");
    await click("home");
    assert.equal(await repo.getInput("123"), undefined);
    await click(`${templateKey}:reset`);
    assert.equal((await repo.getSite(site.id))!.templateDefault, null);
    unchanged = true;
    await click(`s:${site.id}:card`);
    unchanged = false;
    await click(`s:${site.id}:n:view`);
    assert.equal((await repo.getSite(site.id))!.notifyPageview, false);
    await click(`s:${site.id}:pause`);
    assert.equal((await repo.getSite(site.id))!.paused, true);
    await click(`s:${site.id}:archive`);
    assert.equal((await repo.getSite(site.id))!.archived, false);
    await click(`s:${site.id}:confirm`);
    assert.equal((await repo.getSite(site.id))!.archived, true);
    await click(`${templateKey}:edit`);
    assert.equal(await repo.getInput("123"), undefined);
    await assert.rejects(repo.setSiteTemplate(site.id, "default", "Архив"));
    await click(`s:${site.id}:name`); // Old button must not start an edit on an archived site.
    assert.equal(await repo.getInput("123"), undefined);
    await click(`s:${site.id}:restore`);
    assert.equal((await repo.getSite(site.id))!.archived, false);
    await click(`s:${site.id}:stats:7`);
    assert.match(String(lastMessage().payload.text), /7 дней/);
    await click("add");
    await click("cancel");
    assert.equal(await repo.getInput("123"), undefined);
    await click("add");
    await text("/cancel");
    assert.equal(await repo.getInput("123"), undefined);
    await click("add");
    await expireInput("123", { action: "add" });
    await text("expired.example");
    assert.equal((await repo.listSites()).length, 1);
    await click("t:forged");
    assert.match(String(lastMessage().payload.text), /устарела/);
    await click("forged-action");
    assert.match(String(lastMessage().payload.text), /устарела/);
    await click("s:00000000-0000-0000-0000-000000000000:card");
    assert.match(String(lastMessage().payload.text), /больше не существует/);
    for (let i = 0; i < 9; i++) await repo.createSite(`page${i}.example`);
    await click("list:0");
    assert.ok(
      lastMessage()
        .payload.reply_markup.inline_keyboard.flat()
        .some((b) => b.callback_data === "list:1"),
    );
    await click("list:1");
    assert.match(String(lastMessage().payload.text), /Страница 2\/2/);
    await click("archive:0");
    assert.match(String(lastMessage().payload.text), /Архив/);
    const doomed = await repo.createSite("delete.example");
    await click(`s:${doomed.id}:card`);
    assert.ok(
      lastMessage()
        .payload.reply_markup.inline_keyboard.flat()
        .some((b) => b.callback_data === `s:${doomed.id}:delete`),
    );
    await click(`s:${doomed.id}:delete`);
    assert.match(
      String(lastMessage().payload.text),
      /без возможности восстановления/,
    );
    assert.ok(await repo.getSite(doomed.id));
    await click(`s:${doomed.id}:card`); // Cancel returns to the intact website.
    assert.ok(await repo.getSite(doomed.id));
    await repo.updateSite(doomed.id, { archived: true });
    await click(`s:${doomed.id}:delete`);
    await click(`s:${doomed.id}:delete-confirm`);
    assert.equal(await repo.getSite(doomed.id), undefined);
    assert.match(String(lastMessage().payload.text), /Архив/);
    await click(`s:${doomed.id}:delete-confirm`);
    assert.match(String(lastMessage().payload.text), /больше не существует/);
    for (const call of calls) {
      for (const row of call.payload.reply_markup?.inline_keyboard || []) {
        for (const button of row)
          assert.ok(Buffer.byteLength(button.callback_data) <= 64);
      }
    }
  } finally {
    await closeDatabase();
    if (process.platform !== "win32")
      await rm(dir, { recursive: true, force: true });
  }
});
