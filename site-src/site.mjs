// Site-wide constants for the Netio landing. Store URL and prices come from the
// extension's own branding file so there is one source of truth.
import "../src/config/branding.js";

const BRAND = globalThis.EXT_BRAND;

export const SITE = Object.freeze({
  name: "Netio",
  baseUrl: BRAND.landingUrl, // https://netiox.netlify.app
  storeUrl: BRAND.storeUrl,
  supportEmail: "vitowebpro@gmail.com",
  ogImage: `${BRAND.landingUrl}/og-image.png`,
  extVersion: BRAND.version,
  checkedAt: "2026-10-30",
  checkedAtText: "30 de octubre de 2026",
  pro: { monthlyMXN: 89, yearlyMXN: 699, trialDays: 7 },
  notAffiliated: "Netio es una herramienta independiente, no afiliada a Mercado Libre. Las cifras son estimaciones basadas en tarifas publicadas.",
  notAffiliatedEn: "Netio is an independent tool, not affiliated with Mercado Libre. Figures are estimates based on published rates.",
  official: {
    cargoVenta: "https://www.mercadolibre.com.mx/ayuda/Costos-de-vender-un-producto_870",
    envios: "https://www.mercadolibre.com.mx/ayuda/costos-envios-gratis_3287",
    envioVerde: "https://www.mercadolibre.com.mx/ayuda/40538",
    envioAmarilla: "https://www.mercadolibre.com.mx/ayuda/40545",
    envioNaranja: "https://www.mercadolibre.com.mx/ayuda/40547",
    retenciones: "https://www.mercadopago.com.mx/blog/nuevas-retenciones-ventas-en-plataformas",
    full: "https://www.mercadolibre.com.mx/ayuda/costos-operar-full_20522",
    full2: "https://www.mercadolibre.com.mx/ayuda/38951",
    costosNota: "https://vendedores.mercadolibre.com.mx/nota/como-funcionan-los-costos-de-mercado-libre",
    simulador: "https://vendedores.mercadolibre.com.mx/nota/como-usar-el-simulador-de-costos-de-mercado-libre",
    retencionesNota: "https://vendedores.mercadolibre.com.mx/aprender/nota/que-son-y-como-se-aplican-las-retenciones"
  }
});

export function storeLink(source, medium = "site") {
  return `${SITE.storeUrl}?utm_source=${encodeURIComponent(source)}&utm_medium=${encodeURIComponent(medium)}`;
}

// Link to the calculator pre-filled with an example.
export function calcLink(inputs) {
  const q = new URLSearchParams();
  if (inputs.priceMXN != null) q.set("precio", String(inputs.priceMXN));
  if (inputs.costMXN != null) q.set("costo", String(inputs.costMXN));
  q.set("cat", inputs.categoryGroupId || "otra");
  q.set("tipo", inputs.listingTypeId === "premium" ? "premium" : "clasica");
  q.set("rep", inputs.reputation || "verde");
  q.set("peso", String(inputs.weightKg ?? 0.3));
  q.set("gratis", inputs.offersFree ? "si" : "no");
  q.set("rfc", inputs.hasRFC === false ? "no" : "si");
  return `/calculadora/?${q.toString()}`;
}

export function mxn(n) {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const [int, dec] = abs.toFixed(2).split(".");
  return `${sign}$${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}`;
}

export function pct(n) {
  return `${Number.isInteger(n) ? n : String(n)}%`;
}
