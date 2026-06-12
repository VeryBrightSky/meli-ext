// Content script entry point. Detects the page type, finds a safe anchor
// under the price block, and injects the (skeleton-state) card shell that
// Phase 1 will populate with fee/payout data.
//
// Diagnostics: every decision is logged with the [MELI Seller Tools] prefix
// so failures on real pages can be debugged from a console paste.
"use strict";

(() => {
  const BRAND = globalThis.EXT_BRAND;
  const PREFIX = BRAND.cssPrefix;
  const CARD_ID = `${PREFIX}-card-root`;
  const TAG = `[${BRAND.name}]`;

  const log = (...args) => console.log(TAG, ...args);
  const warn = (...args) => console.warn(TAG, ...args);

  // --- Page detection -------------------------------------------------------

  const PageType = Object.freeze({
    PRODUCT: "product",
    SEARCH: "search"
  });

  // Known URL shapes (verified against live site, 2026-06):
  //   product (catalog): https://www.mercadolibre.com.mx/{slug}/p/MLM{id}
  //   product (item):    https://articulo.mercadolibre.com.mx/MLM-{id}-{slug}
  //                      https://www.mercadolibre.com.mx/MLM-{id}-{slug}
  //   search:            https://listado.mercadolibre.com.mx/{query}
  function detectPageType() {
    const { hostname, pathname } = window.location;
    if (hostname === "articulo.mercadolibre.com.mx") return PageType.PRODUCT;
    if (hostname === "listado.mercadolibre.com.mx") return PageType.SEARCH;
    if (hostname === "www.mercadolibre.com.mx") {
      if (/\/p\/MLM\d+/.test(pathname)) return PageType.PRODUCT;
      if (/^\/MLM-\d+/.test(pathname)) return PageType.PRODUCT;
    }
    return null;
  }

  // DOM-based fallback for product pages whose URL shape we don't know yet.
  function sniffProductDom() {
    return Boolean(
      document.querySelector(".ui-pdp-container, .ui-pdp-price, #buybox")
    );
  }

  // --- Anchor lookup ---------------------------------------------------------

  // Layered strategies, most specific first. Each returns the element the
  // card is inserted AFTER (inline under the price, never covering buy
  // buttons or shipping info).
  const ANCHOR_STRATEGIES = [
    {
      name: "pdp-price-container",
      find: () => document.querySelector(".ui-pdp-price")
    },
    {
      name: "pdp-price-fuzzy",
      find: () => document.querySelector('[class*="ui-pdp-price"]')
    },
    {
      name: "legacy-price-id",
      find: () => document.querySelector("#price")
    },
    {
      // Semantic fallback: first Andes money amount inside the main content,
      // climbed to its nearest block container. Survives pdp class renames.
      name: "andes-money-amount",
      find: () => {
        const money = document.querySelector(
          "main .andes-money-amount, #root-app .andes-money-amount"
        );
        return money ? money.closest("div") : null;
      }
    }
  ];

  function findProductAnchor() {
    for (const strategy of ANCHOR_STRATEGIES) {
      const el = strategy.find();
      if (el) return { el, strategyName: strategy.name };
    }
    return null;
  }

  // MELI hydrates parts of the PDP after document_idle, so wait for the
  // anchor with an observer instead of polling. Gives up after 15s — we must
  // never break the host page.
  function waitForAnchor(timeoutMs = 15000) {
    return new Promise((resolve) => {
      const existing = findProductAnchor();
      if (existing) {
        resolve(existing);
        return;
      }
      log("price block not in DOM yet, watching for it…");
      const observer = new MutationObserver(() => {
        const found = findProductAnchor();
        if (found) {
          observer.disconnect();
          clearTimeout(timer);
          log("price block appeared after initial load");
          resolve(found);
        }
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    });
  }

  // When no strategy matches, report what IS on the page so a console paste
  // is enough to write the missing selector.
  function logAnchorDiagnostics() {
    const probes = [
      ".ui-pdp-container",
      ".ui-pdp-price",
      '[class*="ui-pdp"]',
      ".andes-money-amount",
      "#buybox",
      "#price",
      "main",
      "#root-app"
    ];
    const counts = probes.map(
      (sel) => `${sel} -> ${document.querySelectorAll(sel).length}`
    );
    warn(
      "no anchor strategy matched. Selector probe results:\n  " +
        counts.join("\n  ")
    );
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
    if (document.getElementById(CARD_ID)) {
      log("card already injected, skipping");
      return;
    }
    const found = await waitForAnchor();
    if (!found) {
      logAnchorDiagnostics();
      return;
    }
    if (document.getElementById(CARD_ID)) return;
    const { el, strategyName } = found;
    log(
      `anchor found via "${strategyName}":`,
      `<${el.tagName.toLowerCase()} class="${el.className}">`
    );
    el.insertAdjacentElement("afterend", buildCardShell());
    log("card injected ✔");
  }

  // --- Entry -----------------------------------------------------------------

  async function main() {
    log(
      `v${chrome.runtime.getManifest().version} loaded on`,
      window.location.href
    );

    const { enabled = true } = await chrome.storage.sync.get("enabled");
    if (!enabled) {
      log("disabled in options, exiting");
      return;
    }

    let pageType = detectPageType();
    if (!pageType && sniffProductDom()) {
      log("URL not recognized but product DOM detected, treating as product");
      pageType = PageType.PRODUCT;
    }
    log("page type:", pageType ?? "(not a product/search page, exiting)");

    switch (pageType) {
      case PageType.PRODUCT:
        await injectProductCard();
        break;
      case PageType.SEARCH:
        // Phase 2: Quick View strip on search results.
        log("search page support lands in Phase 2");
        break;
      default:
        break;
    }
  }

  main().catch((err) => console.error(TAG, "fatal:", err));
})();
