import {
  newEventTypes,
  EVENTS,
  eventNotification,
} from "../server/event-types.js";
import { translatedError } from "./errors.js";
import { type TelegramContext as Context } from "./i18n.js";
import { Composer, InlineKeyboard } from "grammy";
import {
  deleteSite,
  getSite,
  listSites,
  setInput,
  siteStats,
  trackerSnippet,
  updateSite,
  toggleEventNotification,
  type Site,
} from "../server/sites.js";
import { show, html, back, cancel, mainKeyboard } from "./ui.js";
export async function card(ctx: Context, site: Site) {
  const keyboard = new InlineKeyboard();
  if (site.archived) {
    keyboard
      .text(ctx.t("sites-restore"), `s:${site.id}:restore`)
      .row()
      .text(ctx.t("sites-delete"), `s:${site.id}:delete`)
      .row()
      .text(ctx.t("sites-to-archive"), "archive:0");
  } else {
    keyboard
      .text(ctx.t("sites-tracking-code"), `s:${site.id}:code`)
      .text(ctx.t("sites-statistics"), `s:${site.id}:stats:1`)
      .row()
      .text(ctx.t("sites-name-and-domains"), `s:${site.id}:edit`)
      .row()
      .text(ctx.t("sites-notifications"), `s:${site.id}:notify`)
      .row()
      .text(
        site.paused ? ctx.t("sites-resume") : ctx.t("sites-pause"),
        `s:${site.id}:pause`,
      )
      .row()
      .text(ctx.t("sites-archive"), `s:${site.id}:archive`)
      .row()
      .text(ctx.t("sites-delete"), `s:${site.id}:delete`)
      .row()
      .text(ctx.t("sites-back"), "list:0");
  }
  await show(
    ctx,
    ctx.t("sites-value1-value2-value3-notifications-page-views", {
      value1: html(site.name),
      value2: site.origins
        .map((origin) => `<code>${html(origin)}</code>`)
        .join("\n"),
      value3: site.archived
        ? ctx.t("sites-archived")
        : site.paused
          ? ctx.t("sites-tracking-paused")
          : ctx.t("sites-tracking-enabled"),
      value4: site.notifyPageview
        ? ctx.t("sites-enabled")
        : ctx.t("sites-disabled"),
      value5: site.notifyClick
        ? ctx.t("sites-enabled")
        : ctx.t("sites-disabled"),
    }) +
      "\n" +
      newEventTypes
        .map(
          (type) =>
            `${EVENTS[type].emoji} ${ctx.t("event-" + type.replaceAll("_", "-"))} — ${ctx.t(eventNotification(site, type) ? "sites-enabled" : "sites-disabled")}`,
        )
        .join("\n") +
      (site.archived ? "" : "\n\n" + ctx.t("sites-notification-settings-hint")),
    keyboard,
  );
}

async function showList(ctx: Context, archived: boolean, page: number) {
  const sites = await listSites(archived);
  const max = Math.max(0, Math.ceil(sites.length / 8) - 1);
  page = Math.min(page, max);
  const keyboard = new InlineKeyboard();
  for (const site of sites.slice(page * 8, page * 8 + 8))
    keyboard
      .text(
        `${site.paused ? "⏸" : archived ? "📦" : "🌐"} ${site.name}`,
        `s:${site.id}:card`,
      )
      .row();
  const prefix = archived ? "archive" : "list";
  keyboard
    .text("◀️", `${prefix}:${Math.max(0, page - 1)}`)
    .text(`${page + 1} / ${max + 1}`, `${prefix}:${page}`)
    .text("▶️", `${prefix}:${Math.min(max, page + 1)}`)
    .row()
    .text(ctx.t("sites-add-website"), "add")
    .text(
      ctx.t(archived ? "sites-to-list" : "sites-archive-2"),
      archived ? "list:0" : "archive:0",
    )
    .text(ctx.t("sites-main-menu"), "home");
  await show(
    ctx,
    `${archived ? ctx.t("sites-archive-3") : ctx.t("sites-my-websites")}</b>\n\n${sites.length ? ctx.t("sites-websites-value1-page-value2-value3", { value1: sites.length, value2: page + 1, value3: max + 1 }) : ctx.t("sites-no-websites-yet")}`,
    keyboard,
  );
}

export async function showCode(ctx: Context, site: Site) {
  await show(
    ctx,
    ctx.t("sites-tracker-value1-add-this-to-your", {
      value1: html(site.name),
      value2: html(trackerSnippet(site.id)),
    }),
    back(site.id, ctx),
  );
}

async function notifications(ctx: Context, site: Site) {
  const keyboard = new InlineKeyboard();
  for (const type of newEventTypes)
    keyboard
      .text(
        `${eventNotification(site, type) ? "✅" : "❌"} ${EVENTS[type].emoji} ${ctx.t("event-" + type.replaceAll("_", "-"))}`,
        `s:${site.id}:n:${type}`,
      )
      .row();
  await show(
    ctx,
    ctx.t("sites-value1-choose-notification-events-disabling-both", {
      value1: html(site.name),
    }),
    new InlineKeyboard()
      .text(ctx.t("sites-templates"), `t:${site.id}:menu`)
      .row()
      .text(
        ctx.t("sites-value1-page-views", {
          value1: site.notifyPageview ? "✅" : "❌",
        }),
        `s:${site.id}:n:view`,
      )
      .row()
      .text(
        ctx.t("sites-value1-clicks", {
          value1: site.notifyClick ? "✅" : "❌",
        }),
        `s:${site.id}:n:click`,
      )
      .row()
      .append(keyboard)
      .text(ctx.t("sites-to-website"), `s:${site.id}:card`),
  );
}

