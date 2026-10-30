// Anonymous analytics: sanitizer allowlist, queue, batching, opt-out, dormant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const load = (f) => new Function(readFileSync(join(root, f), "utf8"))();
load("src/telemetry/telemetry-core.js");
load("src/telemetry/telemetry-sw.js");
const C = globalThis.MST_TELEMETRY_CORE;
const SW = globalThis.MST_TELEMETRY_SW;

const UUID = "123e4567-e89b-42d3-a456-426614174000";

test("sanitizer accepts every allowlisted event with valid props", () => {
  const good = {
    install: {}, update: { from: "1.4.3" },
    active_day: { days_since_install: 3, trial_state: "trial", pro: true },
    card_seen: { page: "catalog" }, first_cost_entered: {}, first_target_price_used: {},
    first_sweetspot_seen: {}, radar_preview_seen: { n_items: "10-24" },
    paywall_seen: { reason: "teaser", key: "target" },
    checkout_click: { plan: "pro-yearly", from: "expired-banner" },
    checkout_failed: { from: "upsell" }, login_click: { from: "dashboard" },
    paid_detected: {}, trial_expired_seen: {}, share_click: { where: "card" },
    review_ask: { state: "shown" }, welcome_seen: {}, dashboard_open: {}, csv_export: {},
    options_open: {}, reset_clicked: {}, error: { code: "no_anchor" },
    daily_summary: { cards: 1, products: 1, searches: 0, cost_entries: 2, calcs: 3, anchors_missing: 0 }
  };
  assert.deepEqual(Object.keys(good).sort(), [...C.EVENT_NAMES].sort());
  for (const [event, props] of Object.entries(good)) {
    assert.deepEqual(C.sanitizeEvent(event, props), { event, props }, event);
  }
});

test("sanitizer rejects urls, prices, titles, unknown events and oversize values", () => {
  const bad = [
    ["page_view", {}],
    ["card_seen", { page: "https://www.mercadolibre.com.mx/x" }],
    ["card_seen", {}],
    ["card_seen", { page: "Celular Samsung A15 128GB" }],
    ["error", { code: "$827.00" }],
    ["error", { code: "a@b.com" }],
    ["paywall_seen", { reason: "teaser", key: "MLM-123456789" }],
    ["active_day", { days_since_install: 99999, trial_state: "trial", pro: true }],
    ["active_day", { days_since_install: 1.5, trial_state: "trial", pro: true }],
    ["active_day", { days_since_install: "3", trial_state: "trial", pro: true }],
    ["daily_summary", { cards: 10000, products: 0, searches: 0, cost_entries: 0, calcs: 0, anchors_missing: 0 }],
    ["update", { from: "1.4.3-evil" }],
    ["__proto__", {}], ["constructor", {}], [null, {}], [42, {}]
  ];
  for (const [e, p] of bad) assert.equal(C.sanitizeEvent(e, p), null, String(e) + JSON.stringify(p));
  // Unknown extra props are dropped (rebuilt from the spec), never forwarded.
  const r = C.sanitizeEvent("card_seen", { page: "product", price: 827, title: "x", url: "y" });
  assert.deepEqual(r.props, { page: "product" });
  // Arrays / non-objects as props are treated as empty
  assert.equal(C.sanitizeEvent("card_seen", [1]), null);
  assert.deepEqual(C.sanitizeEvent("install", "junk"), { event: "install", props: {} });
});

test("row has only the allowed columns", () => {
  const clean = C.sanitizeEvent("card_seen", { page: "product" });
  const row = C.buildRow({ installId: UUID, extVersion: "1.5.0", lang: "es-419", chrome: 141, platform: "win" }, clean);
  assert.deepEqual(Object.keys(row).sort(), ["chrome_major", "event", "ext_version", "install_id", "lang", "platform", "props"]);
  assert.equal(row.lang, "es");
  assert.equal(C.buildRow({ installId: UUID, extVersion: "x", lang: "", chrome: null, platform: "beos" }, clean).platform, "other");
});

