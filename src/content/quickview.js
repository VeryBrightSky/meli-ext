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
  const T = globalThis.MST_I18N.t;
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
    bar.appendChild(el("span", null, T("stripNet")));
    bar.appendChild(el("b", null, UI.fmtRange(b.netMinMXN, b.netMaxMXN)));
    const chevron = el("span", `${PREFIX}-strip__chevron`, "▾");
    bar.appendChild(chevron);
    strip.appendChild(bar);

    const panel = el("div", `${PREFIX}-strip__panel`);
    panel.hidden = true;

    panel.appendChild(
      panelRow(
        T("stripListingType"),
        data.listingTypeGuess === "premium" ? T("typePremium") : T("typeClassic")
      )
    );
    panel.appendChild(
      panelRow(
        T("stripCategory"),
        quote.categoryGroup
          ? quote.categoryGroup.label
          : T("stripUnknownCategory", [UI.fmtPctRange(quote.pctMin, quote.pctMax)])
      )
    );
    panel.appendChild(panelRow(T("stripFreeShipping"), data.freeShipping ? T("yes") : T("no")));
    if (data.seller) panel.appendChild(panelRow(T("stripSeller"), data.seller));
    panel.appendChild(
      panelRow(
        T("stripCommission", [UI.fmtPctRange(b.pctMin, b.pctMax)]),
        UI.fmtCharge(b.commissionMinMXN, b.commissionMaxMXN)
      )
    );
    if (b.fixedCostMXN > 0) {
      panel.appendChild(panelRow(T("stripFixedCost"), UI.fmtCharge(b.fixedCostMXN)));
    }
    panel.appendChild(
      panelRow(T("stripNetBeforeShipping"), UI.fmtRange(b.netMinMXN, b.netMaxMXN))
    );
    panel.appendChild(
      el("div", `${PREFIX}-strip__brand`,
        T("stripFooter", [BRAND.name, SOURCE.meta.retrievedAt]))
    );
    strip.appendChild(panel);

    bar.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      bar.setAttribute("aria-expanded", String(!panel.hidden));
      chevron.classList.toggle(`${PREFIX}-strip__chevron--open`, !panel.hidden);
    });

    return strip;
  }

  // --- CSV export -----------------------------------------------------------

  function csvEscape(value) {
    const s = String(value ?? "");
    return /[",\n;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  }

  function buildCsv() {
    const header = [
      T("csvHeaderTitle"),
      T("rowPrice"),
      T("stripListingType"),
      T("stripCategory"),
      T("stripFreeShipping"),
      T("csvCommissionMin"),
      T("csvCommissionMax"),
      T("csvNetMin"),
      T("csvNetMax")
    ];
    const groupLabel =
      SOURCE.listCategoryGroups().find((g) => g.id === pageCategoryGroupId)?.label ?? "";
    const lines = [header.map(csvEscape).join(",")];

    const { items } = findItems();
    for (const item of items) {
      if (!item.querySelector(`.${STRIP_CLASS}`)) continue; // export what's shown
      const data = extractItemData(item);
      if (!data.priceMXN) continue;
      const quote = SOURCE.getQuote({
        priceMXN: data.priceMXN,
        listingTypeId: data.listingTypeGuess,
        categoryGroupId: pageCategoryGroupId
      });
      const b = CALC.computeBreakdown(quote, {
        priceMXN: data.priceMXN,
        shippingCostMXN: 0,
        productCostMXN: 0
      });
      const title =
        item.querySelector("h2, .poly-component__title")?.textContent.trim() ?? "";
      lines.push(
        [
          title,
          b.priceMXN.toFixed(2),
          data.listingTypeGuess === "premium" ? T("typePremium") : T("typeClassic"),
          groupLabel,
          data.freeShipping ? T("yes") : T("no"),
          b.commissionMinMXN.toFixed(2),
          b.commissionMaxMXN.toFixed(2),
          b.netMinMXN.toFixed(2),
          b.netMaxMXN.toFixed(2)
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    return "﻿" + lines.join("\r\n"); // BOM so Excel opens UTF-8 correctly
  }

  function downloadCsv() {
    const blob = new Blob([buildCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${BRAND.name.toLowerCase()}-resultados.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Inject (or refresh) the export bar above the results list. Idempotent.
  function ensureExportBar(firstItem, stripCount) {
    const ID = `${PREFIX}-export`;
    let bar = document.getElementById(ID);
    if (!bar) {
      const list = firstItem.closest("ol, ul") ?? firstItem.parentElement;
      if (!list || !list.parentElement) return;
      bar = el("div", `${PREFIX}-export`);
      bar.id = ID;
      const logo = document.createElement("img");
      logo.src = chrome.runtime.getURL(BRAND.logoPath);
      logo.alt = BRAND.name;
      logo.width = 12;
      logo.height = 12;
      const btn = el("button", `${PREFIX}-export__btn`, "");
      btn.type = "button";
      btn.addEventListener("click", downloadCsv);
      bar.append(logo, btn, el("span", `${PREFIX}-export__brand`, BRAND.name));
      list.parentElement.insertBefore(bar, list);
    }
    bar.querySelector(`.${PREFIX}-export__btn`).textContent =
      `${T("btnExportCsv")} (${stripCount})`;
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
    const stripCount = items.filter((i) => i.querySelector(`.${STRIP_CLASS}`)).length;
    if (stripCount > 0) ensureExportBar(items[0], stripCount);
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
