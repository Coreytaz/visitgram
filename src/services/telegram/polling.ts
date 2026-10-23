import { type Bot } from "grammy";
export function createPolling(
  bot: Pick<Bot, "start" | "stop" | "isRunning"> | undefined,
  chatId: string | undefined,
  prepare?: () => Promise<void>,
) {
  let polling: Promise<void> | undefined;
  let stopping = true;
  let wakeRetry: (() => void) | undefined;

  function start() {
    if (!bot || !chatId) return;
    if (!/^\d+$/.test(chatId))
      throw new Error("TELEGRAM_CHAT_ID must be the owner's private chat ID");
    if (polling) return;
    stopping = false;
    const activeBot = bot;
    polling = (async () => {
      let prepared = false;
      while (!stopping) {
        try {
          if (!prepared && prepare) {
            await prepare();
            prepared = true;
          }
          if (stopping) break;
          await activeBot.start({
            timeout: 5,
            allowed_updates: ["message", "callback_query"],
          });
        } catch {
          if (!stopping)
            console.error("Telegram polling failed; retrying in 5 seconds");
        }
        if (!stopping)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              wakeRetry = undefined;
              resolve();
            }, 5000);
            wakeRetry = () => {
              clearTimeout(timer);
              wakeRetry = undefined;
              resolve();
            };
          });
      }
    })().finally(() => {
      polling = undefined;
    });
  }

  async function stop() {
    stopping = true;
    wakeRetry?.();
    if (bot?.isRunning()) await bot.stop();
    await polling;
  }

  return { start, stop };
}