export const listPattern = /^(list|archive):(\d{1,6})$/;
export const sitePattern =
  /^s:([a-f0-9-]{36}):(card|code|edit|name|origins|notify|pause|archive|confirm|restore|delete|delete-confirm|n:view|n:click|n:form_start|n:form_success|n:form_abandon|n:scroll_depth|n:active_time|n:block_view|n:contact_click|n:file_download|n:outbound_click|n:video_progress|stats:1|stats:7|stats:30)$/;
export function createSites(owner: string) {
  const sites = new Composer<Context>();
  sites.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const list = listPattern.exec(data);
    const match = sitePattern.exec(data);
    await setInput(owner);
    try {
      if (list) {
        await showList(ctx, list[1] === "archive", Number(list[2]));
        return;
      }
      const [, id, action] = match!;
      const site = await getSite(id);
      if (!site) {
        await show(
          ctx,
          ctx.t("sites-this-website-no-longer-exists-open"),
          mainKeyboard(ctx),
        );
        return;
      }
      if (
        site.archived &&
        !["card", "restore", "delete", "delete-confirm"].includes(action)
      ) {
        await card(ctx, site);
        return;
      }
      if (action === "card") await card(ctx, site);
      else if (action === "code") await showCode(ctx, site);
      else if (action === "edit")
        await show(
          ctx,
          ctx.t("sites-value1-what-would-you-like-to", {
            value1: html(site.name),
          }),
          new InlineKeyboard()
            .text(ctx.t("sites-name"), `s:${id}:name`)
            .row()
            .text(ctx.t("sites-domains"), `s:${id}:origins`)
            .row()
            .text(ctx.t("sites-to-website"), `s:${id}:card`),
        );
      else if (action === "name" || action === "origins") {
        await setInput(owner, { action, siteId: id });
        await show(
          ctx,
          action === "name"
            ? ctx.t("sites-send-a-new-name-up-to")
            : ctx.t("sites-send-the-complete-new-comma-separated", {
                value1: site.origins.map(html).join("\n"),
              }),
          cancel(ctx),
        );
      } else if (action === "notify") await notifications(ctx, site);
      else if (action.startsWith("n:"))
        await notifications(
          ctx,
          ["n:view", "n:click"].includes(action)
            ? await updateSite(id, {
                toggle:
                  action === "n:view" ? "notify_pageview" : "notify_click",
              })
            : await toggleEventNotification(id, action.slice(2)),
        );
      else if (action === "pause")
        await card(ctx, await updateSite(id, { toggle: "paused" }));
      else if (action === "delete")
        await show(
          ctx,
          ctx.t("sites-delete-confirmation", { value1: html(site.name) }),
          new InlineKeyboard()
            .text(ctx.t("sites-yes-delete"), `s:${id}:delete-confirm`)
            .row()
            .text(ctx.t("sites-cancel"), `s:${id}:card`),
        );
      else if (action === "delete-confirm") {
        await deleteSite(id);
        await showList(ctx, site.archived, 0);
      } else if (action === "archive")
        await show(
          ctx,
          ctx.t("sites-archive-value1-tracking-and-notifications-will", {
            value1: html(site.name),
          }),
          new InlineKeyboard()
            .text(ctx.t("sites-yes-archive"), `s:${id}:confirm`)
            .row()
            .text(ctx.t("sites-cancel"), `s:${id}:card`),
        );
      else if (action === "confirm")
        await card(ctx, await updateSite(id, { archived: true }));
      else if (action === "restore")
        await card(ctx, await updateSite(id, { archived: false }));
      else if (action.startsWith("stats:")) {
        const days = Number(action.split(":")[1]) as 1 | 7 | 30;
        const stats = await siteStats(id, days);
        await show(
          ctx,
          ctx.t("sites-value1-last-value2-page-views-value3", {
            value1: html(site.name),
            value2:
              days === 1
                ? ctx.t("sites-24-hours")
                : ctx.t("sites-value1-days", { value1: days }),
            value3: stats.views,
            value4: stats.clicks,
            value5: stats.visitors,
            value6: stats.newVisitors,
            value7: stats.returningVisitors,
            value8: stats.sessionVisitors
              ? ctx.t("sites-legacy-temporary-ids-value1", {
                  value1: stats.sessionVisitors,
                })
              : "",
            value9: stats.pages.length
              ? stats.pages
                  .map((p) => `${html(p.path.slice(0, 300))} — ${p.count}`)
                  .join("\n")
              : ctx.t("sites-no-page-views-yet"),
          }) +
            "\n\n" +
            newEventTypes
              .map((type) => {
                const counts = stats.milestones[type];
                const detail = counts
                  ? " (" +
                    Object.entries(counts)
                      .map(
                        ([key, value]) =>
                          `${type === "video_progress" ? ctx.t("event-stage-" + key) : type === "scroll_depth" ? key + "%" : ctx.t("event-active-seconds", { value1: Number(key) })}: ${value}`,
                      )
                      .join(", ") +
                    ")"
                  : "";
                return `${EVENTS[type].emoji} ${ctx.t("event-" + type.replaceAll("_", "-"))}: ${stats.eventCounts[type] || 0}${detail}`;
              })
              .join("\n"),
          new InlineKeyboard()
            .text(ctx.t("sites-24-hours"), `s:${id}:stats:1`)
            .text(ctx.t("sites-7-days"), `s:${id}:stats:7`)
            .text(ctx.t("sites-30-days"), `s:${id}:stats:30`)
            .row()
            .text(ctx.t("sites-to-website"), `s:${id}:card`),
        );
      }
    } catch (error) {
      const message = translatedError(
        ctx,
        error,
        ctx.t("main-menu-could-not-complete-the-action-please"),
      );
      await ctx.reply(html(message), { parse_mode: "HTML" });
    }
  });
  return sites;
}
