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
  // Andes design tokens — keep in sync with src/content/content.css.
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
