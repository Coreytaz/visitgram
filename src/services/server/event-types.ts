import type { Site } from "./site-types.js";

export const EVENTS = {
  pageview: { emoji: "👀", notify: true },
  click: { emoji: "🖱", notify: true },
  form_start: { emoji: "📝", notify: false },
  form_success: { emoji: "✅", notify: true },
  form_abandon: { emoji: "🚪", notify: false },
  scroll_depth: { emoji: "📜", notify: false },
  active_time: { emoji: "⏱", notify: false },
  block_view: { emoji: "👁", notify: false },
  contact_click: { emoji: "📞", notify: true },
  file_download: { emoji: "📥", notify: false },
  outbound_click: { emoji: "🔗", notify: false },
  video_progress: { emoji: "🎬", notify: false },
} as const;
export type EventType = keyof typeof EVENTS;
export const eventTypes = Object.keys(EVENTS) as EventType[];
export const newEventTypes = eventTypes.filter(
  (t) => t !== "pageview" && t !== "click",
);
export function isEventType(type: unknown): type is EventType {
  return typeof type === "string" && Object.hasOwn(EVENTS, type);
}
export function eventNotification(site: Site, type: string): boolean {
  if (!isEventType(type)) return false;
  return type === "pageview"
    ? site.notifyPageview
    : type === "click"
      ? site.notifyClick
      : (site.eventNotifications?.[type] ?? EVENTS[type].notify);
}
export function notificationsEnabled(site: Site, type: string) {
  return !site.paused && !site.archived && eventNotification(site, type);
}

export type EventDetails = {
  elementId?: string;
  threshold?: number;
  stage?: string;
  channel?: string;
  linkUrl?: string;
};
export function eventDetails(input: Record<string, unknown>): EventDetails {
  const details: EventDetails = {};
  if (input.elementId !== undefined) {
    if (
      typeof input.elementId !== "string" ||
      input.elementId.length > 120 ||
      [...input.elementId].some((c) => c.charCodeAt(0) < 32)
    )
      throw Error("Invalid element");
    details.elementId = input.elementId;
  }
  const thresholds =
    input.type === "scroll_depth"
      ? [25, 50, 75, 100]
      : input.type === "active_time"
        ? [30, 60, 120, 300]
        : undefined;
  if (thresholds) {
    if (
      typeof input.threshold !== "number" ||
      !thresholds.includes(input.threshold)
    )
      throw Error("Invalid threshold");
    details.threshold = input.threshold;
  }
  if (input.type === "video_progress") {
    if (
      typeof input.stage !== "string" ||
      !["start", "half", "complete"].includes(input.stage)
    )
      throw Error("Invalid video stage");
    details.stage = input.stage;
  }
  if (input.type === "contact_click") {
    if (
      typeof input.channel !== "string" ||
      !["phone", "email", "telegram", "whatsapp", "viber"].includes(
        input.channel,
      )
    )
      throw Error("Invalid channel");
    details.channel = input.channel;
  }
  if (["file_download", "outbound_click"].includes(String(input.type))) {
    if (typeof input.linkUrl !== "string" || input.linkUrl.length > 1024)
      throw Error("Invalid link");
    const url = new URL(input.linkUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw Error("Invalid link");
    details.linkUrl = url.origin + url.pathname;
  }
  return details;
}
