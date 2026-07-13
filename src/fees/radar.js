// Profitability Radar math — pure, no DOM, no chrome.*. The Pro decision layer
// on search pages: given a per-result net payout (before the seller's acquisition
// cost) and the seller's assumptions, classify each result as a winner, a thin
// margin, or a loss, and summarize a whole page into a sourcing verdict.
//
// Conservative by design: callers pass the WORST-CASE net (netMin, i.e. the
// higher commission bound when the category rate is a range), so "profitable"
// means "clears the target even in the worst case".
"use strict";

globalThis.MST_RADAR = (() => {
  const round2 = (n) => Math.round(n * 100) / 100;

  const DEFAULT_TARGET_PCT = 30;

  // Bucket a margin against the seller's target:
  //   loss   — negative margin (sells at a loss)
  //   thin   — positive but below target (marginal)
  //   profit — clears the target (a winner)
  function bucketFor(marginPct, targetMarginPct) {
    if (marginPct < 0) return "loss";
    if (marginPct >= targetMarginPct) return "profit";
    return "thin";
  }

  // Evaluate one result. netMXN excludes shipping (unknowable in browse
  // context); acquisitionPct is the assumed buy cost as a % of sale price.
  function evaluate({ priceMXN, netMXN, acquisitionPct, targetMarginPct }) {
    const acquisitionCostMXN = round2((priceMXN * acquisitionPct) / 100);
    const profitMXN = round2(netMXN - acquisitionCostMXN);
    const marginPct = priceMXN > 0 ? round2((profitMXN / priceMXN) * 100) : 0;
    return {
      acquisitionCostMXN,
      profitMXN,
      marginPct,
      bucket: bucketFor(marginPct, targetMarginPct)
    };
  }

  // Page verdict: counts per bucket. Input is an array of objects each carrying
  // a `bucket` (evaluations, or DOM-derived { bucket }).
  function summarize(items) {
    const out = { total: items.length, profit: 0, thin: 0, loss: 0 };
    for (const it of items) {
      if (it && (it.bucket === "profit" || it.bucket === "thin" || it.bucket === "loss")) {
        out[it.bucket]++;
      }
    }
    return out;
  }

  // Winners first: sort a copy by margin descending, stable on ties (preserves
  // the page's original order among equal margins). Used to order the exported
  // shortlist so the best opportunities are at the top.
  function rankByMargin(evals) {
    return evals
      .map((e, i) => ({ e, i }))
      .sort((a, b) => b.e.marginPct - a.e.marginPct || a.i - b.i)
      .map((x) => x.e);
  }

  return Object.freeze({
    round2,
    DEFAULT_TARGET_PCT,
    bucketFor,
    evaluate,
    summarize,
    rankByMargin
  });
})();
