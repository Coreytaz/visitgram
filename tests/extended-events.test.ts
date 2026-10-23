import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import {
  eventDetails,
  newEventTypes,
  eventNotification,
} from "../src/services/server/event-types.js";
import {
  formatNotification,
  renderTemplate,
} from "../src/services/server/notifications.js";
import { translator } from "../src/services/telegram/i18n.js";

// A deterministic browser harness: DOM matching, observer delivery and clock are
// controlled independently of tracker internals, including dynamic elements.
class Element {
  attrs: Record<string, string> = {};
  parent: Element | null = null;
  isConnected = true;
  id = "";
  textContent = "";
  currentTime = 0;
  duration = 100;
  listeners = new Map<string, (() => void)[]>();
  constructor(public tagName: string) {}
  get href() {
    return this.attrs.href;
  }
  getAttribute(key: string) {
    return this.attrs[key] ?? null;
  }
  hasAttribute(key: string) {
    return key in this.attrs;
  }
  closest(selector: string): Element | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Walk a fake DOM ancestor chain.
    for (let el: Element | null = this; el; el = el.parent) {
      if (
        selector.split(",").some((part) => {
          const qualified = /^(input)\[type="([^"]+)"\]$/.exec(part);
          if (qualified)
            return el!.tagName === "INPUT" && el!.attrs.type === qualified[2];
          if (part === '[role="button"]') return el!.attrs.role === "button";
          const attr = /^\[([^\]]+)\]$/.exec(part);
          if (attr) return el!.hasAttribute(attr[1]);
          if (part === "a[href]")
            return el!.tagName === "A" && el!.hasAttribute("href");
          return el!.tagName.toLowerCase() === part;
        })
      )
        return el;
    }
    return null;
  }
  addEventListener(name: string, fn: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), fn]);
  }
  removeEventListener(name: string, fn: () => void) {
    this.listeners.set(
      name,
      (this.listeners.get(name) || []).filter((x) => x !== fn),
    );
  }
  emit(name: string) {
    for (const fn of this.listeners.get(name) || []) fn();
  }
}
async function browser(beacon = true) {
  const code = await readFile(
    new URL("../public/tracker.js", import.meta.url),
    "utf8",
  );
  let now = 1_000_000,
    nextId = 0;
  const timers = new Map<
    number,
    { fn: () => void; at: number; interval?: number }
  >();
  const listeners = new Map<string, ((event?: unknown) => void)[]>();
  const nodes: Element[] = [];
  const blobs: Blob[] = [];
  const observers: {
    callback: (entries: unknown[]) => void;
    elements: Set<Element>;
  }[] = [];
  let mutation = () => {};
  const document = {
    visibilityState: "visible",
    documentElement: { scrollHeight: 4000 },
    body: { scrollHeight: 4000 },
    currentScript: {
      src: "https://analytics.example/tracker.js",
      getAttribute: () => "site",
    },
    referrer: "",
    title: "Demo",
    querySelectorAll: (selector: string) =>
      nodes.filter((el) => el.isConnected && el.closest(selector) === el),
    addEventListener: (name: string, fn: (event?: unknown) => void) =>
      listeners.set(name, [...(listeners.get(name) || []), fn]),
  };
  const location = {
    pathname: "/first",
    href: "https://site.example/first",
    origin: "https://site.example",
    search: "",
  };
  const navigator = {
    doNotTrack: "0",
    globalPrivacyControl: false,
    sendBeacon: (_url: string, blob: Blob) => {
      if (beacon) blobs.push(blob);
      return beacon;
    },
  };
  const window = {
    innerHeight: 1000,
    innerWidth: 1000,
    scrollY: 0,
    analog: {} as { formSuccess: (form: Element) => void; refresh: () => void },
  };
  vm.runInNewContext(code, {
    Element,
    Blob,
    URL,
    URLSearchParams,
    crypto: { randomUUID },
    window,
    document,
    location,
    navigator,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    fetch: (_url: string, options: { body: string }) => {
      blobs.push(new Blob([options.body]));
      return Promise.resolve();
    },
    addEventListener: document.addEventListener,
    history: {
      pushState: (_s: unknown, _t: string, url: string) => {
        location.pathname = url;
      },
      replaceState() {},
    },
    setTimeout: (fn: () => void, ms: number) => {
      timers.set(++nextId, { fn, at: now + ms });
      return nextId;
    },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: (fn: () => void, ms: number) => {
      timers.set(++nextId, { fn, at: now + ms, interval: ms });
      return nextId;
    },
    IntersectionObserver: class {
      state: (typeof observers)[number];
      constructor(callback: (entries: unknown[]) => void) {
        this.state = { callback, elements: new Set() };
        observers.push(this.state);
      }
      observe(el: Element) {
        this.state.elements.add(el);
      }
      unobserve(el: Element) {
        this.state.elements.delete(el);
      }
      disconnect() {
        this.state.elements.clear();
      }
    },
    MutationObserver: class {
      constructor(callback: () => void) {
        mutation = callback;
      }
      observe() {}
    },
  });
  const emit = (event: string, data?: unknown) => {
    for (const fn of listeners.get(event) || []) fn(data);
  };
  return {
    window,
    document,
    navigator,
    add(tag: string, attrs: Record<string, string> = {}) {
      const el = new Element(tag);
      el.attrs = attrs;
      nodes.push(el);
      mutation();
      return el;
    },
    emit,
    intersect(el: Element, ratio: number) {
      for (const observer of observers)
        if (observer.elements.has(el))
          observer.callback([{ target: el, intersectionRatio: ratio }]);
    },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        if (due[1].interval) due[1].at += due[1].interval;
        else timers.delete(due[0]);
        due[1].fn();
      }
      now = until;
    },
    async payloads() {
      return Promise.all(blobs.map(async (b) => JSON.parse(await b.text())));
    },
    navigate: (url: string) => {
      location.pathname = url;
      emit("popstate");
    },
  };
}

