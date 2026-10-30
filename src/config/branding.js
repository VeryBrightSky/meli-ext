// Single source of truth for branding. Final product name is TBD — change it
// here and run `npm run build`, which stamps manifest.json from these values.
// Loaded as a classic script (content scripts, options page) so it must not
// use import/export; it exposes one global.
"use strict";

globalThis.EXT_BRAND = Object.freeze({
  // Display name shown in injected cards and the options page.
  name: "Netio",
  // Store-listing name (manifest "name" in release builds): descriptive and
  // keyword-matched to what sellers search on the Chrome Web Store. The
  // toolbar/short name stays "Netio" via manifest short_name.
  storeName: "Netio: Calculadora de Comisiones y Ganancias Mercado Libre México",
  // Name used in manifest.json dev builds.
  manifestName: "Netio (dev)",
  version: "1.5.0",
  description:
    "Calculadora de comisiones, ganancias y precios para vendedores de Mercado Libre México.",
  // ExtensionPay id (registered at extensionpay.com). Plans configured there:
  // "pro-monthly" ($89 MXN/mes) and "pro-yearly" ($699 MXN/año).
  extpayId: "netio",
  // Public Chrome Web Store listing (used by the share buttons).
  storeUrl: "https://chromewebstore.google.com/detail/netio/bjhikillfgbpblogloljjhejogfeajac",
  // Store link for a share from `where` (card | welcome | dashboard). The UTM
  // tags show up in the Chrome Web Store dashboard, so shares are measurable.
  shareUrl(where) {
    return `${this.storeUrl}?utm_source=whatsapp&utm_medium=share&utm_campaign=${where}`;
  },
  // Where the public landing pages live (privacy policy, uninstall survey).
  // Must serve privacidad.html and adios.html from this base; no trailing slash.
  landingUrl: "https://netio.app",
  storeReviewsUrl: "https://chromewebstore.google.com/detail/netio/bjhikillfgbpblogloljjhejogfeajac/reviews",
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
