import { Composer, InlineKeyboard } from "grammy";
import type { TelegramContext, LanguagePreferences } from "./i18n.js";
import { show } from "./ui.js";
import { setInput } from "../server/sites.js";
import { registerCommandHints } from "./commands.js";

export function createSettings(
  owner: string,
  preferences?: LanguagePreferences,
) {
  const settings = new Composer<TelegramContext>();
  settings.on("callback_query:data", async (ctx) => {
    const match = /^language:(ru|en)$/.exec(ctx.callbackQuery.data);
    await setInput(owner);
    if (match && preferences) {
      const locale = match[1] as "ru" | "en";
      await preferences.set(owner, locale);
      ctx.i18n.useLocale(locale);
      try {
        await registerCommandHints(ctx.api, owner, locale);
      } catch {
        console.warn(
          "Telegram command language update failed; saved preference retained",
        );
      }
    }
    const locale =
      (await preferences?.get(owner)) ?? (await ctx.i18n.getLocale());
    await show(
      ctx,
      ctx.t("settings-language"),
      new InlineKeyboard()
        .text(`${locale === "ru" ? "✅ " : ""}Русский`, "language:ru")
        .text(`${locale === "en" ? "✅ " : ""}English`, "language:en")
        .row()
        .text(ctx.t("sites-main-menu"), "home"),
    );
  });
  return settings;
}