test("forms require confirmed success, deduplicate cycles and abandon on the old SPA path", async () => {
  const b = await browser();
  const form = b.add("FORM", { "data-analog-form": "Request" });
  const field = b.add("INPUT");
  field.parent = form;
  b.emit("input", { target: field, isTrusted: true });
  b.emit("input", { target: field, isTrusted: true });
  b.emit("submit", { target: form }); // A submit attempt is not a success.
  b.window.analog.formSuccess(form);
  b.window.analog.formSuccess(form);
  b.navigate("/second");
  b.emit("input", { target: field });
  b.navigate("/third");
  b.emit("pagehide");
  const types = (await b.payloads()).map((e) => e.type);
  assert.deepEqual(types, [
    "pageview",
    "form_start",
    "form_success",
    "pageview",
    "form_start",
    "form_abandon",
    "pageview",
  ]);
  assert.equal(
    (await b.payloads()).find((e) => e.type === "form_abandon").path,
    "/second",
  );
  const silent = b.add("FORM");
  b.window.analog.formSuccess(silent);
  assert.equal((await b.payloads()).at(-1).type, "form_success");
  form.attrs["data-analog-ignore"] = "";
  b.emit("input", { target: field });
  b.window.analog.formSuccess(form);
  assert.equal(
    (await b.payloads()).filter((e) => e.type === "form_start").length,
    2,
  );
});

test("scroll milestones reset per route, active time excludes hidden and idle intervals", async () => {
  const b = await browser();
  b.emit("scroll");
  b.window.scrollY = 3000;
  b.emit("scroll");
  b.emit("scroll");
  assert.deepEqual(
    (await b.payloads())
      .filter((e) => e.type === "scroll_depth")
      .map((e) => e.threshold),
    [25, 50, 75, 100],
  );
  b.advance(30000); // first interaction's 30 seconds
  b.advance(90000); // idle
  assert.deepEqual(
    (await b.payloads())
      .filter((e) => e.type === "active_time")
      .map((e) => e.threshold),
    [30],
  );
  b.emit("keydown");
  b.document.visibilityState = "hidden";
  b.emit("visibilitychange");
  b.advance(60000);
  assert.equal(
    (await b.payloads()).filter((e) => e.type === "active_time").length,
    1,
  );
  b.document.visibilityState = "visible";
  b.emit("visibilitychange");
  b.emit("pointermove");
  b.advance(30000);
  assert.deepEqual(
    (await b.payloads())
      .filter((e) => e.type === "active_time")
      .map((e) => e.threshold),
    [30, 60],
  );
  b.navigate("/second");
  b.emit("scroll");
  assert.equal(
    (await b.payloads()).filter((e) => e.type === "scroll_depth").length,
    8,
  );
  b.document.documentElement.scrollHeight = 500;
  b.document.body.scrollHeight = 500;
  b.navigate("/short");
  b.emit("scroll");
  assert.equal(
    (await b.payloads()).filter((e) => e.type === "scroll_depth").length,
    8,
  );
});

test("dynamic blocks need a continuous visible second; HTML5 video stages are deduplicated", async () => {
  const b = await browser();
  const block = b.add("DIV", { "data-analog-view": "Prices" });
  b.intersect(block, 0.5);
  b.advance(600);
  b.intersect(block, 0.4);
  b.advance(600);
  assert.equal(
    (await b.payloads()).filter((e) => e.type === "block_view").length,
    0,
  );
  b.intersect(block, 0.5);
  b.advance(1000);
  b.intersect(block, 1);
  b.advance(1000);
  assert.equal(
    (await b.payloads()).filter((e) => e.type === "block_view").length,
    1,
  );
  const hidden = b.add("DIV", { "data-analog-view": "Hidden" });
  b.intersect(hidden, 1);
  b.document.visibilityState = "hidden";
  b.emit("visibilitychange");
  b.advance(1000);
  assert.equal(
    (await b.payloads()).filter((e) => e.type === "block_view").length,
    1,
  );
  const video = b.add("VIDEO", { "data-analog-video": "Demo" });
  video.emit("play");
  video.emit("play");
  video.currentTime = 50;
  video.emit("timeupdate");
  video.emit("timeupdate");
  video.emit("ended");
  assert.deepEqual(
    (await b.payloads())
      .filter((e) => e.type === "video_progress")
      .map((e) => e.stage),
    ["start", "half", "complete"],
  );
  b.navigate("/second");
  video.emit("play");
  assert.equal(
    (await b.payloads()).filter((e) => e.type === "video_progress").length,
    4,
  );
});

