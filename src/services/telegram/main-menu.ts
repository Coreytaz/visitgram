import { translatedError } from "./errors.js";
import { type TelegramContext as Context } from "./i18n.js";
import { Composer } from "grammy";
import { setInput } from "../server/sites.js";
import { show, mainKeyboard, cancel, html } from "./ui.js";
export function createMainMenu(owner: string) {
  const menu = new Composer<Context>();
  menu.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    await setInput(owner);
    try {
      if (data === "home" || data === "cancel") {
        await show(
          ctx,
          ctx.t("main-menu-website-management"),
          mainKeyboard(ctx),
        );
        return;
      }
      if (data === "add") {
        await setInput(owner, { action: "add" });
        await show(
          ctx,
          ctx.t("main-menu-add-a-website-send-a-domain"),
          cancel(ctx),
        );
        return;
      }
    } catch (error) {
      await ctx.reply(
        html(
          translatedError(
            ctx,
            error,
            ctx.t("main-menu-could-not-complete-the-action-please"),
          ),
        ),
        { parse_mode: "HTML" },
      );
    }
  });
  return menu;
}
