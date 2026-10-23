import {
  translator,
  type Locale,
  type TelegramContext as Context,
} from "./i18n.js";
import { Composer, type Api } from "grammy";
import { setInput } from "../server/sites.js";
import { show, mainKeyboard } from "./ui.js";

export async function registerCommandHints(
  api: Pick<Api, "setMyCommands" | "setChatMenuButton">,
  owner: string,
  selectedLocale?: Locale,
) {
  const chatId = Number(owner);
  if (!/^\d+$/.test(owner) || !Number.isSafeInteger(chatId) || chatId <= 0)
    throw new Error("TELEGRAM_CHAT_ID must be the owner's private chat ID");
  for (const languageCode of selectedLocale
    ? (["", "ru", "en"] as const)
    : (["", "en"] as const)) {
    const ctx = translator(
      selectedLocale ?? (languageCode === "en" ? "en" : "ru"),
    );
    await api.setMyCommands(
      ["start", "menu", "cancel"].map((command) => ({
        command,
        description: ctx.t(`commands-hint-${command}`),
      })),
      {
        scope: { type: "chat", chat_id: chatId },
        ...(languageCode ? { language_code: languageCode } : {}),
      },
    );
  }
  await api.setChatMenuButton({
    chat_id: chatId,
    menu_button: { type: "commands" },
  });
}

export function createCommands(owner: string) {
  const commands = new Composer<Context>();
  commands.command(["start", "menu"], async (ctx) => {
    await setInput(owner);
    await show(
      ctx,
      ctx.t("commands-website-management-add-websites-get-tracking"),
      mainKeyboard(ctx),
    );
  });
  commands.command("cancel", async (ctx) => {
    await setInput(owner);
    await show(ctx, ctx.t("commands-action-cancelled"), mainKeyboard(ctx));
  });
  return commands;
}
