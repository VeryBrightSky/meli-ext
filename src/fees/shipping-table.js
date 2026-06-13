// Versioned Mercado Envíos MX rate table — seller cost of a free-shipping
// order by weight bracket. Same bundled-data pattern as fee-table.js.
//
// CAVEATS: secondary source (transcribing MELI's official pages); actual cost
// varies by seller reputation (discounts), dimensions, and listing price.
// Treat as a base estimate — the card's manual shipping input always wins.
"use strict";

globalThis.MST_SHIPPING_TABLE = Object.freeze({
  meta: {
    version: "2026-06-12.1",
    site: "MLM",
    currency: "MXN",
    retrievedAt: "2026-06-12",
    sources: [
      {
        url: "https://www.profitosapp.com/blog/cambios-mercado-envios-full-mexico-abril-2026",
        note: "Tabla por peso vigente abril 2026 (cita páginas oficiales de Mercado Libre). Productos ≥ $299 'mantuvieron sus costos actuales'.",
        confidence: "secondary"
      }
    ],
    caveats: [
      "El costo real varía según reputación del vendedor, dimensiones y precio.",
      "fullServiceCost (vigente 2026-04-06): costo de servicio para vendedores Full en productos < $299, por peso y tramo de precio — tabla distinta a la de envío gratis."
    ]
  },
  // maxKg inclusive upper bound of the bracket.
  brackets: [
    { maxKg: 0.3, costMXN: 52.4 },
    { maxKg: 0.5, costMXN: 56.0 },
    { maxKg: 1, costMXN: 59.6 },
    { maxKg: 2, costMXN: 67.6 },
    { maxKg: 3, costMXN: 76.0 },
    { maxKg: 4, costMXN: 82.4 },
    { maxKg: 5, costMXN: 88.0 },
    { maxKg: 7, costMXN: 98.0 },
    { maxKg: 9, costMXN: 111.6 },
    { maxKg: 12, costMXN: 129.2 },
    { maxKg: 15, costMXN: 152.0 },
    { maxKg: 20, costMXN: 178.0 },
    { maxKg: 30, costMXN: 225.2 }
  ],

  // Mercado Envíos FULL: variable "costo de servicio de envío" for products
  // under $299, by weight bracket AND price tier — effective 2026-04-06,
  // replaces the fixed charge for Full sellers. DISTINCT from the
  // free-shipping table above. Price tiers: <99 | 99–198.99 | 199–298.99.
  fullServiceCost: {
    priceTiersMaxExclusive: [99, 199, 299],
    rows: [
      { maxKg: 0.3, costsMXN: [25, 32, 35] },
      { maxKg: 0.5, costsMXN: [28.5, 34, 38] },
      { maxKg: 1, costsMXN: [33, 38, 39] },
      { maxKg: 2, costsMXN: [35, 40, 41] },
      { maxKg: 3, costsMXN: [37, 46, 48] },
      { maxKg: 4, costsMXN: [39, 50, 54] },
      { maxKg: 5, costsMXN: [40, 53, 59] },
      { maxKg: 7, costsMXN: [45, 59, 70] },
      { maxKg: 9, costsMXN: [51, 67, 81] },
      { maxKg: 12, costsMXN: [59, 78, 96] },
      { maxKg: 15, costsMXN: [69, 92, 113] },
      { maxKg: 20, costsMXN: [81, 108, 140] },
      { maxKg: 30, costsMXN: [102, 137, 195] },
      { maxKg: 40, costsMXN: [126, 170, 250] },
      { maxKg: 50, costsMXN: [163, 220, 305] },
      { maxKg: 60, costsMXN: [183, 247, 334] }
    ]
  }
});

globalThis.MST_SHIPPING = (() => {
  const table = globalThis.MST_SHIPPING_TABLE;

  // Seller shipping cost estimate for a weight in kg; null above the table.
  function costForWeight(kg) {
    if (!(kg > 0)) return null;
    const bracket = table.brackets.find((b) => kg <= b.maxKg);
    return bracket ? bracket.costMXN : null;
  }

  // Full sellers' service cost for an under-$299 item; null when out of
  // range (weight above table or price ≥ $299).
  function fullServiceCost(kg, priceMXN) {
    if (!(kg > 0) || !(priceMXN > 0)) return null;
    const fsc = table.fullServiceCost;
    const tierIndex = fsc.priceTiersMaxExclusive.findIndex((max) => priceMXN < max);
    if (tierIndex === -1) return null; // ≥ $299: no service cost
    const row = fsc.rows.find((r) => kg <= r.maxKg);
    return row ? row.costsMXN[tierIndex] : null;
  }

  return Object.freeze({
    meta: table.meta,
    brackets: table.brackets,
    costForWeight,
    fullServiceCost
  });
})();
