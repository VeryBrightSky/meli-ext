// Web calculator (/calculadora/) against the OFFICIAL Mercado Envíos tables
// and against the extension's own shipping path. Expected values are derived
// by hand from scratchpad/seo/official-sources.md (checked 2026-10-30):
//   commission = price * category rate (fee-table.js, secondary source)
//   fixed      = $25 / $30 / $37 below $99 / $149 / $299, Clásica only
//   shipping   = official table by reputation, price band and weight bracket
//   withholdings (on price / 1.16): RFC 8% IVA + 2.5% ISR; no RFC 16% + 20%
//   net        = price - commission - fixed - shipping - withholdings - cost
// Run `node scripts/build-site.mjs` first: the modules under test are the
// copies the build drops into landing/calculadora/.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const calcDir = path.resolve(here, "../../landing/calculadora");
for (const f of ["fee-table.js", "fee-source.js", "calculator.js", "shipping-table.js", "shipping-official.js", "calc-web.js"]) {
  const p = path.join(calcDir, f);
  assert.ok(fs.existsSync(p), `missing ${p}; run node scripts/build-site.mjs first`);
  await import(p);
}
const WEB = globalThis.NETIO_WEB_CALC;
const CALC = globalThis.MST_CALC;
const SOURCE = globalThis.MST_FEE_SOURCE;
const SHIP_EXT = globalThis.MST_SHIPPING;

