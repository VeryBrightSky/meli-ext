// Profitability Radar math (pure). Ranking, threshold bucketing, and the
// page-summary counts the search-page Radar renders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// radar.js assigns globalThis.MST_RADAR; eval it in this context.
new Function(readFileSync(join(root, "src/fees/radar.js"), "utf8"))();
const RADAR = globalThis.MST_RADAR;

test("bucketFor: loss / thin / profit around the target", () => {
  assert.equal(RADAR.bucketFor(-0.1, 30), "loss"); // negative margin = sells at a loss
  assert.equal(RADAR.bucketFor(0, 30), "thin"); // breakeven is not a loss, but not a winner
  assert.equal(RADAR.bucketFor(29.99, 30), "thin");
  assert.equal(RADAR.bucketFor(30, 30), "profit"); // clears target exactly → winner
  assert.equal(RADAR.bucketFor(55, 30), "profit");
});

test("evaluate: profit, margin, and bucket from net + acquisition cost", () => {
  // price 827, net 744.30 (worst case), buy cost 60% → 496.20 → profit 248.10,
  // margin 30.00% → exactly clears a 30% target.
  const e = RADAR.evaluate({
    priceMXN: 827,
    netMXN: 744.3,
    acquisitionPct: 60,
    targetMarginPct: 30
  });
  assert.equal(e.acquisitionCostMXN, 496.2);
  assert.equal(e.profitMXN, 248.1);
  assert.equal(e.marginPct, 30);
  assert.equal(e.bucket, "profit");
});

test("evaluate: thin and loss verdicts", () => {
  // price 120, net 102.60, buy cost 72 → profit 30.60, margin 25.5% → thin @30.
  const thin = RADAR.evaluate({ priceMXN: 120, netMXN: 102.6, acquisitionPct: 60, targetMarginPct: 30 });
  assert.equal(thin.profitMXN, 30.6);
  assert.equal(thin.marginPct, 25.5);
  assert.equal(thin.bucket, "thin");
  // same item but the buy cost eats the net → loss.
  const loss = RADAR.evaluate({ priceMXN: 120, netMXN: 102.6, acquisitionPct: 90, targetMarginPct: 30 });
  assert.ok(loss.profitMXN < 0);
  assert.equal(loss.bucket, "loss");
});

test("evaluate: target threshold flips thin → profit", () => {
  const args = { priceMXN: 120, netMXN: 102.6, acquisitionPct: 60 };
  assert.equal(RADAR.evaluate({ ...args, targetMarginPct: 30 }).bucket, "thin");
  assert.equal(RADAR.evaluate({ ...args, targetMarginPct: 25 }).bucket, "profit"); // 25.5 ≥ 25
});

test("evaluate: zero price never divides by zero", () => {
  const e = RADAR.evaluate({ priceMXN: 0, netMXN: 0, acquisitionPct: 60, targetMarginPct: 30 });
  assert.equal(e.marginPct, 0);
  assert.equal(e.bucket, "thin");
});

test("summarize: counts per bucket over a page", () => {
  const evals = [
    { bucket: "profit" },
    { bucket: "profit" },
    { bucket: "thin" },
    { bucket: "loss" },
    { bucket: "loss" },
    { bucket: "loss" }
  ];
  assert.deepEqual(RADAR.summarize(evals), { total: 6, profit: 2, thin: 1, loss: 3 });
});

test("summarize: empty page", () => {
  assert.deepEqual(RADAR.summarize([]), { total: 0, profit: 0, thin: 0, loss: 0 });
});

test("rankByMargin: winners first, stable on ties, non-mutating", () => {
  const input = [
    { id: "a", marginPct: 10 },
    { id: "b", marginPct: 30 },
    { id: "c", marginPct: 30 }, // tie with b → keeps original order
    { id: "d", marginPct: -5 }
  ];
  const ranked = RADAR.rankByMargin(input);
  assert.deepEqual(ranked.map((e) => e.id), ["b", "c", "a", "d"]);
  assert.equal(input[0].id, "a"); // original array untouched
});

test("DEFAULT_TARGET_PCT is a sane sourcing default", () => {
  assert.equal(RADAR.DEFAULT_TARGET_PCT, 30);
});
