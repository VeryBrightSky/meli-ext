// Single source of truth for branding. Final product name is TBD — change it
// here and run `npm run build`, which stamps manifest.json from these values.
// Loaded as a classic script (content scripts, options page) so it must not
// use import/export; it exposes one global.
"use strict";

globalThis.EXT_BRAND = Object.freeze({
  // Display name shown in injected cards and the options page.
  name: "MELI Seller Tools",
  // Name used in manifest.json. "(dev)" suffix is stripped by the release build.
  manifestName: "MELI Seller Tools (dev)",
  version: "0.1.0",
  description:
    "Fee calculator, net payout and seller insights for MercadoLibre Mexico listings.",
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
