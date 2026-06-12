// Unit tests for the fee table, fee source, and calculator. These are classic
// scripts (globalThis-based), so load them the same way the build does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const file of [
  "src/fees/fee-table.js",
  "src/fees/calculator.js",
  "src/fees/fee-source.js",
  "src/content/format.js"
]) {
  new Function(readFileSync(join(root, file), "utf8"))();
}
const SOURCE = globalThis.MST_FEE_SOURCE;
const CALC = globalThis.MST_CALC;
const UI = globalThis.MST_UI;

test("tech category quote is exact and matches the table", () => {
  const q = SOURCE.getQuote({ priceMXN: 827, listingTypeId: "classic", categoryGroupId: "tech" });
  assert.equal(q.pctMin, 10);
  assert.equal(q.pctMax, 10);
  assert.equal(q.fixedCostMXN, 0); // 827 >= 299
});

test("unknown category falls back to official ranges", () => {
  const q = SOURCE.getQuote({ priceMXN: 827, listingTypeId: "classic", categoryGroupId: null });
  assert.equal(q.pctMin, 8);
  assert.equal(q.pctMax, 16);
  const p = SOURCE.getQuote({ priceMXN: 827, listingTypeId: "premium", categoryGroupId: null });
  assert.equal(p.pctMin, 12.5);
  assert.equal(p.pctMax, 20.5);
});

test("fixed cost tiers and boundaries", () => {
  const fc = (price) =>
    SOURCE.getQuote({ priceMXN: price, listingTypeId: "classic", categoryGroupId: "tech" }).fixedCostMXN;
  assert.equal(fc(35), 25);
  assert.equal(fc(98.99), 25);
  assert.equal(fc(99), 30);
  assert.equal(fc(149.99), 30);
  assert.equal(fc(150), 37);
  assert.equal(fc(298.99), 37);
  assert.equal(fc(299), 0);
  assert.equal(fc(300), 0);
});

test("breakdown math: tech classic at $827", () => {
  const q = SOURCE.getQuote({ priceMXN: 827, listingTypeId: "classic", categoryGroupId: "tech" });
  const b = CALC.computeBreakdown(q, { priceMXN: 827, shippingCostMXN: 0, productCostMXN: 0 });
  assert.equal(b.commissionMinMXN, 82.7);
  assert.equal(b.commissionMaxMXN, 82.7);
  assert.equal(b.netMinMXN, 744.3);
  assert.equal(b.netMaxMXN, 744.3);
  assert.equal(b.isExactRate, true);
});

test("breakdown math: range rates produce swapped net bounds", () => {
  const q = SOURCE.getQuote({ priceMXN: 1000, listingTypeId: "classic", categoryGroupId: null });
  const b = CALC.computeBreakdown(q, { priceMXN: 1000, shippingCostMXN: 0, productCostMXN: 0 });
  assert.equal(b.commissionMinMXN, 80); // 8%
  assert.equal(b.commissionMaxMXN, 160); // 16%
  assert.equal(b.netMinMXN, 840); // worst case = max commission
  assert.equal(b.netMaxMXN, 920);
  assert.ok(b.netMinMXN <= b.netMaxMXN);
});

test("profit margin uses net bounds and shipping", () => {
  const q = SOURCE.getQuote({ priceMXN: 827, listingTypeId: "classic", categoryGroupId: "tech" });
  const b = CALC.computeBreakdown(q, { priceMXN: 827, shippingCostMXN: 50, productCostMXN: 400 });
  assert.equal(b.netMinMXN, 694.3); // 827 - 82.7 - 50
  assert.equal(b.profitMinMXN, 294.3);
  assert.equal(b.marginMinPct, 35.59);
});

test("low-price item pays commission AND fixed cost", () => {
  const q = SOURCE.getQuote({ priceMXN: 120, listingTypeId: "classic", categoryGroupId: "tech" });
  const b = CALC.computeBreakdown(q, { priceMXN: 120, shippingCostMXN: 0, productCostMXN: 0 });
  assert.equal(b.fixedCostMXN, 30);
  assert.equal(b.netMinMXN, 120 - 12 - 30);
});

test("category matching from breadcrumbs (accents stripped)", () => {
  assert.equal(SOURCE.matchCategory(["Celulares y Teléfonos", "Smartphones"]), "tech");
  assert.equal(SOURCE.matchCategory(["Computación"]), "tech");
  assert.equal(SOURCE.matchCategory(["Herramientas", "Taladros"]), "tools");
  assert.equal(SOURCE.matchCategory(["Hogar y Muebles"]), "home-general");
  assert.equal(SOURCE.matchCategory(["Categoría Desconocida XYZ"]), null);
  assert.equal(SOURCE.matchCategory([]), null);
});