test("platform, chrome major and language are coarse", () => {
  assert.equal(C.platformFrom({ uaPlatform: "Chrome OS" }), "cros");
  assert.equal(C.platformFrom({ uaPlatform: "Windows" }), "win");
  assert.equal(C.platformFrom({ uaPlatform: "macOS" }), "mac");
  assert.equal(C.platformFrom({ uaPlatform: "Linux" }), "linux");
  assert.equal(C.platformFrom({ uaPlatform: "Android" }), "android");
  assert.equal(C.platformFrom({ ua: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/120.0.0.0" }), "cros");
  assert.equal(C.platformFrom({ ua: "Mozilla/5.0 (Linux; Android 13) Chrome/120.0.0.0" }), "android");
  assert.equal(C.platformFrom({ ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }), "mac");
  assert.equal(C.platformFrom({}), "other");
  assert.equal(C.chromeMajor("Mozilla/5.0 Chrome/141.0.7390.54 Safari/537.36"), 141);
  assert.equal(C.chromeMajor("nope"), null);
  assert.equal(C.langFrom("es-419"), "es");
  assert.equal(C.langFrom("EN_us"), "en");
  assert.equal(C.langFrom(""), "und");
});

test("config: https only, loopback http only for the QA override", () => {
  assert.deepEqual(C.normalizeConfig({ url: "https://abc.supabase.co/", key: "k.e.y" }), { url: "https://abc.supabase.co", key: "k.e.y" });
  assert.equal(C.normalizeConfig({ url: "", key: "" }), null);
  assert.equal(C.normalizeConfig({ url: "https://abc.supabase.co", key: "" }), null);
  assert.equal(C.normalizeConfig({ url: "http://abc.supabase.co", key: "k" }), null);
  assert.equal(C.normalizeConfig({ url: "http://127.0.0.1:9999", key: "k" }), null);
  assert.deepEqual(C.normalizeConfig({ url: "http://127.0.0.1:9999", key: "k" }, { allowLoopbackHttp: true }), { url: "http://127.0.0.1:9999", key: "k" });
  assert.equal(C.normalizeConfig({ url: "https://a.co/path", key: "k" }), null);
  assert.equal(C.normalizeConfig({ url: "https://a.co", key: "k k" }), null);
});

test("queue is a ring buffer: max 200 and drops events older than 14 days", () => {
  const now = 1_000_000_000_000;
  let q = [];
  for (let i = 0; i < 250; i++) q = C.pushQueue(q, { _id: String(i), _t: now }, now);
  assert.equal(q.length, 200);
  assert.equal(q[0]._id, "50");
  assert.equal(q.at(-1)._id, "249");
  const old = [{ _id: "old", _t: now - 15 * 86400000 }, { _id: "new", _t: now - 86400000 }, { junk: true }, null];
  assert.deepEqual(C.pruneQueue(old, now).map((x) => x._id), ["new"]);
  assert.equal(C.takeBatch(q).length, 50);
  assert.equal(C.removeIds(q, new Set(["50", "51"])).length, 198);
  assert.deepEqual(Object.keys(C.toWire({ _id: "a", _t: 1, event: "x" })), ["event"]);
});

test("daily summary aggregation props are clamped and products = distinct count", () => {
  const d = C.emptyDay("2026-10-30");
  d.cards = 12; d.calcs = 99999; d.pset = ["a", "b", "c"];
  const p = C.summaryProps(d);
  assert.equal(p.cards, 12);
  assert.equal(p.calcs, 9999);
  assert.equal(p.products, 3);
  assert.ok(C.hasActivity(d));
  assert.ok(!C.hasActivity(C.emptyDay("x")));
  assert.deepEqual(C.sanitizeEvent("daily_summary", p).props, p);
});

test("uninstall url: id only when enabled", () => {
  const on = C.buildUninstallUrl("https://netiox.netlify.app/", { installId: UUID, extVersion: "1.5.0", days: 4, cost: true, paywall: false, enabled: true });
  assert.equal(on, `https://netiox.netlify.app/adios.html?i=${UUID}&v=1.5.0&d=4&c=1&p=0`);
  const off = C.buildUninstallUrl("https://netiox.netlify.app", { installId: UUID, extVersion: "1.5.0", days: 4, cost: true, paywall: true, enabled: false });
  assert.equal(off, "https://netiox.netlify.app/adios.html?v=1.5.0");
  assert.ok(on.length < 1000);
});

test("bucketing helpers agree between core and the client", () => {
  const store = globalThis.chrome;
  globalThis.chrome = {};
  load("src/telemetry/telemetry-client.js");
  globalThis.chrome = store;
  for (const n of [0, 1, 9, 10, 24, 25, 49, 50, 500, NaN]) {
    assert.equal(globalThis.MST_TRACK.bucket(n), C.bucketItems(n), String(n));
  }
});

// ---- service-worker half with fakes -------------------------------------------

function fakeStorage(init = {}) {
  const data = { ...init };
  return {
    data,
    async get(keys) {
      if (keys === null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = structuredClone(v); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; }
  };
}
function makeSW({ config = { url: "https://t.supabase.co", key: "anon" }, storage = fakeStorage(), status = 204, nowRef = { t: Date.parse("2026-10-30T15:00:00") }, trial = { state: "trial", pro: true } } = {}) {
  const calls = [];
  let n = 0;
  const uninstall = [];
  const sw = SW.create({
    storage,
    config,
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return { status, text: async () => "boom" };
    },
    now: () => nowRef.t,
    version: "1.5.0",
    uiLang: () => "es-419",
    ua: () => "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0.0.0",
    uaPlatform: () => "Windows",
    randomUUID: () => UUID,
    randomId: () => `id${++n}`,
    timers: { set: () => 1, clear: () => {} },
    landingUrl: "https://netiox.netlify.app",
    setUninstallURL: async (u) => uninstall.push(u),
    getTrialState: async () => trial
  });
  return { sw, calls, storage, nowRef, uninstall };
}

test("dormant: empty config never calls fetch and queues nothing, local counters still count", async () => {
  const { sw, calls, storage, uninstall } = makeSW({ config: { url: "", key: "" } });
  await sw.onInstalled({ reason: "install" });
  await sw.track("card_seen", { page: "product" });
  await sw.count("cards");
  const r = await sw.flush();
  assert.equal(calls.length, 0);
  assert.deepEqual(r, { sent: 0 });
  assert.equal(storage.data["mst:tq"], undefined);
  assert.equal(storage.data["mst:iid"], undefined, "no install id is minted while dormant");
  assert.equal(storage.data["mst:tcounts"].card_seen, 1);
  assert.equal(uninstall.length, 0, "no uninstall survey while dormant");
  const st = await sw.getState();
  assert.equal(st.configured, false);
  assert.equal(st.enabled, false);
});

test("shipped config is empty (dormant by default) and no source calls fetch outside extensionpay/telemetry", () => {
  load("src/config/telemetry-config.js");
  assert.deepEqual({ ...globalThis.MST_TELEMETRY_CONFIG }, { url: "", key: "" });
  const hits = [];
  for (const f of ["src/background/service-worker.js", "src/content/card.js", "src/content/content.js", "src/content/quickview.js", "src/content/upsell.js", "src/content/page-data.js", "src/content/history.js", "src/dashboard/dashboard.js", "src/options/options.js", "src/onboarding/welcome.js", "src/pro/gate.js", "src/telemetry/telemetry-client.js", "src/fees/fee-source.js"]) {
    const s = readFileSync(join(root, f), "utf8");
    if (/\bfetch\s*\(|XMLHttpRequest|sendBeacon|new WebSocket|EventSource/.test(s.replace(/\/\/.*$/gm, ""))) hits.push(f);
  }
  // The only allowed fetch call site is the worker's injected wrapper.
  assert.deepEqual(hits, ["src/background/service-worker.js"]);
  const sw = readFileSync(join(root, "src/background/service-worker.js"), "utf8");
  assert.equal((sw.match(/globalThis\.fetch\(/g) ?? []).length, 1);
});

test("install id: random UUID v4 format, created once, kept in storage", async () => {
  const { sw, storage } = makeSW();
  await sw.onInstalled({ reason: "install" });
  assert.ok(C.isUuid(storage.data["mst:iid"]));
  const before = storage.data["mst:iid"];
  await sw.track("options_open", {});
  assert.equal(storage.data["mst:iid"], before);
  // the real generator yields v4 uuids
  assert.match(globalThis.crypto.randomUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("enabled: install + active_day queue, flush POSTs one batch with correct headers", async () => {
  const { sw, calls, storage } = makeSW();
  await sw.onInstalled({ reason: "install" });
  await sw.track("card_seen", { page: "product" });
  const res = await sw.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://t.supabase.co/rest/v1/events");
  const h = calls[0].init.headers;
  assert.equal(h.apikey, "anon");
  assert.equal(h.Authorization, "Bearer anon");
  assert.equal(h["Content-Type"], "application/json");
  assert.equal(h.Prefer, "return=minimal");
  assert.equal(calls[0].init.keepalive, false);
  const events = calls[0].body.map((r) => r.event);
  assert.deepEqual(events, ["install", "active_day", "card_seen"]);
  for (const row of calls[0].body) {
    assert.deepEqual(Object.keys(row).sort(), ["chrome_major", "event", "ext_version", "install_id", "lang", "platform", "props"]);
    assert.equal(row.platform, "win");
    assert.equal(row.chrome_major, 141);
  }
  assert.equal(res.sent, 3);
  assert.deepEqual(storage.data["mst:tq"], []);
  assert.equal(storage.data["mst:tlast"].status, 204);
  assert.equal(storage.data["mst:tlast"].error, null);
});

test("once-ever events and per-day caps", async () => {
  const { sw, storage, nowRef } = makeSW();
  for (let i = 0; i < 3; i++) await sw.track("card_seen", { page: "product" });
  for (let i = 0; i < 4; i++) await sw.track("paywall_seen", { reason: "teaser", key: "target" });
  await sw.track("paywall_seen", { reason: "alert", key: "loss" });
  for (let i = 0; i < 9; i++) await sw.track("error", { code: "no_anchor" });
  const names = () => storage.data["mst:tq"].map((r) => r.event);
  assert.equal(names().filter((e) => e === "card_seen").length, 1);
  assert.equal(names().filter((e) => e === "paywall_seen").length, 2);
  assert.equal(names().filter((e) => e === "error").length, 5);
  nowRef.t += 86400000; // next local day: caps reset, once-ever stays
  await sw.track("error", { code: "no_anchor" });
  await sw.track("card_seen", { page: "product" });
  assert.equal(names().filter((e) => e === "error").length, 6);
  assert.equal(names().filter((e) => e === "card_seen").length, 1);
  assert.equal(names().filter((e) => e === "active_day").length, 2);
});

test("daily_summary is rolled up on the first activity of the next day", async () => {
  const { sw, storage, nowRef } = makeSW();
  await sw.count("cards"); await sw.count("cards");
  await sw.count("product", "ab12"); await sw.count("product", "ab12"); await sw.count("product", "cd34");
  await sw.count("calcs"); await sw.count("anchors_missing");
  assert.equal((await sw.count("bogus")).ok, false);
  assert.equal((await sw.count("product", "https://evil")).ok, true); // ignored hash
  assert.equal(storage.data["mst:tq"].filter((r) => r.event === "daily_summary").length, 0);
  nowRef.t += 86400000;
  await sw.track("options_open", {});
  const sum = storage.data["mst:tq"].find((r) => r.event === "daily_summary");
  assert.deepEqual(sum.props, { cards: 2, products: 2, searches: 0, cost_entries: 0, calcs: 1, anchors_missing: 1 });
});

test("expired trial emits trial_expired_seen once; paid emits paid_detected once", async () => {
  const a = makeSW({ trial: { state: "expired", pro: false } });
  await a.sw.track("options_open", {});
  a.nowRef.t += 86400000;
  await a.sw.track("options_open", {});
  const ev = a.storage.data["mst:tq"].map((r) => r.event);
  assert.equal(ev.filter((e) => e === "trial_expired_seen").length, 1);
  const b = makeSW({ trial: { state: "paid", pro: true } });
  await b.sw.track("options_open", {});
  await b.sw.markPaid();
  assert.equal(b.storage.data["mst:tq"].filter((r) => r.event === "paid_detected").length, 1);
});

test("batching: 50 rows per request; failures keep the queue and record the error", async () => {
  const s = fakeStorage({ "mst:tq": Array.from({ length: 120 }, (_, i) => ({ _id: `q${i}`, _t: Date.parse("2026-10-30T14:00:00"), install_id: UUID, event: "options_open", props: {}, ext_version: "1.5.0", lang: "es", chrome_major: 141, platform: "win" })) });
  const ok = makeSW({ storage: s });
  await ok.sw.flush();
  assert.deepEqual(ok.calls.map((c) => c.body.length), [50, 50, 20]);
  assert.equal(s.data["mst:tq"].length, 0);

  const s2 = fakeStorage({ "mst:tq": [{ _id: "a", _t: Date.parse("2026-10-30T14:00:00"), install_id: UUID, event: "options_open", props: {}, ext_version: "1.5.0", lang: "es", chrome_major: 141, platform: "win" }] });
  const bad = makeSW({ storage: s2, status: 503 });
  await bad.sw.flush();
  assert.equal(s2.data["mst:tq"].length, 1, "5xx keeps the queue");
  assert.equal(s2.data["mst:tlast"].status, 503);
  assert.match(s2.data["mst:tlast"].error, /http 503/);
  const poison = makeSW({ storage: s2, status: 400 });
  await poison.sw.flush();
  assert.equal(s2.data["mst:tq"].length, 0, "400 drops the rejected batch so it cannot block the queue");
  assert.match(s2.data["mst:tlast"].error, /dropped/);
});

test("network error is recorded, not thrown", async () => {
  const storage = fakeStorage({ "mst:tq": [{ _id: "a", _t: Date.parse("2026-10-30T14:00:00"), install_id: UUID, event: "options_open", props: {}, ext_version: "1.5.0", lang: "es", chrome_major: 1, platform: "win" }] });
  const sw = SW.create({ storage, config: { url: "https://t.co", key: "k" }, fetch: async () => { throw new TypeError("Failed to fetch"); }, now: () => Date.parse("2026-10-30T15:00:00"), version: "1.5.0", randomUUID: () => UUID, randomId: () => "x", timers: { set: () => 1, clear: () => {} } });
  await sw.flush();
  assert.equal(storage.data["mst:tlast"].status, 0);
  assert.equal(storage.data["mst:tlast"].error, "Failed to fetch");
  assert.equal(storage.data["mst:tq"].length, 1);
});

test("flush when the queue reaches 20", async () => {
  const { sw, calls, storage } = makeSW();
  await sw.track("card_seen", { page: "product" });
  assert.equal(calls.length, 0, "below 20 waits for the debounce");
  storage.data["mst:tq"] = Array.from({ length: 19 }, (_, i) => ({ _id: `f${i}`, _t: Date.parse("2026-10-30T14:30:00"), install_id: UUID, event: "options_open", props: {}, ext_version: "1.5.0", lang: "es", chrome_major: 1, platform: "win" }));
  await sw.track("welcome_seen", {});
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.length >= 1, true, "queue >= 20 flushes immediately");
});

test("opt-out clears the queue and stops all sends; opt-in resumes", async () => {
  const { sw, calls, storage } = makeSW();
  await sw.onInstalled({ reason: "install" });
  await sw.track("card_seen", { page: "product" });
  assert.ok(storage.data["mst:tq"].length > 0);
  const off = await sw.setEnabled(false);
  assert.equal(off.enabled, false);
  assert.deepEqual(storage.data["mst:tq"], []);
  assert.equal(storage.data["mst:telemetry"], false);
  await sw.track("first_cost_entered", {});
  await sw.count("cards");
  const r = await sw.flush();
  assert.equal(calls.length, 0);
  assert.equal(r.sent, 0);
  assert.deepEqual(storage.data["mst:tq"], []);
  assert.equal((await sw.getState()).enabled, false);
  await sw.setEnabled(true);
  await sw.track("options_open", {});
  assert.ok(storage.data["mst:tq"].length > 0);
});

test("uninstall survey url set when configured; opted-out url has no install id", async () => {
  const { sw, uninstall } = makeSW();
  await sw.onInstalled({ reason: "install" });
  await sw.track("first_cost_entered", {});
  assert.ok(uninstall.at(-1).includes(`i=${UUID}`));
  assert.ok(uninstall.at(-1).includes("c=1"));
  await sw.setEnabled(false);
  assert.equal(uninstall.at(-1), "https://netiox.netlify.app/adios.html?v=1.5.0");
});

test("update from an older version backfills first_cost_entered for existing sellers", async () => {
  const storage = fakeStorage({ "mst:cost:MLM1": 250 });
  const { sw } = makeSW({ storage });
  await sw.onInstalled({ reason: "update", previousVersion: "1.4.3" });
  const ev = storage.data["mst:tq"].map((r) => r.event);
  assert.deepEqual(ev, ["update", "first_cost_entered"]);
});

test("rejected events never reach the queue", async () => {
  const { sw, storage } = makeSW();
  const r = await sw.track("card_seen", { page: "https://www.mercadolibre.com.mx/MLM-1" });
  assert.equal(r.ok, false);
  assert.equal(storage.data["mst:tq"], undefined);
});

test("release build strips the analytics QA override (and the line exists to strip)", () => {
  const s = readFileSync(join(root, "src/telemetry/telemetry-sw.js"), "utf8");
  assert.ok(s.includes("override = stored[K.override] ?? null;"));
});

test("enable-telemetry: key validation and landing page config injection", async () => {
  const { validate, applyAdiosConfig } = await import("../scripts/enable-telemetry.mjs");
  const jwt = (role) => `h.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.sig-sig-sig-sig`;
  assert.deepEqual(validate("https://abcd.supabase.co/", jwt("anon")), { url: "https://abcd.supabase.co", key: jwt("anon") });
  assert.throws(() => validate("http://abcd.supabase.co", jwt("anon")));
  assert.throws(() => validate("https://abcd.supabase.co", jwt("service_role")), /role|service_role/);
  assert.throws(() => validate("https://abcd.supabase.co", "short"));
  const html = readFileSync(join(root, "landing/adios.html"), "utf8");
  const out = applyAdiosConfig(html, "https://abcd.supabase.co", "k".repeat(30));
  assert.ok(out.includes('"url":"https://abcd.supabase.co"'));
  assert.ok(!out.includes('{ url: "", key: "" }'));
  assert.throws(() => applyAdiosConfig("<html></html>", "u", "k"));
});

test("version 1.5.1 is consistent across branding, package and manifest", () => {
  new Function(readFileSync(join(root, "src/config/branding.js"), "utf8"))();
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const man = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  assert.equal(globalThis.EXT_BRAND.version, "1.5.1");
  assert.equal(pkg.version, "1.5.1");
  assert.equal(man.version, "1.5.1");
  assert.deepEqual(man.permissions, ["storage"]);
  assert.deepEqual(man.host_permissions, ["https://extensionpay.com/*"]);
});

test("landing base is the real site and the options debug line shows the full install id", () => {
  new Function(readFileSync(join(root, "src/config/branding.js"), "utf8"))();
  assert.equal(globalThis.EXT_BRAND.landingUrl, "https://netiox.netlify.app");
  assert.ok(readFileSync(join(root, "src/options/options.js"), "utf8").includes("install id ${d.iid ?? \"-\"}"));
  const b = readFileSync(join(root, "scripts/build.mjs"), "utf8");
  assert.ok(b.includes("-telemetry.zip") && b.includes('join(root, "release"'), "keyed zip goes to release/ only");
});
