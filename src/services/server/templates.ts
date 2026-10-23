export type TemplateKind = "default" | "pageview" | "click";
export class TemplateError extends Error {}
export const TEMPLATE_EXAMPLE =
  "{action_emoji} <b>{site_name}</b>\n\n{action}\n📄 <code>{path}</code>\n👤 {visitor_status}\n🆔 <code>{visitor_id}</code>\n\n🕒 {time}";
export const VARIABLES = {
  action: "Действие",
  action_emoji: "Эмодзи действия",
  event_type: "Тип события",
  site_name: "Название сайта",
  site: "Host",
  path: "Путь",
  title: "Заголовок",
  element: "Название элемента",
  element_id: "Идентификатор элемента",
  threshold: "Процент / секунды",
  stage: "Этап видео",
  channel: "Канал связи",
  link_url: "Адрес ссылки",
  visitor_id: "ID посетителя",
  visitor_status: "Новый / повторный / без постоянного ID",
  ip: "IP",
  browser: "Браузер",
  os: "ОС",
  device: "Устройство",
  language: "Язык",
  timezone: "Часовой пояс",
  screen: "Экран",
  viewport: "Окно",
  elapsed_seconds: "Секунды до действия",
  referrer: "Источник",
  utm_source: "UTM source",
  utm_medium: "UTM medium",
  utm_campaign: "UTM campaign",
  utm_content: "UTM content",
  utm_term: "UTM term",
  time: "Дата и время",
};
export const escapeHtml = (v: unknown) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
type Token = { kind: "text" | "tag" | "variable"; value: string };
function visibleText(value: string) {
  return value
    .replace(/&#(x[0-9a-fA-F]+|\d+);/g, (_, digits: string) =>
      String.fromCodePoint(
        digits.startsWith("x") ? parseInt(digits.slice(1), 16) : Number(digits),
      ),
    )
    .trim();
}
function compile(source: string): Token[] {
  if (!source.trim() || source.length > 2000)
    throw new TemplateError("Шаблон должен содержать от 1 до 2000 символов.");
  const tokens: Token[] = [],
    stack: string[] = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    if (rest.startsWith("{{") || rest.startsWith("}}")) {
      tokens.push({ kind: "text", value: rest[0] });
      i += 2;
      continue;
    }
    if (rest[0] === "{") {
      const m = /^\{([a-z_]+)\}/.exec(rest);
      if (!m || !Object.hasOwn(VARIABLES, m[1]))
        throw new TemplateError(
          "Неизвестная переменная или неверные скобки. Откройте список переменных.",
        );
      tokens.push({ kind: "variable", value: m[1] });
      i += m[0].length;
      continue;
    }
    if (rest[0] === "}")
      throw new TemplateError("Для буквальной скобки используйте }}.");
    if (rest[0] === "<") {
      const m = /^<(\/?)(b|i|u|s|code|pre)>/.exec(rest);
      if (!m)
        throw new TemplateError(
          "Разрешены только b, i, u, s, code, pre без атрибутов.",
        );
      if (m[1]) {
        if (stack.pop() !== m[2])
          throw new TemplateError("Неверное закрытие HTML-тегов.");
      } else {
        if (
          stack.includes("code") ||
          stack.includes("pre") ||
          (["code", "pre"].includes(m[2]) && stack.length)
        )
          throw new TemplateError(
            "code и pre нельзя совмещать с другими тегами.",
          );
        stack.push(m[2]);
      }
      tokens.push({ kind: "tag", value: m[0] });
      i += m[0].length;
      continue;
    }
    if (rest[0] === "&") {
      const m = /^&(amp|lt|gt|quot|#39|#\d+|#x[0-9a-fA-F]+);/.exec(rest);
      if (!m) throw new TemplateError("Для символа & используйте &amp;.");
      if (m[1].startsWith("#")) {
        const n = m[1].startsWith("#x")
          ? parseInt(m[1].slice(2), 16)
          : Number(m[1].slice(1));
        if (n < 32 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff))
          throw new TemplateError("Недопустимая HTML-сущность.");
      }
      tokens.push({ kind: "text", value: m[0] });
      i += m[0].length;
      continue;
    }
    // eslint-disable-next-line no-control-regex -- Reject control characters except tab and line breaks.
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(rest[0]))
      throw new TemplateError("Недопустимый управляющий символ.");
    tokens.push({ kind: "text", value: rest[0] });
    i++;
  }
  if (stack.length) throw new TemplateError("Закройте HTML-теги.");
  if (
    !tokens.some(
      (t) =>
        t.kind === "variable" || (t.kind === "text" && visibleText(t.value)),
    )
  )
    throw new TemplateError("Сообщение не может быть пустым.");
  return tokens;
}
export function validateTemplate(source: string) {
  compile(source);
}
export function renderValues(source: string, values: Record<string, unknown>) {
  const result = compile(source)
    .map((t) =>
      t.kind === "variable"
        ? escapeHtml(
            values[t.value] === undefined ||
              values[t.value] === null ||
              values[t.value] === ""
              ? "—"
              : values[t.value],
          )
        : t.value,
    )
    .join("");
  if (result.length > 4096)
    throw new TemplateError("Готовое сообщение превышает 4096 символов.");
  return result;
}
