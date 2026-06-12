// Content script entry point. Phase 0: detect the page type, find a safe
// anchor under the price block, and inject the (empty, skeleton-state) card
// shell that Phase 1 will populate with fee/payout data.
"use strict";

(() => {
  const BRAND = globalThis.EXT_BRAND;
  const PREFIX = BRAND.cssPrefix;
  const CARD_ID = `${PREFIX}-card-root`;

  // --- Page detection -------------------------------------------------------

  const PageType = Object.freeze({
    PRODUCT: "product",
    SEARCH: "search"
  });

  function detectPageType() {
    const { hostname, pathname } = window.location;
    if (hostname === "articulo.mercadolibre.com.mx") {
      return PageType.PRODUCT;
    }
    if (hostname === "listado.mercadolibre.com.mx") {
      return PageType.SEARCH;
    }
    // Catalog product pages live on www, e.g. /p/MLM12345678 or seller-style
    // /MLM-123456789-some-title-_JM paths that get served from www.
    if (hostname === "www.mercadolibre.com.mx") {
      if (/^\/p\/MLM\d+/.test(pathname) || /\/MLM-?\d+/.test(pathname)) {
        return PageType.PRODUCT;
      }
    }
    return null;
  }

  // --- Anchor lookup ---------------------------------------------------------

  // Candidate elements to inject after, in priority order. We want to sit
  // inline under the price block in the buybox column, never covering buy
  // buttons or shipping info.
  const PRODUCT_ANCHOR_SELECTORS = [
    ".ui-pdp-price",
    ".ui-pdp-container__col--right .ui-pdp-price__second-line",
    "#price"
  ];

  function findProductAnchor() {
    for (const selector of PRODUCT_ANCHOR_SELECTORS) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  // MELI hydrates parts of the PDP after document_idle, so wait for the
  // anchor with an observer instead of polling. Gives up quietly after 15s
  // (e.g. unexpected layout) — we must never break the host page.
  function waitForAnchor(timeoutMs = 15000) {
    return new Promise((resolve) => {
      const existing = findProductAnchor();
      if (existing) {
        resolve(existing);
        return;
      }
      const observer = new MutationObserver(() => {
        const el = findProductAnchor();
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // --- Card shell ------------------------------------------------------------

  function buildCardShell() {
    const card = document.createElement("section");
    card.id = CARD_ID;
    card.className = `${PREFIX}-card`;

    // Skeleton rows — replaced by Phase 1 with real fee/payout content.
    const body = document.createElement("div");
    body.className = `${PREFIX}-card__body`;
    for (const width of ["60%", "85%", "40%"]) {
      const row = document.createElement("div");
      row.className = `${PREFIX}-skeleton`;
      row.style.width = width;
      body.appendChild(row);
    }
    card.appendChild(body);

    // Third-party attribution footer — legal requirement, every injected card.
    const footer = document.createElement("footer");
    footer.className = `${PREFIX}-card__brand`;
    const logo = document.createElement("img");
    logo.src = chrome.runtime.getURL(BRAND.logoPath);
    logo.alt = "";
    logo.width = 12;
    logo.height = 12;
    const label = document.createElement("span");
    label.textContent = BRAND.name;
    footer.append(logo, label);
    card.appendChild(footer);

    return card;
  }

  async function injectProductCard() {
    if (document.getElementById(CARD_ID)) return;
    const anchor = await waitForAnchor();
    if (!anchor || document.getElementById(CARD_ID)) return;
    anchor.insertAdjacentElement("afterend", buildCardShell());
  }

  // --- Entry -----------------------------------------------------------------

  async function main() {
    const { enabled = true } = await chrome.storage.sync.get("enabled");
    if (!enabled) return;

    switch (detectPageType()) {
      case PageType.PRODUCT:
        await injectProductCard();
        break;
      case PageType.SEARCH:
        // Phase 2: Quick View strip on search results.
        break;
      default:
        break;
    }
  }

  main().catch(() => {
    // Never surface errors into the host page console beyond this point.
  });
})();