// Expected shipping for each case was read straight off the official rows.
export const CASES = [
  { id: 1, note: "homepage example; <$299 optional free shipping, verde 0.3 kg",
    in: { priceMXN: 149, costMXN: 55, categoryGroupId: "tech", listingTypeId: "classic", reputation: "verde", weightKg: 0.3, offersFree: true, hasRFC: true },
    exp: { com: 14.9, fixed: 37, ship: 52.4, iva: 10.28, isr: 3.21, ret: 13.49, pre: -10.3, net: -23.79, margin: -15.97 } },
  { id: 2, note: "boundary $298.99: fixed $37 still applies, optional free shipping column",
    in: { priceMXN: 298.99, costMXN: 100, categoryGroupId: "home-general", listingTypeId: "classic", reputation: "verde", weightKg: 0.5, offersFree: true, hasRFC: true },
    exp: { com: 44.85, fixed: 37, ship: 56, iva: 20.62, isr: 6.44, ret: 27.06, pre: 61.14, net: 34.08, margin: 11.4 } },
  { id: 3, note: "boundary $299: fixed $0, mandatory free shipping, verde 0.5 kg band $299-498.99",
    in: { priceMXN: 299, costMXN: 100, categoryGroupId: "home-general", listingTypeId: "classic", reputation: "verde", weightKg: 0.5, offersFree: false, hasRFC: true },
    exp: { com: 44.85, fixed: 0, ship: 56, iva: 20.62, isr: 6.44, ret: 27.06, pre: 98.15, net: 71.09, margin: 23.78 } },
  { id: 4, note: "boundary $498.99: amarilla 1 kg band $299-498.99, Premium Belleza 18.5% (no fixed), no RFC",
    in: { priceMXN: 498.99, costMXN: 200, categoryGroupId: "beauty-health", listingTypeId: "premium", reputation: "amarilla", weightKg: 1, offersFree: false, hasRFC: false },
    exp: { com: 92.31, fixed: 0, ship: 71.5, iva: 68.83, isr: 86.03, ret: 154.86, pre: 135.18, net: -19.68, margin: -3.94 } },
  { id: 5, note: "boundary $499: amarilla 1 kg jumps to band $499-998.99",
    in: { priceMXN: 499, costMXN: 200, categoryGroupId: "beauty-health", listingTypeId: "premium", reputation: "amarilla", weightKg: 1, offersFree: false, hasRFC: false },
    exp: { com: 92.32, fixed: 0, ship: 89.4, iva: 68.83, isr: 86.03, ret: 154.86, pre: 117.28, net: -37.58, margin: -7.53 } },
  { id: 6, note: "boundary $998.99: naranja 3 kg band $499-998.99",
    in: { priceMXN: 998.99, costMXN: 400, categoryGroupId: "vehicles-industry", listingTypeId: "classic", reputation: "naranja", weightKg: 3, offersFree: false, hasRFC: true },
    exp: { com: 119.88, fixed: 0, ship: 177, iva: 68.9, isr: 21.53, ret: 90.43, pre: 302.11, net: 211.68, margin: 21.19 } },
  { id: 7, note: "boundary $999: naranja 3 kg band desde $999",
    in: { priceMXN: 999, costMXN: 400, categoryGroupId: "vehicles-industry", listingTypeId: "classic", reputation: "naranja", weightKg: 3, offersFree: false, hasRFC: true },
    exp: { com: 119.88, fixed: 0, ship: 190, iva: 68.9, isr: 21.53, ret: 90.43, pre: 289.12, net: 198.69, margin: 19.89 } },
  { id: 8, note: "<$299 without free shipping: seller pays $0 shipping, fixed $25 tier",
    in: { priceMXN: 89, costMXN: 20, categoryGroupId: "tech", listingTypeId: "classic", reputation: "verde", weightKg: 0.3, offersFree: false, hasRFC: true },
    exp: { com: 8.9, fixed: 25, ship: 0, iva: 6.14, isr: 1.92, ret: 8.06, pre: 35.1, net: 27.04, margin: 30.38 } },
  { id: 9, note: "boundary $99: fixed tier steps to $30; amarilla optional free shipping 0.3 kg",
    in: { priceMXN: 99, costMXN: 30, categoryGroupId: "home-general", listingTypeId: "classic", reputation: "amarilla", weightKg: 0.3, offersFree: true, hasRFC: false },
    exp: { com: 14.85, fixed: 30, ship: 62.9, iva: 13.66, isr: 17.07, ret: 30.73, pre: -38.75, net: -69.48, margin: -70.18 } },
  { id: 10, note: "boundary $98.99: fixed $25; verde 1 kg optional free shipping",
    in: { priceMXN: 98.99, costMXN: 30, categoryGroupId: "tech", listingTypeId: "classic", reputation: "verde", weightKg: 1, offersFree: true, hasRFC: true },
    exp: { com: 9.9, fixed: 25, ship: 59.6, iva: 6.83, isr: 2.13, ret: 8.96, pre: -25.51, net: -34.47, margin: -34.82 } },
  { id: 11, note: "unknown category: Premium default range 12.5-20.5%; verde 2 kg band desde $999",
    in: { priceMXN: 1500, costMXN: 700, categoryGroupId: null, listingTypeId: "premium", reputation: "verde", weightKg: 2, offersFree: false, hasRFC: true },
    exp: { comMin: 187.5, comMax: 307.5, fixed: 0, ship: 84.5, iva: 103.45, isr: 32.33, ret: 135.78, preMin: 408, preMax: 528, netMin: 272.22, netMax: 392.22, marginMin: 18.15, marginMax: 26.15 } },
  { id: 12, note: "amarilla 5 kg at $350 (band $299-498.99)",
    in: { priceMXN: 350, costMXN: 120, categoryGroupId: "tech", listingTypeId: "classic", reputation: "amarilla", weightKg: 5, offersFree: false, hasRFC: true },
    exp: { com: 35, fixed: 0, ship: 105.6, iva: 24.14, isr: 7.54, ret: 31.68, pre: 89.4, net: 57.72, margin: 16.49 } },
  { id: 13, note: "40 kg: outside the extension's table (null), inside the official one",
    in: { priceMXN: 2000, costMXN: 900, categoryGroupId: "tools", listingTypeId: "classic", reputation: "verde", weightKg: 40, offersFree: false, hasRFC: true },
    exp: { com: 270, fixed: 0, ship: 349, iva: 137.93, isr: 43.1, ret: 181.03, pre: 481, net: 299.97, margin: 15 } }
];

