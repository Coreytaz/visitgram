import type { TemplateKind } from "./templates.js";
export type Site = {
  id: string;
  name: string;
  paused: boolean;
  archived: boolean;
  notifyPageview: boolean;
  notifyClick: boolean;
  eventNotifications?: Record<string, boolean>;
  origins: string[];
  templateDefault: string | null;
  templatePageview: string | null;
  templateClick: string | null;
};
export type InputState = {
  action: "add" | "name" | "origins" | "template";
  templateKind?: TemplateKind;
  draft?: string;
  draftToken?: string;
  phase?: "input" | "preview";
  siteId?: string;
  expires: number;
};

export function normalizeOrigins(text: string): string[] {
  const values = text.split(/[\s,]+/).filter(Boolean);
  if (!values.length || values.length > 10)
    throw new Error("Укажите от 1 до 10 доменов через запятую.");
  return [
    ...new Set(
      values.map((value) => {
        let url: URL;
        try {
          url = new URL(value.includes("://") ? value : `https://${value}`);
        } catch {
          throw new Error("Не удалось распознать домен.");
        }
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.hostname.includes("*") ||
          url.hostname.length > 253
        ) {
          throw new Error(
            "Нужен адрес с HTTP/HTTPS, без логина, пароля, параметров, меток и маски *.",
          );
        }
        return url.origin;
      }),
    ),
  ];
}
