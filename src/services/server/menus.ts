import { type TelegramContext } from "../telegram/i18n.js";
import { type Bot } from "grammy";
import { createTelegramMiddleware } from "../telegram/app.js";
export { mainKeyboard } from "../telegram/ui.js";
export function registerMenus(bot: Bot, owner: string) {
  const menus = createTelegramMiddleware(owner);
  bot.use((ctx, next) => menus.middleware()(ctx as TelegramContext, next));
}
