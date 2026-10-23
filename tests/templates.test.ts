import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VARIABLES,
  validateTemplate,
  renderValues,
} from "../src/services/server/templates.js";
import {
  renderTemplate,
  formatNotification,
  formatTelegramMessage,
} from "../src/services/server/notifications.js";
import type { Site } from "../src/services/server/sites.js";

test("template variables escape once, preserve zero and literal braces", () => {
  for (const name of Object.keys(VARIABLES)) {
    assert.equal(
      renderValues(`{${name}}`, { [name]: "<x>&{path}" }),
      "&lt;x&gt;&amp;{path}",
    );
    for (const empty of [null, undefined, ""])
      assert.equal(renderValues(`{${name}}`, { [name]: empty }), "—");
  }
  assert.equal(
    renderValues("{{path}} {elapsed_seconds}", { elapsed_seconds: 0 }),
    "{path} 0",
  );
  assert.equal(
    renderValues("<b><i>{title}</i></b> &amp; &#39;", { title: "A > B" }),
    "<b><i>A &gt; B</i></b> &amp; &#39;",
  );
});

test("template validator rejects unknown variables, malformed HTML and excessive size", () => {
  for (const invalid of [
    "",
    " ",
    "<b></b>",
    "<b>&#32;</b>",
    "&#160;",
    "{unknown}",
    "{constructor}",
    "{path",
    "}",
    "<a>x</a>",
    '<b class="x">x</b>',
    "<b>x</i>",
    "<b>x",
    "<pre><b>x</b></pre>",
    "<b><code>x</code></b>",
    "<code><pre>x</pre></code>",
    "x & y",
    "&#0;",
    "&#xD800;",
    "&#1114112;",
    "x\u0000",
    "x".repeat(2001),
  ]) {
    assert.throws(() => validateTemplate(invalid), Error, invalid);
  }
  validateTemplate("<b><i>x</i></b><u>u</u><s>s</s><code>c</code><pre>p</pre>");
  assert.equal(renderValues("{path}", { path: "x".repeat(4096) }).length, 4096);
  assert.throws(() =>
    renderValues("<b>{path}</b>", { path: "x".repeat(4096) }),
  );
});

test("notification variables, inheritance and safe fallback", () => {
  const site = {
    templateDefault: "Общий {action}",
    templateClick: null,
    templatePageview: null,
  } as Site;
  const stamp = Date.UTC(2026, 9, 23, 9, 57, 13);
  const event = {
    type: "click",
    label: "Купить <товар>",
    path: "/shop",
    visitorStatus: "returning" as const,
    elapsedSeconds: 0,
    timezone: "Asia/Yekaterinburg",
  };
  assert.equal(
    formatNotification(site, event, stamp),
    "Общий Нажал «Купить &lt;товар&gt;»",
  );
  assert.equal(
    renderTemplate(
      "{visitor_status}|{elapsed_seconds}|{time}|{utm_term}",
      event,
      stamp,
    ),
    "Повторный|0|23 октября 2026, 14:57:13 (UTC+5)|—",
  );
  assert.equal(
    renderTemplate("{action}", { type: "click" }, stamp),
    "Нажал на элемент",
  );
  assert.equal(
    renderTemplate("{action}", { type: "pageview" }, stamp),
    "Открыл страницу",
  );
  site.templateClick = "Клик {element}";
  assert.match(formatNotification(site, event, stamp), /^Клик /);
  assert.equal(
    formatNotification(site, { type: "pageview" }, stamp),
    "Общий Открыл страницу",
  );
  const other = { ...site, templateDefault: "Другой", templateClick: null };
  assert.equal(formatNotification(other, event, stamp), "Другой");
  const logs: string[] = [];
  const warn = console.warn;
  console.warn = (value) => logs.push(String(value));
  try {
    for (const broken of ["{unknown}", "{path}{path}"]) {
      site.templateClick = broken;
      const large = { ...event, path: "<".repeat(1500) };
      assert.equal(
        formatNotification(site, large, stamp),
        formatTelegramMessage(large, stamp),
      );
    }
  } finally {
    console.warn = warn;
  }
  assert.equal(logs.length, 2);
  assert.ok(
    logs.every((value) => !value.includes("shop") && !value.includes("товар")),
  );
  assert.doesNotThrow(() =>
    renderTemplate("{time}", { timezone: "invalid" }, stamp),
  );
});

test("all event metadata is exposed to templates", () => {
  const values = {
    site_name: "Магазин",
    site: "shop.test",
    path: "/cart",
    title: "Корзина",
    element: "Оплатить",
    visitor_id: "browser-1",
    ip: "192.0.2.1",
    browser: "Chrome",
    os: "Linux",
    device: "телефон",
    language: "ru",
    timezone: "UTC",
    screen: "1920 × 1080",
    viewport: "800 × 600",
    referrer: "https://example.org",
    utm_source: "tg",
    utm_medium: "social",
    utm_campaign: "sale",
    utm_content: "link",
    utm_term: "item",
  };
  const event = {
    type: "click",
    siteName: values.site_name,
    site: values.site,
    path: values.path,
    title: values.title,
    label: values.element,
    visitor: values.visitor_id,
    visitorStatus: "new" as const,
    ip: values.ip,
    browser: values.browser,
    os: values.os,
    device: values.device,
    language: values.language,
    timezone: values.timezone,
    screen: values.screen,
    viewport: values.viewport,
    referrer: values.referrer,
    campaign: {
      utm_source: values.utm_source,
      utm_medium: values.utm_medium,
      utm_campaign: values.utm_campaign,
      utm_content: values.utm_content,
      utm_term: values.utm_term,
    },
  };
  for (const [key, value] of Object.entries(values))
    assert.equal(renderTemplate(`{${key}}`, event, 0), value);
  assert.equal(
    renderTemplate("{event_type}|{action_emoji}|{visitor_status}", event, 0),
    "click|🖱|Новый",
  );
});