// The extension's own path for the same inputs: fee-source quote + its single
// shipping table + reputation subsidy (shipping-table.js, fee-table.js).
export function extensionResult(inp) {
  const quote = SOURCE.getQuote({ priceMXN: inp.priceMXN, listingTypeId: inp.listingTypeId, categoryGroupId: inp.categoryGroupId });
  const full = SHIP_EXT.costForWeight(inp.weightKg);
  const subsidyPct = SOURCE.shippingSubsidy.levels.find((l) => l.id === (inp.reputation === "amarilla" ? "amarillo" : inp.reputation))?.subsidyPct || 0;
  let shipping;
  if (full === null) shipping = null;
  else if (inp.priceMXN < 299 && !inp.offersFree) shipping = 0; // the card does not autofill below $299
  else shipping = CALC.subsidizedShipping({ fullShippingMXN: full, priceMXN: inp.priceMXN, freeShipping: true, subsidyPct, thresholdMXN: 299 });
  const bd = CALC.computeBreakdown(quote, { priceMXN: inp.priceMXN, shippingCostMXN: shipping ?? 0, productCostMXN: inp.costMXN });
  const wh = CALC.computeWithholdings(inp.priceMXN, inp.hasRFC ? WEB.RATES_RFC : WEB.RATES_NO_RFC);
  return {
    commissionMinMXN: bd.commissionMinMXN, commissionMaxMXN: bd.commissionMaxMXN, fixedCostMXN: bd.fixedCostMXN,
    shippingMXN: shipping, withholdingsMXN: wh.totalMXN,
    netMinMXN: shipping === null ? null : CALC.round2(bd.netMinMXN - inp.costMXN - wh.totalMXN),
    netMaxMXN: shipping === null ? null : CALC.round2(bd.netMaxMXN - inp.costMXN - wh.totalMXN)
  };
}

for (const c of CASES) {
  test(`case ${c.id}: ${c.note}`, () => {
    const r = WEB.compute(c.in);
    const e = c.exp;
    assert.equal(r.commissionMinMXN, e.comMin ?? e.com, "commission min");
    assert.equal(r.commissionMaxMXN, e.comMax ?? e.com, "commission max");
    assert.equal(r.fixedCostMXN, e.fixed, "fixed charge");
    assert.equal(r.shippingMXN, e.ship, "shipping (official table)");
    assert.equal(r.withholdings.ivaMXN, e.iva, "IVA withheld");
    assert.equal(r.withholdings.isrMXN, e.isr, "ISR withheld");
    assert.equal(r.withholdings.totalMXN, e.ret, "withholdings total");
    assert.equal(r.preWithholdingMinMXN, e.preMin ?? e.pre, "net before withholdings (min)");
    assert.equal(r.preWithholdingMaxMXN, e.preMax ?? e.pre, "net before withholdings (max)");
    assert.equal(r.netMinMXN, e.netMin ?? e.net, "net min");
    assert.equal(r.netMaxMXN, e.netMax ?? e.net, "net max");
    assert.equal(r.marginMinPct, e.marginMin ?? e.margin, "margin min");
    assert.equal(r.marginMaxPct, e.marginMax ?? e.margin, "margin max");
  });
}

test("official table sanity: optional free-shipping column equals the $299-498.99 column", () => {
  const S = globalThis.NETIO_SHIPPING_OFFICIAL;
  const a = S.sellerCost({ priceMXN: 150, weightKg: 0.3, reputation: "verde", offersFree: true }).costMXN;
  const b = S.sellerCost({ priceMXN: 299, weightKg: 0.3, reputation: "verde", offersFree: false }).costMXN;
  assert.equal(a, b);
  assert.equal(a, 52.4);
  assert.equal(S.sellerCost({ priceMXN: 299, weightKg: 0.3, reputation: "amarilla" }).costMXN, 62.9);
  assert.equal(S.sellerCost({ priceMXN: 299, weightKg: 0.3, reputation: "naranja" }).costMXN, 104.8);
  assert.equal(S.sellerCost({ priceMXN: 999, weightKg: 0.3, reputation: "naranja" }).costMXN, 131);
  assert.equal(S.sellerCost({ priceMXN: 5000, weightKg: 400, reputation: "verde" }).costMXN, 3146);
  assert.equal(S.sellerCost({ priceMXN: 50, weightKg: 0, reputation: "verde" }), null);
});

test("extension path differs from the official tables where documented", () => {
  // verde at $299: extension halves an already-discounted value.
  const ext = extensionResult(CASES[2].in);
  assert.equal(ext.shippingMXN, 28);
  assert.equal(WEB.compute(CASES[2].in).shippingMXN, 56);
  // below $299 with optional free shipping and verde: both agree.
  assert.equal(extensionResult(CASES[0].in).shippingMXN, 52.4);
});
