import {
  createI18n,
  type Locale,
  type LanguagePreferences,
  type TelegramContext as Context,
} from "./i18n.js";
import { Bot, Composer } from "grammy";
import { Router } from "@grammyjs/router";
import { ownerOnly, acknowledgeCallback } from "./middleware.js";
import { createCommands } from "./commands.js";
import { createMainMenu } from "./main-menu.js";
import { createSites, listPattern, sitePattern } from "./sites.js";
import { createTemplates } from "./templates.js";
import { createInput } from "./input.js";
import { nativeFetch } from "./transport.js";
import { createSettings } from "./settings.js";

export function createTelegramMiddleware(
  owner: string,
  locale?: Locale,
  preferences?: LanguagePreferences,
) {
  const app = new Composer<Context>();
  app.use(
    createI18n(
      locale,
      preferences
        ? async (ctx) => {
            if (
              ctx.chat?.type !== "private" ||
              String(ctx.chat.id) !== owner ||
              String(ctx.from?.id) !== owner
            )
              return undefined;
            return preferences.get(owner);
          }
        : undefined,
    ).middleware(),
  );
  app.use(ownerOnly(owner));
  app.use(createCommands(owner));
  const callbacks = app.on("callback_query:data");
  callbacks.use(acknowledgeCallback);
  const router = new Router<Context>((ctx) => {
    const data = ctx.callbackQuery?.data ?? "";
    if (data.startsWith("t:")) return "templates";
    if (["home", "cancel", "add"].includes(data)) return "main";
    if (data === "settings" || /^language:(ru|en)$/.test(data))
      return "settings";
    if (listPattern.test(data) || sitePattern.test(data)) return "sites";
    return "unknown";
  });
  router.route("main", createMainMenu(owner));
  router.route("settings", createSettings(owner, preferences));
  router.route("sites", createSites(owner));
  router.route("templates", createTemplates(owner));
  router.otherwise((ctx) =>
    ctx.reply(ctx.t("app-this-button-has-expired-open-menu")),
  );
  callbacks.use(router);
  app.use(createInput(owner));
  return app;
}
export interface TelegramBotOptions {
  token: string;
  owner?: string;
  locale?: Locale;
  preferences?: LanguagePreferences;
  fetch?: typeof globalThis.fetch;
}
export function createTelegramBot({
  token,
  owner,
  locale,
  preferences,
  fetch = nativeFetch,
}: TelegramBotOptions) {
  const bot = new Bot<Context>(token, {
    client: { timeoutSeconds: 10, fetch },
  });
  if (owner) bot.use(createTelegramMiddleware(owner, locale, preferences));
  bot.catch(() => console.error("Telegram menu handler failed"));
  return bot;
}
