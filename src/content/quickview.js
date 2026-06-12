// Phase 2: Quick View strip on search result pages (listado.*).
// One thin strip per visible result item: collapsed shows estimated net
// payout; click expands a mini breakdown (listing type guess, free shipping,
// seller, commission, fixed cost). Reuses the fee source + calculator; new
// results from infinite scroll are picked up by a debounced observer.
"use strict";

globalThis.MST_QUICKVIEW = (() => {
  const BRAND = globalThis.EXT_BRAND;
  const PREFIX = BRAND.cssPrefix;
  const SOURCE = globalThis.MST_FEE_SOURCE;
  const CALC = globalThis.MST_CALC;
  const UI = globalThis.MST_UI;
  const TAG = `[${BRAND.name}]`;
  const STRIP_CLASS = `${PREFIX}-strip`;

  const log = (...args) => console.log(TAG, ...args);
  const warn = (...args) => console.warn(TAG, ...args);

  let pageCategoryGroupId = null;

  // --- Result discovery -------------------------------------------------------

  // Layered like the PDP anchor strategies. li.ui-search-layout__item verified
  // live 2026-06; the rest are fallbacks for layout drift.
  const ITEM_SELECTORS = [
    "li.ui-search-layout__item",
    ".ui-search-result__wrapper",
    ".poly-card"
  ];

  function findItems() {
    for (const selector of ITEM_SELECTORS) {
      const items = [...document.querySelectorAll(selector)].filter(UI.isVisible);
      if (items.length > 0) return { items, selector };
    }
    return { items: [], selector: null };
  }

  // --- Per-item extraction ------------------------------------------------------

  function extractPrice(item) {
    for (const money of item.querySelectorAll(".andes-money-amount")) {
      // Skip crossed-out original prices ("precio anterior").
      if (/previous/.test(money.className) || money.closest("s")) continue;
      const fraction = money.querySelector(".andes-money-amount__fraction");
      if (!fraction) continue;
      const whole = Number.parseInt(fraction.textContent.replace(/[^\d]/g, ""), 10);
      if (!Number.isFinite(whole) || whole <= 0) continue;
      const centsEl = money.querySelector(".andes-money-amount__cents");
      const cents = centsEl
        ? Number.parseInt(centsEl.textContent.replace(/[^\d]/g, ""), 10) || 0
        : 0;
      return whole + cents / 100;
    }
    return null;
  }

  function extractItemData(item) {
    const text = item.innerText;
    return {
      priceMXN: extractPrice(item),
      freeShipping: /env[ií]o gratis/i.test(text),
      // MSI is a Premium-only feature; absence is a weak signal, so this is a
      // labeled guess in the UI.
      listingTypeGuess: /meses sin intereses|\bmsi\b/i.test(text) ? "premium" : "classic",
      seller: item.querySelector('[class*="seller"]')?.textContent.trim() || null
    };
  }

  // --- Strip UI -----------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function panelRow(label, value) {
    const r = el("div", `${PREFIX}-strip__row`);
    r.appendChild(el("span", `${PREFIX}-strip__label`, label));
    r.appendChild(el("span", `${PREFIX}-strip__value`, value));
    return r;
  }

  function buildStrip(data) {
    const quote = SOURCE.getQuote({
      priceMXN: data.priceMXN,
      listingTypeId: data.listingTypeGuess,
      categoryGroupId: pageCategoryGroupId
    });
    // Net excludes shipping here: per-result shipping cost is unknowable in
    // browse context (noted in the expanded panel).
    const b = CALC.computeBreakdown(quote, {
      priceMXN: data.priceMXN,
      shippingCostMXN: 0,
      productCostMXN: 0
    });

    const strip = el("div", STRIP_CLASS);

    const bar = el("button", `${PREFIX}-strip__bar`);
    bar.type = "button";
    bar.setAttribute("aria-expanded", "false");
    const logo = document.createElement("img");
    logo.src = chrome.runtime.getURL(BRAND.logoPath);
    logo.alt = BRAND.name;
    logo.width = 10;
    logo.height = 10;
    bar.appendChild(logo);
    bar.appendChild(el("span", null, "Neto aprox."));
    bar.appendChild(el("b", null, UI.fmtRange(b.netMinMXN, b.netMaxMXN)));
    const chevron = el("span", `${PREFIX}-strip__chevron`, "▾");
    bar.appendChild(chevron);
    strip.appendChild(bar);

    const panel = el("div", `${PREFIX}-strip__panel`);
    panel.hidden = true;

    panel.appendChild(
      panelRow(
        "Publicación (estimada)",
        data.listingTypeGuess === "premium" ? "Premium" : "Clásica"
      )
    );
    panel.appendChild(
      panelRow(
        "Categoría",
        quote.categoryGroup ? quote.categoryGroup.label : `Desconocida (${UI.fmtPctRange(quote.pctMin, quote.pctMax)})`
      )
    );
    panel.appendChild(panelRow("Envío gratis", data.freeShipping ? "Sí" : "No"));
    if (data.seller) panel.appendChild(panelRow("Vendedor", data.seller));
    panel.appendChild(
      panelRow(
        `Comisión (${UI.fmtPctRange(b.pctMin, b.pctMax)})`,
        UI.fmtCharge(b.commissionMinMXN, b.commissionMaxMXN)
      )
    );
    if (b.fixedCostMXN > 0) {
      panel.appendChild(panelRow("Cargo fijo (< $299)", UI.fmtCharge(b.fixedCostMXN)));
    }
    panel.appendChild(
      panelRow("Recibirás aprox. (antes de envío)", UI.fmtRange(b.netMinMXN, b.netMaxMXN))
    );
    panel.appendChild(
      el("div", `${PREFIX}-strip__brand`, `${BRAND.name} · estimado, tarifas al ${SOURCE.meta.retrievedAt}`)
    );
    strip.appendChild(panel);

    bar.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      bar.setAttribute("aria-expanded", String(!panel.hidden));
      chevron.classList.toggle(`${PREFIX}-strip__chevron--open`, !panel.hidden);
    });

    return strip;
  }

  // --- Scan & observe -----------------------------------------------------------

  function scan() {
    const { items, selector } = findItems();
    if (items.length === 0) return { injected: 0, total: 0, selector };

    let injected = 0;
    let skippedNoPrice = 0;
    for (const item of items) {
      if (item.querySelector(`.${STRIP_CLASS}`)) continue; // already done
      const data = extractItemData(item);
      if (!data.priceMXN) {
        skippedNoPrice++;
        continue;
      }
      const host = item.querySelector(".poly-card__content") ?? item;
      host.appendChild(buildStrip(data));
      injected++;
    }
    if (injected > 0 || skippedNoPrice > 0) {
      log(
        `quick view: ${items.length} result(s) via "${selector}", ` +
          `+${injected} strip(s) injected, ${skippedNoPrice} skipped (no price)`
      );
    }
    return { injected, total: items.length, selector };
  }

  function init() {
    // Category browse pages have a breadcrumb; keyword searches usually don't.
    const crumbs = [
      ...document.querySelectorAll(".andes-breadcrumb a, .andes-breadcrumb__link")
    ].map((a) => a.textContent.trim());
    pageCategoryGroupId = SOURCE.matchCategory(crumbs);
    log(
      "quick view init — breadcrumbs:",
      crumbs.length ? crumbs : "(none)",
      "→ category group:",
      pageCategoryGroupId ?? "(unknown, using official range)"
    );

    const first = scan();
    if (first.total === 0) {
      warn(
        "no search result items found. Probes: " +
          ITEM_SELECTORS.map(
            (s) => `${s} -> ${document.querySelectorAll(s).length}`
          ).join(", ")
      );
    }

    // Infinite scroll / pagination: re-scan when results change. scan() is
    // idempotent (skips items that already have a strip), and strips injected
    // by the scan re-trigger the observer exactly once into a no-op pass.
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        scan();
      }, 400);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  return Object.freeze({ init });
})();
