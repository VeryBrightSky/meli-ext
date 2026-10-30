// Versioned Mercado Envíos MX seller cost tables — what the seller pays per
// shipment by reputation, listing price band and weight bracket. Same
// bundled-data pattern as fee-table.js. Transcribed from the three official
// help pages on 2026-10-30 (same data as site-src/shipping-official.js).
//
// Official pages (checked 2026-10-30):
//   Verde / MercadoLíder:      https://www.mercadolibre.com.mx/ayuda/40538  (50% off, already included)
//   Amarilla / sin reputación: https://www.mercadolibre.com.mx/ayuda/40545  (40% off, already included)
//   Naranja / roja:            https://www.mercadolibre.com.mx/ayuda/40547  (no discount)
//   Rules:                     https://www.mercadolibre.com.mx/ayuda/costos-envios-gratis_3287
//
// Columns: $0–98.99 | $99–198.99 | $199–298.99 | $299–498.99 | $499–998.99 | desde $999.
// From $299 free shipping is mandatory and the seller pays the band column.
// Below $299 free shipping is optional; when the seller offers it, the cost is
// the "envío gratis opcional" column, which on every official page equals the
// $299–498.99 column. Values are MXN per shipment and ALREADY INCLUDE the
// reputation discount: never apply a reputation percentage on top.
//
// CAVEATS: the real cost uses the greater of physical and volumetric weight;
// the card's manual shipping input always wins over these estimates.
"use strict";

