// Owner key: the extension holds only a SHA-256; possession of the secret is
// re-verified on every status computation. Tests use a throwaway key and the
// QA hash override; the real key exists nowhere in this repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const load = (f) => new Function(readFileSync(join(root, f), "utf8"))();

const store = { local: {}, sync: {} };
const area = (name) => ({
  async get(keys) {
    const data = store[name];
    if (keys === null || keys === undefined) return structuredClone(data);
    const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
  },
  async set(obj) { for (const [k, v] of Object.entries(obj)) store[name][k] = structuredClone(v); },
  async remove(keys) { for (const k of [].concat(keys)) delete store[name][k]; }
});
const sent = [];
globalThis.chrome = {
  storage: { local: area("local"), sync: area("sync") },
  runtime: { sendMessage: async (m) => { sent.push(m); return { ok: false }; } }
};
globalThis.EXT_BRAND = { cssPrefix: "mst" };
load("src/config/owner.js");
load("src/pro/gate.js");
load("src/telemetry/telemetry-core.js");
load("src/telemetry/telemetry-sw.js");
const O = globalThis.MST_OWNER;
const G = globalThis.MST_GATE;
const SW = globalThis.MST_TELEMETRY_SW;

const KEY = randomBytes(32).toString("hex"); // throwaway, per run
const HASH = createHash("sha256").update(KEY, "utf8").digest("hex");
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const reset = () => { store.local = {}; store.sync = {}; sent.length = 0; };
const useThrowaway = () => { store.local[O.HASH_OVERRIDE_KEY] = HASH; };

