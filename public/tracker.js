(() => {
  const script = document.currentScript;
  if (!script || window.__analogTelegramTracker) return;
  if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
  window.__analogTelegramTracker = true;
  const trackingUrl = new URL("/api/track", script.src);
  const siteId = script.getAttribute("data-site-id");
  if (siteId) trackingUrl.searchParams.set("site_id", siteId);
  const endpoint = trackingUrl.href;
  let startedAt = Date.now();
  let pagePath = location.pathname;
  const campaign = {};
  const params = new URLSearchParams(location.search || "");
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ]) {
    const value = params.get(key);
    if (value) campaign[key] = value.slice(0, 60);
  }
  const makeId = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const n = Math.floor(Math.random() * 16);
          return (c === "x" ? n : (n & 3) | 8).toString(16);
        });
  const key = `analog-visitor:${siteId || location.origin}`;
  const validId = (value) =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  let visitor = makeId();
  let identityMode = "memory";
  try {
    const stored = localStorage.getItem(key);
    if (validId(stored)) visitor = stored;
    localStorage.setItem(key, visitor);
    if (localStorage.getItem(key) !== visitor)
      throw new Error("Storage unavailable");
    identityMode = "persistent";
  } catch {
    try {
      const stored = sessionStorage.getItem(key);
      if (validId(stored)) visitor = stored;
      sessionStorage.setItem(key, visitor);
      identityMode = "session";
    } catch {
      /* An in-memory ID still groups events on this page. */
    }
  }
  const sessionKey = `${key}:session`;
  let visit = { id: makeId(), lastSeen: Date.now() };
  try {
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) || "null");
    if (
      stored &&
      validId(stored.id) &&
      Number.isFinite(stored.lastSeen) &&
      Date.now() - stored.lastSeen < 1800000
    )
      visit = stored;
  } catch {
    /* Continue with a page-local session. */
  }
  const send = (type, label = "", details = {}) => {
    if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
    if (Date.now() - visit.lastSeen >= 1800000) visit.id = makeId();
    visit.lastSeen = Date.now();
    try {
      sessionStorage.setItem(sessionKey, JSON.stringify(visit));
    } catch {
      /* Optional */
    }
    const data = JSON.stringify({
      type,
      ...details,
      path: pagePath,
      visitor,
      identityMode,
      session: visit.id,
      label,
      referrer: document.referrer,
      title: document.title?.slice(0, 160),
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen: { width: window.screen?.width, height: window.screen?.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
      campaign,
    });
    if (
      !navigator.sendBeacon ||
      !navigator.sendBeacon(endpoint, new Blob([data], { type: "text/plain" }))
    ) {
      fetch(endpoint, {
        method: "POST",
        body: data,
        headers: { "Content-Type": "text/plain" },
        keepalive: true,
      }).catch(() => {});
    }
  };
  send("pageview");
  const ignored = (el) => !!el?.closest("[data-analog-ignore]");
  const clickLabel = (el) =>
    (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.textContent ||
      el.id ||
      el.tagName.toLowerCase()
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  let forms = new Map(),
    videos = new Map(),
    blocks = new Map();
  let seenBlocks = new WeakSet(),
    videoStages = new WeakMap();
  let depths = new Set(),
    times = new Set();
  let activeMs = 0,
    lastTick = Date.now(),
    lastInteraction = 0;
  const name = (el, kind) =>
    (
      el.getAttribute("data-analog-" + kind) ||
      el.id ||
      kind +
        "-" +
        (Array.from(
          document.querySelectorAll(kind === "form" ? "form" : "video"),
        ).indexOf(el) +
          1)
    ).slice(0, 120);
  const formState = (form) => {
    if (!forms.has(form)) forms.set(form, { started: false, success: false });
    return forms.get(form);
  };
  const abandon = () => {
    for (const [form, state] of forms) {
      if (state.started && !state.success && !ignored(form)) {
        const label = name(form, "form");
        send("form_abandon", label, { elementId: label });
        state.started = false;
      }
    }
  };
  document.addEventListener(
    "input",
    (event) => {
      const field = event.target;
      const form = field instanceof Element ? field.closest("form") : null;
      if (!form || ignored(field) || event.isTrusted === false) return;
      const state = formState(form);
      if (!state.started) {
        state.started = true;
        state.success = false;
        const label = name(form, "form");
        send("form_start", label, { elementId: label });
      }
    },
    { capture: true },
  );
  document.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element) || ignored(event.target)) return;
      const explicit = event.target.closest("[data-analog-event]");
      if (explicit) {
        if (!explicit.closest("input,textarea,select,[contenteditable]"))
          send("click", explicit.getAttribute("data-analog-event") || "click");
        return;
      }
      const anchor = event.target.closest("a[href]");
      if (!anchor) {
        const button = event.target.closest(
          'button,[role="button"],input[type="button"],input[type="submit"],input[type="reset"]',
        );
        if (
          button &&
          !event.target.closest("textarea,select,[contenteditable]")
        )
          send("click", clickLabel(button));
        return;
      }
      let url;
      try {
        url = new URL(anchor.href, location.href);
      } catch {
        return;
      }
      const host = url.hostname.toLowerCase();
      const channel =
        url.protocol === "tel:"
          ? "phone"
          : url.protocol === "mailto:"
            ? "email"
            : url.protocol === "tg:" ||
                ["t.me", "telegram.me", "www.t.me", "www.telegram.me"].includes(
                  host,
                )
              ? "telegram"
              : url.protocol === "whatsapp:" ||
                  [
                    "wa.me",
                    "api.whatsapp.com",
                    "web.whatsapp.com",
                    "www.whatsapp.com",
                    "whatsapp.com",
                  ].includes(host)
                ? "whatsapp"
                : url.protocol === "viber:" || host === "invite.viber.com"
                  ? "viber"
                  : null;
      if (channel) {
        send("contact_click", channel, { channel });
        return;
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return;
      const linkUrl = (url.origin + url.pathname).slice(0, 1024);
      if (
        anchor.hasAttribute("download") ||
        /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z)$/i.test(url.pathname)
      ) {
        send("file_download", "", { linkUrl });
      } else if (url.origin !== location.origin)
        send("outbound_click", "", { linkUrl });
      else send("click", clickLabel(anchor));
    },
    { capture: true },
  );
  const scroll = () => {
    const height = Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
    );
    if (height <= window.innerHeight) return;
    const depth = (100 * ((window.scrollY || 0) + window.innerHeight)) / height;
    for (const threshold of [25, 50, 75, 100])
      if (depth >= threshold && !depths.has(threshold)) {
        depths.add(threshold);
        send("scroll_depth", "", { threshold });
      }
  };
  const visible = () => document.visibilityState !== "hidden";
  let wasVisible = visible();
  const tick = () => {
    const now = Date.now();
    if (wasVisible)
      activeMs += Math.max(
        0,
        Math.min(now, lastInteraction + 30000) - lastTick,
      );
    lastTick = now;
    for (const threshold of [30, 60, 120, 300])
      if (activeMs >= threshold * 1000 && !times.has(threshold)) {
        times.add(threshold);
        send("active_time", "", { threshold });
      }
  };
  const interact = () => {
    tick();
    lastInteraction = Date.now();
  };
  for (const event of [
    "pointerdown",
    "pointermove",
    "keydown",
    "touchstart",
    "scroll",
  ])
    document.addEventListener(event, interact, {
      passive: true,
      capture: true,
    });
  addEventListener("scroll", scroll, { passive: true });
  const clearBlockTimers = () => {
    for (const state of blocks.values()) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
    }
  };
  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const state = blocks.get(entry.target);
              if (!state) continue;
              state.ratio = entry.intersectionRatio;
              if (state.timer) clearTimeout(state.timer);
              state.timer = null;
              if (
                state.ratio >= 0.5 &&
                !state.sent &&
                visible() &&
                !ignored(entry.target)
              )
                state.timer = setTimeout(() => {
                  state.timer = null;
                  if (
                    !visible() ||
                    ignored(entry.target) ||
                    !entry.target.isConnected
                  )
                    return;
                  state.sent = true;
                  seenBlocks.add(entry.target);
                  const label =
                    entry.target.getAttribute("data-analog-view") ||
                    entry.target.id ||
                    "block";
                  send("block_view", label.slice(0, 120), {
                    elementId: label.slice(0, 120),
                  });
                }, 1000);
            }
          },
          { threshold: [0, 0.5] },
        )
      : null;
  document.addEventListener("visibilitychange", () => {
    tick();
    wasVisible = visible();
    if (!visible()) clearBlockTimers();
    else
      for (const [el, state] of blocks)
        if (!state.sent) {
          observer?.unobserve(el);
          observer?.observe(el);
        }
  });
  const refresh = () => {
    if (!document.querySelectorAll) return;
    for (const form of document.querySelectorAll("form"))
      if (!ignored(form)) formState(form);
    for (const el of document.querySelectorAll("[data-analog-view]"))
      if (!ignored(el) && !blocks.has(el)) {
        blocks.set(el, {
          sent: seenBlocks.has(el),
          ratio: 0,
          timer: null,
          observed: true,
        });
        observer?.observe(el);
      }
    for (const video of document.querySelectorAll("video"))
      if (!ignored(video) && !videos.has(video)) {
        const stages = videoStages.get(video) || new Set();
        videoStages.set(video, stages);
        const emit = (stage) => {
          if (stages.has(stage) || ignored(video)) return;
          stages.add(stage);
          const label = name(video, "video");
          send("video_progress", label, { elementId: label, stage });
        };
        const handlers = {
          play: () => emit("start"),
          timeupdate: () => {
            if (
              video.currentTime > 0 &&
              Number.isFinite(video.duration) &&
              video.duration > 0 &&
              video.currentTime >= video.duration / 2
            )
              emit("half");
          },
          ended: () => emit("complete"),
        };
        for (const [event, handler] of Object.entries(handlers))
          video.addEventListener(event, handler);
        videos.set(video, handlers);
      }
    for (const [el, state] of blocks) {
      if (ignored(el)) {
        if (state.timer) clearTimeout(state.timer);
        state.timer = null;
        observer?.unobserve(el);
        state.observed = false;
      } else if (!state.observed) {
        observer?.observe(el);
        state.observed = true;
      }
      if (!el.isConnected) {
        if (state.timer) clearTimeout(state.timer);
        observer?.unobserve(el);
        blocks.delete(el);
      }
    }
    for (const [video, handlers] of videos)
      if (!video.isConnected) {
        for (const [event, handler] of Object.entries(handlers))
          video.removeEventListener(event, handler);
        videos.delete(video);
      }
  };
  window.analog = {
    ...window.analog,
    refresh,
    formSuccess(form) {
      if (
        !(form instanceof Element) ||
        form.tagName !== "FORM" ||
        ignored(form)
      )
        return;
      const state = formState(form);
      if (state.success) return;
      state.success = true;
      state.started = false;
      const label = name(form, "form");
      send("form_success", label, { elementId: label });
    },
  };
  refresh();
  if (typeof MutationObserver === "function")
    new MutationObserver(refresh).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-analog-view", "data-analog-ignore"],
    });
  if (typeof setInterval === "function") setInterval(tick, 1000);
  addEventListener("pagehide", () => {
    tick();
    abandon();
    clearBlockTimers();
  });
  const resetPage = () => {
    tick();
    abandon();
    clearBlockTimers();
    observer?.disconnect();
    for (const [video, handlers] of videos)
      for (const [event, handler] of Object.entries(handlers))
        video.removeEventListener(event, handler);
    forms = new Map();
    videos = new Map();
    blocks = new Map();
    seenBlocks = new WeakSet();
    videoStages = new WeakMap();
    depths = new Set();
    times = new Set();
    activeMs = 0;
    lastTick = Date.now();
    lastInteraction = 0;
    startedAt = Date.now();
    pagePath = location.pathname;
    refresh();
  };
  let previous = location.pathname;
  const navigate = () => {
    if (previous !== location.pathname) {
      previous = location.pathname;
      resetPage();
      send("pageview");
    }
  };
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      navigate();
      return result;
    };
  }
  addEventListener("popstate", navigate);
})();
