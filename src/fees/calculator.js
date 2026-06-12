// Pure fee math — no DOM, no chrome.*, no fee-table knowledge. Takes a quote
// from the fee source plus user inputs, returns a payout breakdown. Kept pure
// so it is unit-testable in Node and survives the V2 fee-source swap.
"use strict";

globalThis.MST_CALC = (() => {
  const round2 = (n) => Math.round(n * 100) / 100;

  // Parse user-typed money. Mexican users mix separators: "1,234.56",
  // "1234.56", "4,99", "$ 450". Rule: with both separators the rightmost one
  // is decimal; a lone comma is decimal only when followed by 1–2 digits.
  function parseMoney(raw) {
    if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? round2(raw) : 0;
    if (typeof raw !== "string") return 0;
    let s = raw.trim().replace(/[$\s]/g, "");
    if (!s) return 0;
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) {
        s = s.replace(/\./g, "").replace(/,/g, ".");
      } else {
        s = s.replace(/,/g, "");
      }
    } else if (lastComma > -1) {
      const digitsAfter = s.length - lastComma - 1;
      const singleComma = s.indexOf(",") === lastComma;
      s = singleComma && digitsAfter >= 1 && digitsAfter <= 2
        ? s.replace(",", ".")
        : s.replace(/,/g, "");
    }
    const n = Number.parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? round2(n) : 0;
  }

  // quote: { pctMin, pctMax, fixedCostMXN } (from fee source)
  // inputs: { priceMXN, shippingCostMXN, productCostMXN }
  // Returns min/max bounds; min === max when the rate is exact.
  function computeBreakdown(quote, inputs) {
    const price = inputs.priceMXN;
    const shipping = inputs.shippingCostMXN > 0 ? inputs.shippingCostMXN : 0;
    const fixedCost = quote.fixedCostMXN || 0;

    const commissionMin = round2((price * quote.pctMin) / 100);
    const commissionMax = round2((price * quote.pctMax) / 100);
    // Higher commission → lower payout: net bounds swap the commission bounds.
    const netMin = round2(price - commissionMax - fixedCost - shipping);
    const netMax = round2(price - commissionMin - fixedCost - shipping);

    const breakdown = {
      priceMXN: price,
      pctMin: quote.pctMin,
      pctMax: quote.pctMax,
      isExactRate: quote.pctMin === quote.pctMax,
      commissionMinMXN: commissionMin,
      commissionMaxMXN: commissionMax,
      fixedCostMXN: fixedCost,
      shippingCostMXN: shipping,
      netMinMXN: netMin,
      netMaxMXN: netMax,
      // Total MELI fees (commission + fixed charge, NOT shipping) as % of
      // the sale price — the "real bite" at a glance.
      effectiveRateMinPct:
        price > 0 ? round2(((commissionMin + fixedCost) / price) * 100) : 0,
      effectiveRateMaxPct:
        price > 0 ? round2(((commissionMax + fixedCost) / price) * 100) : 0
    };

    if (inputs.productCostMXN > 0) {
      breakdown.productCostMXN = inputs.productCostMXN;
      breakdown.profitMinMXN = round2(netMin - inputs.productCostMXN);
      breakdown.profitMaxMXN = round2(netMax - inputs.productCostMXN);
      breakdown.marginMinPct = price > 0 ? round2((breakdown.profitMinMXN / price) * 100) : 0;
      breakdown.marginMaxPct = price > 0 ? round2((breakdown.profitMaxMXN / price) * 100) : 0;
    }

    return breakdown;
  }

  // Reverse calculator: the listing price P that yields profit = marginPct·P
  // after commission (ratePct·P), the price-dependent fixed charge, and
  // shipping:  P·(1 − rate − margin) = cost + shipping + fixed(P)
  // fixed(P) is a step function of P, so iterate to a fixed point (the tiers
  // are few and monotonic; cap the loop defensively). marginPct = 0 gives the
  // break-even price. Returns null when the margin is unreachable.
  function solveTargetPrice({ costMXN, shippingMXN, marginPct, ratePct, fixedCostFn }) {
    const denom = 1 - ratePct / 100 - marginPct / 100;
    if (denom <= 0.001) return null;
    const base = costMXN + (shippingMXN > 0 ? shippingMXN : 0);
    if (base <= 0) return null;

    let fixed = 0;
    let price = base / denom;
    for (let i = 0; i < 6; i++) {
      const nextFixed = fixedCostFn(price);
      if (nextFixed === fixed && i > 0) break;
      fixed = nextFixed;
      price = (base + fixed) / denom;
    }
    return round2(price);
  }

  return Object.freeze({ computeBreakdown, solveTargetPrice, round2, parseMoney });
})();
