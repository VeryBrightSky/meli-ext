// Content script entry point. Detects the page type, finds a VISIBLE anchor
// under the price block, and injects the card / search strips.
//
// MELI is a SPA: it navigates client-side (search → product, related-product
// clicks, variant changes). Every route change tears the previous surface
// down completely (card, strips, observers) and re-runs detection, so stale
// state from a previous product is impossible. A generation counter cancels
// in-flight async work the moment a newer navigation starts.
//
// MELI renders .ui-pdp-price in multiple subtrees (sticky header, hidden
// variants), so anchor selection filters by actual visibility, not DOM order.
//
// Diagnostics: every decision is logged with a [<brand name>] prefix so
// failures on real pages can be debugged from a console paste.
"use strict";

(() => {
  const BRAND = globalThis.EXT_BRAND;
  const SAFE = globalThis.MST_SAFE;
  const PREFIX = BRAND.cssPrefix;
  const CARD_ID = `${PREFIX}-card-root`;
  const TAG = `[${BRAND.name}]`;

  const log = (...args) => console.log(TAG, ...args);
  const warn = (...args) => console.warn(TAG, ...args);

  const describe = (el) =>
    `<${el.tagName.toLowerCase()}${el.id ? ` id="${el.id}"` : ""} class="${el.className}">`;

  // --- Route lifecycle --------------------------------------------------------

  // Bumped on every navigation; async flows re-check it after each await and
  // abandon themselves when stale. cleanups run before the next route starts.
  let generation = 0;
  let cleanups = [];
  const onCleanup = (fn) => cleanups.push(fn);
  const isStale = (gen) => gen !== generation;

  function runCleanups() {
    const fns = cleanups;
    cleanups = [];
    for (const fn of fns) SAFE.run("cleanup", fn);
  }

  // Observe with automatic route-scoped disconnect and a SAFE-wrapped callback.
  function observeUntilCleanup(label, callback, target, options) {
    const observer = new MutationObserver(SAFE.wrap(label, callback));
    observer.observe(target, options);
    onCleanup(() => observer.disconnect());
    return observer;
  }

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
      // Client-side search results can render under www. (SPA nav from a PDP).
      if (document.querySelector(".ui-search-layout, .ui-search-results")) {
        return PageType.SEARCH;
      }
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
      onCleanup(done);
    });
  }

  async function waitForPageSettled({ quietMs = 600 } = {}) {
    await waitForLoad();
    log("page loaded, waiting for hydration to settle…");
    const waitedMs = await waitForDomQuiet(quietMs);
    log(`DOM settled after ${waitedMs}ms`);
  }

  // Wait for a visible anchor with an observer instead of polling. Gives up
  // after 15s — we must never break the host page. (Every SPA navigation
  // retries from scratch, so a one-off miss is not permanent.)
  function waitForAnchor(timeoutMs = 15000) {
    return new Promise((resolve) => {
      const existing = findProductAnchor();
      if (existing) {
        resolve(existing);
        return;
      }
      log("no visible price block yet, watching for it…");
      const stop = () => {
        observer.disconnect();
        clearTimeout(timer);
        resolve(null);
      };
      const observer = observeUntilCleanup(
        "anchor-wait",
        () => {
          const found = findProductAnchor();
          if (found) {
            observer.disconnect();
            clearTimeout(timer);
            log("visible price block appeared after initial load");
            resolve(found);
          }
        },
        document.documentElement,
        {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style", "hidden"]
        }
      );
      const timer = setTimeout(stop, timeoutMs);
      onCleanup(stop);
    });
  }

  // --- Card -------------------------------------------------------------------

  // Page data is collected per navigation on first successful anchor;
  // re-injections within the same route reuse it.
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
    const card = SAFE.run("card-build", buildCard, null);
    if (!card) return null;
    found.el.insertAdjacentElement("afterend", card);
    return found;
  }

  // --- Persistence -----------------------------------------------------------

  // The page's React app can re-render the price section and drop the card,
  // or toggle our anchor's subtree hidden. Watch for both and re-inject at a
  // currently-visible anchor — capped per route so we never loop-fight the
  // page (every SPA navigation gets a fresh budget).
  // Re-injection is capped as a rolling BURST budget, not a permanent count:
  // MAX_REINJECTS within REINJECT_WINDOW_MS throttles a page that loop-fights
  // us, but once the page settles for a full window the budget resets — so an
  // occasional re-render minutes apart is always served and the card can never
  // "vanish forever" for the route (we keep observing rather than disconnect).
  const MAX_REINJECTS = 5;
  const REINJECT_WINDOW_MS = 15000;

  function watchCardPersistence() {
    let reinjects = 0;
    let windowStart = 0;
    let pending = false;
    let pendingTimer = null;

    const recover = (reason) => {
      const now = Date.now();
      if (now - windowStart > REINJECT_WINDOW_MS) {
        reinjects = 0;
        windowStart = now;
      }
      if (reinjects >= MAX_REINJECTS) {
        warn(`${reason}, but re-inject budget (${MAX_REINJECTS}/${REINJECT_WINDOW_MS / 1000}s) is spent; will retry once the page settles`);
        return; // keep observing — a mutation past the window resets the budget
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

    const observer = observeUntilCleanup(
      "card-persistence",
      (mutations) => {
        // Ignore mutations we caused ourselves (recalc patches, input edits):
        // reacting to them would loop. Card removal is still caught because the
        // removal record's target is the card's PARENT, outside the card.
        const card = document.getElementById(CARD_ID);
        if (card && mutations.every((m) => card.contains(m.target))) return;
        if (pending) return;
        pending = true;
        // Debounce: let the page's render batch finish, and rate-limit the
        // visibility checks (rect + computed style) to one per 200ms.
        pendingTimer = setTimeout(
          SAFE.wrap("card-recover", () => {
            pending = false;
            const card = document.getElementById(CARD_ID);
            if (card && isVisible(card)) return;
            // Never yank the card out from under a user mid-edit; defer until
            // focus leaves (a later mutation retriggers recovery).
            if (card && card.contains(document.activeElement)) return;
            if (!card) {
              recover("card removed by page re-render");
            } else {
              recover("card's subtree went hidden");
            }
          }),
          200
        );
      },
      document.documentElement,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden"]
      }
    );
    onCleanup(() => clearTimeout(pendingTimer));
  }

  async function injectProductCard(gen, { settle }) {
    if (document.getElementById(CARD_ID)) {
      log("card already injected, skipping");
      return;
    }
    if (settle) await waitForPageSettled();
    if (isStale(gen)) return;
    const found = await waitForAnchor();
    if (isStale(gen) || !found) {
      if (!found && !isStale(gen)) logAnchorDiagnostics();
      return;
    }
    if (document.getElementById(CARD_ID)) return;
    logAnchorChoice(found);

    pageData = SAFE.run("page-data", () => globalThis.MST_PAGE.collect(found.el), null);
    if (!pageData?.price) {
      warn("price not found on page (itemprop meta + andes-money-amount both missed) — not injecting");
      pageData = null;
      return;
    }

    // Local price history snapshot for this visit (capped, storage.local).
    globalThis.MST_HISTORY.record(pageData.itemId, pageData.price.value).catch(() => {});

    const card = SAFE.run("card-build", buildCard, null);
    if (!card) return;
    found.el.insertAdjacentElement("afterend", card);
    log("card injected ✔");
    logCardVisibilityReport(document.getElementById(CARD_ID));
    watchCardPersistence();
  }

  function removeInjectedUi() {
    document.getElementById(CARD_ID)?.remove();
    SAFE.run("quickview-destroy", () => globalThis.MST_QUICKVIEW.destroy());
  }

  // --- Routing -----------------------------------------------------------------

  async function route({ initial }) {
    const gen = generation;

    const settings = await chrome.storage.sync
      .get({ enabled: true, cardEnabled: true, stripsEnabled: true })
      .catch(() => ({ enabled: true, cardEnabled: true, stripsEnabled: true }));
    if (isStale(gen)) return;
    if (!settings.enabled) {
      log("disabled in options, exiting");
      return;
    }

    // Resolve Pro entitlement per navigation before any UI builds. A failure
    // here must never abort injection — fall back to the free tier.
    const proStatus = await globalThis.MST_GATE.refresh().catch(() => ({ pro: false }));
    if (isStale(gen)) return;
    log("pro status:", proStatus);

    let pageType = detectPageType();
    if (!pageType && sniffProductDom()) {
      log("URL not recognized but product DOM detected, treating as product");
      pageType = PageType.PRODUCT;
    }
    log("page type:", pageType ?? "(not a product/search page)");

    switch (pageType) {
      case PageType.PRODUCT:
        if (!settings.cardEnabled) {
          log("product card disabled in settings");
          break;
        }
        await injectProductCard(gen, { settle: initial });
        break;
      case PageType.SEARCH:
        if (!settings.stripsEnabled) {
          log("search strips disabled in settings");
          break;
        }
        if (initial) await waitForPageSettled();
        if (isStale(gen)) return;
        globalThis.MST_QUICKVIEW.init();
        onCleanup(() => globalThis.MST_QUICKVIEW.destroy());
        break;
      default:
        break;
    }
  }

  // --- SPA navigation ----------------------------------------------------------

  // Content scripts can't intercept the page's history.pushState (isolated
  // world), so detect URL changes with a cheap 1s href poll + popstate.
  // On change: tear everything down, wait for the new view to render, re-route.
  function startUrlWatcher() {
    let lastHref = location.href;
    let renavTimer = null;

    const onNavigated = SAFE.wrap("spa-nav", () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      const gen = ++generation;
      log("SPA navigation detected →", location.href);
      runCleanups();
      removeInjectedUi();
      pageData = null;
      // Give the SPA a beat to swap views, then wait for the new view's DOM
      // to go quiet before re-routing (page is already loaded — short settle).
      clearTimeout(renavTimer);
      renavTimer = setTimeout(
        SAFE.wrap("spa-reroute", () => {
          waitForDomQuiet(400, 4000).then(() => {
            if (isStale(gen)) return; // navigated again already
            route({ initial: false }).catch((err) => warn("route failed:", err));
          });
        }),
        250
      );
    });

    setInterval(onNavigated, 1000);
    window.addEventListener("popstate", () => setTimeout(onNavigated, 50));
  }

  // --- Entry -----------------------------------------------------------------

  async function main() {
    log(
      `v${chrome.runtime.getManifest().version} loaded on`,
      window.location.href
    );
    startUrlWatcher();
    await route({ initial: true }).catch((err) => warn("initial route failed:", err));
  }

  main().catch((err) => console.error(TAG, "fatal:", err));
})();
