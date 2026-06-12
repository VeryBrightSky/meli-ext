// Content script entry point. Detects the page type, finds a VISIBLE anchor
// under the price block, and injects the (skeleton-state) card shell that
// Phase 1 will populate with fee/payout data.
//
// MELI renders .ui-pdp-price in multiple subtrees (sticky header, hidden
// variants), so anchor selection filters by actual visibility, not DOM order.
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

  const describe = (el) =>
    `<${el.tagName.toLowerCase()}${el.id ? ` id="${el.id}"` : ""} class="${el.className}">`;

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

  // --- Visibility ------------------------------------------------------------

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function hasFixedOrStickyAncestor(el) {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") return true;
    }
    return false;
  }

  // --- Anchor lookup ---------------------------------------------------------

  // Layered strategies, most specific first. Each returns ALL candidates;
  // selection then filters by visibility and avoids sticky-header duplicates.
  const ANCHOR_STRATEGIES = [
    {
      name: "pdp-price-container",
      findAll: () => document.querySelectorAll(".ui-pdp-price")
    },
    {
      name: "pdp-price-fuzzy",
      findAll: () => document.querySelectorAll('[class*="ui-pdp-price"]')
    },
    {
      name: "legacy-price-id",
      findAll: () => document.querySelectorAll("#price")
    },
    {
      // Semantic fallback: Andes money amounts inside the main content,
      // climbed to their nearest block container. Survives pdp class renames.
      name: "andes-money-amount",
      findAll: () => {
        const blocks = [];
        for (const money of document.querySelectorAll(
          "main .andes-money-amount, #root-app .andes-money-amount"
        )) {
          const block = money.closest("div");
          if (block && !blocks.includes(block)) blocks.push(block);
        }
        return blocks;
      }
    }
  ];

  // Among visible candidates prefer ones outside fixed/sticky containers
  // (sticky-header price duplicate), then the largest on-screen rect (the
  // main buybox price dwarfs thumbnails and badges).
  function pickBestCandidate(visible) {
    const inFlow = visible.filter((el) => !hasFixedOrStickyAncestor(el));
    const pool = inFlow.length > 0 ? inFlow : visible;
    return pool.reduce((best, el) => {
      const area = (e) => {
        const r = e.getBoundingClientRect();
        return r.width * r.height;
      };
      return area(el) > area(best) ? el : best;
    });
  }

  // Silent (called from observers at high frequency); callers log the result.
  function findProductAnchor() {
    for (const strategy of ANCHOR_STRATEGIES) {
      const candidates = [...strategy.findAll()];
      if (candidates.length === 0) continue;
      const visible = candidates.filter(isVisible);
      if (visible.length === 0) continue;
      return {
        el: pickBestCandidate(visible),
        strategyName: strategy.name,
        candidateCount: candidates.length,
        visibleCount: visible.length
      };
    }
    return null;
  }

  function logAnchorChoice(found) {
    log(
      `anchor via "${found.strategyName}": ${found.candidateCount} candidate(s), ` +
        `${found.visibleCount} visible, chose ${describe(found.el)}`
    );
  }

  // When no strategy matches, report what IS on the page so a console paste
  // is enough to write the missing selector.
  function logAnchorDiagnostics() {
    const lines = ANCHOR_STRATEGIES.map((s) => {
      const candidates = [...s.findAll()];
      return `${s.name}: ${candidates.length} candidate(s), ${candidates.filter(isVisible).length} visible`;
    });
    const probes = [
      ".ui-pdp-container",
      ".andes-money-amount",
      "#buybox",
      "main",
      "#root-app"
    ].map((sel) => `${sel} -> ${document.querySelectorAll(sel).length}`);
    warn(
      "no VISIBLE anchor found.\n  strategies:\n    " +
        lines.join("\n    ") +
        "\n  probes:\n    " +
        probes.join("\n    ")
    );
  }

  // --- Hydration settling ----------------------------------------------------

  // MELI's PDP is a React app that hydrates after load. Injecting before
  // hydration finishes causes a mismatch (React error #418) and our card gets
  // wiped by the re-render. Wait for window load, then for the DOM to go
  // quiet (no mutations for `quietMs`), capped at `maxMs` so a busy page
  // (carousels, ads) can't stall us forever.
  function waitForLoad() {
    if (document.readyState === "complete") return Promise.resolve();
    return new Promise((resolve) =>
      window.addEventListener("load", resolve, { once: true })
    );
  }

  function waitForDomQuiet(quietMs = 600, maxMs = 6000) {
    return new Promise((resolve) => {
      const started = performance.now();
      const done = () => {
        observer.disconnect();
        clearTimeout(quietTimer);
        clearTimeout(capTimer);
        resolve(Math.round(performance.now() - started));
      };
      let quietTimer = setTimeout(done, quietMs);
      const capTimer = setTimeout(done, maxMs);
      const observer = new MutationObserver(() => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(done, quietMs);
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true
      });
    });
  }

  async function waitForPageSettled() {
    await waitForLoad();
    log("page loaded, waiting for hydration to settle…");
    const waitedMs = await waitForDomQuiet();
    log(`DOM settled after ${waitedMs}ms`);
  }

  // Wait for a visible anchor with an observer instead of polling. Gives up
  // after 15s — we must never break the host page.
  function waitForAnchor(timeoutMs = 15000) {
    return new Promise((resolve) => {
      const existing = findProductAnchor();
      if (existing) {
        resolve(existing);
        return;
      }
      log("no visible price block yet, watching for it…");
      const observer = new MutationObserver(() => {
        const found = findProductAnchor();
        if (found) {
          observer.disconnect();
          clearTimeout(timer);
          log("visible price block appeared after initial load");
          resolve(found);
        }
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden"]
      });
    });
  }

  // --- Card -------------------------------------------------------------------

  // Page data is collected once on first successful anchor; re-injections
  // reuse it (card state itself lives in MST_CARD and survives re-renders).
  let pageData = null;

  function buildCard() {
    return globalThis.MST_CARD.build(pageData);
  }

  // Post-injection self-check: confirm the card actually renders on screen;
  // if not, walk ancestors and name the one hiding it.
  function logCardVisibilityReport(card) {
    const rect = card.getBoundingClientRect();
    const style = getComputedStyle(card);
    log("card self-check:", {
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      },
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity
    });
    if (isVisible(card)) {
      log("card visible on screen ✔");
      return true;
    }
    warn("card is in the DOM but NOT visible. Ancestor audit:");
    for (
      let node = card.parentElement;
      node && node !== document.documentElement;
      node = node.parentElement
    ) {
      const s = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      if (
        s.display === "none" ||
        s.visibility === "hidden" ||
        s.opacity === "0" ||
        r.width === 0 ||
        r.height === 0
      ) {
        warn(
          `  hidden ancestor ${describe(node)} ` +
            `display=${s.display} visibility=${s.visibility} opacity=${s.opacity} ` +
            `size=${Math.round(r.width)}x${Math.round(r.height)}`
        );
      }
    }
    return false;
  }

  function insertCard() {
    const found = findProductAnchor();
    if (!found) return null;
    found.el.insertAdjacentElement("afterend", buildCard());
    return found;
  }

  // --- Persistence -----------------------------------------------------------

  // The page's React app can re-render the price section and drop the card,
  // or toggle our anchor's subtree hidden. Watch for both and re-inject at a
  // currently-visible anchor — capped so we never loop-fight the page.
  const MAX_REINJECTS = 5;

  function watchCardPersistence() {
    let reinjects = 0;
    let pending = false;

    const recover = (reason) => {
      if (reinjects >= MAX_REINJECTS) {
        warn(`${reason}, but re-inject cap (${MAX_REINJECTS}) reached, giving up`);
        observer.disconnect();
        return;
      }
      reinjects++;
      log(`${reason}, re-anchoring (${reinjects}/${MAX_REINJECTS})`);
      document.getElementById(CARD_ID)?.remove();
      const found = insertCard();
      if (found) {
        logAnchorChoice(found);
        logCardVisibilityReport(document.getElementById(CARD_ID));
      } else {
        warn("no visible anchor available, will retry on next page mutation");
      }
    };

    const observer = new MutationObserver((mutations) => {
      // Ignore mutations we caused ourselves (recalc patches, input edits):
      // reacting to them would loop. Card removal is still caught because the
      // removal record's target is the card's PARENT, outside the card.
      const card = document.getElementById(CARD_ID);
      if (card && mutations.every((m) => card.contains(m.target))) return;
      if (pending) return;
      pending = true;
      // Debounce: let the page's render batch finish, and rate-limit the
      // visibility checks (rect + computed style) to one per 200ms.
      setTimeout(() => {
        pending = false;
        const card = document.getElementById(CARD_ID);
        if (card && isVisible(card)) return;
        if (!card) {
          recover("card removed by page re-render");
        } else {
          recover("card's subtree went hidden");
        }
      }, 200);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"]
    });
  }

  async function injectProductCard() {
    if (document.getElementById(CARD_ID)) {
      log("card already injected, skipping");
      return;
    }
    await waitForPageSettled();
    const found = await waitForAnchor();
    if (!found) {
      logAnchorDiagnostics();
      return;
    }
    if (document.getElementById(CARD_ID)) return;
    logAnchorChoice(found);

    pageData = globalThis.MST_PAGE.collect(found.el);
    if (!pageData.price) {
      warn("price not found on page (itemprop meta + andes-money-amount both missed) — not injecting");
      pageData = null;
      return;
    }

    found.el.insertAdjacentElement("afterend", buildCard());
    log("card injected ✔");
    logCardVisibilityReport(document.getElementById(CARD_ID));
    watchCardPersistence();
  }

  // --- Entry -----------------------------------------------------------------

  async function main() {
    log(
      `v${chrome.runtime.getManifest().version} loaded on`,
      window.location.href
    );

    const settings = await chrome.storage.sync.get({
      enabled: true,
      cardEnabled: true,
      stripsEnabled: true
    });
    if (!settings.enabled) {
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
        if (!settings.cardEnabled) {
          log("product card disabled in settings");
          break;
        }
        await injectProductCard();
        break;
      case PageType.SEARCH:
        if (!settings.stripsEnabled) {
          log("search strips disabled in settings");
          break;
        }
        await waitForPageSettled();
        globalThis.MST_QUICKVIEW.init();
        break;
      default:
        break;
    }
  }

  main().catch((err) => console.error(TAG, "fatal:", err));
})();
