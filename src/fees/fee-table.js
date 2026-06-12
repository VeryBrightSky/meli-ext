// Versioned MELI MX fee table — the bundled data source for V1.
// V2 replaces this with authed listing_prices API calls via fee-source.js;
// nothing outside fee-source.js may read this global directly.
//
// Confidence levels:
//   "official"  — published by Mercado Libre, fetched on retrievedAt
//   "secondary" — third-party transcriptions; MELI no longer publishes exact
//                 per-category rates ("Consultar porcentaje exacto")
"use strict";

globalThis.MST_FEE_TABLE = Object.freeze({
  meta: {
    version: "2026-06-12.1",
    site: "MLM",
    currency: "MXN",
    retrievedAt: "2026-06-12",
    sources: [
      {
        url: "https://www.mercadolibre.com.mx/ayuda/Costos-de-vender-un-producto_870",
        note: "Official: Clásica 8–16%, Premium 12.5–20.5% (MSI hasta 18 meses), precio mínimo $35.",
        confidence: "official"
      },
      {
        url: "https://vendedores.mercadolibre.com.mx/nota/como-funcionan-los-costos-de-mercado-libre",
        note: "Official: costo fijo solo aplica bajo $299, depende de tipo de publicación y categoría; $0 desde $299.",
        confidence: "official"
      },
      {
        url: "https://www.profitosapp.com/blog/cuanto-cobra-mercado-libre-por-vender-mexico-2026",
        note: "Secondary: tabla por categoría (vigente 02/02/2026) y tramos de cargo fijo $25/$30/$37.",
        confidence: "secondary"
      },
      {
        url: "https://www.tiendanube.com/blog/comision-mercado-libre-mexico/",
        note: "Secondary: confirma tramos $25 (<$99), $30 ($99–$149), $37 ($150–$299). Indica que ambos tipos pagan cargo fijo.",
        confidence: "secondary"
      }
    ],
    caveats: [
      "MELI ya no publica el porcentaje exacto por categoría; los valores por grupo son de fuentes secundarias.",
      "Fuentes discrepan sobre si Premium está exento del cargo fijo; esta tabla lo cobra en ambos tipos (estimación conservadora).",
      "No incluye retenciones fiscales (ISR/IVA) ni el costo real de Mercado Envíos."
    ]
  },

  // Official bounds — used when the category is unknown.
  defaults: {
    classic: { pctMin: 8, pctMax: 16, confidence: "official" },
    premium: { pctMin: 12.5, pctMax: 20.5, confidence: "official" }
  },

  minPriceMXN: 35,
  freeShippingThresholdMXN: 299,

  // Per-unit fixed cost for low-price items. Applies below thresholdMXN to
  // both listing types (see caveats). Tiers: price < maxPriceExclusive.
  fixedCost: {
    thresholdMXN: 299,
    appliesTo: ["classic", "premium"],
    confidence: "secondary",
    tiers: [
      { maxPriceExclusive: 99, amountMXN: 25 },
      { maxPriceExclusive: 150, amountMXN: 30 },
      { maxPriceExclusive: 299, amountMXN: 37 }
    ]
  },

  // Category groups per ProfitOS (02/02/2026). aliases are accent-stripped
  // lowercase fragments matched against the PDP breadcrumb.
  categoryGroups: [
    {
      id: "tech",
      label: "Tecnología y electrónica",
      classic: { pctMin: 10, pctMax: 10, confidence: "secondary" },
      premium: { pctMin: 12.5, pctMax: 14.5, confidence: "secondary" },
      aliases: [
        "celular", "telefon", "computacion", "computo", "laptop", "consola",
        "videojuego", "electronica", "audio", "camara", "television",
        "instrumento", "agro", "alimento", "antiguedad"
      ]
    },
    {
      id: "vehicles-industry",
      label: "Accesorios para vehículos, industrias y oficinas",
      classic: { pctMin: 12, pctMax: 12, confidence: "secondary" },
      premium: { pctMin: 16.5, pctMax: 16.5, confidence: "secondary" },
      aliases: ["vehiculo", "autoparte", "refaccion", "industria", "oficina", "moto"]
    },
    {
      id: "tools",
      label: "Herramientas",
      classic: { pctMin: 13.5, pctMax: 13.5, confidence: "secondary" },
      premium: { pctMin: 18, pctMax: 18, confidence: "secondary" },
      aliases: ["herramienta"]
    },
    {
      id: "beauty-health",
      label: "Belleza, salud y equipamiento médico",
      classic: { pctMin: 14, pctMax: 14, confidence: "secondary" },
      premium: { pctMin: 18.5, pctMax: 18.5, confidence: "secondary" },
      aliases: ["belleza", "salud", "cuidado personal", "medic", "perfume", "maquillaje"]
    },
    {
      id: "home-general",
      label: "Hogar, moda, deportes y general",
      classic: { pctMin: 15, pctMax: 15, confidence: "secondary" },
      premium: { pctMin: 19.5, pctMax: 19.5, confidence: "secondary" },
      aliases: [
        "hogar", "mueble", "jardin", "electrodomestico", "ropa", "calzado",
        "moda", "deporte", "fitness", "juguete", "bebe", "arte", "libro",
        "musica", "mascota", "joyeria", "reloj", "construccion", "recuerdo",
        "bolsa", "accesorio de moda"
      ]
    }
  ]
});
