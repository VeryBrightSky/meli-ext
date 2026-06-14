// Single source of truth for branding. Final product name is TBD — change it
// here and run `npm run build`, which stamps manifest.json from these values.
// Loaded as a classic script (content scripts, options page) so it must not
// use import/export; it exposes one global.
"use strict";

globalThis.EXT_BRAND = Object.freeze({
  // Display name shown in injected cards and the options page.
  name: "Netio",
  // Name used in manifest.json. "(dev)" suffix is stripped by the release build.
  manifestName: "Netio (dev)",
  version: "1.2.0",
  description:
    "Calculadora de comisiones, ganancias y precios para vendedores de Mercado Libre México.",
  // ExtensionPay id (registered at extensionpay.com). Plans configured there:
  // "pro-monthly" ($89 MXN/mes) and "pro-yearly" ($699 MXN/año).
  extpayId: "netio",
  plans: Object.freeze({ monthly: "pro-monthly", yearly: "pro-yearly" }),
  // Path relative to the extension root; resolve with chrome.runtime.getURL().
  logoPath: "src/assets/icons/icon16.png",
  // Brand palette for the LOGO and store assets ONLY (scripts/gen-icons.py,
  // promo tile). The in-page card deliberately does NOT use these — it keeps
  // the Andes tokens below so it looks native on Mercado Libre.
  logo: Object.freeze({
    primary: "#2D3277",  // deep blue — icon/tile background
    accent: "#00A650"    // profit green — upward arrow / tagline
  }),
  // Andes design tokens for the in-page UI — keep in sync with content.css.
  // Do NOT swap these for the logo palette; the card must match MELI.
  colors: Object.freeze({
    actionBlue: "#3483FA",
    accentYellow: "#FFE600",
    skeletonGray: "#ededed",
    textPrimary: "rgba(0, 0, 0, 0.9)",
    textSecondary: "rgba(0, 0, 0, 0.55)"
  }),
  // CSS class prefix for everything we inject, to avoid colliding with Andes.
  cssPrefix: "mst"
});
