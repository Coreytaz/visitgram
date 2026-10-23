import { type TelegramContext as Context } from "./i18n.js";
import { defaultTranslator, type Translator } from "./i18n.js";
import { GrammyError, InlineKeyboard } from "grammy";
export { escapeHtml as html } from "../server/templates.js";
export const mainKeyboard = (ctx: Translator = defaultTranslator) =>
  new InlineKeyboard()
    .text(ctx.t("ui-my-websites"), "list:0")
    .row()
    .text(ctx.t("sites-add-website"), "add")
    .row()
    .text(ctx.t("settings-button"), "settings");
export const back = (id: string, ctx: Translator = defaultTranslator) =>
  new InlineKeyboard().text(ctx.t("sites-to-website"), `s:${id}:card`);
export const cancel = (ctx: Translator = defaultTranslator) =>
  new InlineKeyboard().text(ctx.t("templates-cancel"), "cancel");

export async function show(
  ctx: Context,
  text: string,
  keyboard: InlineKeyboard,
) {
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      if (!(
        error instanceof GrammyError &&
        error.description.includes("message is not modified")
      ))
        throw error;
    }
  } else
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
}
