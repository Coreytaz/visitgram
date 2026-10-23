import { eq } from "drizzle-orm";
import { db, tables as t, write } from "./connection.js";
import type { LanguagePreferences } from "../telegram/i18n.js";

export const languagePreferences: LanguagePreferences = {
  async get(owner) {
    const [row] = await db
      .select()
      .from(t.bot_preferences)
      .where(eq(t.bot_preferences.owner, owner));
    return row?.locale === "ru" || row?.locale === "en"
      ? row.locale
      : undefined;
  },
  async set(owner, locale) {
    if (locale !== "ru" && locale !== "en") throw Error("Invalid language");
    await write(async (tx) => {
      await tx
        .delete(t.bot_preferences)
        .where(eq(t.bot_preferences.owner, owner));
      await tx.insert(t.bot_preferences).values({ owner, locale });
    });
  },
};
