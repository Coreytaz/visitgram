import { I18n, type I18nFlavor } from "@grammyjs/i18n";
import { type Context } from "grammy";
import { fileURLToPath } from "node:url";

export type TelegramContext = Context & I18nFlavor;
export type Translator = Pick<I18nFlavor, "t">;
export type Locale = "ru" | "en";
export interface LanguagePreferences {
  get(owner: string): Promise<Locale | undefined>;
  set(owner: string, locale: Locale): Promise<void>;
}
export function resolveLocale(language?: string): Locale {
  return language?.toLowerCase().split(/[-_]/)[0] === "en" ? "en" : "ru";
}
export function createI18n(
  locale?: Locale,
  preference?: (ctx: Context) => Promise<Locale | undefined>,
) {
  return new I18n<Context>({
    defaultLocale: "ru",
    directory: fileURLToPath(new URL("./locales", import.meta.url)),
    fluentBundleOptions: { useIsolating: false },
    localeNegotiator: async (ctx) =>
      (await preference?.(ctx)) ??
      locale ??
      resolveLocale(ctx.from?.language_code),
  });
}
export const i18n = createI18n();
export const defaultTranslator: Translator = {
  t: (key, variables) => i18n.t("ru", key, variables),
};

export function translator(locale: Locale = "ru"): Translator {
  return { t: (key, variables) => i18n.t(locale, key, variables) };
}
export function configuredLocale(): Locale {
  return resolveLocale(process.env.TELEGRAM_LOCALE);
}
