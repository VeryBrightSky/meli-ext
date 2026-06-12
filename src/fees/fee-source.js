// Fee source abstraction — the V1/V2 swap point.
//
// Interface every fee source implements:
//   kind                                  "table" | "api" (V2)
//   meta                                  { version, retrievedAt, sources, caveats }
//   getQuote({ priceMXN, listingTypeId, categoryGroupId })
//     → { pctMin, pctMax, fixedCostMXN, categoryGroup|null, confidence }
//   listCategoryGroups()                  [{ id, label }] for the picker
//   matchCategory(breadcrumbTexts)        groupId | null
//
// The calculator and card only ever touch this interface; V2 swaps in an
// authed listing_prices-backed source without touching either.
"use strict";

globalThis.MST_FEE_SOURCE = (() => {
  const table = globalThis.MST_FEE_TABLE;

  const stripAccents = (s) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  function findGroup(categoryGroupId) {
    return table.categoryGroups.find((g) => g.id === categoryGroupId) ?? null;
  }

  function fixedCostFor(priceMXN) {
    const fc = table.fixedCost;
    if (priceMXN >= fc.thresholdMXN) return 0;
    const tier = fc.tiers.find((t) => priceMXN < t.maxPriceExclusive);
    return tier ? tier.amountMXN : 0;
  }

  function getQuote({ priceMXN, listingTypeId, categoryGroupId }) {
    const type = listingTypeId === "premium" ? "premium" : "classic";
    const group = findGroup(categoryGroupId);
    const rate = group ? group[type] : table.defaults[type];
    return {
      pctMin: rate.pctMin,
      pctMax: rate.pctMax,
      fixedCostMXN: fixedCostFor(priceMXN),
      categoryGroup: group ? { id: group.id, label: group.label } : null,
      confidence: rate.confidence
    };
  }

  function listCategoryGroups() {
    return table.categoryGroups.map((g) => ({ id: g.id, label: g.label }));
  }

  // Best-effort: match breadcrumb texts against group aliases. Earlier
  // breadcrumb entries are broader categories — match those first.
  function matchCategory(breadcrumbTexts) {
    for (const raw of breadcrumbTexts) {
      const text = stripAccents(raw);
      for (const group of table.categoryGroups) {
        if (group.aliases.some((alias) => text.includes(alias))) {
          return group.id;
        }
      }
    }
    return null;
  }

  return Object.freeze({
    kind: "table",
    meta: table.meta,
    freeShippingThresholdMXN: table.freeShippingThresholdMXN,
    getQuote,
    getFixedCost: fixedCostFor,
    // Prices where the fixed charge steps (sweet-spot candidates).
    getFixedCostThresholds: () => table.fixedCost.tiers.map((t) => t.maxPriceExclusive),
    listCategoryGroups,
    matchCategory
  });
})();
