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
  "src/pro/gate.js",
  "src/dashboard/dashboard-model.js"
]) {
  new Function(readFileSync(join(root, file), "utf8"))();
}
const SOURCE = globalThis.MST_FEE_SOURCE;
const CALC = globalThis.MST_CALC;
const UI = globalThis.MST_UI;
const GATE = globalThis.MST_GATE;
const SHIPPING = globalThis.MST_SHIPPING;
const DASH = globalThis.MST_DASH;

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

test("fixed cost tiers and boundaries (official MX bands: 99/149/299)", () => {
  const fc = (price) =>
    SOURCE.getQuote({ priceMXN: price, listingTypeId: "classic", categoryGroupId: "tech" }).fixedCostMXN;
  assert.equal(fc(35), 25);
  assert.equal(fc(98.99), 25);
  assert.equal(fc(99), 30);
  assert.equal(fc(148.99), 30);
  assert.equal(fc(149), 37);
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
  // net(95)=60.50 vs net(99)=59.10 → −1.40; $149/$299 outside +20%
  assert.equal(CALC.findSweetSpot({ ...args, priceMXN: 95 }), null);
  // $150: next threshold is $299, beyond +20% (limit 180 < 299)
  assert.equal(CALC.findSweetSpot({ ...args, priceMXN: 150 }), null);
});

test("sweet spot: a step UP in the fixed charge is never a nudge ($140 → $149, Premium)", () => {
  // Crossing $149 raises the fixed charge $30→$37. The +$1.10 that used to be
  // reported was just the higher price, not a fee win — a seller can charge
  // more at any price. Only steps where the fixed charge DROPS count.
  assert.equal(
    CALC.findSweetSpot({ priceMXN: 140, ratePct: 10, fixedCostFn: SOURCE.getFixedCost, thresholds: SOURCE.getFixedCostThresholds() }),
    null
  );
  // Premium has no fixed charge at all → never a sweet spot.
  const premium = SOURCE.fixedCostFnFor({ listingTypeId: "premium" });
  assert.equal(
    CALC.findSweetSpot({ priceMXN: 85, ratePct: 14.5, fixedCostFn: premium, thresholds: SOURCE.getFixedCostThresholds() }),
    null
  );
});

test("sweet spot: Full tiers (99/199/299) are the candidates in Full mode", () => {
  assert.deepEqual(SOURCE.getFixedCostThresholds(1), [99, 199, 299]);
  // 1kg @ $190 Full: service cost $38 (tier 99–198.99) → at $199 it is $39 (step up) → no nudge;
  // at $280 → $299 drops to 0 → nudge (tested above). $150 → 199 is +$1 cost, no nudge.
  const fn = SOURCE.fixedCostFnFor({ listingTypeId: "classic", fullWeightKg: 1 });
  assert.equal(
    CALC.findSweetSpot({ priceMXN: 190, ratePct: 10, fixedCostFn: fn, thresholds: SOURCE.getFixedCostThresholds(1) }),
    null
  );
});

test("solveTargetPrice: oscillation across the $299 step snaps to $299 (never under-states)", () => {
  // Classic 10%: base 260 → fixed-point oscillates (260/0.9=288.9 <299 → +37 → 330 ≥299 → fixed 0 → 288.9 …)
  // The honest answer is the step itself: $299 covers 260 + 0 at 10%.
  const p = CALC.solveTargetPrice({
    costMXN: 260,
    shippingMXN: 0,
    marginPct: 0,
    ratePct: 10,
    fixedCostFn: SOURCE.getFixedCost,
    thresholds: SOURCE.getFixedCostThresholds()
  });
  assert.equal(p, 299);
  // Every price returned must actually cover base + fixed(price) at the margin.
  for (const base of [230, 250, 255, 262, 268, 270, 290, 300]) {
    const q = CALC.solveTargetPrice({ costMXN: base, shippingMXN: 0, marginPct: 0, ratePct: 10, fixedCostFn: SOURCE.getFixedCost, thresholds: SOURCE.getFixedCostThresholds() });
    assert.ok(q * 0.9 + 0.01 >= base + SOURCE.getFixedCost(q), `base ${base}: price ${q} does not cover ${base} + ${SOURCE.getFixedCost(q)}`);
  }
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
  assert.deepEqual(SOURCE.getFixedCostThresholds(), [99, 149, 299]);
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
    trialActive: false,
    trialExpired: false,
    trialDaysLeft: 0
  });
  assert.equal(GATE.computeProStatus(null, now).pro, false);
});

