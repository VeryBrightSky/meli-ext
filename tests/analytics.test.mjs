// Private analytics tooling: stats helpers, diagnosis rules, report text,
// single-source inlining, SQL/extension allowlist agreement, landing survey.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "../tools/analytics/lib.mjs";
import { buildPage } from "../tools/analytics/sync-lib.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(root, p), "utf8");
new Function(read("src/telemetry/telemetry-core.js"))();

test("wilson interval matches known values and stays inside [0,1]", () => {
  const w = L.wilson(50, 100);
  assert.ok(Math.abs(w.lo - 0.4038) < 0.001 && Math.abs(w.hi - 0.5962) < 0.001, JSON.stringify(w));
  const z = L.wilson(0, 10);
  assert.equal(z.lo, 0);
  assert.ok(Math.abs(z.hi - 0.2775) < 0.002);
  const all = L.wilson(10, 10);
  assert.equal(all.hi, 1);
  assert.equal(L.wilson(1, 0), null);
  assert.equal(L.wilson(5, 3), null);
  assert.equal(L.rateText(1, 0), "n/a");
  assert.match(L.rateText(50, 100), /^50% \(95% CI 40% to 60%\)$/);
});

test("funnelRows: step conversion, drop, anomalies", () => {
  const f = { installed: 100, active: 80, card_seen: 60, cost_entered: 30, target_price_used: 40, paywall_seen: 10, checkout_click: 2, paid_detected: 1 };
  const rows = L.funnelRows(f);
  assert.equal(rows[1].stepRate.p, 0.8);
  assert.ok(Math.abs(rows[3].drop - 0.5) < 1e-9);
  assert.equal(rows[4].anomaly, true); // target (40) > cost (30)
  assert.equal(rows[4].stepRate, null);
  assert.equal(rows[0].prev, null);
});

const base = () => L.normalizeReport({
  funnel: { installed: 200, active: 190, card_seen: 100, cost_entered: 30, target_price_used: 20, paywall_seen: 25, checkout_click: 5, paid_detected: 1 },
  lang: [{ k: "es", n: 100 }, { k: "en", n: 100 }],
  platform: [{ k: "win", n: 120 }, { k: "cros", n: 80 }],
  trial_state: [{ k: "trial", n: 50 }],
  diag: { expired: 10, expired_no_cost: 8, cost_no_paywall: 15, paywall_no_checkout: 24, checkout_no_paid: 4, checkout_failed_installs: 2, checkout_failed_events: 3 },
  summary: { cards: 80, anchors_missing: 20 },
  errors: [{ k: "no_anchor", n: 9, installs: 5 }]
});

test("diagnose fires the expected rules with the numbers behind them", () => {
  const ids = L.diagnose(base()).map((f) => f.id);
  for (const id of ["non_es", "chromebooks", "no_card", "anchors", "card_no_cost", "cost_no_paywall", "paywall_no_checkout", "checkout_failed", "checkout_no_paid", "expired_no_engage", "error_no_anchor"]) {
    assert.ok(ids.includes(id), `missing ${id} in ${ids}`);
  }
  assert.ok(!ids.includes("low_sample"));
  const nc = L.diagnose(base()).find((f) => f.id === "no_card");
  assert.match(nc.numbers, /100 of 200/);
});

test("diagnose: healthy and tiny datasets", () => {
  const healthy = L.normalizeReport({ funnel: { installed: 300, active: 290, card_seen: 280, cost_entered: 200, target_price_used: 150, paywall_seen: 60, checkout_click: 30, paid_detected: 20 }, lang: [{ k: "es", n: 300 }], platform: [{ k: "win", n: 300 }], diag: { paywall_no_checkout: 30, checkout_no_paid: 10, cost_no_paywall: 10 }, summary: { cards: 500 } });
  assert.deepEqual(L.diagnose(healthy).map((f) => f.id), ["clean"]);
  const tiny = L.normalizeReport({ funnel: { installed: 12, active: 10, card_seen: 5 } });
  assert.equal(L.diagnose(tiny)[0].id, "low_sample");
  assert.equal(L.diagnose(L.normalizeReport({}))[0].id, "no_data");
  assert.equal(L.isSmallSample(99), true);
  assert.equal(L.isSmallSample(100), false);
});

