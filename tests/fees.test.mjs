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
  "src/fees/shipping-table.js",
  "src/fees/calculator.js",
  "src/fees/fee-source.js",
  "src/content/format.js",
  "src/pro/gate.js"
]) {
  new Function(readFileSync(join(root, file), "utf8"))();
}
const SOURCE = globalThis.MST_FEE_SOURCE;
const CALC = globalThis.MST_CALC;
const UI = globalThis.MST_UI;
const GATE = globalThis.MST_GATE;
const SHIPPING = globalThis.MST_SHIPPING;

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

test("fixed cost tiers and boundaries (Apr 2026: 99/199/299)", () => {
  const fc = (price) =>
    SOURCE.getQuote({ priceMXN: price, listingTypeId: "classic", categoryGroupId: "tech" }).fixedCostMXN;
  assert.equal(fc(35), 25);
  assert.equal(fc(98.99), 25);
  assert.equal(fc(99), 30);
  assert.equal(fc(198.99), 30);
  assert.equal(fc(199), 37);
  assert.equal(fc(298.99), 37);
  assert.equal(fc(299), 0);
  assert.equal(fc(300), 0);
});

test("fixed cost applies ONLY to Clásica — Premium exempt at any price", () => {
  const fcPremium = (price) =>
    SOURCE.getQuote({ priceMXN: price, listingTypeId: "premium", categoryGroupId: "tech" }).fixedCostMXN;
  assert.equal(fcPremium(50), 0);
  assert.equal(fcPremium(120), 0);
  assert.equal(fcPremium(250), 0);
  // breakdown flows through: $120 premium has commission only
  const q = SOURCE.getQuote({ priceMXN: 120, listingTypeId: "premium", categoryGroupId: "tech" });
  const b = CALC.computeBreakdown(q, { priceMXN: 120, shippingCostMXN: 0, productCostMXN: 0 });
  assert.equal(b.fixedCostMXN, 0);
  assert.equal(b.netMaxMXN, 105); // 120 − 12.5%
  // fixedCostFnFor mirrors it
  assert.equal(SOURCE.fixedCostFnFor({ listingTypeId: "premium" })(120), 0);
  assert.equal(SOURCE.fixedCostFnFor({ listingTypeId: "classic" })(120), 30);
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

test("sweet spot: losing or out-of-window tier crossings do not nudge", () => {
  const args = { ratePct: 10, fixedCostFn: SOURCE.getFixedCost, thresholds: SOURCE.getFixedCostThresholds() };
  // net(95)=60.50 vs net(99)=59.10 → −1.40; $199/$299 outside +20%
  assert.equal(CALC.findSweetSpot({ ...args, priceMXN: 95 }), null);
  // $150: no threshold within +20% (limit 180 < 199)
  assert.equal(CALC.findSweetSpot({ ...args, priceMXN: 150 }), null);
});

test("sweet spot: $190 → $199 marginally wins (+$1.10 despite higher tier)", () => {
  // (199−190)·0.9 − (37−30) = 8.10 − 7 = 1.10
  const spot = CALC.findSweetSpot({
    priceMXN: 190,
    ratePct: 10,
    fixedCostFn: SOURCE.getFixedCost,
    thresholds: SOURCE.getFixedCostThresholds()
  });
  assert.deepEqual(spot, { targetPriceMXN: 199, netGainMXN: 1.1 });
});

test("sweet spot: Full mode uses the service-cost discontinuities", () => {
  // 1kg item @ $280 (tier3: $39 service) → at $299 service cost vanishes:
  // gain = 19·0.9 + 39 = 56.10
  const fn = SOURCE.fixedCostFnFor({ listingTypeId: "classic", fullWeightKg: 1 });
  const spot = CALC.findSweetSpot({
    priceMXN: 280,
    ratePct: 10,
    fixedCostFn: fn,
    thresholds: SOURCE.getFixedCostThresholds()
  });
  assert.deepEqual(spot, { targetPriceMXN: 299, netGainMXN: 56.1 });
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
  assert.deepEqual(SOURCE.getFixedCostThresholds(), [99, 199, 299]);
});

test("Full service cost: weight × price-tier matrix lookups", () => {
  const f = SHIPPING.fullServiceCost;
  assert.equal(f(0.3, 50), 25); // ≤0.3 kg, tier 1
  assert.equal(f(0.3, 99), 32); // price boundary → tier 2
  assert.equal(f(0.3, 250), 35); // tier 3
  assert.equal(f(0.5, 50), 28.5);
  assert.equal(f(1, 150), 38);
  assert.equal(f(60, 50), 183); // heaviest bracket
  assert.equal(f(61, 50), null); // above the table
  assert.equal(f(1, 299), null); // ≥ $299: no service cost
  assert.equal(f(0, 50), null);
});

test("withholdings: IVA 8% + ISR 2.5% of the VAT-exclusive base", () => {
  // price 116 → base exactly 100
  const w = CALC.computeWithholdings(116, SOURCE.withholdings);
  assert.deepEqual(w, { baseMXN: 100, ivaMXN: 8, isrMXN: 2.5, totalMXN: 10.5 });
  // the $827 test listing
  const w2 = CALC.computeWithholdings(827, SOURCE.withholdings);
  assert.equal(w2.baseMXN, 712.93);
  assert.equal(w2.ivaMXN, 57.03);
  assert.equal(w2.isrMXN, 17.82);
  assert.equal(w2.totalMXN, 74.85);
  assert.equal(SOURCE.withholdings.since, "2026-01-01");
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
  // chrome.i18n: "$" + digit is a substitution placeholder; literal prices
  // must be escaped "$$4.99" or they silently render as ".99".
  for (const [loc, data] of [["es_419", es], ["en", en]]) {
    for (const [key, val] of Object.entries(data)) {
      const unescapedLiteral = /(?<!\$)\$\d{2,}|(?<!\$)\$\d\.\d/.exec(val.message);
      assert.equal(
        unescapedLiteral,
        null,
        `${loc}/${key}: unescaped literal dollar "${unescapedLiteral?.[0]}" — use $$`
      );
    }
  }
});

test("gate: never-paid user is not pro", () => {
  const now = Date.UTC(2026, 5, 12);
  assert.deepEqual(GATE.computeProStatus({ paid: false }, now), {
    pro: false,
    paid: false,
    trialActive: false
  });
  assert.equal(GATE.computeProStatus(null, now).pro, false);
});

test("gate: active trial is pro, expired trial is not", () => {
  const now = Date.UTC(2026, 5, 12);
  const active = GATE.computeProStatus(
    { paid: false, trialStartedAt: new Date(now - 3 * 24 * 3600 * 1000).toISOString() },
    now
  );
  assert.deepEqual(active, { pro: true, paid: false, trialActive: true });
  const expired = GATE.computeProStatus(
    { paid: false, trialStartedAt: new Date(now - 8 * 24 * 3600 * 1000).toISOString() },
    now
  );
  assert.deepEqual(expired, { pro: false, paid: false, trialActive: false });
  // boundary: exactly 7 days → expired
  const edge = GATE.computeProStatus(
    { paid: false, trialStartedAt: new Date(now - GATE.TRIAL_MS).toISOString() },
    now
  );
  assert.equal(edge.pro, false);
});

test("gate: paid user is pro regardless of trial", () => {
  const now = Date.UTC(2026, 5, 12);
  assert.equal(GATE.computeProStatus({ paid: true }, now).pro, true);
  assert.equal(
    GATE.computeProStatus(
      { paid: true, trialStartedAt: new Date(now - 30 * 24 * 3600 * 1000).toISOString() },
      now
    ).pro,
    true
  );
});

test("gate: ExtPay v3.1 multi-plan — paid via either plan is Pro", () => {
  const now = Date.UTC(2026, 5, 12);
  for (const nickname of ["pro-monthly", "pro-yearly"]) {
    const user = {
      paid: true,
      paidAt: new Date(now - 1000).toISOString(),
      plan: { nickname, unitAmountCents: nickname === "pro-monthly" ? 8900 : 69900, currency: "mxn" },
      subscriptionStatus: "active"
    };
    assert.equal(GATE.computeProStatus(user, now).pro, true, nickname);
  }
  // canceled-but-not-paid v3.1 shape stays locked
  assert.equal(
    GATE.computeProStatus({ paid: false, plan: null, subscriptionStatus: "canceled" }, now).pro,
    false
  );
});

test("gate: unreachable ExtPay fails OPEN for cached-entitled, CLOSED otherwise", () => {
  // fresh wins over cache
  assert.equal(
    GATE.resolveStatus({ pro: false, paid: false, trialActive: false }, { pro: true, paid: true }).pro,
    false
  );
  // unreachable + cached entitled → pro (fail open for paying users)
  const open = GATE.resolveStatus(null, { pro: true, paid: true, trialActive: false });
  assert.equal(open.pro, true);
  assert.equal(open.source, "cache");
  // unreachable + cached not-entitled → closed
  assert.equal(GATE.resolveStatus(null, { pro: false, paid: false }).pro, false);
  // unreachable + no cache → closed
  const closed = GATE.resolveStatus(null, null);
  assert.equal(closed.pro, false);
  assert.equal(closed.source, "default");
});

test("shipping table: bracket lookup boundaries", () => {
  assert.equal(SHIPPING.costForWeight(0.2), 52.4);
  assert.equal(SHIPPING.costForWeight(0.3), 52.4); // inclusive upper bound
  assert.equal(SHIPPING.costForWeight(0.31), 56.0);
  assert.equal(SHIPPING.costForWeight(1), 59.6);
  assert.equal(SHIPPING.costForWeight(10), 129.2);
  assert.equal(SHIPPING.costForWeight(30), 225.2);
  assert.equal(SHIPPING.costForWeight(31), null); // above the table
  assert.equal(SHIPPING.costForWeight(0), null);
  assert.equal(SHIPPING.costForWeight(-1), null);
});

test("shipping table meta carries source citation and date", () => {
  assert.equal(SHIPPING.meta.retrievedAt, "2026-06-12");
  assert.ok(SHIPPING.meta.sources.length >= 1);
  assert.equal(SHIPPING.brackets.length, 13);
});

test("fee table meta carries source citations and retrieval date", () => {
  assert.ok(SOURCE.meta.version.startsWith("2026-"));
  assert.equal(SOURCE.meta.retrievedAt, "2026-06-12");
  assert.ok(SOURCE.meta.sources.length >= 3);
  assert.ok(SOURCE.meta.sources.some((s) => s.confidence === "official"));
});
