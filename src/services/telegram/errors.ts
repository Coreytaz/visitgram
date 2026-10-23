import { type Translator } from "./i18n.js";
const errors: Record<string, string> = {
  "Шаблон должен содержать от 1 до 2000 символов.":
    "error-the-template-must-contain-to-characters",
  "Неизвестная переменная или неверные скобки. Откройте список переменных.":
    "error-unknown-variable-or-invalid-braces-open-the",
  "Для буквальной скобки используйте }}.":
    "error-use-for-a-literal-closing-brace",
  "Разрешены только b, i, u, s, code, pre без атрибутов.":
    "error-only-b-i-u-s-code-pre",
  "Неверное закрытие HTML-тегов.": "error-html-tags-are-closed-in-the-wrong",
  "code и pre нельзя совмещать с другими тегами.":
    "error-code-and-pre-cannot-be-combined-with",
  "Для символа & используйте &amp;.": "error-use-amp-for-the-character",
  "Недопустимая HTML-сущность.": "error-invalid-html-entity",
  "Недопустимый управляющий символ.": "error-invalid-control-character",
  "Закройте HTML-теги.": "error-close-all-html-tags",
  "Сообщение не может быть пустым.": "error-the-message-cannot-be-empty",
  "Готовое сообщение превышает 4096 символов.":
    "error-the-rendered-message-exceeds-characters",
  "Один из доменов уже привязан к сайту, включая архив.":
    "error-one-of-the-domains-is-already-linked",
  "Сайт больше не существует.": "error-this-website-no-longer-exists",
  "Сначала восстановите сайт из архива.":
    "error-restore-the-website-from-the-archive-first",
  "Название должно содержать от 1 до 80 символов без переносов строк.":
    "error-the-name-must-contain-to-characters-without",
  "Один из доменов уже привязан к другому сайту.":
    "error-one-of-the-domains-is-already-linked-another",
  "Неизвестная настройка.": "error-unknown-setting",
  "Неизвестный тип шаблона.": "error-unknown-template-type",
  "Сайт недоступен или находится в архиве.":
    "error-the-website-is-unavailable-or-archived",
  "Укажите от 1 до 10 доменов через запятую.":
    "error-send-to-commaseparated-domains",
  "Не удалось распознать домен.": "error-could-not-recognize-the-domain",
  "Нужен адрес с HTTP/HTTPS, без логина, пароля, параметров, меток и маски *.":
    "error-use-an-httphttps-domain-without-a-path",
  "VISITGRAM_PUBLIC_URL должен быть HTTP/HTTPS origin без пути и пароля.":
    "error-visitgrampublicurl-must-be-an-httphttps-origin-without",
};
export function translatedError(
  ctx: Translator,
  error: unknown,
  fallback: string,
) {
  if (!(error instanceof Error)) return fallback;
  const key = errors[error.message];
  if (key) return ctx.t(key);
  return fallback;
}