test("parseMoney handles Mexican separator styles", () => {
  const p = CALC.parseMoney;
  assert.equal(p("827"), 827);
  assert.equal(p("827.50"), 827.5);
  assert.equal(p("1,234.56"), 1234.56);
  assert.equal(p("1.234,56"), 1234.56); // dot-thousands, comma-decimal
  assert.equal(p("4,99"), 4.99); // lone comma + 2 digits = decimal
  assert.equal(p("1,234"), 1234); // lone comma + 3 digits = thousands
  assert.equal(p("1,234,567"), 1234567);
  assert.equal(p("$ 450"), 450);
  assert.equal(p("$1,199.00"), 1199);
  assert.equal(p(""), 0);
  assert.equal(p("abc"), 0);
  assert.equal(p("-50"), 0); // negative clamped
  assert.equal(p(4.9922), 4.99); // sanitizes stored junk
  assert.equal(p(null), 0);
  assert.equal(p(undefined), 0);
});

test("charge formatting keeps minus sign on both range bounds", () => {
  assert.equal(UI.fmtCharge(2.88, 5.77), "−$2.88 – −$5.77");
  assert.equal(UI.fmtCharge(82.7), "−$82.70");
  assert.equal(UI.fmtCharge(82.7, 82.7), "−$82.70");
  assert.equal(UI.fmtRange(744.3, 744.3), "$744.30");
  assert.equal(UI.fmtRange(840, 920), "$840.00 – $920.00");
  assert.equal(UI.fmtMoney(1234567.89), "$1,234,567.89");
});

test("solveTargetPrice: target margin accounts for commission and shipping", () => {
  // tech classic 10%: P·(1 − 0.10 − 0.20) = 400 + 50 → P = 642.86
  const p = CALC.solveTargetPrice({
    costMXN: 400,
    shippingMXN: 50,
    marginPct: 20,
    ratePct: 10,
    fixedCostFn: SOURCE.getFixedCost
  });
  assert.equal(p, 642.86);
  // verify: profit at that price ≈ 20% of price
  const profit = p - p * 0.1 - 50 - 400;
  assert.ok(Math.abs(profit / p - 0.2) < 0.001);
});

test("solveTargetPrice: breakeven (margin 0)", () => {
  const p = CALC.solveTargetPrice({
    costMXN: 400,
    shippingMXN: 50,
    marginPct: 0,
    ratePct: 10,
    fixedCostFn: SOURCE.getFixedCost
  });
  assert.equal(p, 500); // 450 / 0.9
});

test("solveTargetPrice: fixed-cost tier pulled in for low prices", () => {
  // cost 30, rate 10%: naive P = 33.33 (<99 → +$25 fixed) → (30+25)/0.9 = 61.11
  const p = CALC.solveTargetPrice({
    costMXN: 30,
    shippingMXN: 0,
    marginPct: 0,
    ratePct: 10,
    fixedCostFn: SOURCE.getFixedCost
  });
  assert.equal(p, 61.11);
});

test("solveTargetPrice: unreachable margin returns null", () => {
  assert.equal(
    CALC.solveTargetPrice({
      costMXN: 100,
      shippingMXN: 0,
      marginPct: 85,
      ratePct: 16,
      fixedCostFn: SOURCE.getFixedCost
    }),
    null
  );
  assert.equal(
    CALC.solveTargetPrice({
      costMXN: 0,
      shippingMXN: 0,
      marginPct: 20,
      ratePct: 10,
      fixedCostFn: SOURCE.getFixedCost
    }),
    null
  );
});

test("effective rate combines commission and fixed charge as % of price", () => {
  // $120, tech classic 10% + $30 fixed → (12 + 30) / 120 = 35%
  const q = SOURCE.getQuote({ priceMXN: 120, listingTypeId: "classic", categoryGroupId: "tech" });
  const b = CALC.computeBreakdown(q, { priceMXN: 120, shippingCostMXN: 0, productCostMXN: 0 });
  assert.equal(b.effectiveRateMinPct, 35);
  assert.equal(b.effectiveRateMaxPct, 35);
  // $827 no fixed charge → exactly the commission rate
  const q2 = SOURCE.getQuote({ priceMXN: 827, listingTypeId: "classic", categoryGroupId: "tech" });
  const b2 = CALC.computeBreakdown(q2, { priceMXN: 827, shippingCostMXN: 0, productCostMXN: 0 });
  assert.equal(b2.effectiveRateMinPct, 10);
  // unknown category → range
  const q3 = SOURCE.getQuote({ priceMXN: 1000, listingTypeId: "classic", categoryGroupId: null });
  const b3 = CALC.computeBreakdown(q3, { priceMXN: 1000, shippingCostMXN: 0, productCostMXN: 0 });
  assert.equal(b3.effectiveRateMinPct, 8);
  assert.equal(b3.effectiveRateMaxPct, 16);
});

test("exact display numbers: breakeven $500.00, target $642.86 (10% classic, cost 400, ship 50)", () => {
  const args = { costMXN: 400, shippingMXN: 50, ratePct: 10, fixedCostFn: SOURCE.getFixedCost };
  const breakeven = CALC.solveTargetPrice({ ...args, marginPct: 0 });
  assert.equal(breakeven, 500);
  assert.equal(UI.fmtMoney(breakeven), "$500.00");
  const target = CALC.solveTargetPrice({ ...args, marginPct: 20 });
  assert.equal(target, 642.86);
  assert.equal(UI.fmtMoney(target), "$642.86");
});

