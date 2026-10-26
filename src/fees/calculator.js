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
    let s = raw.trim();
    // A price copied from MELI arrives as "$ 870 33" / "$870\n33": the cents
    // live in a separate <sup>. Re-join them as decimals before stripping.
    s = s.replace(/^(?:MX)?\$?\s*(\d[\d.,]*)\s+(\d{2})$/, "$1.$2");
    // Negative input is never a valid amount here.
    if (/^[-−]/.test(s)) return 0;
    // Drop currency symbols/prefixes ("MX$", "$") and whitespace.
    s = s.replace(/[^\d.,]/g, "");
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
  //
  // `thresholds` (optional): the prices where fixedCostFn steps. Needed for
  // the band where the fixed point oscillates across a step (e.g. classic
  // 10%, base 255–268: with fixed=$37 the price lands ≥$299 where fixed=0,
  // and with fixed=0 it lands <$299 where fixed=$37). The honest answer there
  // is the step itself ($299): the smallest price that actually covers
  // base + fixed(price). Without thresholds the old fixed-point result is
  // returned.
  // Prices are rounded UP to the cent so the displayed price always reaches
  // the margin (round-to-nearest could land 0.5¢ short), and never below
  // `minPriceMXN` (MELI's listing minimum) when given.
  const ceil2 = (n) => Math.ceil(n * 100 - 1e-6) / 100;

  function solveTargetPrice({ costMXN, shippingMXN, marginPct, ratePct, fixedCostFn, thresholds = [], minPriceMXN = 0 }) {
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
    const feasible = (p) => p * denom + 1e-9 >= base + fixedCostFn(p);
    const finish = (p) => {
      let out = ceil2(Math.max(p, minPriceMXN));
      // The step at the minimum (or rounding) can still leave it short;
      // walk up a cent at a time (bounded) until it truly covers.
      for (let i = 0; i < 5 && !feasible(out); i++) out = ceil2(out + 0.01);
      return out;
    };
    // fixedCostFn is piecewise constant between `thresholds`, and NOT monotonic
    // (the fixed charge vanishes and the shipping discount starts at $299), so
    // the fixed-point price above can sit in a higher band than the cheapest
    // answer. The feasible set is a union of [max(band start, band solution),
    // next band) intervals, so its minimum is always a band start or a band
    // solution: test them all and take the lowest that truly covers. Every
    // candidate re-evaluates fixedCostFn at its own price.
    const candidates = [price, ...thresholds];
    for (const t of [0, ...thresholds]) {
      const p = (base + fixedCostFn(t)) / denom;
      if (p >= t) candidates.push(p);
    }
    const ok = candidates.filter((p) => p > 0 && feasible(p)).sort((a, b) => a - b);
    return ok.length ? finish(ok[0]) : finish(price);
  }

  // Sweet-spot detector: fees are discontinuous (fixed-charge tiers at
  // $99/$150, charge disappears at $299), so a small price INCREASE can raise
  // the net payout. Scan thresholds within `maxIncreaseRatio` above the
  // current price and return the one with the best positive net gain.
  // Shipping/cost are constant across the comparison and cancel out.
  // Only a step where the FIXED charge actually drops counts: raising the
  // price always raises the gross, so without that guard a Premium listing
  // (no fixed charge) or a classic price just under a step-UP ($99, $149)
  // would be told to raise the price for "free money" that is nothing but the
  // higher price itself.
  // `shippingFn(p)` (optional): what the SELLER pays to ship at price p.
  // Crossing $299 makes free shipping mandatory, so a step that drops the
  // fixed charge can still lose money once the seller starts paying shipping.
  function findSweetSpot({ priceMXN, ratePct, fixedCostFn, thresholds, maxIncreaseRatio = 0.2, shippingFn = () => 0 }) {
    if (!(priceMXN > 0)) return null;
    const net = (p) => p * (1 - ratePct / 100) - fixedCostFn(p) - shippingFn(p);
    const limit = priceMXN * (1 + maxIncreaseRatio);
    const fixedNow = fixedCostFn(priceMXN);
    let best = null;
    for (const t of thresholds) {
      if (t <= priceMXN || t > limit) continue;
      if (!(fixedCostFn(t) < fixedNow)) continue;
      const gain = round2(net(t) - net(priceMXN));
      if (gain > 0 && (best === null || gain > best.netGainMXN)) {
        best = { targetPriceMXN: t, netGainMXN: gain };
      }
    }
    return best;
  }

  // Tax withholdings (Mexico, since 2026-01-01): IVA retained on the
  // VAT-exclusive base, ISR retained on the same base. Rates assume the
  // seller's RFC is registered with the platform.
  function computeWithholdings(priceMXN, { vatPct = 16, ivaRetPct = 8, isrRetPct = 2.5 } = {}) {
    const base = priceMXN / (1 + vatPct / 100);
    const iva = round2((base * ivaRetPct) / 100);
    const isr = round2((base * isrRetPct) / 100);
    return {
      baseMXN: round2(base),
      ivaMXN: iva,
      isrMXN: isr,
      totalMXN: round2(iva + isr)
    };
  }

  // Seller's effective Mercado Envíos cost after the reputation-based free-
  // shipping subsidy. Only free-shipping items at/above the threshold are
  // subsidized; below it (or when shipping isn't free) the seller pays the full
  // cost. LABELED ESTIMATE — the subsidy percentage is approximate.
  function subsidizedShipping({ fullShippingMXN, priceMXN, freeShipping, subsidyPct, thresholdMXN = 299 }) {
    const full = fullShippingMXN > 0 ? fullShippingMXN : 0;
    if (full === 0) return 0;
    if (!freeShipping || !(priceMXN >= thresholdMXN)) return full;
    const pct = Math.max(0, Math.min(100, subsidyPct || 0));
    return round2(full * (1 - pct / 100));
  }

  // Meses sin intereses (MSI) financing charge to the seller: a percentage of
  // the sale price, charged when the listing offers installments. The rate is
  // the SELLER'S OWN account rate (entered in the card); we only apply it.
  // LABELED ESTIMATE. Returns the MXN cost to subtract from the net payout.
  function msiCost(priceMXN, chargePct) {
    const price = priceMXN > 0 ? priceMXN : 0;
    const pct = chargePct > 0 ? chargePct : 0;
    return round2((price * pct) / 100);
  }

  return Object.freeze({
    computeBreakdown,
    solveTargetPrice,
    findSweetSpot,
    computeWithholdings,
    subsidizedShipping,
    msiCost,
    round2,
    parseMoney
  });
})();
