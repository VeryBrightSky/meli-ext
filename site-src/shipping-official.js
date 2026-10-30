// Official Mercado Envíos México seller cost tables, transcribed from the three
// official help pages on 2026-10-30. Used by the web calculator (/calculadora/)
// for the shipping line. Loaded as a classic script in the browser and via
// globalThis in Node tests, like the extension's fee modules.
//
// Source pages (checked 2026-10-30):
//   Verde / MercadoLíder:     https://www.mercadolibre.com.mx/ayuda/40538  (50% off, already included)
//   Amarilla / sin reputación: https://www.mercadolibre.com.mx/ayuda/40545  (40% off, already included)
//   Naranja / roja:           https://www.mercadolibre.com.mx/ayuda/40547  (no discount)
//   Rules:                    https://www.mercadolibre.com.mx/ayuda/costos-envios-gratis_3287
// Columns: $0–98.99 | $99–198.99 | $199–298.99 | $299–498.99 | $499–998.99 | desde $999.
// Below $299 free shipping is optional; when the seller offers it, the cost is
// the "envío gratis opcional" column, which on every official page equals the
// $299–498.99 column. Values are MXN per shipment and already include the
// reputation discount.
"use strict";

globalThis.NETIO_SHIPPING_OFFICIAL = (() => {
  const checkedAt = "2026-10-30";
  const bandsMaxExclusive = [99, 199, 299, 499, 999, Infinity];
  const bandLabels = ["$0 a $98.99", "$99 a $198.99", "$199 a $298.99", "$299 a $498.99", "$499 a $998.99", "Desde $999"];
  // maxKg inclusive upper bound; the last row covers everything above 350 kg.
  const weightsMaxKg = [0.3, 0.5, 1, 2, 3, 4, 5, 7, 9, 12, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, Infinity];
  const weightLabels = [
    "Hasta 300 g", "300 g a 500 g", "500 g a 1 kg", "1 a 2 kg", "2 a 3 kg", "3 a 4 kg", "4 a 5 kg", "5 a 7 kg", "7 a 9 kg",
    "9 a 12 kg", "12 a 15 kg", "15 a 20 kg", "20 a 30 kg", "30 a 40 kg", "40 a 50 kg", "50 a 60 kg", "60 a 70 kg", "70 a 80 kg",
    "80 a 90 kg", "90 a 100 kg", "100 a 125 kg", "125 a 150 kg", "150 a 175 kg", "175 a 200 kg", "200 a 225 kg", "225 a 250 kg",
    "250 a 275 kg", "275 a 300 kg", "300 a 325 kg", "325 a 350 kg", "Más de 350 kg"
  ];

  const tables = {
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
  };

  const FREE_THRESHOLD = 299;
  const OPTIONAL_COLUMN = 3; // "envío gratis opcional" below $299 equals the $299–498.99 column

  function bandIndex(priceMXN) {
    return bandsMaxExclusive.findIndex((max) => priceMXN < max);
  }
  function weightIndex(kg) {
    if (!(kg > 0)) return -1;
    return weightsMaxKg.findIndex((max) => kg <= max);
  }

  // What the seller pays Mercado Envíos for one shipment.
  //   reputation: "verde" | "amarilla" | "naranja"
  //   offersFree: whether the seller offers free shipping below $299 (optional)
  // At/above $299 free shipping is mandatory and the price band column applies.
  // Below $299: the optional column when offersFree, otherwise $0 (the buyer pays).
  // Returns { costMXN, bandLabel, weightLabel, mandatory } or null for bad input.
  function sellerCost({ priceMXN, weightKg, reputation, offersFree }) {
    const t = tables[reputation];
    const w = weightIndex(weightKg);
    if (!t || w === -1 || !(priceMXN >= 0)) return null;
    const mandatory = priceMXN >= FREE_THRESHOLD;
    const b = bandIndex(priceMXN);
    if (!mandatory && !offersFree) {
      return { costMXN: 0, bandLabel: bandLabels[b], weightLabel: weightLabels[w], mandatory: false, column: null };
    }
    const col = mandatory ? b : OPTIONAL_COLUMN;
    return { costMXN: t.rows[w][col], bandLabel: mandatory ? bandLabels[b] : "Envío gratis opcional (menos de $299)", weightLabel: weightLabels[w], mandatory, column: col };
  }

  return Object.freeze({
    checkedAt,
    freeShippingThresholdMXN: FREE_THRESHOLD,
    bandsMaxExclusive,
    bandLabels,
    weightsMaxKg,
    weightLabels,
    tables,
    bandIndex,
    weightIndex,
    sellerCost
  });
})();
