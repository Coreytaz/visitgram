import { type TelegramContext as Context } from "./i18n.js";
import { type MiddlewareFn } from "grammy";
export function ownerOnly(owner: string): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (
      ctx.chat?.type !== "private" ||
      String(ctx.chat.id) !== owner ||
      String(ctx.from?.id) !== owner
    ) {
      if (ctx.callbackQuery) {
        try {
          await ctx.answerCallbackQuery({
            text: ctx.t("middleware-access-denied"),
          });
        } catch {
          /* Expired query. */
        }
      }
      return;
    }
    await next();
  };
}
export const acknowledgeCallback: MiddlewareFn<Context> = async (ctx, next) => {
  try {
    await ctx.answerCallbackQuery();
  } catch {
    return;
  }
  await next();
};
