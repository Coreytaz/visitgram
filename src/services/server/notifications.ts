import { EVENTS, isEventType, type EventDetails } from "./event-types.js";
import { translator, type Locale } from "../telegram/i18n.js";
import type { Site } from "./sites.js";
import { renderValues } from "./templates.js";

export function renderTemplate(
  source: string,
  e: MessageEvent,
  timestamp: number,
  locale: Locale = "ru",
) {
  const ctx = translator(locale);
  return renderValues(source, {
    action:
      e.type === "click"
        ? e.label
          ? ctx.t("notification-clicked-value", { value1: e.label })
          : ctx.t("notification-clicked-an-element")
        : e.type === "pageview" || !e.type
          ? ctx.t("notification-opened-a-page")
          : ctx.t("event-" + e.type.replaceAll("_", "-")),
    action_emoji: isEventType(e.type) ? EVENTS[e.type].emoji : "👀",
    element_id: e.elementId,
    threshold: e.threshold,
    stage: e.stage,
    channel: e.channel,
    link_url: e.linkUrl,
    event_type: e.type,
    site_name: e.siteName || e.site,
    site: e.site,
    path: e.path,
    title: e.title,
    element: e.label,
    visitor_id: e.visitor,
    visitor_status:
      e.visitorStatus === "new"
        ? ctx.t("notification-new")
        : e.visitorStatus === "returning"
          ? ctx.t("notification-returning")
          : ctx.t("notification-no-persistent-id"),
    ip: e.ip,
    browser: e.browser,
    os: e.os,
    device: e.device,
    language: e.language,
    timezone: e.timezone,
    screen: e.screen,
    viewport: e.viewport,
    elapsed_seconds: e.elapsedSeconds,
    referrer: e.referrer,
    utm_source: e.campaign?.utm_source,
    utm_medium: e.campaign?.utm_medium,
    utm_campaign: e.campaign?.utm_campaign,
    utm_content: e.campaign?.utm_content,
    utm_term: e.campaign?.utm_term,
    time: humanTime(timestamp, e.timezone || "UTC", locale),
  });
}
export function formatNotification(
  site: Site,
  e: MessageEvent,
  timestamp: number,
  locale: Locale = "ru",
) {
  const source =
    (e.type === "click"
      ? site.templateClick
      : e.type === "pageview"
        ? site.templatePageview
        : null) ?? site.templateDefault;
  if (source !== null) {
    try {
      return renderTemplate(source, e, timestamp, locale);
    } catch {
      console.warn(
        "Notification template fallback: invalid or oversized template",
      );
    }
  }
  return formatTelegramMessage(e, timestamp, locale);
}

function humanTime(timestamp: number, timezone = "UTC", locale: Locale = "ru") {
  try {
    new Intl.DateTimeFormat(locale, { timeZone: timezone });
  } catch {
    timezone = "UTC";
  }
  const date = new Date(timestamp);
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(date)
    .replace(/\s*г\.$/u, "");
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const offset = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")!
    .value.replace("GMT", "UTC");
  return `${day}, ${time} (${offset})`;
}

export type MessageEvent = EventDetails & {
  site?: string;
  siteName?: string;
  type?: string;
  path?: string;
  title?: string;
  label?: string;
  visitor?: string;
  visitorStatus?: "new" | "returning" | "unknown";
  ip?: string;
  browser?: string;
  os?: string;
  device?: string;
  language?: string;
  timezone?: string;
  screen?: string;
  viewport?: string;
  elapsedSeconds?: number;
  referrer?: string;
  campaign?: Record<string, string>;
};

export function formatTelegramMessage(
  e: MessageEvent,
  timestamp: number,
  locale: Locale = "ru",
) {
  const ctx = translator(locale);
  const escape = (value: unknown, limit = 160) =>
    String(value ?? "")
      .slice(0, limit)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const device =
    e.device === "телефон" ? "📱" : e.device === "планшет" ? "📱" : "💻";
  const action = [
    e.label && `🎯 <b>${escape(e.label)}</b>`,
    e.threshold !== undefined &&
      (e.type === "scroll_depth"
        ? `${e.threshold}%`
        : ctx.t("event-active-seconds", { value1: e.threshold })),
    e.stage &&
      escape(
        ["start", "half", "complete"].includes(e.stage)
          ? ctx.t("event-stage-" + e.stage)
          : e.stage,
      ),
    e.channel &&
      escape(
        ["phone", "email", "telegram", "whatsapp", "viber"].includes(e.channel)
          ? ctx.t("event-channel-" + e.channel)
          : e.channel,
      ),
    e.linkUrl && escape(e.linkUrl, 1024),
    typeof e.elapsedSeconds === "number" &&
      e.type === "click" &&
      ctx.t("notification-after-value-sec-since-opening", {
        value1: e.elapsedSeconds,
      }),
  ]
    .filter(Boolean)
    .join("\n");
  const visitor = [
    e.visitorStatus === "new"
      ? ctx.t("notification-new-visitor")
      : e.visitorStatus === "returning"
        ? ctx.t("notification-returning-visitor")
        : ctx.t("notification-visitor-no-persistent-id"),
    `ID: <code>${escape(e.visitor || ctx.t("notification-anonymous"), 64)}</code>`,
    e.ip && `IP: <code>${escape(e.ip, 64)}</code>`,
  ]
    .filter(Boolean)
    .join("\n");
  const details = [
    ctx.t("notification-value-device", { value1: device }),
    [e.browser, e.os]
      .filter(Boolean)
      .map((v) => escape(v))
      .join(" · "),
    [e.device, e.language]
      .filter(Boolean)
      .map((v) => escape(v))
      .join(" · "),
    [
      e.screen &&
        ctx.t("notification-screen-value", { value1: escape(e.screen) }),
      e.viewport &&
        ctx.t("notification-viewport-value", { value1: escape(e.viewport) }),
    ]
      .filter(Boolean)
      .join(" · "),
    e.timezone &&
      ctx.t("notification-time-zone-value", { value1: escape(e.timezone) }),
  ]
    .filter(Boolean)
    .join("\n");
  const source = [
    ctx.t("notification-referrer"),
    e.referrer
      ? escape(e.referrer, 260)
      : ctx.t("notification-direct-visit-referrer-unavailable"),
    ...Object.entries(e.campaign || {})
      .filter(([key]) =>
        [
          "utm_source",
          "utm_medium",
          "utm_campaign",
          "utm_content",
          "utm_term",
        ].includes(key),
      )
      .map(([key, value]) => `<code>${key}=${escape(value, 60)}</code>`),
  ].join("\n");
  return [
    [
      e.type === "click"
        ? ctx.t("notification-button-click")
        : e.type === "pageview" || !e.type
          ? ctx.t("notification-page-view")
          : `${isEventType(e.type) ? EVENTS[e.type].emoji : ""} ${ctx.t("event-" + e.type.replaceAll("_", "-"))}`,
      `<b>${escape(e.site, 253)}</b>`,
      e.siteName && e.siteName !== e.site && `<i>${escape(e.siteName, 80)}</i>`,
      `<code>${escape(e.path, 512)}</code>`,
      e.title && `<i>${escape(e.title)}</i>`,
    ]
      .filter(Boolean)
      .join("\n"),
    action,
    visitor,
    details,
    source,
    `🕒 ${escape(humanTime(timestamp, e.timezone || "UTC", locale))}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