test("exact tier-crossing: solution migrates $25 tier -> $30 tier", () => {
  // cost 70 @ 10%: naive 77.78 (+$25 tier) -> 105.56 crosses into the $30
  // tier -> converges at (70+30)/0.9 = 111.11
  const p = CALC.solveTargetPrice({
    costMXN: 70,
    shippingMXN: 0,
    marginPct: 0,
    ratePct: 10,
    fixedCostFn: SOURCE.getFixedCost
  });
  assert.equal(p, 111.11);
  assert.equal(UI.fmtMoney(p), "$111.11");
});

test("exact unreachable margin: 16% rate + 85% margin -> null (UI shows 'Margen inalcanzable')", () => {
  const p = CALC.solveTargetPrice({
    costMXN: 100,
    shippingMXN: 0,
    marginPct: 85,
    ratePct: 16,
    fixedCostFn: SOURCE.getFixedCost
  });
  assert.equal(p, null);
});

test("sweet spot: $280 @ 10% → raise to $299, net up exactly $54.10", () => {
  // net(280) = 252 − 37 = 215; net(299) = 269.10 − 0 = 269.10
  const spot = CALC.findSweetSpot({
    priceMXN: 280,
    ratePct: 10,
    fixedCostFn: SOURCE.getFixedCost,
    thresholds: SOURCE.getFixedCostThresholds()
  });
  assert.deepEqual(spot, { targetPriceMXN: 299, netGainMXN: 54.1 });
});

test("sweet spot: worst-case 16% rate at $280 still gains $52.96", () => {
  // (299−280)·0.84 + 37 = 15.96 + 37 = 52.96
  const spot = CALC.findSweetSpot({
    priceMXN: 280,
    ratePct: 16,
    fixedCostFn: SOURCE.getFixedCost,
    thresholds: SOURCE.getFixedCostThresholds()
  });
  assert.deepEqual(spot, { targetPriceMXN: 299, netGainMXN: 52.96 });
});

test("sweet spot: tier INCREASES never nudge ($95→$99 loses, $145→$150 loses)", () => {
  const args = { ratePct: 10, fixedCostFn: SOURCE.getFixedCost, thresholds: SOURCE.getFixedCostThresholds() };
  // net(95)=60.50 vs net(99)=59.10 → −1.40, and $150/$299 outside +20%
  assert.equal(CALC.findSweetSpot({ ...args, priceMXN: 95 }), null);
  // net(145)=100.50 vs net(150)=98.00 → −2.50
  assert.equal(CALC.findSweetSpot({ ...args, priceMXN: 145 }), null);
});

test("sweet spot: no threshold nearby → null ($310 and $827)", () => {
  const args = { ratePct: 10, fixedCostFn: SOURCE.getFixedCost, thresholds: SOURCE.getFixedCostThresholds() };
  assert.equal(CALC.findSweetSpot({ ...args, priceMXN: 310 }), null);
  assert.equal(CALC.findSweetSpot({ ...args, priceMXN: 827 }), null);
});

test("sweet spot: $260 still reaches $299 within +20% window", () => {
  // net(260)=234−37=197; net(299)=269.10 → gain 72.10; limit 312 ≥ 299
  const spot = CALC.findSweetSpot({
    priceMXN: 260,
    ratePct: 10,
    fixedCostFn: SOURCE.getFixedCost,
    thresholds: SOURCE.getFixedCostThresholds()
  });
  assert.deepEqual(spot, { targetPriceMXN: 299, netGainMXN: 72.1 });
});

test("fixed-cost thresholds come from the table", () => {
  assert.deepEqual(SOURCE.getFixedCostThresholds(), [99, 150, 299]);
});

test("getFixedCost exposed on the fee source", () => {
  assert.equal(SOURCE.getFixedCost(50), 25);
  assert.equal(SOURCE.getFixedCost(299), 0);
});

test("locales: en keys exactly match es_419 keys", () => {
  const es = JSON.parse(readFileSync(join(root, "_locales/es_419/messages.json"), "utf8"));
  const en = JSON.parse(readFileSync(join(root, "_locales/en/messages.json"), "utf8"));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  for (const key of Object.keys(es)) {
    assert.ok(es[key].message.length > 0, `es_419 ${key} empty`);
    assert.ok(en[key].message.length > 0, `en ${key} empty`);
  }
});

test("fee table meta carries source citations and retrieval date", () => {
  assert.ok(SOURCE.meta.version.startsWith("2026-"));
  assert.equal(SOURCE.meta.retrievedAt, "2026-06-12");
  assert.ok(SOURCE.meta.sources.length >= 3);
  assert.ok(SOURCE.meta.sources.some((s) => s.confidence === "official"));
});