globalThis.MST_SHIPPING_TABLE = Object.freeze({
  meta: {
    version: "2026-10-30.1",
    site: "MLM",
    currency: "MXN",
    retrievedAt: "2026-10-30",
    sources: [
      {
        url: "https://www.mercadolibre.com.mx/ayuda/40538",
        note: "Official: tabla de costos de envío para reputación verde / MercadoLíder (50% de bonificación ya incluida).",
        confidence: "official"
      },
      {
        url: "https://www.mercadolibre.com.mx/ayuda/40545",
        note: "Official: tabla para reputación amarilla o sin reputación (40% de bonificación ya incluida).",
        confidence: "official"
      },
      {
        url: "https://www.mercadolibre.com.mx/ayuda/40547",
        note: "Official: tabla para reputación naranja o roja (sin bonificación).",
        confidence: "official"
      },
      {
        url: "https://www.mercadolibre.com.mx/ayuda/costos-envios-gratis_3287",
        note: "Official: reglas; envío gratis obligatorio desde $299, opcional abajo; costo por peso (físico o volumétrico, el mayor) y precio; bonificación por reputación incluida en las tablas.",
        confidence: "official"
      },
      {
        url: "https://www.profitosapp.com/blog/cambios-mercado-envios-full-mexico-abril-2026",
        note: "Secondary: costo de servicio Full por peso y tramo de precio (< $299), vigente abril 2026.",
        confidence: "secondary"
      }
    ],
    caveats: [
      "El costo real usa el mayor entre peso físico y volumétrico; el envío que escribas en la tarjeta siempre gana.",
      "Las tablas ya incluyen la bonificación por reputación (50% verde, 40% amarilla o sin reputación, 0% naranja/roja): no se aplica otro descuento encima.",
      "Abajo de $299 el envío gratis es opcional; si lo ofreces pagas la columna 'envío gratis opcional', que en las tres páginas oficiales es igual a la columna $299 a $498.99.",
      "fullServiceCost (vigente 2026-04-06): costo de servicio para vendedores Full en productos < $299, por peso y tramo de precio — tabla distinta a la de envío."
    ]
  },

  // Price bands: priceMXN < bandsMaxExclusive[i] picks column i.
  bandsMaxExclusive: [99, 199, 299, 499, 999, Infinity],
  bandLabels: ["$0 a $98.99", "$99 a $198.99", "$199 a $298.99", "$299 a $498.99", "$499 a $998.99", "Desde $999"],
  // Column used below $299 when the seller offers free shipping (optional).
  optionalFreeColumn: 3,
  freeShippingThresholdMXN: 299,

  // maxKg inclusive upper bound of each weight row; the last row covers
  // everything above 350 kg.
  weightsMaxKg: [0.3, 0.5, 1, 2, 3, 4, 5, 7, 9, 12, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, Infinity],

  // reputation id → table. "amarillo" (the card's id) and "none" (sin
  // reputación) both resolve to the amarilla table, per the official page
  // title "Reputación amarilla o sin reputación".
  tables: {
    verde: {
      label: "Verde o MercadoLíder",
      discountPct: 50,
      url: "https://www.mercadolibre.com.mx/ayuda/40538",
      rows: [
        [25, 32, 35, 52.4, 65.5, 65.5],
        [28.5, 34, 38, 56, 70, 70],
        [33, 38, 39, 59.6, 74.5, 74.5],
        [35, 40, 41, 67.6, 84.5, 84.5],
        [37, 46, 48, 76, 88.5, 95],
        [39, 50, 54, 82.4, 95.5, 103],
        [40, 53, 59, 88, 102.5, 110],
        [45, 59, 70, 98, 122.5, 122.5],
        [51, 67, 81, 111.6, 139.5, 139.5],
        [59, 78, 96, 129.2, 161.5, 161.5],
        [69, 92, 113, 152, 190, 190],
        [81, 108, 140, 178, 222.5, 222.5],
        [102, 137, 195, 225.2, 281.5, 281.5],
        [126, 170, 250, 279.2, 349, 349],
        [163, 220, 305, 361.2, 451.5, 451.5],
        [183, 247, 334, 405.6, 507, 507],
        [188, 254, 363, 416.4, 520.5, 520.5],
        [196, 264, 392, 433.6, 542, 542],
        [220, 297, 421, 487.6, 609.5, 609.5],
        [254, 343, 450, 562.4, 703, 703],
        [288, 389, 523, 637.2, 796.5, 796.5],
        [382, 516, 694, 846, 1057.5, 1057.5],
        [476, 643, 865, 1054.8, 1318.5, 1318.5],
        [570, 770, 1036, 1263.6, 1579.5, 1579.5],
        [664, 897, 1207, 1472.4, 1840.5, 1840.5],
        [758, 1024, 1378, 1681.2, 2101.5, 2101.5],
        [852, 1151, 1549, 1890, 2362.5, 2362.5],
        [946, 1278, 1720, 2098.4, 2623, 2623],
        [1040, 1406, 1892, 2308, 2885, 2885],
        [1134, 1533, 2063, 2516.8, 3146, 3146],
        [1134, 1533, 2063, 2516.8, 3146, 3146]
      ]
    },
    amarilla: {
      label: "Amarilla o sin reputación",
      discountPct: 40,
      url: "https://www.mercadolibre.com.mx/ayuda/40545",
      rows: [
        [30, 38.4, 42, 62.9, 78.6, 78.6],
        [34.2, 40.8, 45.6, 67.2, 84, 84],
        [39.6, 45.6, 46.8, 71.5, 89.4, 89.4],
        [42, 48, 49.2, 81.1, 101.4, 101.4],
        [44.4, 55.2, 57.6, 91.2, 106.2, 114],
        [46.8, 60, 64.8, 98.9, 114.6, 123.6],
        [48, 63.6, 70.8, 105.6, 123, 132],
        [54, 70.8, 84, 117.6, 147, 147],
        [61.2, 80.4, 97.2, 133.9, 167.4, 167.4],
        [70.8, 93.6, 115.2, 155, 193.8, 193.8],
        [82.8, 110.4, 135.6, 182.4, 228, 228],
        [97.2, 129.6, 168, 213.6, 267, 267],
        [122.4, 164.4, 234, 270.2, 337.8, 337.8],
        [151.2, 204, 300, 335, 418.8, 418.8],
        [195.6, 264, 366, 433.4, 541.8, 541.8],
        [219.6, 296.4, 400.8, 486.7, 608.4, 608.4],
        [225.6, 304.8, 435.6, 499.7, 624.6, 624.6],
        [235.2, 316.8, 470.4, 520.3, 650.4, 650.4],
        [264, 356.4, 505.2, 585.1, 731.4, 731.4],
        [304.8, 411.6, 540, 674.9, 843.6, 843.6],
        [345.6, 466.8, 627.6, 764.6, 955.8, 955.8],
        [458.4, 619.2, 832.8, 1015.2, 1269, 1269],
        [571.2, 771.6, 1038, 1265.8, 1582.2, 1582.2],
        [684, 924, 1243.2, 1516.3, 1895.4, 1895.4],
        [796.8, 1076.4, 1448.4, 1766.9, 2208.6, 2208.6],
        [909.6, 1228.8, 1653.6, 2017.4, 2521.8, 2521.8],
        [1022.4, 1381.2, 1858.8, 2268, 2835, 2835],
        [1135.2, 1533.6, 2064, 2518.1, 3147.6, 3147.6],
        [1248, 1687.2, 2270.4, 2769.6, 3462, 3462],
        [1360.8, 1839.6, 2475.6, 3020.2, 3775.2, 3775.2],
        [1360.8, 1839.6, 2475.6, 3020.2, 3775.2, 3775.2]
      ]
    },
    naranja: {
      label: "Naranja o roja",
      discountPct: 0,
      url: "https://www.mercadolibre.com.mx/ayuda/40547",
      rows: [
        [50, 64, 70, 104.8, 131, 131],
        [57, 68, 76, 112, 140, 140],
        [66, 76, 78, 119.2, 149, 149],
        [70, 80, 82, 135.2, 169, 169],
        [74, 92, 96, 152, 177, 190],
        [78, 100, 108, 164.8, 191, 206],
        [80, 106, 118, 176, 205, 220],
        [90, 118, 140, 196, 245, 245],
        [102, 134, 162, 223.2, 279, 279],
        [118, 156, 192, 258.4, 323, 323],
        [138, 184, 226, 304, 380, 380],
        [162, 216, 280, 356, 445, 445],
        [204, 274, 390, 450.4, 563, 563],
        [252, 340, 500, 558.4, 698, 698],
        [326, 440, 610, 722.4, 903, 903],
        [366, 494, 668, 811.2, 1014, 1014],
        [376, 508, 726, 832.8, 1041, 1041],
        [392, 528, 784, 867.2, 1084, 1084],
        [440, 594, 842, 975.2, 1219, 1219],
        [508, 686, 900, 1124.8, 1406, 1406],
        [576, 778, 1046, 1274.4, 1593, 1593],
        [764, 1032, 1388, 1692, 2115, 2115],
        [952, 1286, 1730, 2109.6, 2637, 2637],
        [1140, 1540, 2072, 2527.2, 3159, 3159],
        [1328, 1794, 2414, 2944.8, 3681, 3681],
        [1516, 2048, 2756, 3362.4, 4203, 4203],
        [1704, 2302, 3098, 3780, 4725, 4725],
        [1892, 2556, 3440, 4196.8, 5246, 5246],
        [2080, 2812, 3784, 4616, 5770, 5770],
        [2268, 3066, 4126, 5033.6, 6292, 6292],
        [2268, 3066, 4126, 5033.6, 6292, 6292]
      ]
    }
  },

  // Mercado Envíos FULL: variable "costo de servicio de envío" for products
  // under $299, by weight bracket AND price tier — effective 2026-04-06,
  // replaces the fixed charge for Full sellers. DISTINCT from the shipping
  // tables above. Price tiers: <99 | 99–198.99 | 199–298.99.
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

  // Card reputation ids → official table. Anything unknown (including "none",
  // sin reputación) reads the amarilla table, per the official page title.
  const TABLE_FOR = { verde: "verde", amarilla: "amarilla", amarillo: "amarilla", naranja: "naranja", roja: "naranja" };
  function tableFor(reputation) {
    return table.tables[TABLE_FOR[reputation] ?? "amarilla"];
  }

  function bandIndex(priceMXN) {
    if (!Number.isFinite(priceMXN) || priceMXN < 0) return -1;
    return table.bandsMaxExclusive.findIndex((max) => priceMXN < max);
  }
  function weightIndex(kg) {
    if (!(kg > 0) || !Number.isFinite(kg)) return -1;
    return table.weightsMaxKg.findIndex((max) => kg <= max);
  }

  // Seller shipping cost (MXN, discount already included) for a weight in kg
  // at a listing price for a reputation. At/above $299 the price band column;
  // below $299 the "envío gratis opcional" column (what the seller pays when
  // they offer free shipping there; callers decide whether shipping applies).
  // Without a usable price the optional column is returned (same number).
  // null for a bad weight.
  function costForWeight(kg, priceMXN, reputation) {
    const w = weightIndex(kg);
    if (w === -1) return null;
    const t = tableFor(reputation);
    const b = bandIndex(priceMXN);
    const col = b === -1 || priceMXN < table.freeShippingThresholdMXN ? table.optionalFreeColumn : b;
    return t.rows[w][col];
  }

  // Reputation discount built into the table a reputation id reads (50 / 40 / 0).
  function discountPctFor(reputation) {
    return tableFor(reputation).discountPct;
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

  // Weight brackets for the card's select (maxKg of each finite row).
  const brackets = Object.freeze(
    table.weightsMaxKg.filter(Number.isFinite).map((maxKg) => Object.freeze({ maxKg }))
  );

  return Object.freeze({
    meta: table.meta,
    brackets,
    // Listing prices where the seller's shipping cost steps (band starts
    // from $299 up): solver / sweet-spot candidates.
    priceBandThresholds: Object.freeze(
      table.bandsMaxExclusive.filter((p) => Number.isFinite(p) && p >= table.freeShippingThresholdMXN)
    ),
    freeShippingThresholdMXN: table.freeShippingThresholdMXN,
    tableFor,
    discountPctFor,
    costForWeight,
    fullServiceCost
  });
})();
