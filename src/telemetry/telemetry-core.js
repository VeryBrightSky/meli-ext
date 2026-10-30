// Anonymous funnel analytics: PURE logic (no chrome.*, no fetch, no storage).
// Loaded by the service worker and unit-tested in Node. Everything that could
// ever leave the browser is decided here: a strict allowlist of event names
// and per-event props (enums, bounded numbers and booleans ONLY). Free text,
// URLs, prices, costs, titles, listing ids, category names and emails have no
// way through: unknown events, unknown props and out-of-range values are
// dropped, never "cleaned".
"use strict";

globalThis.MST_TELEMETRY_CORE = (() => {
  // --- storage keys (all in storage.local; kept across "reset saved data") ----
  const KEYS = Object.freeze({
    iid: "mst:iid",
    enabled: "mst:telemetry",
    noticeSeen: "mst:telemetryNoticeSeen",
    queue: "mst:tq",
    last: "mst:tlast",
    flags: "mst:tflags",
    day: "mst:tday",
    counts: "mst:tcounts",
    override: "mst:telemetryOverride"
  });

  // --- limits ----------------------------------------------------------------
  const MAX_QUEUE = 200;
  const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  const BATCH_SIZE = 50;
  const FLUSH_AT = 20;
  const FLUSH_DEBOUNCE_MS = 30 * 1000;

  // --- allowlist ---------------------------------------------------------------
  const REASONS = ["teaser", "alert", "upsell", "radar", "dashboard", "expired-banner"];
  const UPSELL_KEYS = [
    "generic", "target", "sweetspot", "breakeven", "loss", "msi", "radar",
    "dashboard", "whatif", "compare", "expired"
  ];
  const ERROR_CODES = [
    "ctx_invalid", "parse_fail", "no_anchor", "no_price", "fee_unavailable",
    "render_fail", "route_fail", "quickview_fail", "storage_fail", "uncaught"
  ];
  const TRIAL_STATES = ["trial", "expired", "paid", "free"];
  const N_ITEMS = ["0", "1-9", "10-24", "25-49", "50+"];

  // Prop validators. Each returns the clean value or undefined (= reject).
  const enumOf = (list) => (v) => (typeof v === "string" && list.includes(v) ? v : undefined);
  const intIn = (min, max) => (v) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
  const bool = (v) => (typeof v === "boolean" ? v : undefined);
  const version = (v) =>
    typeof v === "string" && v.length <= 12 && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) ? v : undefined;

  const COUNT = intIn(0, 9999);
  const NONE = Object.freeze({});

  const SCHEMA = Object.freeze({
    install: NONE,
    update: { from: version },
    active_day: { days_since_install: intIn(0, 3650), trial_state: enumOf(TRIAL_STATES), pro: bool },
    card_seen: { page: enumOf(["product", "catalog"]) },
    first_cost_entered: NONE,
    first_target_price_used: NONE,
    first_sweetspot_seen: NONE,
    radar_preview_seen: { n_items: enumOf(N_ITEMS) },
    paywall_seen: { reason: enumOf(REASONS), key: enumOf(UPSELL_KEYS) },
    checkout_click: {
      plan: enumOf(["pro-monthly", "pro-yearly", "plans"]),
      from: enumOf([...REASONS, "trial-banner"])
    },
    checkout_failed: { from: enumOf([...REASONS, "trial-banner"]) },
    login_click: { from: enumOf([...REASONS, "trial-banner", "options"]) },
    paid_detected: NONE,
    trial_expired_seen: NONE,
    share_click: { where: enumOf(["card", "welcome", "dashboard"]) },
    review_ask: { state: enumOf(["shown", "clicked", "dismissed"]) },
    welcome_seen: NONE,
    dashboard_open: NONE,
    csv_export: NONE,
    options_open: NONE,
    reset_clicked: NONE,
    error: { code: enumOf(ERROR_CODES) },
    daily_summary: {
      cards: COUNT, products: COUNT, searches: COUNT,
      cost_entries: COUNT, calcs: COUNT, anchors_missing: COUNT
    }
  });
  const EVENT_NAMES = Object.freeze(Object.keys(SCHEMA));

  // Events that fire at most once per install, ever.
  const ONCE_EVER = new Set([
    "install", "card_seen", "first_cost_entered", "first_target_price_used",
    "first_sweetspot_seen", "paid_detected", "trial_expired_seen"
  ]);
  // Per local calendar day: { max, per: [prop names that split the budget] }.
  const DAILY_POLICY = Object.freeze({
    paywall_seen: { max: 1, per: ["reason", "key"] },
    radar_preview_seen: { max: 1, per: [] },
    checkout_click: { max: 10, per: [] },
    checkout_failed: { max: 5, per: [] },
    login_click: { max: 5, per: [] },
    share_click: { max: 5, per: [] },
    review_ask: { max: 1, per: ["state"] },
    welcome_seen: { max: 2, per: [] },
    dashboard_open: { max: 5, per: [] },
    csv_export: { max: 5, per: [] },
    options_open: { max: 3, per: [] },
    reset_clicked: { max: 3, per: [] },
    error: { max: 5, per: ["code"] }
  });
  const DEFAULT_DAILY_MAX = 20;
  // Lifecycle events are produced by the service worker itself and are not
  // "the seller used the product" (they must not trigger active_day).
  const PASSIVE = new Set(["install", "update", "paid_detected", "trial_expired_seen", "daily_summary", "active_day"]);

  // Counters aggregated locally and shipped as one daily_summary row.
  const SUMMARY_KEYS = Object.freeze(["cards", "products", "searches", "cost_entries", "calcs", "anchors_missing"]);

  // Defense in depth: even a value that passed its validator must not look
  // like a URL, a host, an email or money.
  const FORBIDDEN = /https?:|www\.|mercadolibre|mercadopago|@|\$|mlm-?\d/i;

  // Validate and rebuild: returns { event, props } with ONLY allowlisted keys
  // and valid values, or null when the event must be dropped.
  function sanitizeEvent(event, props) {
    if (typeof event !== "string" || !Object.hasOwn(SCHEMA, event)) return null;
    const spec = SCHEMA[event];
    const input = props && typeof props === "object" && !Array.isArray(props) ? props : {};
    const out = {};
    for (const name of Object.keys(spec)) {
      if (!Object.hasOwn(input, name)) return null; // every declared prop is required
      const v = spec[name](input[name]);
      if (v === undefined) return null;
      out[name] = v;
    }
    if (FORBIDDEN.test(JSON.stringify(out))) return null;
    return { event, props: out };
  }

  // --- environment (coarse, no fingerprinting) -----------------------------------
  function platformFrom({ uaPlatform, ua } = {}) {
    const p = String(uaPlatform ?? "").toLowerCase();
    const u = String(ua ?? "");
    if (p === "chrome os" || p === "chromeos" || /CrOS/.test(u)) return "cros";
    if (p === "windows" || (!p && /Windows/.test(u))) return "win";
    if (p === "android" || (!p && /Android/.test(u))) return "android";
    if (p === "macos" || (!p && /Macintosh|Mac OS X/.test(u))) return "mac";
    if (p === "linux" || (!p && /Linux|X11/.test(u))) return "linux";
    return "other";
  }
  function chromeMajor(ua) {
    const m = /Chrom(?:e|ium)\/(\d{1,3})\./.exec(String(ua ?? ""));
    const n = m ? Number(m[1]) : NaN;
    return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
  }
  function langFrom(ui) {
    const m = /^([a-z]{2,3})(?:[-_]|$)/i.exec(String(ui ?? ""));
    return m ? m[1].toLowerCase() : "und";
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

  // The wire row. Server fills ts. NEVER carries anything but these columns.
  function buildRow({ installId, extVersion, lang, chrome, platform }, clean) {
    return {
      install_id: installId,
      event: clean.event,
      props: clean.props,
      ext_version: version(extVersion) ?? "0.0.0",
      lang: langFrom(lang),
      chrome_major: chrome,
      platform: ["cros", "win", "mac", "linux", "android", "other"].includes(platform) ? platform : "other"
    };
  }

  // --- config ----------------------------------------------------------------
  // https only (the QA override may also use http on loopback for the mock).
  function normalizeConfig(cfg, { allowLoopbackHttp = false } = {}) {
    if (!cfg || typeof cfg !== "object") return null;
    let url = typeof cfg.url === "string" ? cfg.url.trim().replace(/\/+$/, "") : "";
    const key = typeof cfg.key === "string" ? cfg.key.trim() : "";
    if (!url || !key) return null;
    const https = /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i.test(url);
    const loop = allowLoopbackHttp && /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(url);
    if (!https && !loop) return null;
    if (/[\s"'<>]/.test(key)) return null;
    return { url, key };
  }

  // --- time ------------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, "0");
  // Local calendar day, so "once per day" matches the seller's day.
  function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function daysSinceInstall(installedAtMs, nowMs) {
    if (!Number.isFinite(installedAtMs) || installedAtMs <= 0) return 0;
    return Math.max(0, Math.min(3650, Math.floor((nowMs - installedAtMs) / 86400000)));
  }
  function bucketItems(n) {
    const x = Number(n);
    if (!(x >= 1)) return "0";
    if (x < 10) return "1-9";
    if (x < 25) return "10-24";
    if (x < 50) return "25-49";
    return "50+";
  }
  // gate status -> the four trial states the report knows.
  function trialStateOf(status) {
    if (!status) return "free";
    if (status.paid) return "paid";
    if (status.trialActive) return "trial";
    if (status.trialExpired) return "expired";
    return "free";
  }

  // --- queue (ring buffer) -------------------------------------------------------
  // Items carry _id (for removal after a send) and _t (client time, for aging
  // out only; neither is ever sent).
  function pruneQueue(queue, nowMs, { max = MAX_QUEUE, maxAgeMs = MAX_AGE_MS } = {}) {
    let q = Array.isArray(queue) ? queue.filter((it) => it && typeof it === "object" && Number.isFinite(it._t)) : [];
    q = q.filter((it) => nowMs - it._t <= maxAgeMs);
    if (q.length > max) q = q.slice(q.length - max);
    return q;
  }
  function pushQueue(queue, item, nowMs, opts) {
    return pruneQueue([...(Array.isArray(queue) ? queue : []), item], nowMs, opts);
  }
  const takeBatch = (queue, n = BATCH_SIZE) => queue.slice(0, n);
  const removeIds = (queue, ids) => queue.filter((it) => !ids.has(it._id));
  const toWire = (item) => {
    const { _id, _t, ...row } = item;
    return row;
  };

  // --- daily counters ------------------------------------------------------------
  function emptyDay(day) {
    return { day, caps: {}, pset: [], cards: 0, searches: 0, cost_entries: 0, calcs: 0, anchors_missing: 0 };
  }
  const clamp9999 = (n) => Math.max(0, Math.min(9999, Math.trunc(Number(n) || 0)));
  function summaryProps(day) {
    const out = {};
    for (const k of SUMMARY_KEYS) {
      out[k] = clamp9999(k === "products" ? (Array.isArray(day.pset) ? day.pset.length : 0) : day[k]);
    }
    return out;
  }
  const hasActivity = (day) => !!day && SUMMARY_KEYS.some((k) => summaryProps(day)[k] > 0);
  // Budget key for the per-day caps (e.g. "paywall_seen:teaser:target").
  function capKey(clean) {
    const policy = DAILY_POLICY[clean.event];
    const parts = [clean.event, ...(policy ? policy.per.map((p) => clean.props[p]) : [])];
    return parts.join(":");
  }
  const capMax = (event) => (DAILY_POLICY[event] ? DAILY_POLICY[event].max : DEFAULT_DAILY_MAX);

  // --- uninstall survey URL --------------------------------------------------------
  function buildUninstallUrl(landingUrl, { installId, extVersion, days, cost, paywall, enabled }) {
    const base = String(landingUrl ?? "").replace(/\/+$/, "") + "/adios.html";
    const q = new URLSearchParams();
    if (enabled && isUuid(installId)) q.set("i", installId);
    q.set("v", version(extVersion) ?? "0.0.0");
    if (enabled) {
      q.set("d", String(Math.max(0, Math.min(3650, Math.trunc(days) || 0))));
      q.set("c", cost ? "1" : "0");
      q.set("p", paywall ? "1" : "0");
    }
    return `${base}?${q.toString()}`;
  }

  return Object.freeze({
    KEYS, MAX_QUEUE, MAX_AGE_MS, BATCH_SIZE, FLUSH_AT, FLUSH_DEBOUNCE_MS,
    REASONS, UPSELL_KEYS, ERROR_CODES, TRIAL_STATES, N_ITEMS, SCHEMA, EVENT_NAMES,
    ONCE_EVER, DAILY_POLICY, PASSIVE, SUMMARY_KEYS, DEFAULT_DAILY_MAX,
    sanitizeEvent, platformFrom, chromeMajor, langFrom, isUuid, buildRow,
    normalizeConfig, dayKey, daysSinceInstall, bucketItems, trialStateOf,
    pruneQueue, pushQueue, takeBatch, removeIds, toWire,
    emptyDay, summaryProps, hasActivity, capKey, capMax, buildUninstallUrl
  });
})();