test("shipped hash is a well-formed SHA-256 and no key-like secret is in the module", () => {
  assert.match(O.KEY_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(O.STORAGE_KEY, "mst:ownerKey");
});

test("sha256hex matches node crypto", async () => {
  assert.equal(await O.sha256hex(KEY), HASH);
});

test("correct key unlocks, wrong key does not", async () => {
  reset();
  useThrowaway();
  assert.equal(await O.activate("x".repeat(40)), false);
  assert.equal(store.local[O.STORAGE_KEY], undefined);
  assert.equal(await O.isActive(), false);
  assert.equal(await O.activate(KEY), true);
  assert.equal(store.local[O.STORAGE_KEY], KEY);
  assert.equal(await O.isActive(), true);
  const s = await G.refresh();
  assert.equal(s.pro, true);
  assert.equal(s.paid, true);
  assert.equal(s.owner, true);
  assert.equal(s.source, "owner");
  assert.equal(s.trialActive, false);
  assert.equal(s.trialExpired, false);
  assert.equal(G.isOwner(), true);
});

test("with the real shipped hash the throwaway key does nothing", async () => {
  reset();
  store.local[O.STORAGE_KEY] = KEY; // no hash override
  assert.equal(await O.isActive(), false);
  assert.equal(await O.activate(KEY), false);
  const s = await G.refresh();
  assert.equal(s.owner, undefined);
});

test("owner mode never asks ExtensionPay (no getProStatus message)", async () => {
  reset();
  useThrowaway();
  store.local[O.STORAGE_KEY] = KEY;
  await G.refresh();
  assert.equal(sent.filter((m) => m.type === "getProStatus").length, 0);
});

test("tampered storage does not unlock: boolean flag, the hash itself, junk", async () => {
  for (const planted of [true, "true", 1, HASH, "short", "y".repeat(300), { a: 1 }, null]) {
    reset();
    useThrowaway();
    store.local[O.STORAGE_KEY] = planted;
    assert.equal(await O.isActive(), false, `planted ${String(planted).slice(0, 12)}`);
  }
  reset();
  useThrowaway();
  store.local["mst:owner"] = true;
  store.local["mst:isOwner"] = true;
  store.local["mst:proStatus"] = { pro: true, paid: true, owner: true, fetchedAt: 1 };
  const s = await G.refresh();
  assert.notEqual(s.source, "owner");
  assert.equal(Boolean(s.owner), false);
});

test("removing the key locks again", async () => {
  reset();
  useThrowaway();
  await O.activate(KEY);
  assert.equal((await G.refresh()).owner, true);
  await O.remove();
  assert.equal(await O.isActive(), false);
  assert.equal(Boolean((await G.refresh()).owner), false);
});

test("a key stored then verified against a changed hash stops working (re-verified every time)", async () => {
  reset();
  useThrowaway();
  await O.activate(KEY);
  store.local[O.HASH_OVERRIDE_KEY] = "0".repeat(64);
  assert.equal(await O.isActive(), false);
});

test("matches() rejects non-strings and absurd lengths", async () => {
  for (const bad of [undefined, null, 5, {}, "", "a".repeat(15), "a".repeat(257)]) {
    assert.equal(await O.matches(bad, HASH), false);
  }
});

function fakeTel(owner) {
  const data = {};
  const st = {
    data,
    async get(keys) {
      const list = keys === null ? Object.keys(data) : [].concat(keys);
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(o) { for (const [k, v] of Object.entries(o)) data[k] = structuredClone(v); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; }
  };
  const calls = [];
  const urls = [];
  let n = 0;
  const ownerRef = { on: owner };
  const sw = SW.create({
    storage: st,
    config: { url: "https://t.supabase.co", key: "anon" },
    fetch: async (u, init) => { calls.push({ u, body: init.body }); return { status: 204, text: async () => "" }; },
    now: () => Date.parse("2026-10-30T15:00:00"),
    version: "1.5.2",
    uiLang: () => "es-419",
    ua: () => "Mozilla/5.0 Chrome/141.0.0.0",
    uaPlatform: () => "Windows",
    randomUUID: () => UUID,
    randomId: () => `id${++n}`,
    timers: { set: () => 1, clear: () => {} },
    landingUrl: "https://netiox.netlify.app",
    setUninstallURL: async (u) => urls.push(u),
    getTrialState: async () => ({ state: "paid", pro: true }),
    isOwner: async () => ownerRef.on
  });
  return { sw, st, calls, urls, ownerRef };
}

test("telemetry is silent in owner mode: no events, queue, counters, summary, iid or fetch", async () => {
  const { sw, st, calls, urls } = fakeTel(true);
  await sw.init();
  await sw.onInstalled({ reason: "install" });
  await sw.track("card_seen", { page: "product" });
  await sw.track("paywall_seen", { reason: "teaser", key: "target" });
  await sw.count("cards");
  await sw.count("product", "abcd1234");
  await sw.markPaid();
  const r = await sw.flush();
  assert.equal(calls.length, 0);
  assert.deepEqual(r, { sent: 0 });
  for (const k of ["mst:tq", "mst:iid", "mst:tcounts", "mst:tday", "mst:tflags"]) {
    assert.equal(st.data[k], undefined, k);
  }
  const state = await sw.getState();
  assert.equal(state.enabled, false);
  assert.equal(state.owner, true);
  assert.ok(urls.length > 0);
  for (const u of urls) {
    assert.ok(!u.includes(UUID) && !/[?&]i=/.test(u), "owner uninstall URL carries no install id");
  }
});

test("activating owner mode purges previously collected analytics and the id-bearing survey URL", async () => {
  const { sw, st, calls, urls, ownerRef } = fakeTel(false);
  await sw.onInstalled({ reason: "install" });
  await sw.track("card_seen", { page: "product" });
  assert.ok(st.data["mst:tq"]?.length > 0);
  assert.ok(urls.some((u) => u.includes(UUID)));
  ownerRef.on = true;
  await sw.init();
  assert.equal(st.data["mst:tq"], undefined);
  assert.equal(st.data["mst:iid"], undefined);
  assert.equal(st.data["mst:tcounts"], undefined);
  assert.ok(!urls.at(-1).includes(UUID));
  await sw.flush();
  assert.equal(calls.length, 0);
});

test("key never appears in telemetry rows, counters, or uninstall URLs", async () => {
  reset();
  useThrowaway();
  await O.activate(KEY);
  const { sw, st, calls, urls, ownerRef } = fakeTel(true);
  await sw.track("card_seen", { page: "product" });
  ownerRef.on = false;
  await sw.track("card_seen", { page: "product" });
  await sw.flush();
  const blob = JSON.stringify([st.data, calls, urls]);
  assert.ok(!blob.includes(KEY));
});

test("owner key survives the options Reset (KEEP_LOCAL) and is not a telemetry key", () => {
  const src = readFileSync(join(root, "src/options/options.js"), "utf8");
  assert.match(src, /KEEP_LOCAL = new Set\(\[[\s\S]*MST_OWNER\.STORAGE_KEY/);
  assert.ok(!Object.values(globalThis.MST_TELEMETRY_CORE.KEYS).includes(O.STORAGE_KEY));
});

test("key is stored in storage.local only, never storage.sync", async () => {
  reset();
  useThrowaway();
  await O.activate(KEY);
  assert.deepEqual(store.sync, {});
});

test("build strips the QA hash override line from owner.js in release", () => {
  const src = readFileSync(join(root, "src/config/owner.js"), "utf8");
  const build = readFileSync(join(root, "scripts/build.mjs"), "utf8");
  const line = "hash = stored?.[HASH_OVERRIDE_KEY] || hash;";
  assert.equal(src.split(line).length - 1, 1);
  assert.ok(build.includes(line));
});

// v1.5.2 audit (F/K): keys pasted with surrounding whitespace are accepted
// (stored trimmed); the stored key is hashed once per key/hash pair, not twice
// per status refresh; and the options page has no ?owner= URL path.
test("v1.5.2 owner key: whitespace trimmed, hashed once per key, no URL activation path", async () => {
  reset();
  useThrowaway();
  assert.equal(await O.activate(`  ${KEY}\n`), true);
  assert.equal(store.local[O.STORAGE_KEY], KEY, "stored trimmed");
  assert.equal(await O.isActive(), true);

  // Count digests across two status refreshes with an unchanged key.
  const subtle = globalThis.crypto.subtle;
  const realDigest = subtle.digest;
  let digests = 0;
  Object.defineProperty(subtle, "digest", { configurable: true, writable: true, value: function (...a) { digests++; return realDigest.apply(this, a); } });
  try {
    // A fresh key (the memo already holds KEY from the activation above).
    const KEY2 = randomBytes(32).toString("hex");
    reset();
    store.local[O.HASH_OVERRIDE_KEY] = createHash("sha256").update(KEY2, "utf8").digest("hex");
    store.local[O.STORAGE_KEY] = KEY2;
    assert.equal((await G.refresh()).owner, true);
    assert.equal((await G.refresh()).owner, true);
    assert.equal(digests, 1, "one SHA-256 for two refreshes of the same key");
    // A changed key or hash is re-verified.
    store.local[O.STORAGE_KEY] = KEY2 + "x";
    assert.equal(await O.isActive(), false);
    assert.equal(digests, 2);
    store.local[O.STORAGE_KEY] = KEY2;
    store.local[O.HASH_OVERRIDE_KEY] = "0".repeat(64);
    assert.equal(await O.isActive(), false);
    assert.equal(digests, 3);
    // Removal locks without hashing anything.
    delete store.local[O.STORAGE_KEY];
    assert.equal(await O.isActive(), false);
    assert.equal(digests, 3);
  } finally {
    Object.defineProperty(subtle, "digest", { configurable: true, writable: true, value: realDigest });
  }

  const options = readFileSync(join(root, "src/options/options.js"), "utf8");
  assert.ok(!/params\.(has|get)\("owner"\)|\?owner=/.test(options), "no ?owner= URL activation");
  assert.ok(!options.includes("history.replaceState"), "nothing rewrites the URL");
  assert.ok(options.includes("navigator.clipboard.readText"), "paste helper reads the clipboard on click");
});
