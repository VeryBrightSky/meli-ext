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
  const RADAR = globalThis.MST_RADAR;
  const GATE = globalThis.MST_GATE;
  const UI = globalThis.MST_UI;
  const T = globalThis.MST_I18N.t;
  const TAG = `[${BRAND.name}]`;
  const STRIP_CLASS = `${PREFIX}-strip`;

  const log = (...args) => console.log(TAG, ...args);
  const warn = (...args) => console.warn(TAG, ...args);
  const SAFE = globalThis.MST_SAFE;

  let pageCategoryGroupId = null;

  // Per-init lifecycle state (torn down by destroy() on SPA navigation).
  let observer = null;
  let observerTimer = null;
  let scanTimer = null;
  // Cap strip builds per scan pass so a 50+ result page can't block the main
  // thread in one long task; the remainder is picked up on the next macrotask
  // (and by the scroll observer). The processed WeakSet keeps this idempotent.
  const MAX_STRIPS_PER_SCAN = 30;
  // Items already handled this session — skips both re-extraction AND the
  // per-item layout reads (isVisible/innerText) on every observer pass, which
  // is what keeps 50+ result pages from janking during infinite scroll.
  let processed = new WeakSet();
  let itemSelector = null; // resolved once per page, reused by later scans

  // --- Result discovery -------------------------------------------------------

  // Layered like the PDP anchor strategies. li.ui-search-layout__item verified
  // live 2026-06; the rest are fallbacks for layout drift.
  const ITEM_SELECTORS = [
    "li.ui-search-layout__item",
    ".ui-search-result__wrapper",
    ".poly-card"
  ];

  function findItems() {
    // Once a selector matched this page, stick to it (cheap re-query).
    if (itemSelector) {
      return { items: [...document.querySelectorAll(itemSelector)], selector: itemSelector };
    }
    for (const selector of ITEM_SELECTORS) {
      const items = [...document.querySelectorAll(selector)].filter(UI.isVisible);
      if (items.length > 0) {
        itemSelector = selector;
        return { items, selector };
      }
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

  // Modo investigación (Pro): assumed acquisition cost as % of price, set in
  // options; strips then show an estimated profit per result.
  let acquisitionPct = 0;

  // Profitability Radar (Pro): once an acquisition cost is set, strips become
  // green/yellow/red verdicts, the bar summarizes the page, and the seller can
  // raise the target margin or filter to winners only. Free = plain net strips.
  let radarTargetPct = RADAR.DEFAULT_TARGET_PCT;
  let onlyProfitable = false;
  const radarActive = () => GATE.isPro() && acquisitionPct > 0;

  // Free preview of the Radar: verdicts are computed for every result with an
  // assumed cost (the seller's own setting if any, else 60% of price), the
  // first FREE_VERDICTS strips show their colors for real, the rest stay plain
  // and the summary bar names how many winners the page holds. The counts are
  // the hook; seeing WHICH ones is PRO.
  const FREE_VERDICTS = 3;
  const DEFAULT_ASSUMED_COST_PCT = 60;
  const previewPct = () => (acquisitionPct > 0 ? acquisitionPct : DEFAULT_ASSUMED_COST_PCT);
  const radarPreview = () => !GATE.isPro();
  let freeVerdictsShown = 0;
  let upsellOpen = null; // set when the free export bar is built

  // Worst-case verdict for one result: classify by netMin (higher commission
  // bound) so "profitable" survives the conservative case.
  function evaluateStrip(data, b) {
    return RADAR.evaluate({
      priceMXN: data.priceMXN,
      netMXN: b.netMinMXN,
      acquisitionPct: radarActive() ? acquisitionPct : previewPct(),
      targetMarginPct: radarTargetPct
    });
  }

  // Colored profit pill shown on the strip bar in place of the plain net.
  function buildVerdict(evaln) {
    const pill = el("span", `${PREFIX}-strip__verdict`);
    pill.dataset.bucket = evaln.bucket;
    pill.appendChild(el("span", `${PREFIX}-strip__dot`));
    pill.appendChild(el("b", null, UI.fmtMoney(evaln.profitMXN)));
    pill.appendChild(el("span", `${PREFIX}-strip__margin`, `${evaln.marginPct}%`));
    return pill;
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

    // Radar verdict: stamp the strip so the summary bar, target control,
    // and "only profitable" filter can read it without recomputing. In free
    // preview the verdict is stamped as `preview` (counted, not shown) except
    // for the first few strips, which show their colors for real.
    const evaln = radarActive() || radarPreview() ? evaluateStrip(data, b) : null;
    let showVerdict = false;
    if (evaln) {
      strip.dataset.margin = String(evaln.marginPct);
      if (radarActive()) {
        strip.dataset.bucket = evaln.bucket;
        showVerdict = true;
      } else {
        strip.dataset.preview = evaln.bucket;
        if (freeVerdictsShown < FREE_VERDICTS) {
          strip.dataset.bucket = evaln.bucket;
          freeVerdictsShown += 1;
          showVerdict = true;
        }
      }
    }

    const bar = el("button", `${PREFIX}-strip__bar`);
    bar.type = "button";
    bar.setAttribute("aria-expanded", "false");
    const logo = document.createElement("img");
    logo.src = chrome.runtime.getURL(BRAND.logoPath);
    logo.alt = BRAND.name;
    logo.width = 10;
    logo.height = 10;
    bar.appendChild(logo);
    if (evaln && showVerdict) {
      bar.appendChild(buildVerdict(evaln));
    } else {
      bar.appendChild(el("span", null, T("stripNet")));
      bar.appendChild(el("b", null, UI.fmtRange(b.netMinMXN, b.netMaxMXN)));
    }
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
    if (globalThis.MST_GATE.isPro() && acquisitionPct > 0) {
      const cost = CALC.round2((data.priceMXN * acquisitionPct) / 100);
      panel.appendChild(
        panelRow(
          T("researchProfit", [String(acquisitionPct)]),
          UI.fmtRange(CALC.round2(b.netMinMXN - cost), CALC.round2(b.netMaxMXN - cost))
        )
      );
    }
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
    const active = radarActive();
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
    if (active) header.push(T("csvProfit"), T("csvMargin"));
    const groupLabel =
      SOURCE.listCategoryGroups().find((g) => g.id === pageCategoryGroupId)?.label ?? "";

    // Collect rows as objects so the profitable shortlist can be ranked.
    const rows = [];
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
      const cells = [
        title,
        b.priceMXN.toFixed(2),
        data.listingTypeGuess === "premium" ? T("typePremium") : T("typeClassic"),
        groupLabel,
        data.freeShipping ? T("yes") : T("no"),
        b.commissionMinMXN.toFixed(2),
        b.commissionMaxMXN.toFixed(2),
        b.netMinMXN.toFixed(2),
        b.netMaxMXN.toFixed(2)
      ];
      let marginPct = 0;
      if (active) {
        const evaln = evaluateStrip(data, b);
        if (onlyProfitable && evaln.bucket !== "profit") continue; // shortlist
        cells.push(evaln.profitMXN.toFixed(2), evaln.marginPct.toFixed(1));
        marginPct = evaln.marginPct;
      }
      rows.push({ cells, marginPct });
    }
    // Winners first when exporting the shortlist (stable on ties via the
    // shared, tested radar helper).
    const ordered = active && onlyProfitable ? RADAR.rankByMargin(rows) : rows;

    const lines = [header.map(csvEscape).join(",")];
    for (const r of ordered) lines.push(r.cells.map(csvEscape).join(","));
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

  // --- Radar controls (Pro) -------------------------------------------------

  // All strips carrying a radar verdict.
  function radarStrips() {
    return [...document.querySelectorAll(`.${STRIP_CLASS}`)].filter(
      (s) => s.dataset.margin !== undefined
    );
  }

  // Re-bucket every strip against the current target (margin is target-
  // independent, so no recompute), refresh the summary, and dim non-winners
  // when "only profitable" is on.
  function reapplyRadar() {
    const strips = radarStrips();
    for (const s of strips) {
      const bucket = RADAR.bucketFor(Number(s.dataset.margin), radarTargetPct);
      s.dataset.bucket = bucket;
      const pill = s.querySelector(`.${PREFIX}-strip__verdict`);
      if (pill) pill.dataset.bucket = bucket;
      const item = s.closest(ITEM_SELECTORS.join(",")) ?? s.parentElement;
      if (item) {
        item.classList.toggle(`${PREFIX}-dimmed`, onlyProfitable && bucket !== "profit");
      }
    }
    const summaryEl = document.querySelector(`.${PREFIX}-radar__summary`);
    if (summaryEl) {
      const c = RADAR.summarize(strips.map((s) => ({ bucket: s.dataset.bucket })));
      summaryEl.textContent = T("radarSummary", [
        String(c.total),
        String(c.profit),
        String(c.thin),
        String(c.loss)
      ]);
    }
  }

  // Export button label tracks the active mode (all vs profitable shortlist).
  function refreshExportBtn() {
    const btn = document.querySelector(`.${PREFIX}-export__btn`);
    if (!btn) return;
    if (radarActive() && onlyProfitable) {
      const n = document.querySelectorAll(`.${STRIP_CLASS}[data-bucket="profit"]`).length;
      btn.textContent = T("btnExportProfitable", [String(n)]);
    } else {
      btn.textContent = `${T("btnExportCsv")} (${document.querySelectorAll(`.${STRIP_CLASS}`).length})`;
    }
  }

  // Free preview row: live counts for the page + CTA. Rebuilt on each scan
  // via refreshPreviewSummary().
  function buildPreviewRow() {
    const row = el("div", `${PREFIX}-radar ${PREFIX}-radar--preview`);
    row.appendChild(el("span", `${PREFIX}-radar__summary`, ""));
    const cta = el("button", `${PREFIX}-radar__cta`, T("radarSeeAll"));
    cta.type = "button";
    cta.addEventListener("click", () => {
      const c = previewCounts();
      if (upsellOpen) upsellOpen("radar", c.profit > 0 ? [String(c.profit)] : []);
    });
    row.appendChild(cta);
    row.appendChild(el("span", `${PREFIX}-radar__more`, ""));
    return row;
  }

  function previewCounts() {
    const strips = [...document.querySelectorAll(`.${STRIP_CLASS}[data-preview]`)];
    return RADAR.summarize(strips.map((s) => ({ bucket: s.dataset.preview })));
  }

  function refreshPreviewSummary() {
    const summaryEl = document.querySelector(`.${PREFIX}-radar--preview .${PREFIX}-radar__summary`);
    if (!summaryEl) return;
    const c = previewCounts();
    summaryEl.textContent = T("radarFreeSummary", [
      String(c.total),
      String(c.profit),
      String(c.thin),
      String(c.loss),
      String(previewPct())
    ]);
    const more = document.querySelector(`.${PREFIX}-radar--preview .${PREFIX}-radar__more`);
    const hidden = Math.max(0, c.total - FREE_VERDICTS);
    if (more) more.textContent = hidden > 0 ? T("radarMoreLocked", [String(hidden)]) : "";
  }

  // Inline acquisition-cost input so a PRO/trial user can switch the Radar on
  // from the results page (the options page was the only way before).
  function buildCostField() {
    const field = el("label", `${PREFIX}-radar__costfield`);
    field.appendChild(el("span", null, T("radarCostLabel")));
    const input = el("input", `${PREFIX}-radar__cost`);
    input.type = "number";
    input.min = "0";
    input.max = "99";
    input.step = "1";
    input.value = acquisitionPct > 0 ? String(acquisitionPct) : "";
    input.placeholder = String(DEFAULT_ASSUMED_COST_PCT);
    input.setAttribute("aria-label", T("radarCostLabel"));
    input.addEventListener("change", async () => {
      const v = Math.max(0, Math.min(99, Math.round(Number(input.value) || 0)));
      await chrome.storage.sync.set({ acquisitionPct: v });
      // Verdicts depend on the cost: rebuild the strips and the bar in place.
      SAFE.run("quickview-reinit", () => init().catch((err) => warn("re-init failed:", err)));
    });
    field.appendChild(input);
    return field;
  }

  function buildRadarRow() {
    const row = el("div", `${PREFIX}-radar`);
    row.appendChild(buildCostField());
    row.appendChild(el("span", `${PREFIX}-radar__summary`));

    const field = el("label", `${PREFIX}-radar__field`);
    field.appendChild(el("span", null, T("radarTarget")));
    const input = el("input", `${PREFIX}-radar__target`);
    input.type = "number";
    input.min = "0";
    input.max = "90";
    input.step = "5";
    input.value = String(radarTargetPct);
    input.setAttribute("aria-label", T("radarTarget"));
    input.addEventListener("input", () => {
      radarTargetPct = Math.max(0, Math.min(90, Math.round(Number(input.value) || 0)));
      chrome.storage.sync.set({ radarTargetPct });
      reapplyRadar();
      refreshExportBtn();
    });
    field.append(input, el("span", null, "%"));
    row.appendChild(field);

    const only = el("button", `${PREFIX}-radar__only`, T("radarOnly"));
    only.type = "button";
    only.setAttribute("aria-pressed", "false");
    only.addEventListener("click", () => {
      onlyProfitable = !onlyProfitable;
      only.classList.toggle(`${PREFIX}-radar__only--active`, onlyProfitable);
      only.setAttribute("aria-pressed", String(onlyProfitable));
      reapplyRadar();
      refreshExportBtn();
    });
    row.appendChild(only);
    return row;
  }

  // Inject (or refresh) the bar above the results list. Idempotent.
  //   Free:  PRO chip + locked CSV that opens the upsell.
  //   Pro:   real CSV export. With an acquisition cost set, the Radar row
  //          (page summary + target margin + "only profitable") is added.
  function ensureExportBar(firstItem) {
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
      const wrap = el("div", `${PREFIX}-export__main`);
      wrap.append(logo, btn);
      if (GATE.isPro()) {
        btn.addEventListener("click", downloadCsv);
        if (acquisitionPct > 0) {
          wrap.appendChild(
            el("span", `${PREFIX}-export__research`, T("researchActive", [String(acquisitionPct)]))
          );
        }
      } else {
        const upsell = globalThis.MST_UPSELL.attach(bar);
        upsellOpen = (reason, vars) => upsell.open(reason, vars);
        const open = () => {
          const c = previewCounts();
          upsellOpen("radar", c.profit > 0 ? [String(c.profit)] : []);
        };
        btn.classList.add(`${PREFIX}-locked`);
        btn.addEventListener("click", open);
        wrap.appendChild(globalThis.MST_UPSELL.chip(open));
      }
      bar.prepend(wrap);
      bar.querySelector(`.${PREFIX}-export__main`).appendChild(
        el("span", `${PREFIX}-export__brand`, BRAND.name)
      );

      bar.classList.add(`${PREFIX}-export--radar`);
      if (radarActive()) {
        bar.appendChild(buildRadarRow());
      } else if (GATE.isPro()) {
        // Entitled but no cost yet: the row with the inline input, so the
        // Radar is one keystroke away instead of buried in options.
        const row = el("div", `${PREFIX}-radar`);
        row.appendChild(buildCostField());
        row.appendChild(el("span", `${PREFIX}-radar__more`, T("radarSetCost")));
        bar.appendChild(row);
      } else {
        bar.insertBefore(buildPreviewRow(), upsellPanelOf(bar));
      }
      list.parentElement.insertBefore(bar, list);
    }
    if (radarActive()) reapplyRadar();
    if (radarPreview()) refreshPreviewSummary();
    refreshExportBtn();
  }

  // The upsell panel (free bar) must stay last so the preview row sits above it.
  function upsellPanelOf(bar) {
    return bar.querySelector(`.${PREFIX}-upsell`);
  }

  // --- Scan & observe -----------------------------------------------------------

  function scan() {
    const { items, selector } = findItems();
    if (items.length === 0) return { injected: 0, total: 0, selector };

    let injected = 0;
    let skippedNoPrice = 0;
    let failed = 0;
    let capped = false;
    for (const item of items) {
      if (processed.has(item)) continue; // no repeat layout reads
      if (item.querySelector(`.${STRIP_CLASS}`)) {
        processed.add(item);
        continue;
      }
      // Yield after a batch so a big page doesn't build every strip in one
      // long task; the rest is caught on the scheduled follow-up pass below.
      if (injected >= MAX_STRIPS_PER_SCAN) {
        capped = true;
        break;
      }
      // One broken result (unexpected markup) must not kill the other strips.
      try {
        if (!UI.isVisible(item)) continue; // lazy placeholder — retry next pass
        const data = extractItemData(item);
        if (!data.priceMXN) {
          skippedNoPrice++;
          processed.add(item);
          continue;
        }
        const host = item.querySelector(".poly-card__content") ?? item;
        host.appendChild(buildStrip(data));
        processed.add(item);
        injected++;
      } catch (err) {
        failed++;
        processed.add(item); // don't retry a poisoned item every pass
        warn("strip failed for one result (skipped):", err);
      }
    }
    if (injected > 0 || skippedNoPrice > 0 || failed > 0) {
      log(
        `quick view: ${items.length} result(s) via "${selector}", ` +
          `+${injected} strip(s) injected, ${skippedNoPrice} skipped (no price)` +
          (failed > 0 ? `, ${failed} failed` : "")
      );
    }
    const first = items.find((i) => i.querySelector(`.${STRIP_CLASS}`));
    if (first) SAFE.run("export-bar", () => ensureExportBar(first));
    // More results than this pass built: continue on the next macrotask so the
    // browser can paint between batches.
    if (capped) {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => SAFE.run("quickview-scan-more", scan), 0);
    }
    return { injected, total: items.length, selector };
  }

  // Full teardown for SPA navigation: stop observing, remove every injected
  // node, reset per-page state. Idempotent — safe to call twice.
  function destroy() {
    observer?.disconnect();
    observer = null;
    clearTimeout(observerTimer);
    observerTimer = null;
    clearTimeout(scanTimer);
    scanTimer = null;
    processed = new WeakSet();
    itemSelector = null;
    pageCategoryGroupId = null;
    onlyProfitable = false;
    for (const node of document.querySelectorAll(`.${STRIP_CLASS}, #${PREFIX}-export`)) {
      node.remove();
    }
    for (const dimmed of document.querySelectorAll(`.${PREFIX}-dimmed`)) {
      dimmed.classList.remove(`${PREFIX}-dimmed`);
    }
  }

  // A mutation batch caused entirely by our own strip/bar injections must not
  // schedule another scan — that would be a self-feeding loop.
  function isOurMutation(m) {
    const t = m.target;
    if (!(t instanceof Element)) return false;
    if (t.closest(`.${STRIP_CLASS}, #${PREFIX}-export`)) return true;
    return (
      m.addedNodes.length > 0 &&
      [...m.addedNodes].every(
        (n) =>
          n instanceof Element &&
          (n.classList?.contains(STRIP_CLASS) || n.id === `${PREFIX}-export`)
      )
    );
  }

  async function init() {
    destroy(); // re-init after SPA navigation starts clean
    freeVerdictsShown = 0;
    upsellOpen = null;
    const settings = await chrome.storage.sync.get({
      acquisitionPct: 0,
      radarTargetPct: RADAR.DEFAULT_TARGET_PCT
    });
    acquisitionPct = CALC.parseMoney(settings.acquisitionPct);
    radarTargetPct = Math.max(0, Math.min(90, Math.round(Number(settings.radarTargetPct) || 0)));
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

    const first = SAFE.run("quickview-scan", scan, { injected: 0, total: 0 });
    if (first.total === 0) {
      warn(
        "no search result items found. Probes: " +
          ITEM_SELECTORS.map(
            (s) => `${s} -> ${document.querySelectorAll(s).length}`
          ).join(", ")
      );
    }

    // Infinite scroll / pagination: re-scan when results change. scan() is
    // idempotent (processed WeakSet + strip check), and our own injections
    // are filtered out so they never re-trigger a pass.
    let pending = false;
    observer = new MutationObserver(
      SAFE.wrap("quickview-observer", (mutations) => {
        if (pending) return;
        if (mutations.every(isOurMutation)) return;
        pending = true;
        observerTimer = setTimeout(
          SAFE.wrap("quickview-rescan", () => {
            pending = false;
            scan();
          }),
          400
        );
      })
    );
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  return Object.freeze({ init, destroy });
})();
