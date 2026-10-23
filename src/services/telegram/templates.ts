import { translatedError } from "./errors.js";
import { resolveLocale, type TelegramContext as Context } from "./i18n.js";
import { show } from "./ui.js";
import { Composer, InlineKeyboard } from "grammy";
import { randomBytes } from "node:crypto";
import {
  getSite,
  getInput,
  setInput,
  setSiteTemplate,
  type Site,
  type InputState,
} from "../server/sites.js";
import {
  TEMPLATE_EXAMPLE,
  VARIABLES,
  escapeHtml as h,
  validateTemplate,
  TemplateError,
  type TemplateKind,
} from "../server/templates.js";
import {
  formatTelegramMessage,
  renderTemplate,
  type MessageEvent,
} from "../server/notifications.js";
const kinds = { d: "default", v: "pageview", c: "click" } as const;
const names = (ctx: Context) => ({
  default: ctx.t("templates-default"),
  pageview: ctx.t("templates-page-views"),
  click: ctx.t("templates-clicks"),
});
const code = (kind: TemplateKind) =>
  kind === "default" ? "d" : kind === "click" ? "c" : "v";
const key = (site: Site, kind: TemplateKind) => `t:${site.id}:${code(kind)}`;
function effective(site: Site, kind: TemplateKind) {
  return (
    (kind === "default"
      ? site.templateDefault
      : kind === "click"
        ? site.templateClick
        : site.templatePageview) ?? site.templateDefault
  );
}
function sample(ctx: Context, site: Site, type: string): MessageEvent {
  return {
    site: new URL(site.origins[0]).host,
    siteName: site.name,
    type,
    path: "/catalog",
    title: ctx.t("templates-demo-page"),
    label: type === "click" ? ctx.t("templates-buy") : undefined,
    visitor: "demo-visitor",
    visitorStatus: "new",
    ip: "192.0.2.1",
    browser: "Chrome",
    os: "Windows",
    device: ctx.t("templates-computer"),
    language: "ru",
    timezone: "Asia/Yekaterinburg",
    screen: "1920 × 1080",
    viewport: "1280 × 720",
    elapsedSeconds: 0,
    referrer: "https://example.org",
    campaign: { utm_source: "demo" },
  };
}
async function view(ctx: Context, site: Site, kind: TemplateKind) {
  const own =
    kind === "default"
      ? site.templateDefault
      : kind === "click"
        ? site.templateClick
        : site.templatePageview;
  const source = effective(site, kind),
    p = key(site, kind);
  const text = ctx.t("templates-value1-value2-source-value3-value4", {
    value1: names(ctx)[kind],
    value2: h(site.name),
    value3:
      own !== null
        ? ctx.t("templates-custom-template")
        : source !== null
          ? ctx.t("templates-website-default-template")
          : ctx.t("templates-built-in-format"),
    value4:
      source !== null
        ? `<pre>${h(source)}</pre>`
        : ctx.t("templates-the-built-in-format-is-used"),
  });
  await show(
    ctx,
    text,
    new InlineKeyboard()
      .text(ctx.t("templates-edit"), `${p}:edit`)
      .text(ctx.t("templates-preview"), `${p}:p:c`)
      .row()
      .text(ctx.t("templates-variables"), `${p}:vars`)
      .text(ctx.t("templates-reset"), `${p}:reset`)
      .row()
      .text(ctx.t("sites-back"), `t:${site.id}:menu`),
  );
}
function draftMatches(
  state: InputState | undefined,
  site: Site,
  kind: TemplateKind,
  nonce: string | undefined,
) {
  return (
    state?.action === "template" &&
    state.siteId === site.id &&
    state.templateKind === kind &&
    state.draftToken === nonce
  );
}
async function prompt(
  ctx: Context,
  site: Site,
  kind: TemplateKind,
  state: InputState,
) {
  const p = key(site, kind);
  await show(
    ctx,
    ctx.t("templates-value1-value2-send-text-with-variables", {
      value1: names(ctx)[kind],
      value2: h(site.name),
      value3: h(state.draft ?? effective(site, kind) ?? TEMPLATE_EXAMPLE),
    }),
    new InlineKeyboard()
      .text(ctx.t("templates-variables"), `${p}:vars:${state.draftToken}`)
      .row()
      .text(ctx.t("templates-cancel"), `${p}:cancel`),
  );
}
async function preview(
  ctx: Context,
  site: Site,
  kind: TemplateKind,
  type: string,
  state?: InputState,
) {
  const p = key(site, kind),
    nonce = state ? `:${state.draftToken}` : "";
  const e = sample(ctx, site, type);
  const source = state?.draft ?? effective(site, kind);
  const rendered =
    source !== null && source !== undefined
      ? renderTemplate(
          source,
          e,
          Date.now(),
          resolveLocale(await ctx.i18n.getLocale()),
        )
      : formatTelegramMessage(
          e,
          Date.now(),
          resolveLocale(await ctx.i18n.getLocale()),
        );
  const keyboard = new InlineKeyboard();
  if (kind === "default")
    keyboard
      .text(ctx.t("templates-page-view"), `${p}:p:v${nonce}`)
      .text(ctx.t("templates-click"), `${p}:p:c${nonce}`)
      .row();
  if (state)
    keyboard
      .text(ctx.t("templates-save"), `${p}:save:${state.draftToken}`)
      .text(ctx.t("templates-revise"), `${p}:fix:${state.draftToken}`)
      .row()
      .text(ctx.t("templates-variables"), `${p}:vars:${state.draftToken}`)
      .text(ctx.t("templates-cancel"), `${p}:cancel`);
  else keyboard.text(ctx.t("templates-to-template"), `${p}:view`);
  // Keep the notification itself free of extra headings that might exceed Telegram limits.
  await show(ctx, rendered, keyboard);
}
export async function handleTemplateCallback(
  ctx: Context,
  owner: string,
  data: string,
) {
  if (!data.startsWith("t:")) return false;
  const match =
    /^t:([a-f0-9-]{36}):(menu|[dvc]:(?:view|edit|reset|cancel|vars(?::[a-f0-9]{8})?|resume:[a-f0-9]{8}|fix:[a-f0-9]{8}|save:[a-f0-9]{8}|p:[vc](?::[a-f0-9]{8})?))$/.exec(
      data,
    );
  if (!match) {
    await ctx.reply(ctx.t("templates-this-button-has-expired-open-menu"));
    return true;
  }
  const site = await getSite(match[1]);
  if (!site || site.archived) {
    await setInput(owner);
    await ctx.reply(ctx.t("templates-this-website-is-unavailable-or-archived"));
    return true;
  }
  try {
    if (match[2] === "menu") {
      await setInput(owner);
      const k = new InlineKeyboard();
      for (const kind of ["default", "pageview", "click"] as const)
        k.text(names(ctx)[kind], `${key(site, kind)}:view`).row();
      k.text(ctx.t("templates-notifications"), `s:${site.id}:notify`);
      await show(
        ctx,
        ctx.t("templates-templates-value1-event-template-website-default", {
          value1: h(site.name),
        }),
        k,
      );
      return true;
    }
    const parts = match[2].split(":"),
      kind = kinds[parts[0] as keyof typeof kinds],
      action = parts[1],
      p = key(site, kind);
    const nonce = action === "p" ? parts[3] : parts[2];
    const state = await getInput(owner);
    if (nonce && !draftMatches(state, site, kind, nonce)) {
      await ctx.reply(ctx.t("templates-the-draft-has-expired-or-10"));
      return true;
    }
    if (action === "edit") {
      await setInput(owner, {
        action: "template",
        siteId: site.id,
        templateKind: kind,
        phase: "input",
        draftToken: randomBytes(4).toString("hex"),
      });
      await prompt(ctx, site, kind, (await getInput(owner))!);
    } else if (action === "save") {
      if (!state?.draft || state.phase !== "preview") {
        await ctx.reply(ctx.t("templates-send-a-template-for-preview-first"));
        return true;
      }
      await setSiteTemplate(site.id, kind, state.draft);
      await setInput(owner);
      await view(ctx, (await getSite(site.id))!, kind);
    } else if (action === "fix" || action === "resume") {
      if (action === "fix")
        await setInput(owner, { ...state!, phase: "input" });
      const current = (await getInput(owner))!;
      if (current.phase === "preview")
        await preview(
          ctx,
          site,
          kind,
          kind === "pageview" ? "pageview" : "click",
          current,
        );
      else await prompt(ctx, site, kind, current);
    } else if (action === "vars") {
      if (!nonce) await setInput(owner);
      const help = Object.entries(VARIABLES)
        .map(
          ([name]) => `<code>{${name}}</code> — ${ctx.t(`variable-${name}`)}`,
        )
        .join("\n");
      await show(
        ctx,
        ctx.t("templates-variables-value1-missing-values-zero-is", {
          value1: help,
        }),
        new InlineKeyboard().text(
          ctx.t("sites-back"),
          nonce ? `${p}:resume:${nonce}` : `${p}:view`,
        ),
      );
    } else if (action === "p") {
      if (!nonce) await setInput(owner);
      await preview(
        ctx,
        site,
        kind,
        kind === "pageview"
          ? "pageview"
          : kind === "click"
            ? "click"
            : parts[2] === "v"
              ? "pageview"
              : "click",
        nonce ? state : undefined,
      );
    } else {
      await setInput(owner);
      if (action === "reset") await setSiteTemplate(site.id, kind, null);
      await view(ctx, (await getSite(site.id))!, kind);
    }
  } catch (error) {
    await ctx.reply(
      error instanceof TemplateError
        ? translatedError(
            ctx,
            error,
            ctx.t("templates-could-not-validate-the-template-please"),
          )
        : ctx.t("templates-could-not-open-the-template-try"),
    );
  }
  return true;
}
export async function handleTemplateText(
  ctx: Context,
  owner: string,
  state: InputState,
  text: string,
) {
  if (state.action !== "template") return false;
  const site = state.siteId ? await getSite(state.siteId) : undefined;
  if (!site || site.archived || !state.templateKind) {
    await setInput(owner);
    await ctx.reply(ctx.t("templates-this-website-is-unavailable-open-menu"));
    return true;
  }
  if (state.phase !== "input") {
    await ctx.reply(ctx.t("templates-press-revise-or-save-in-the"));
    return true;
  }
  try {
    validateTemplate(text);
    renderTemplate(text, sample(ctx, site, "click"), Date.now());
    renderTemplate(text, sample(ctx, site, "pageview"), Date.now());
    await setInput(owner, {
      ...state,
      draft: text,
      draftToken: randomBytes(4).toString("hex"),
      phase: "preview",
    });
    await preview(
      ctx,
      site,
      state.templateKind,
      state.templateKind === "pageview" ? "pageview" : "click",
      (await getInput(owner))!,
    );
  } catch (error) {
    await ctx.reply(
      error instanceof TemplateError
        ? translatedError(
            ctx,
            error,
            ctx.t("templates-could-not-validate-the-template-please"),
          )
        : ctx.t("templates-could-not-validate-the-template-please"),
    );
  }
  return true;
}

export function createTemplates(owner: string) {
  const templates = new Composer<Context>();
  templates.on("callback_query:data", async (ctx) => {
    await handleTemplateCallback(ctx, owner, ctx.callbackQuery.data);
  });
  return templates;
}