test("automatic clicks cover dynamic controls and internal links without field values", async () => {
  const b = await browser();
  const button = b.add("BUTTON");
  button.textContent = "  Купить   сейчас  ";
  const child = b.add("SPAN");
  child.parent = button;
  b.emit("click", { target: child });
  b.emit("click", {
    target: b.add("DIV", { role: "button", "aria-label": "Menu" }),
  });
  b.emit("click", {
    target: b.add("INPUT", { type: "submit", value: "secret" }),
  });
  b.emit("click", {
    target: b.add("A", { href: "/pricing?secret=1", title: "Тарифы" }),
  });
  b.emit("click", {
    target: b.add("INPUT", { type: "text", value: "secret" }),
  });
  const ignored = b.add("DIV", { "data-analog-ignore": "" });
  button.parent = ignored;
  b.emit("click", { target: child });
  button.parent = null;
  button.attrs["data-analog-event"] = "Custom";
  b.emit("click", { target: child });
  const payloads = await b.payloads();
  assert.deepEqual(
    payloads.slice(1).map((e) => [e.type, e.label]),
    [
      ["click", "Купить сейчас"],
      ["click", "Menu"],
      ["click", "input"],
      ["click", "Тарифы"],
      ["click", "Custom"],
    ],
  );
  assert.doesNotMatch(JSON.stringify(payloads), /secret/);
});

test("link classification, explicit precedence, privacy opt-outs and fetch fallback", async () => {
  const b = await browser(false);
  for (const href of [
    "tel:+123456789",
    "mailto:private@example.org",
    "https://t.me/private?token=secret",
    "https://api.whatsapp.com/send?phone=123",
    "viber://chat?number=123",
    "https://outside.example/a.PDF?secret=1#x",
    "https://outside.example/path?token=secret",
    "https://t.me.evil.example/x",
  ])
    b.emit("click", { target: b.add("A", { href }) });
  const explicit = b.add("A", {
    href: "https://outside.example",
    "data-analog-event": "Custom",
  });
  b.emit("click", { target: explicit });
  const ignored = b.add("A", { href: "tel:123", "data-analog-ignore": "" });
  b.emit("click", { target: ignored });
  const payloads = await b.payloads();
  assert.deepEqual(
    payloads.slice(1).map((e) => e.type),
    [
      "contact_click",
      "contact_click",
      "contact_click",
      "contact_click",
      "contact_click",
      "file_download",
      "outbound_click",
      "outbound_click",
      "click",
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(payloads),
    /123456789|private|secret|phone=|number=/,
  );
  assert.equal(payloads[6].linkUrl, "https://outside.example/a.PDF");
  b.navigator.globalPrivacyControl = true;
  b.emit("click", { target: explicit });
  assert.equal((await b.payloads()).length, payloads.length);
  b.navigator.globalPrivacyControl = false;
  b.navigator.doNotTrack = "1";
  b.emit("click", { target: explicit });
  assert.equal((await b.payloads()).length, payloads.length);
});

test("new metadata validates allowed milestones and strips link secrets", () => {
  assert.deepEqual(
    eventDetails({
      type: "outbound_click",
      linkUrl: "https://example.org/a?token=x#y",
    }),
    { linkUrl: "https://example.org/a" },
  );
  for (const input of [
    { type: "active_time", threshold: 31 },
    { type: "scroll_depth", threshold: "50" },
    { type: "video_progress", stage: "invalid" },
    { type: "contact_click", channel: "other" },
    { type: "outbound_click", linkUrl: "javascript:alert(1)" },
    { type: "file_download", linkUrl: "https://user:pass@example.org/a" },
    { type: "form_start", elementId: "x".repeat(121) },
  ])
    assert.throws(() => eventDetails(input));
});

test("new event templates use common overrides, metadata and localized names", () => {
  const site = {
    id: "site",
    name: "Demo",
    paused: false,
    archived: false,
    origins: [],
    notifyClick: true,
    notifyPageview: true,
    templateDefault:
      "{action_emoji} {action} {threshold} {stage} {channel} {link_url} {element_id}",
    templatePageview: "VIEW",
    templateClick: "CLICK",
  };
  for (const type of newEventTypes) {
    assert.equal(
      eventNotification(site, type),
      ["contact_click", "form_success"].includes(type),
    );
    for (const locale of ["ru", "en"] as const) {
      const result = formatNotification(
        site,
        {
          type,
          elementId: "<form>",
          threshold: 50,
          stage: "half",
          channel: "phone",
          linkUrl: "https://example.org/",
        },
        0,
        locale,
      );
      assert.match(
        result,
        /50 half phone https:\/\/example.org\/ &lt;form&gt;/,
      );
      assert.ok(
        result.includes(
          translator(locale).t("event-" + type.replaceAll("_", "-")),
        ),
      );
    }
  }
  assert.equal(renderTemplate("{threshold}", { threshold: 0 }, 0), "0");
});
