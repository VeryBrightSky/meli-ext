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
      "Desde el 6 de abril de 2026, productos < $299 migran a costo de envío variable por peso (revisar fee-table)."
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
  ]
});

globalThis.MST_SHIPPING = (() => {
  const table = globalThis.MST_SHIPPING_TABLE;

  // Seller shipping cost estimate for a weight in kg; null above the table.
  function costForWeight(kg) {
    if (!(kg > 0)) return null;
    const bracket = table.brackets.find((b) => kg <= b.maxKg);
    return bracket ? bracket.costMXN : null;
  }

  return Object.freeze({ meta: table.meta, brackets: table.brackets, costForWeight });
})();
