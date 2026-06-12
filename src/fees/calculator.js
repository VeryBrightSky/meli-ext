// Pure fee math — no DOM, no chrome.*, no fee-table knowledge. Takes a quote
// from the fee source plus user inputs, returns a payout breakdown. Kept pure
// so it is unit-testable in Node and survives the V2 fee-source swap.
"use strict";

globalThis.MST_CALC = (() => {
  const round2 = (n) => Math.round(n * 100) / 100;

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
      netMaxMXN: netMax
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

  return Object.freeze({ computeBreakdown, round2 });
})();