test("gate: active trial is pro, expired trial is not", () => {
  const now = Date.UTC(2026, 5, 12);
  const active = GATE.computeProStatus(
    { paid: false, trialStartedAt: new Date(now - 3 * 24 * 3600 * 1000).toISOString() },
    now
  );
  assert.deepEqual(active, { pro: true, paid: false, trialActive: true, trialExpired: false, trialDaysLeft: 4 });
  const expired = GATE.computeProStatus(
    { paid: false, trialStartedAt: new Date(now - 8 * 24 * 3600 * 1000).toISOString() },
    now
  );
  assert.deepEqual(expired, { pro: false, paid: false, trialActive: false, trialExpired: true, trialDaysLeft: 0 });
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

test("gate: offline Pro cache expires past the TTL (bounded staleness)", () => {
  const now = 1_700_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;
  // fresh cache within the window → usable (payer stays Pro offline)
  assert.equal(GATE.isCacheUsable({ pro: true, fetchedAt: now - DAY }, now), true);
  // stale cache past the window → not usable (no unbounded entitlement)
  assert.equal(GATE.isCacheUsable({ pro: true, fetchedAt: now - 31 * DAY }, now), false);
  // legacy cache with no timestamp → usable (write must not self-revoke)
  assert.equal(GATE.isCacheUsable({ pro: true }, now), true);
  // no cache → not usable
  assert.equal(GATE.isCacheUsable(null, now), false);
});

test("shipping subsidy: reputation reduces free-shipping cost at/above threshold", () => {
  const S = CALC.subsidizedShipping;
  // Below the threshold → seller pays all, regardless of reputation.
  assert.equal(S({ fullShippingMXN: 100, priceMXN: 250, freeShipping: true, subsidyPct: 50, thresholdMXN: 299 }), 100);
  // Not free shipping → seller pays all.
  assert.equal(S({ fullShippingMXN: 100, priceMXN: 500, freeShipping: false, subsidyPct: 50, thresholdMXN: 299 }), 100);
  // Free shipping AT the threshold → subsidy applies.
  assert.equal(S({ fullShippingMXN: 100, priceMXN: 299, freeShipping: true, subsidyPct: 50, thresholdMXN: 299 }), 50);
  // Free shipping above threshold, 40% (amarillo) → pays 60%.
  assert.equal(S({ fullShippingMXN: 120, priceMXN: 500, freeShipping: true, subsidyPct: 40, thresholdMXN: 299 }), 72);
  // 0% subsidy (naranja/roja) → pays full even when eligible.
  assert.equal(S({ fullShippingMXN: 100, priceMXN: 500, freeShipping: true, subsidyPct: 0, thresholdMXN: 299 }), 100);
  // Guards: zero full cost stays 0; subsidy clamps to [0,100].
  assert.equal(S({ fullShippingMXN: 0, priceMXN: 500, freeShipping: true, subsidyPct: 50, thresholdMXN: 299 }), 0);
  assert.equal(S({ fullShippingMXN: 100, priceMXN: 500, freeShipping: true, subsidyPct: 150, thresholdMXN: 299 }), 0);
});

test("shipping subsidy table: conservative estimate values are wired + labeled", () => {
  const sub = SOURCE.shippingSubsidy;
  assert.equal(sub.confidence, "estimate");
  assert.equal(sub.thresholdMXN, 299);
  const byId = Object.fromEntries(sub.levels.map((l) => [l.id, l.subsidyPct]));
  assert.equal(byId.verde, 50); // conservative low end of the 50–60% range
  assert.equal(byId.amarillo, 40);
  assert.equal(byId.naranja, 0);
  assert.equal(byId.none, 0);
});

test("MSI cost: seller financing charge is a % of price, guarded", () => {
  const m = CALC.msiCost;
  assert.equal(m(1000, 13), 130);
  assert.equal(m(827, 7.5), 62.03); // 62.025 → round2
  assert.equal(m(1000, 0), 0); // no rate → no cost
  assert.equal(m(0, 13), 0); // no price → no cost
  assert.equal(m(1000, -5), 0); // negative rate clamped
});

test("MSI reference defaults are wired and clearly a reference (not authoritative)", () => {
  const msi = SOURCE.msiReference;
  assert.equal(msi.confidence, "reference");
  const byMonths = Object.fromEntries(msi.terms.map((t) => [t.months, t.chargePct]));
  assert.deepEqual(byMonths, { 3: 5, 6: 7.5, 9: 10, 12: 13 });
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

test("dashboard recomputes rows LIVE from current default shipping (bug 1)", () => {
  const all = {
    "mst:cost:MLM1": 400,
    "mst:meta:MLM1": {
      title: "Tenis", priceMXN: 827, listingTypeId: "classic",
      categoryGroupId: "tech", url: "u"
    },
    "mst:sales:MLM1": 10
  };
  const r0 = DASH.computeRows(all, "mst", 0)[0];
  const r90 = DASH.computeRows(all, "mst", 90)[0];
  // Shipping is taken from the passed value, never from saved meta.
  assert.equal(r0.b.shippingCostMXN, 0);
  assert.equal(r90.b.shippingCostMXN, 90);
  // The only delta between the two is the shipping (everything else live-equal).
  assert.equal(CALC.round2(r0.b.netMinMXN - r90.b.netMinMXN), 90);
  assert.equal(CALC.round2(r0.b.profitMinMXN - r90.b.profitMinMXN), 90);
});

test("dashboard default shipping: explicit value (incl. 0) wins, null/absent falls back", () => {
  // A deliberately saved 0 (seller genuinely pays no shipping) is authoritative
  // and overrides the card's last-used local value — the same source of truth
  // the card uses, so the two surfaces never disagree.
  assert.equal(DASH.resolveDefaultShipping({ defaultShippingMXN: 0 }, { shippingCostMXN: 90 }), 0);
  assert.equal(DASH.resolveDefaultShipping({ defaultShippingMXN: 55 }, { shippingCostMXN: 90 }), 55);
  // "Unset" is null or an ABSENT key (NOT 0) — fall back to the card's last value.
  assert.equal(DASH.resolveDefaultShipping({ defaultShippingMXN: null }, { shippingCostMXN: 90 }), 90);
  assert.equal(DASH.resolveDefaultShipping({}, { shippingCostMXN: 90 }), 90);
  assert.equal(DASH.resolveDefaultShipping(undefined, { shippingCostMXN: 90 }), 90);
  // Unset with no card value either → 0.
  assert.equal(DASH.resolveDefaultShipping({ defaultShippingMXN: null }, undefined), 0);
  assert.equal(DASH.resolveDefaultShipping(undefined, undefined), 0);
});

test("dashboard skips listings without a cost or meta", () => {
  const all = {
    "mst:cost:A": 100,
    "mst:meta:A": { title: "A", priceMXN: 500, listingTypeId: "classic", categoryGroupId: "tech", url: "u" },
    "mst:cost:B": 0, // no cost → skipped
    "mst:meta:B": { title: "B", priceMXN: 500, listingTypeId: "classic", categoryGroupId: "tech", url: "u" },
    "mst:cost:C": 50 // no meta → skipped
  };
  const rows = DASH.computeRows(all, "mst", 0);
  assert.deepEqual(rows.map((r) => r.itemId), ["A"]);
});

test("dashboard grand totals sum monthly profit across rows with sales", () => {
  const all = {
    "mst:cost:A": 400, "mst:meta:A": { title: "A", priceMXN: 827, listingTypeId: "classic", categoryGroupId: "tech", url: "u" }, "mst:sales:A": 10,
    "mst:cost:B": 100, "mst:meta:B": { title: "B", priceMXN: 600, listingTypeId: "classic", categoryGroupId: "tech", url: "u" } // no sales
  };
  const rows = DASH.computeRows(all, "mst", 0);
  const t = DASH.totals(rows);
  assert.equal(t.count, 2);
  assert.equal(t.withSales, 1);
  // A: profit 827-82.70-400 = 344.30 ; ×10 = 3443.00
  assert.equal(t.monthlyMinMXN, 3443);
  assert.equal(t.monthlyMaxMXN, 3443);
});

test("portfolioSummary: empty rows → all zero, no best/worst", () => {
  const s = DASH.portfolioSummary([]);
  assert.deepEqual(s, {
    count: 0,
    profitable: 0,
    lossMakers: 0,
    breakeven: 0,
    bestMargin: null,
    worstMargin: null,
    avgMarginPct: 0
  });
});

test("portfolioSummary: buckets profitable/loss/breakeven off the worst-case bound", () => {
  const rows = [
    { itemId: "P", meta: { title: "Winner" }, b: { profitMinMXN: 120, marginMinPct: 30 } },
    { itemId: "L", meta: { title: "Loser" }, b: { profitMinMXN: -50, marginMinPct: -10 } },
    { itemId: "B", meta: { title: "Even" }, b: { profitMinMXN: 0, marginMinPct: 0 } },
    { itemId: "P2", meta: { title: "Runner-up" }, b: { profitMinMXN: 40, marginMinPct: 8 } }
  ];
  const s = DASH.portfolioSummary(rows);
  assert.equal(s.count, 4);
  assert.equal(s.profitable, 2);
  assert.equal(s.lossMakers, 1);
  assert.equal(s.breakeven, 1);
  // best = max marginMinPct, worst = min marginMinPct
  assert.deepEqual(s.bestMargin, { itemId: "P", title: "Winner", marginPct: 30 });
  assert.deepEqual(s.worstMargin, { itemId: "L", title: "Loser", marginPct: -10 });
  // avg = mean of margins, round2: (30 - 10 + 0 + 8) / 4 = 7
  assert.equal(s.avgMarginPct, 7);
});

test("portfolioSummary: single row is both best and worst; avg rounds to 2dp", () => {
  const rows = [
    { itemId: "X", meta: { title: "Only" }, b: { profitMinMXN: 10, marginMinPct: 33.335 } }
  ];
  const s = DASH.portfolioSummary(rows);
  assert.equal(s.count, 1);
  assert.equal(s.profitable, 1);
  assert.equal(s.lossMakers, 0);
  assert.equal(s.breakeven, 0);
  assert.equal(s.bestMargin.itemId, "X");
  assert.equal(s.worstMargin.itemId, "X");
  assert.equal(s.avgMarginPct, 33.34);
});

test("portfolioSummary: derives from live computeRows (worst-case margin/profit)", () => {
  const all = {
    "mst:cost:A": 400, "mst:meta:A": { title: "A", priceMXN: 827, listingTypeId: "classic", categoryGroupId: "tech", url: "u" },
    "mst:cost:B": 900, "mst:meta:B": { title: "B", priceMXN: 827, listingTypeId: "classic", categoryGroupId: "tech", url: "u" }
  };
  const rows = DASH.computeRows(all, "mst", 0);
  const s = DASH.portfolioSummary(rows);
  assert.equal(s.count, 2);
  // A: profit 827-82.70-400 = 344.30 (profitable); B: cost 900 > net → loss.
  assert.equal(s.profitable, 1);
  assert.equal(s.lossMakers, 1);
  assert.equal(s.bestMargin.itemId, "A");
  assert.equal(s.worstMargin.itemId, "B");
});

test("marginHealth thresholds: <10 red, 10–25 yellow, ≥25 green", () => {
  assert.equal(UI.marginHealth(5), "red");
  assert.equal(UI.marginHealth(9.99), "red");
  assert.equal(UI.marginHealth(-4), "red");
  assert.equal(UI.marginHealth(10), "yellow");
  assert.equal(UI.marginHealth(24.99), "yellow");
  assert.equal(UI.marginHealth(25), "green");
  assert.equal(UI.marginHealth(40), "green");
});

test("fee table meta carries source citations and retrieval date", () => {
  assert.ok(SOURCE.meta.version.startsWith("2026-"));
  assert.equal(SOURCE.meta.retrievedAt, "2026-06-12");
  assert.ok(SOURCE.meta.sources.length >= 3);
  assert.ok(SOURCE.meta.sources.some((s) => s.confidence === "official"));
});

test("gate: local reverse trial — active for 7 days from install, then expired", () => {
  const now = Date.UTC(2026, 5, 12);
  const day = 24 * 3600 * 1000;
  assert.deepEqual(GATE.computeLocalTrial(null, now), { active: false, expired: false, daysLeft: 0, daysSinceEnd: 0 });
  const fresh = GATE.computeLocalTrial(now - 1000, now);
  assert.equal(fresh.active, true);
  assert.equal(fresh.daysLeft, 7);
  const day5 = GATE.computeLocalTrial(now - 5 * day - 1000, now);
  assert.equal(day5.active, true);
  assert.equal(day5.daysLeft, 2);
  const over = GATE.computeLocalTrial(now - 9 * day, now);
  assert.deepEqual(over, { active: false, expired: true, daysLeft: 0, daysSinceEnd: 2 });
  // boundary: exactly 7 days → expired
  assert.equal(GATE.computeLocalTrial(now - GATE.TRIAL_MS, now).active, false);
});

test("gate: mergeStatus — paid wins, ExtPay trial counts, local trial fills in, expiry is explicit", () => {
  const base = (o) => ({ pro: false, paid: false, trialActive: false, trialExpired: false, trialDaysLeft: 0, ...o });
  const local = { active: true, expired: false, daysLeft: 3, daysSinceEnd: 0 };
  const none = { active: false, expired: true, daysLeft: 0, daysSinceEnd: 4 };
  assert.equal(GATE.mergeStatus(base({ paid: true, pro: true }), none).pro, true);
  assert.equal(GATE.mergeStatus(base({ paid: true, pro: true }), none).trialExpired, false);
  const ext = GATE.mergeStatus(base({ pro: true, trialActive: true, trialDaysLeft: 2 }), none);
  assert.equal(ext.pro, true);
  assert.equal(ext.localTrial, false);
  const loc = GATE.mergeStatus(base({}), local);
  assert.deepEqual([loc.pro, loc.trialActive, loc.localTrial, loc.trialDaysLeft], [true, true, true, 3]);
  const exp = GATE.mergeStatus(base({}), none);
  assert.deepEqual([exp.pro, exp.trialActive, exp.trialExpired, exp.trialDaysSinceEnd], [false, false, true, 4]);
  // never-installed-stamp + never paid → plain free, no expiry prompt
  const plain = GATE.mergeStatus(base({}), { active: false, expired: false, daysLeft: 0, daysSinceEnd: 0 });
  assert.equal(plain.trialExpired, false);
});
