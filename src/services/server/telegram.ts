import { configuredLocale, translator } from "../telegram/i18n.js";
import { GrammyError } from "grammy";
import { createTelegramBot } from "../telegram/app.js";
import { createPolling } from "../telegram/polling.js";
import { mainKeyboard } from "../telegram/ui.js";
import { registerCommandHints } from "../telegram/commands.js";
import { languagePreferences } from "../database/preferences.js";
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
export const bot = token
  ? createTelegramBot({
      token,
      owner: chatId,
      preferences: languagePreferences,
    })
  : undefined;
const polling = createPolling(bot, chatId, async () => {
  if (bot && chatId)
    await registerCommandHints(
      bot.api,
      chatId,
      await languagePreferences.get(chatId),
    );
});
export const startTelegram = polling.start;
export const stopTelegram = polling.stop;
export async function sendMainMenu() {
  if (!bot || !chatId) throw new Error("Telegram is not configured");
  const ctx = translator(await notificationLocale());
  return bot.api.sendMessage(chatId, ctx.t("service-ready"), {
    parse_mode: "HTML",
    reply_markup: mainKeyboard(ctx),
  });
}

export async function notificationLocale() {
  return (
    (chatId ? await languagePreferences.get(chatId) : undefined) ??
    configuredLocale()
  );
}

export async function sendTelegramNotification(text: string) {
  if (!bot || !chatId) throw new Error("Telegram is not configured");
  await bot.api.sendMessage(chatId, text, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

export function telegramRetryDelay(error: unknown): number {
  if (error instanceof GrammyError) {
    const seconds = error.parameters.retry_after;
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      return Math.max(30, seconds);
    }
  }
  return 30;
}
