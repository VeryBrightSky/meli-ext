// Pure dashboard data model — no DOM, no chrome. Recomputes every row LIVE
// from the current fee table + the current default shipping, so a settings
// change always propagates (the saved per-listing meta is only the listing
// snapshot: price/type/category/title, never cached fee math).
"use strict";

globalThis.MST_DASH = (() => {
  // The default shipping shown in the dashboard is the OPTIONS-configured value
  // (storage.sync.defaultShippingMXN) — the global knob the user expects, and
  // the SAME source of truth the card uses, so the two never disagree. An
  // explicit value, including a deliberate 0 (genuinely free shipping), wins.
  // "Unset" is null or an ABSENT key (NOT 0); only then do we fall back to the
  // card's last-used local value.
  function resolveDefaultShipping(syncSettings, localDefaults) {
    const CALC = globalThis.MST_CALC;
    const s = syncSettings ? syncSettings.defaultShippingMXN : undefined;
    if (s !== undefined && s !== null) return CALC.parseMoney(s);
    return CALC.parseMoney((localDefaults && localDefaults.shippingCostMXN) || 0);
  }

  // all: a chrome.storage.local snapshot ({key: value}). Returns one row per
  // saved listing that has a cost + meta, recomputed at `defaultShipping`.
  function computeRows(all, prefix, defaultShipping) {
    const SOURCE = globalThis.MST_FEE_SOURCE;
    const CALC = globalThis.MST_CALC;
    const costPrefix = `${prefix}:cost:`;
    const rows = [];
    for (const key of Object.keys(all)) {
      if (!key.startsWith(costPrefix)) continue;
      const itemId = key.slice(costPrefix.length);
      const cost = CALC.parseMoney(all[key]);
      const meta = all[`${prefix}:meta:${itemId}`];
      if (!(cost > 0) || !meta || !(meta.priceMXN > 0)) continue;
      const sales = CALC.parseMoney(all[`${prefix}:sales:${itemId}`]);
      const quote = SOURCE.getQuote({
        priceMXN: meta.priceMXN,
        listingTypeId: meta.listingTypeId,
        categoryGroupId: meta.categoryGroupId
      });
      const b = CALC.computeBreakdown(quote, {
        priceMXN: meta.priceMXN,
        shippingCostMXN: defaultShipping,
        productCostMXN: cost
      });
      rows.push({ itemId, meta, cost, sales, b });
    }
    return rows;
  }

  // Grand totals across rows that have a sales/month figure.
  function totals(rows) {
    const withSales = rows.filter((r) => r.sales > 0);
    return {
      count: rows.length,
      withSales: withSales.length,
      monthlyMinMXN: globalThis.MST_CALC.round2(
        withSales.reduce((s, r) => s + r.b.profitMinMXN * r.sales, 0)
      ),
      monthlyMaxMXN: globalThis.MST_CALC.round2(
        withSales.reduce((s, r) => s + r.b.profitMaxMXN * r.sales, 0)
      )
    };
  }

  // Per-SKU intelligence over already-computed rows. Everything keys off the
  // WORST-CASE bound (marginMinPct / profitMinMXN) — the conservative number
  // this tool always acts on, so a "profitable" SKU is profitable even at the
  // worst end of its fee range. Pure: no DOM, no chrome, no fee math.
  function portfolioSummary(rows) {
    const round2 = globalThis.MST_CALC.round2;
    const count = rows.length;
    if (count === 0) {
      return {
        count: 0,
        profitable: 0,
        lossMakers: 0,
        breakeven: 0,
        bestMargin: null,
        worstMargin: null,
        avgMarginPct: 0
      };
    }
    let profitable = 0;
    let lossMakers = 0;
    let breakeven = 0;
    let marginSum = 0;
    let best = rows[0];
    let worst = rows[0];
    for (const r of rows) {
      const profit = r.b.profitMinMXN;
      if (profit > 0) profitable++;
      else if (profit < 0) lossMakers++;
      else breakeven++;
      marginSum += r.b.marginMinPct;
      if (r.b.marginMinPct > best.b.marginMinPct) best = r;
      if (r.b.marginMinPct < worst.b.marginMinPct) worst = r;
    }
    const brief = (r) => ({ itemId: r.itemId, title: r.meta.title, marginPct: r.b.marginMinPct });
    return {
      count,
      profitable,
      lossMakers,
      breakeven,
      bestMargin: brief(best),
      worstMargin: brief(worst),
      avgMarginPct: round2(marginSum / count)
    };
  }

  return Object.freeze({ resolveDefaultShipping, computeRows, totals, portfolioSummary });
})();