test("normalizeReport survives garbage", () => {
  for (const bad of [null, undefined, 5, "x", [], { funnel: "x", lang: 3, errors: [null] }]) {
    const r = L.normalizeReport(bad);
    assert.equal(r.funnel.installed, 0);
    assert.doesNotThrow(() => L.reportText(r));
    assert.doesNotThrow(() => L.diagnose(r));
  }
});

test("reportText: all numbers, flags sample data, never contains secrets", () => {
  const t = L.reportText(L.normalizeReport(L.demoReport()));
  assert.match(t, /SAMPLE DATA, NOT REAL/);
  assert.match(t, /FUNNEL/);
  assert.match(t, /RETENTION/);
  assert.match(t, /DIAGNOSIS/);
  assert.ok(!/secret|apikey|Bearer|supabase\.co|eyJ/i.test(t));
  const real = L.reportText(base());
  assert.ok(!/SAMPLE/.test(real));
  assert.match(real, /Installed: 200/);
  assert.match(L.reportText(base(), { cohort: "new" }), /new installs only/);
});

test("demo data is clearly labeled", () => {
  assert.equal(L.demoReport().sample, true);
  assert.equal(L.normalizeReport(L.demoReport()).sample, true);
  assert.match(read("tools/analytics/index.html"), /SAMPLE DATA,<br \/>NOT REAL/);
});

test("index.html inlines lib.mjs exactly (one source of truth)", () => {
  const page = buildPage(read("tools/analytics/index.template.html"), read("tools/analytics/lib.mjs"));
  assert.equal(read("tools/analytics/index.html"), page, "run: node tools/analytics/sync-lib.mjs");
  assert.ok(!/^export /m.test(page));
});

test("dashboard page makes no requests except to the user-entered URL", () => {
  const html = read("tools/analytics/index.html");
  assert.ok(!/<script[^>]+src=/i.test(html));
  assert.ok(!/<link[^>]+href=/i.test(html));
  assert.equal((html.match(/fetch\(/g) ?? []).length, 1);
  assert.ok(html.includes("base + \"/rest/v1/rpc/netio_report\""));
  assert.ok(!/innerHTML/.test(html), "data must never be rendered as HTML");
});

test("supabase.sql event allowlist equals the extension allowlist plus uninstall_reason", () => {
  const sql = read("tools/analytics/supabase.sql");
  const block = /ev_event_allowlist check \(event in \(([\s\S]*?)\)\)/.exec(sql)[1];
  const names = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, [...globalThis.MST_TELEMETRY_CORE.EVENT_NAMES, "uninstall_reason"].sort());
  assert.match(sql, /revoke all on public\.events from anon, authenticated/);
  assert.match(sql, /grant insert \(install_id, event, props, ext_version, lang, chrome_major, platform\)/);
  assert.match(sql, /pg_column_size\(props\) < 1000/);
  assert.match(sql, /revoke all on function public\.netio_report\(text, interval\) from public/);
  assert.match(sql, /400 days/);
  assert.ok(!/grant select/i.test(sql));
});

test("adios survey: note cleaner strips urls and emails, caps at 140", () => {
  const html = read("landing/adios.html");
  const src = /\/\/ <cleanNote>([\s\S]*?)\/\/ <\/cleanNote>/.exec(html)[1];
  const cleanNote = new Function(`${src}; return cleanNote;`)();
  assert.equal(cleanNote("visita https://evil.com/x ahora"), "visita ahora");
  assert.equal(cleanNote("escribe a juan@gmail.com ya"), "escribe a ya");
  assert.equal(cleanNote("mira mitienda.mx/oferta ok"), "mira ok");
  assert.equal(cleanNote("www.algo.com"), "");
  assert.equal(cleanNote("a".repeat(300)).length, 140);
  assert.equal(cleanNote(null), "");
  assert.ok(!/<script[^>]+src=|google-analytics|gtag|document\.cookie/i.test(html));
  assert.ok(html.includes('window.NETIO_TELEMETRY = { url: "", key: "" };'));
  for (const k of ["no_card", "numbers", "price", "not_mx", "confused", "other"]) assert.ok(html.includes(k));
  assert.ok(!/—/.test(html), "no em dashes");
});
