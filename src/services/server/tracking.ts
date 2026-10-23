import { isEventType, eventDetails } from "./event-types.js";
import { formatNotification } from "./notifications.js";
export { formatTelegramMessage } from "./notifications.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import {
  cleanEvents,
  pendingEvent,
  updatePending,
  recentEvents,
  insertEvent,
} from "../database/events.js";
import {
  sendTelegramNotification,
  telegramRetryDelay,
  notificationLocale,
} from "./telegram.js";
import {
  migrateSites,
  getSite,
  findLegacySite,
  notificationsEnabled,
} from "./sites.js";

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const enabled = Boolean(botToken && chatId);
const rates = new Map<string, { count: number; until: number }>();
let worker: ReturnType<typeof setInterval> | undefined;
let delivery: Promise<void> | undefined;
let busy = false;

export function deviceInfo(userAgent: string) {
  const browsers = [
    ["Edge", /Edg(?:A|iOS)?\/(\d+)/],
    ["Opera", /OPR\/(\d+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/],
    ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
    ["Safari", /Version\/(\d+).*Safari/],
  ] as const;
  const browserMatch = browsers.find(([, pattern]) => pattern.test(userAgent));
  const browser = browserMatch
    ? `${browserMatch[0]} ${userAgent.match(browserMatch[1])![1]}`
    : "Не определён";
  const os = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent)
      ? "iOS / iPadOS"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Macintosh|Mac OS/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "Не определена";
  const device =
    /iPad|Tablet/.test(userAgent) ||
    (/Android/.test(userAgent) && !/Mobile/.test(userAgent))
      ? "планшет"
      : /Mobile|iPhone|iPod/.test(userAgent)
        ? "телефон"
        : "компьютер / другое";
  return { browser, os, device };
}

export async function initTracking() {
  if (!process.env.VISITGRAM_TOKEN)
    throw new Error("Set VISITGRAM_TOKEN before starting");
  if (Boolean(botToken) !== Boolean(chatId))
    throw new Error("Set both Telegram variables, or neither");
  await migrateSites();
  await cleanTracking();
  if (enabled)
    worker = setInterval(() => {
      if (!delivery)
        delivery = deliver().finally(() => {
          delivery = undefined;
        });
    }, 1100);
}

export async function cleanTracking() {
  const days = Number(process.env.VISITGRAM_TRACK_RETENTION_DAYS || 30);
  if (!Number.isFinite(days) || days < 1)
    throw new Error("Retention must be at least 1 day");
  await cleanEvents(days);
}

export async function stopTracking() {
  if (worker) clearInterval(worker);
  worker = undefined;
  await delivery;
}

async function deliver() {
  if (busy) return;
  busy = true;
  try {
    const row = await pendingEvent();
    if (!row) return;
    let e;
    try {
      e = JSON.parse(row.payload);
      if (!e || typeof e !== "object") throw Error();
    } catch {
      await updatePending(row.id, { status: "failed" });
      console.warn("Invalid queued event retained as failed");
      return;
    }
    const site = row.site_id ? await getSite(String(row.site_id)) : undefined;
    if (!site || !notificationsEnabled(site, e.type)) {
      await updatePending(row.id, { status: "disabled" });
      return;
    }
    e.siteName = site.name;
    const text = formatNotification(
      site,
      e,
      Number(row.timestamp),
      await notificationLocale(),
    );
    let delay = 30;
    let ok = false;
    try {
      await sendTelegramNotification(text);
      ok = true;
    } catch (error) {
      delay = telegramRetryDelay(error);
      // Error objects may contain a bot token or payload: never log them.
    }
    const attempts = Number(row.attempts) + 1;
    await updatePending(row.id, {
      status: ok ? "sent" : attempts >= 5 ? "failed" : "pending",
      attempts,
      next_attempt: Date.now() + delay * 1000,
    });
    if (!ok)
      console.warn(
        `Telegram delivery failed for event ${row.id}, attempt ${attempts}`,
      );
  } catch {
    console.error("Tracking delivery worker failed");
  } finally {
    busy = false;
  }
}

