import { translatedError } from "./errors.js";
import { type TelegramContext as Context } from "./i18n.js";
import { Composer } from "grammy";
import { createSite, getInput, setInput, updateSite } from "../server/sites.js";
import { handleTemplateText } from "./templates.js";
import { card, showCode } from "./sites.js";
import { show, html, mainKeyboard, cancel } from "./ui.js";
export function createInput(owner: string) {
  const input = new Composer<Context>();
  input.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) {
      await ctx.reply(ctx.t("input-use-menu-or-cancel"));
      return;
    }
    const state = await getInput(owner);
    if (!state) {
      await show(
        ctx,
        ctx.t("input-no-active-input-or-10-minutes"),
        mainKeyboard(ctx),
      );
      return;
    }
    try {
      if (await handleTemplateText(ctx, owner, state, ctx.message.text)) return;
      if (state.action === "add") {
        const site = await createSite(ctx.message.text);
        await setInput(owner);
        await showCode(ctx, site);
      } else {
        if (!state.siteId)
          throw new Error(ctx.t("input-this-action-has-expired-open-menu"));
        const site = await updateSite(
          state.siteId,
          state.action === "name"
            ? { name: ctx.message.text }
            : { origins: ctx.message.text },
        );
        await setInput(owner);
        await card(ctx, site);
      }
    } catch (error) {
      const message = translatedError(
        ctx,
        error,
        ctx.t("input-could-not-save-the-website-please"),
      );
      await ctx.reply(
        ctx.t("input-value1-send-another-value-or-cancel", {
          value1: html(message),
        }),
        { parse_mode: "HTML", reply_markup: cancel(ctx) },
      );
    }
  });
  return input;
}
