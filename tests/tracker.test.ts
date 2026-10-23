import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { randomUUID } from "node:crypto";

test("browser tracker sends pages, explicit clicks and SPA routes without form values", async () => {
  const code = await readFile(
    new URL("../public/tracker.js", import.meta.url),
    "utf8",
  );
  const events: unknown[] = [];
  const endpoints: string[] = [];
  const listeners: Record<string, (e?: unknown) => void> = {};
  const location = {
    pathname: "/home",
    search: "?utm_source=telegram&token=secret",
  };
  const navigator = {
    doNotTrack: "0",
    sendBeacon: (_url: string, blob: Blob) => {
      endpoints.push(_url);
      events.push(blob);
      return true;
    },
  };
  class Element {
    closest(selector: string) {
      return selector === "[data-analog-event]" ? this : null;
    }
    getAttribute() {
      return "buy-button";
    }
  }
  const context = vm.createContext({
    window: {
      screen: { width: 1920, height: 1080 },
      innerWidth: 1200,
      innerHeight: 800,
    },
    URL,
    URLSearchParams,
    Blob,
    Element,
    location,
    navigator,
    document: {
      currentScript: {
        src: "https://analytics.example.org/tracker.js",
        getAttribute: () => "test-site-id",
      },
      referrer: "",
      addEventListener: (name: string, fn: () => void) => {
        listeners[name] = fn;
      },
    },
    sessionStorage: { getItem: () => "v1", setItem: () => {} },
    history: {
      pushState() {
        location.pathname = "/next";
      },
      replaceState() {},
    },
    addEventListener: (name: string, fn: () => void) => {
      listeners[name] = fn;
    },
  });
  vm.runInContext(code, context);
  listeners.click({ target: new Element() });
  vm.runInContext('history.pushState({}, "", "/next")', context);
  const payloads = await Promise.all(
    (events as Blob[]).map(async (b) => JSON.parse(await b.text())),
  );
  assert.deepEqual(
    payloads.map((e) => e.type),
    ["pageview", "click", "pageview"],
  );
  assert.equal(payloads[1].label, "buy-button");
  assert.equal(
    endpoints[0],
    "https://analytics.example.org/api/track?site_id=test-site-id",
  );
  assert.equal(payloads[2].path, "/next");
  assert.equal(payloads[0].screen.width, 1920);
  assert.equal(payloads[0].viewport.width, 1200);
  assert.deepEqual(payloads[0].campaign, { utm_source: "telegram" });
  assert.doesNotMatch(JSON.stringify(payloads), /secret/);
  navigator.doNotTrack = "1";
  listeners.click({ target: new Element() });
  assert.equal(events.length, 3);
});

test("visitor survives reloads and new tabs, stays site-scoped and falls back without storage", async () => {
  const code = await readFile(
    new URL("../public/tracker.js", import.meta.url),
    "utf8",
  );
  const local = new Map<string, string>(),
    tab = new Map<string, string>();
  let now = Date.now();
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  const storage = (map: Map<string, string>, blocked = false) => ({
    getItem: (key: string) => {
      if (blocked) throw Error("blocked");
      return map.get(key) || null;
    },
    setItem: (key: string, value: string) => {
      if (blocked) throw Error("blocked");
      map.set(key, value);
    },
  });
  const load = async (
    localMap = local,
    tabMap = tab,
    site = "site-a",
    blockLocal = false,
    blockSession = false,
    dnt = false,
  ) => {
    const events: Blob[] = [];
    vm.runInNewContext(code, {
      window: {},
      Date: Clock,
      crypto: { randomUUID },
      URL,
      URLSearchParams,
      Blob,
      navigator: {
        doNotTrack: dnt ? "1" : "0",
        sendBeacon: (_url: string, body: Blob) => {
          events.push(body);
          return true;
        },
      },
      location: { pathname: "/", origin: "https://site.example", search: "" },
      document: {
        currentScript: {
          src: "https://tracker.example/tracker.js",
          getAttribute: () => site,
        },
        referrer: "",
        addEventListener: () => {},
      },
      localStorage: storage(localMap, blockLocal),
      sessionStorage: storage(tabMap, blockSession),
      history: { pushState: () => {}, replaceState: () => {} },
      addEventListener: () => {},
    });
    return events.length ? JSON.parse(await events[0].text()) : undefined;
  };
  const first = await load(),
    reload = await load();
  assert.equal(first.identityMode, "persistent");
  assert.equal(first.visitor, reload.visitor);
  assert.equal(first.session, reload.session);
  const newTab = await load(local, new Map());
  assert.equal(first.visitor, newTab.visitor);
  assert.notEqual(first.session, newTab.session);
  assert.notEqual(first.visitor, (await load(new Map(), new Map())).visitor);
  assert.notEqual(first.visitor, (await load(local, tab, "site-b")).visitor);
  now += 1800001;
  const afterIdle = await load();
  assert.equal(first.visitor, afterIdle.visitor);
  assert.notEqual(first.session, afterIdle.session);
  const sessionTab = new Map<string, string>();
  const fallback = await load(local, sessionTab, "fallback", true);
  assert.equal(fallback.identityMode, "session");
  assert.equal(
    fallback.visitor,
    (await load(local, sessionTab, "fallback", true)).visitor,
  );
  assert.equal(
    (await load(local, new Map(), "memory", true, true)).identityMode,
    "memory",
  );
  const empty = new Map<string, string>();
  assert.equal(
    await load(empty, new Map(), "dnt", false, false, true),
    undefined,
  );
  assert.equal(empty.size, 0);
});