function reply(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

export async function handleTracking(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const requestUrl = new URL(req.url || "/", "http://localhost");
  const path = requestUrl.pathname;
  if (path === "/tracker.js" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-cache",
    });
    res.end(
      await readFile(
        new URL("../../../public/tracker.js", import.meta.url),
        "utf8",
      ),
    );
    return true;
  }
  if (path !== "/api/track" && path !== "/api/visits") return false;
  if (path === "/api/visits") {
    if (req.headers.authorization !== `Basic ${process.env.VISITGRAM_TOKEN}`) {
      reply(res, 401, { error: "Unauthorized" });
      return true;
    }
    if (req.method !== "GET") {
      reply(res, 405, { error: "Method not allowed" });
      return true;
    }
    const filter = requestUrl.searchParams.get("site_id");
    const rows = await recentEvents(filter || undefined);
    reply(
      res,
      200,
      rows.map((r) => {
        let payload = null;
        try {
          payload = JSON.parse(r.payload);
        } catch {
          // Malformed stored payloads are returned as null.
        }
        return { ...r, payload };
      }),
    );
    return true;
  }
  const origin = req.headers.origin;
  if (!origin) {
    reply(res, 403, { error: "Origin not allowed" });
    return true;
  }
  const siteId = requestUrl.searchParams.get("site_id");
  const site = siteId ? await getSite(siteId) : await findLegacySite(origin);
  if (!site || site.archived) {
    reply(res, 404, { error: "Site not found" });
    return true;
  }
  if (!site.origins.includes(origin)) {
    reply(res, 403, { error: "Origin not allowed" });
    return true;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }
  if (req.method !== "POST") {
    reply(res, 405, { error: "Method not allowed" });
    return true;
  }
  if (site.paused) {
    res.writeHead(204);
    res.end();
    return true;
  }
  const now = Date.now();
  for (const [key, value] of rates) if (value.until < now) rates.delete(key);
  const key = req.socket.remoteAddress || "unknown";
  const rate = rates.get(key) || { count: 0, until: now + 60000 };
  rates.set(key, rate);
  if (++rate.count > 120 || rates.size > 10000) {
    reply(res, 429, { error: "Rate limit" });
    return true;
  }
  try {
    let data = "";
    let bytes = 0;
    for await (const chunk of req) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 4096) {
        reply(res, 413, { error: "Event too large" });
        return true;
      }
      data += chunk;
    }
    const input = JSON.parse(data);
    if (!input || !isEventType(input.type)) throw new Error("Invalid type");
    if (
      typeof input.path !== "string" ||
      !input.path.startsWith("/") ||
      input.path.length > 1024
    )
      throw new Error("Invalid path");
    const clean = (value: unknown, max: number) =>
      typeof value === "string"
        ? // eslint-disable-next-line no-control-regex -- Strip control characters from tracking metadata.
          value.replace(/[\x00-\x1f]/g, " ").slice(0, max)
        : "";
    let referrer = "";
    try {
      referrer = new URL(input.referrer).origin;
    } catch {
      /* Optional */
    }
    let timezone = "";
    try {
      const candidate = clean(input.timezone, 64);
      if (candidate) {
        new Intl.DateTimeFormat("en", { timeZone: candidate });
        timezone = candidate;
      }
    } catch {
      /* Ignore invalid timezones. */
    }
    const dimensions = (value: unknown) => {
      if (!value || typeof value !== "object") return "";
      const { width, height } = value as { width?: unknown; height?: unknown };
      return typeof width === "number" &&
        typeof height === "number" &&
        Number.isInteger(width) &&
        Number.isInteger(height) &&
        width > 0 &&
        height > 0 &&
        width <= 20000 &&
        height <= 20000
        ? `${width} × ${height}`
        : "";
    };
    const campaign: Record<string, string> = {};
    for (const key of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
    ]) {
      const value = clean(input.campaign?.[key], 60);
      if (value) campaign[key] = value;
    }
    const event = {
      ...eventDetails(input),
      site: new URL(origin).host,
      type: input.type,
      path: input.path.split(/[?#]/)[0],
      visitor: clean(input.visitor, 64),
      identityMode: ["persistent", "session", "memory"].includes(
        input.identityMode,
      )
        ? (input.identityMode as string)
        : "legacy",
      session: clean(input.session, 64),
      visitorStatus: "unknown" as "new" | "returning" | "unknown",
      label: clean(input.label, 120),
      referrer,
      title: clean(input.title, 160),
      ip: req.socket.remoteAddress?.replace(/^::ffff:/, "") || "",
      ...deviceInfo((req.headers["user-agent"] || "").slice(0, 512)),
      language: clean(input.language, 32),
      timezone,
      screen: dimensions(input.screen),
      viewport: dimensions(input.viewport),
      elapsedSeconds:
        typeof input.elapsedSeconds === "number" &&
        Number.isFinite(input.elapsedSeconds)
          ? Math.min(86400, Math.max(0, Math.floor(input.elapsedSeconds)))
          : undefined,
      campaign,
    };
    const result = await insertEvent(site.id, origin, event, now, enabled);
    if (result === 204) {
      res.writeHead(204);
      res.end();
      return true;
    }
    if (result !== 202) {
      reply(res, result, {
        error: result === 404 ? "Site not found" : "Origin not allowed",
      });
      return true;
    }
    reply(res, 202, { ok: true });
  } catch {
    reply(res, 400, { error: "Invalid event or storage unavailable" });
  }
  return true;
}
