// Seller fee card UI. The DOM is built ONCE; recalculations patch text nodes
// in place so inputs are stable nodes that never lose focus mid-typing.
// DOM-only module: no page extraction (page-data.js), no fee math
// (calculator.js).
"use strict";

globalThis.MST_CARD = (() => {
  const BRAND = globalThis.EXT_BRAND;
  const PREFIX = BRAND.cssPrefix;
  const CARD_ID = `${PREFIX}-card-root`;
  const SOURCE = globalThis.MST_FEE_SOURCE;
  const CALC = globalThis.MST_CALC;
  const UI = globalThis.MST_UI;
  const T = globalThis.MST_I18N.t;

  // Mutable card state — survives re-injection because the module outlives
  // the DOM node (persistence watcher rebuilds from this).
  const state = {
    priceMXN: 0,
    pagePriceMXN: 0, // the price actually on the page; priceMXN is what-if
    itemId: null,
    listingTypeId: "classic",
    categoryGroupId: null,
    categoryAutoDetected: false,
    shippingCostMXN: 0,
    productCostMXN: 0,
    targetMarginPct: 0,
    salesPerMonth: 0,
    compareOpen: false,
    usesFull: false,
    showWithholdings: false,
    reputationId: "none",
    freeShipping: false,
    weightKg: 0,
    pro: false,
    // MSI (meses sin intereses): selected term and the seller's OWN per-term
    // financing rate. The seller's entered value always wins over the
    // reference default and persists per term in chrome.storage.sync.
    msiOpen: false,
    msiTerm: 3,
    msiRates: {} // { "3": pct, "6": pct, ... } — sparse; unset falls to reference
  };

  // Reference default charge % for a term (rough, account-specific in reality).
  const msiReferencePct = (months) =>
    SOURCE.msiReference.terms.find((t) => t.months === months)?.chargePct ?? 0;

  // The rate in effect for the selected term: the seller's saved value wins,
  // else the reference default. Whether the current value is the seller's own
  // (vs the reference) drives the "referencia aproximada" note.
  const msiTermMonths = [3, 6, 9, 12];
  const msiCurrentIsOwn = () =>
    Object.prototype.hasOwnProperty.call(state.msiRates, String(state.msiTerm));
  const msiCurrentRate = () =>
    msiCurrentIsOwn()
      ? state.msiRates[String(state.msiTerm)]
      : msiReferencePct(state.msiTerm);

  // Full mode needs a weight; default to the smallest bracket when unset.
  const fullWeightKg = () =>
    state.usesFull ? (state.weightKg > 0 ? state.weightKg : 0.3) : null;

  // Live references into the current card DOM, repopulated on each build().
  const refs = {};

  const { fmtMoney, fmtRange, fmtCharge, fmtPctRange } = UI;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function buildRow(labelText, modifier) {
    const root = el("div", `${PREFIX}-row${modifier ? ` ${PREFIX}-row--${modifier}` : ""}`);
    const label = el("span", `${PREFIX}-row__label`, labelText);
    const value = el("span", `${PREFIX}-row__value`, "");
    root.append(label, value);
    return { root, label, value };
  }

  // Patch a row's texts; flash the row when a value actually changed.
  function patchRow(rowRef, labelText, valueText, flash) {
    if (labelText !== null && rowRef.label.textContent !== labelText) {
      rowRef.label.textContent = labelText;
    }
    if (rowRef.value.textContent === valueText) return;
    rowRef.value.textContent = valueText;
    if (flash) {
      rowRef.root.classList.remove(`${PREFIX}-row--flash`);
      void rowRef.root.offsetWidth; // restart the animation
      rowRef.root.classList.add(`${PREFIX}-row--flash`);
    }
  }

  function debounced(fn, ms = 200) {
    let timer = null;
    const wrapped = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    };
    wrapped.flush = () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      fn();
    };
    return wrapped;
  }

  // Money input: type=text + inputmode=decimal so commas are typeable.
  // Never reformatted while focused; normalized to "123.45" on blur.
  // Enter confirms (blurs). Recalc is debounced on 'input'.
  function moneyInput(getValue, onValue) {
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.placeholder = "0.00";
    input.className = `${PREFIX}-input`;

    const apply = () => onValue(CALC.parseMoney(input.value));
    const debouncedApply = debounced(apply);

    input.addEventListener("input", debouncedApply);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
    });
    input.addEventListener("blur", () => {
      debouncedApply.flush();
      const v = getValue();
      input.value = v > 0 ? v.toFixed(2) : "";
    });

    input.syncFromState = () => {
      if (document.activeElement === input) return; // never fight the user
      const v = getValue();
      input.value = v > 0 ? v.toFixed(2) : "";
    };
    return input;
  }

  function persistInputs() {
    const record = {
      shippingCostMXN: state.shippingCostMXN,
      targetMarginPct: state.targetMarginPct
    };
    chrome.storage.local.set({ [`${PREFIX}:defaults`]: record });
    if (state.itemId) {
      chrome.storage.local.set({
        [`${PREFIX}:cost:${state.itemId}`]: state.productCostMXN,
        [`${PREFIX}:sales:${state.itemId}`]: state.salesPerMonth,
        [`${PREFIX}:weight:${state.itemId}`]: state.weightKg
      });
      // Listing snapshot for the dashboard (only meaningful with a cost).
      if (state.productCostMXN > 0) {
        chrome.storage.local.set({
          [`${PREFIX}:meta:${state.itemId}`]: {
            title: document.title.split("|")[0].trim().slice(0, 120),
            priceMXN: state.pagePriceMXN,
            listingTypeId: state.listingTypeId,
            categoryGroupId: state.categoryGroupId,
            url: window.location.href.split("#")[0],
            updatedAt: Date.now()
          }
        });
      }
    }
  }

  // MSI settings are account-wide (a seller's Mercado Pago rates), so they
  // persist in sync storage alongside the other global preferences — not per
  // item like product cost.
  function persistMsi() {
    chrome.storage.sync.set({ msiRates: state.msiRates, msiTerm: state.msiTerm });
  }

  async function restoreInputs() {
    const keys = [`${PREFIX}:defaults`];
    if (state.itemId) {
      keys.push(
        `${PREFIX}:cost:${state.itemId}`,
        `${PREFIX}:catpick:${state.itemId}`,
        `${PREFIX}:sales:${state.itemId}`,
        `${PREFIX}:weight:${state.itemId}`
      );
    }
    const [stored, settings] = await Promise.all([
      chrome.storage.local.get(keys),
      chrome.storage.sync.get({
        defaultShippingMXN: null,
        defaultListingType: "auto",
        usesFull: false,
        showWithholdings: false,
        reputationId: "none",
        freeShipping: false,
        msiRates: {},
        msiTerm: 3
      })
    ]);
    // MSI: restore the seller's own per-term rates and last-picked term.
    state.msiRates =
      settings.msiRates && typeof settings.msiRates === "object" ? settings.msiRates : {};
    state.msiTerm = msiTermMonths.includes(settings.msiTerm) ? settings.msiTerm : 3;
    state.usesFull = settings.usesFull === true;
    state.showWithholdings = settings.showWithholdings === true;
    state.reputationId =
      typeof settings.reputationId === "string" ? settings.reputationId : "none";
    state.freeShipping = settings.freeShipping === true;
    state.weightKg = CALC.parseMoney(stored[`${PREFIX}:weight:${state.itemId}`] ?? 0);
    const defaults = stored[`${PREFIX}:defaults`];
    // Single default-shipping source of truth, shared with the dashboard
    // (MST_DASH.resolveDefaultShipping): an explicit options value — including a
    // deliberate 0 — is authoritative; only a null/absent (unset) options value
    // falls back to the card's last-used local value. Keeps the card and the
    // dashboard from ever showing different profit for the same listing.
    const optShip = settings.defaultShippingMXN;
    state.shippingCostMXN =
      optShip === null || optShip === undefined
        ? CALC.parseMoney(defaults?.shippingCostMXN ?? 0)
        : CALC.parseMoney(optShip);
    state.targetMarginPct = CALC.parseMoney(defaults?.targetMarginPct ?? 0);
    state.productCostMXN = CALC.parseMoney(stored[`${PREFIX}:cost:${state.itemId}`] ?? 0);
    state.salesPerMonth = CALC.parseMoney(stored[`${PREFIX}:sales:${state.itemId}`] ?? 0);
    if (settings.defaultListingType !== "auto") {
      state.listingTypeId = settings.defaultListingType === "premium" ? "premium" : "classic";
    }
    // Manual category pick saved for this listing beats auto-detection.
    const savedPick = stored[`${PREFIX}:catpick:${state.itemId}`];
    if (savedPick && SOURCE.listCategoryGroups().some((g) => g.id === savedPick)) {
      state.categoryGroupId = savedPick;
      state.categoryAutoDetected = false;
    }
  }

  // --- Update (no DOM rebuilding) ---------------------------------------------

  function computeCurrent() {
    const quote = SOURCE.getQuote({
      priceMXN: state.priceMXN,
      listingTypeId: state.listingTypeId,
      categoryGroupId: state.categoryGroupId,
      fullWeightKg: fullWeightKg()
    });
    const subsidyPct =
      SOURCE.shippingSubsidy.levels.find((l) => l.id === state.reputationId)?.subsidyPct || 0;
    const effectiveShipping = CALC.subsidizedShipping({
      fullShippingMXN: state.shippingCostMXN,
      priceMXN: state.priceMXN,
      freeShipping: state.freeShipping,
      subsidyPct,
      thresholdMXN: SOURCE.shippingSubsidy.thresholdMXN
    });
    const b = CALC.computeBreakdown(quote, {
      priceMXN: state.priceMXN,
      shippingCostMXN: effectiveShipping,
      productCostMXN: state.productCostMXN
    });
    return { quote, b, effectiveShipping };
  }

  function update(flash = true) {
    if (!refs.card) return;
    try {
      updateUnsafe(flash);
    } catch (err) {
      // A render failure must never leave inputs dead mid-typing; log once
      // and keep the last consistent view.
      console.warn(`[${BRAND.name}] card update failed (keeping last view):`, err);
    }
  }

  function updateUnsafe(flash) {
    const { quote, b, effectiveShipping } = computeCurrent();

    const pro = state.pro;
    // One discontinuity model for this render: quotes, sweet spot and the
    // solver all see the same fixed-charge/Full-service-cost function.
    const fixedCostFn = SOURCE.fixedCostFnFor({
      listingTypeId: state.listingTypeId,
      fullWeightKg: fullWeightKg()
    });

    // What-if price: reset link only when diverging from the page price.
    refs.resetPrice.style.display =
      pro && state.priceMXN !== state.pagePriceMXN ? "" : "none";
    refs.shipLabel.textContent =
      state.priceMXN >= SOURCE.freeShippingThresholdMXN
        ? T("rowShippingFree")
        : T("rowShipping");

    // Sweet spot (worst-case rate so the promised gain is conservative). Pro.
    const spot = pro
      ? CALC.findSweetSpot({
          priceMXN: state.priceMXN,
          ratePct: quote.pctMax,
          fixedCostFn,
          thresholds: SOURCE.getFixedCostThresholds()
        })
      : null;
    refs.sweetspot.style.display = spot ? "" : "none";
    if (spot) {
      refs.sweetspot.textContent = T("sweetSpot", [
        fmtMoney(spot.targetPriceMXN),
        fmtMoney(spot.netGainMXN)
      ]);
      refs.sweetspot.dataset.target = String(spot.targetPriceMXN);
    } else {
      delete refs.sweetspot.dataset.target;
    }

    // Clásica vs Premium comparison. Pro.
    refs.compareBtn.setAttribute("aria-pressed", String(pro && state.compareOpen));
    refs.compareBtn.classList.toggle(
      `${PREFIX}-compare-toggle--active`,
      pro && state.compareOpen
    );
    refs.compareBox.style.display = pro && state.compareOpen ? "" : "none";
    if (pro && state.compareOpen) {
      const inputs = {
        priceMXN: state.priceMXN,
        // Use the subsidized shipping so the Clásica/Premium comparison matches
        // the card's own net (both are the same item at the same price).
        shippingCostMXN: effectiveShipping,
        productCostMXN: 0
      };
      const c = CALC.computeBreakdown(
        SOURCE.getQuote({
          priceMXN: state.priceMXN,
          listingTypeId: "classic",
          categoryGroupId: state.categoryGroupId,
          fullWeightKg: fullWeightKg()
        }),
        inputs
      );
      const p = CALC.computeBreakdown(
        SOURCE.getQuote({
          priceMXN: state.priceMXN,
          listingTypeId: "premium",
          categoryGroupId: state.categoryGroupId,
          fullWeightKg: fullWeightKg()
        }),
        inputs
      );
      patchRow(refs.compareClassic, null, fmtRange(c.netMinMXN, c.netMaxMXN), flash);
      patchRow(refs.comparePremium, null, fmtRange(p.netMinMXN, p.netMaxMXN), flash);
      // Interval difference: [cMin − pMax, cMax − pMin] — the true bounds.
      patchRow(
        refs.compareDiff,
        null,
        fmtRange(
          CALC.round2(c.netMinMXN - p.netMaxMXN),
          CALC.round2(c.netMaxMXN - p.netMinMXN)
        ),
        flash
      );
    }

    // Meses sin intereses (MSI). Pro. WITHOUT = the card's own net/margin (b);
    // WITH = subtract the estimated financing cost from net (and from profit,
    // when a product cost is set), then recompute the margin the SAME way the
    // card does elsewhere: profit-based with a cost, net-based without.
    refs.msiBtn.setAttribute("aria-pressed", String(pro && state.msiOpen));
    refs.msiBtn.classList.toggle(`${PREFIX}-msi-toggle--active`, pro && state.msiOpen);
    refs.msiBox.style.display = pro && state.msiOpen ? "" : "none";
    if (pro && state.msiOpen) {
      // Never fight the user while they type their own rate.
      if (document.activeElement !== refs.msiRateInput) {
        refs.msiRateInput.value = String(msiCurrentRate());
      }
      refs.msiTermSelect.value = String(state.msiTerm);
      refs.msiRefNote.style.display = msiCurrentIsOwn() ? "none" : "";
      // Classic listings don't offer MSI — mark the section informational.
      refs.msiWhatIf.style.display = state.listingTypeId === "classic" ? "" : "none";

      const msiCost = CALC.msiCost(state.priceMXN, msiCurrentRate());
      patchRow(refs.msiCost, null, fmtCharge(msiCost), flash);

      const netWithMin = CALC.round2(b.netMinMXN - msiCost);
      const netWithMax = CALC.round2(b.netMaxMXN - msiCost);
      refs.msiWithout.net.textContent = `${T("msiNetLabel")} ${fmtRange(b.netMinMXN, b.netMaxMXN)}`;
      refs.msiWith.net.textContent = `${T("msiNetLabel")} ${fmtRange(netWithMin, netWithMax)}`;

      const price = state.priceMXN;
      const marginText = (min, max) =>
        `${T("msiMarginLabel")} ${fmtPctRange(min, max)}`;
      if (b.profitMinMXN !== undefined) {
        // With a product cost: margin = profit / price × 100.
        const profWithMin = CALC.round2(b.profitMinMXN - msiCost);
        const profWithMax = CALC.round2(b.profitMaxMXN - msiCost);
        refs.msiWithout.margin.textContent = marginText(b.marginMinPct, b.marginMaxPct);
        refs.msiWith.margin.textContent = marginText(
          price > 0 ? CALC.round2((profWithMin / price) * 100) : 0,
          price > 0 ? CALC.round2((profWithMax / price) * 100) : 0
        );
      } else {
        // No product cost: match the card's net-based view (net / price × 100).
        const netMarginMin = price > 0 ? CALC.round2((b.netMinMXN / price) * 100) : 0;
        const netMarginMax = price > 0 ? CALC.round2((b.netMaxMXN / price) * 100) : 0;
        refs.msiWithout.margin.textContent = marginText(netMarginMin, netMarginMax);
        refs.msiWith.margin.textContent = marginText(
          price > 0 ? CALC.round2((netWithMin / price) * 100) : 0,
          price > 0 ? CALC.round2((netWithMax / price) * 100) : 0
        );
      }
    }

    patchRow(
      refs.commission,
      T("rowCommission", [fmtPctRange(b.pctMin, b.pctMax)]),
      fmtCharge(b.commissionMinMXN, b.commissionMaxMXN),
      flash
    );

    refs.fixed.root.style.display = b.fixedCostMXN > 0 ? "" : "none";
    if (b.fixedCostMXN > 0) {
      patchRow(
        refs.fixed,
        quote.isFullServiceCost ? T("rowServiceCost") : T("rowFixedCost"),
        fmtCharge(b.fixedCostMXN),
        flash
      );
    }

    // Withholdings (informational; does not change "Recibirás aprox.").
    const showW = state.showWithholdings;
    refs.iva.root.style.display = showW ? "" : "none";
    refs.isr.root.style.display = showW ? "" : "none";
    refs.netAfter.root.style.display = showW ? "" : "none";
    refs.withholdingsHint.style.display = showW ? "" : "none";
    if (showW) {
      const w = CALC.computeWithholdings(state.priceMXN, SOURCE.withholdings);
      patchRow(refs.iva, null, fmtCharge(w.ivaMXN), flash);
      patchRow(refs.isr, null, fmtCharge(w.isrMXN), flash);
      patchRow(
        refs.netAfter,
        null,
        fmtRange(
          CALC.round2(b.netMinMXN - w.totalMXN),
          CALC.round2(b.netMaxMXN - w.totalMXN)
        ),
        flash
      );
    }

    patchRow(
      refs.effective,
      null,
      fmtPctRange(b.effectiveRateMinPct, b.effectiveRateMaxPct),
      flash
    );

    // Shipping subsidy: informational, only when a subsidy actually applies.
    const subsidyApplies = effectiveShipping < state.shippingCostMXN;
    refs.shippingSubsidy.root.style.display = subsidyApplies ? "" : "none";
    if (subsidyApplies) {
      patchRow(
        refs.shippingSubsidy,
        null,
        fmtCharge(CALC.round2(state.shippingCostMXN - effectiveShipping)),
        flash
      );
    }

    patchRow(refs.net, null, fmtRange(b.netMinMXN, b.netMaxMXN), flash);

    const hasProfit = b.profitMinMXN !== undefined;
    refs.profit.root.style.display = hasProfit ? "" : "none";
    if (hasProfit) {
      const losing = b.profitMaxMXN < 0; // even the best case loses money
      const marginText = fmtPctRange(b.marginMinPct, b.marginMaxPct);
      const value = losing
        ? `${T("youLose")} ${fmtRange(-b.profitMaxMXN, -b.profitMinMXN)} (${marginText})`
        : `${fmtRange(b.profitMinMXN, b.profitMaxMXN)} (${marginText})`;
      patchRow(refs.profit, null, value, flash);
      refs.profit.root.classList.toggle(`${PREFIX}-row--loss`, losing);
      // Health dot: red loss, else by worst-case margin (<10/10-25/>25).
      refs.profit.root.dataset.health = losing
        ? "red"
        : UI.marginHealth(b.marginMinPct);
    }

    // Breakeven + target price (reverse calculator). Range rates produce a
    // price range; the WORST case (pctMax) is the safe number to act on.
    const hasCost = state.productCostMXN > 0;
    const solve = (ratePct, marginPct) =>
      CALC.solveTargetPrice({
        costMXN: state.productCostMXN,
        // Subsidized shipping so break-even / target price stay consistent with
        // the displayed net (approximated at the current price near the $299
        // subsidy threshold).
        shippingMXN: effectiveShipping,
        marginPct,
        ratePct,
        fixedCostFn
      });

    refs.breakeven.root.style.display = hasCost ? "" : "none";
    if (hasCost) {
      const lo = solve(quote.pctMin, 0);
      const hi = solve(quote.pctMax, 0);
      patchRow(refs.breakeven, null, lo !== null && hi !== null ? fmtRange(lo, hi) : "—", flash);
    }

    if (pro) {
      refs.targetMarginRow.style.display = hasCost ? "" : "none";
      const hasTarget = hasCost && state.targetMarginPct > 0;
      refs.target.root.style.display = hasTarget ? "" : "none";
      if (hasTarget) {
        const lo = solve(quote.pctMin, state.targetMarginPct);
        const hi = solve(quote.pctMax, state.targetMarginPct);
        patchRow(
          refs.target,
          null,
          lo !== null && hi !== null ? fmtRange(lo, hi) : T("targetUnreachable"),
          flash
        );
      }

      // Monthly profit: profit per unit × user-entered sales/month.
      const hasMonthly =
        hasCost && state.salesPerMonth > 0 && b.profitMinMXN !== undefined;
      refs.salesRow.style.display = hasCost ? "" : "none";
      refs.monthly.root.style.display = hasMonthly ? "" : "none";
      if (hasMonthly) {
        patchRow(
          refs.monthly,
          null,
          fmtRange(
            CALC.round2(b.profitMinMXN * state.salesPerMonth),
            CALC.round2(b.profitMaxMXN * state.salesPerMonth)
          ),
          flash
        );
      }
    }

    // Category hint + toggle button states.
    if (!state.categoryGroupId) {
      refs.hint.textContent = T("hintNoCategory", [fmtPctRange(quote.pctMin, quote.pctMax)]);
      refs.hint.style.display = "";
    } else if (state.categoryAutoDetected) {
      refs.hint.textContent = T("hintDetected");
      refs.hint.style.display = "";
    } else {
      refs.hint.style.display = "none";
    }
    for (const [id, btn] of Object.entries(refs.toggleButtons)) {
      const active = state.listingTypeId === id;
      btn.classList.toggle(`${PREFIX}-toggle__btn--active`, active);
      btn.setAttribute("aria-pressed", String(active));
    }
  }

  // --- Build (once per injection) -----------------------------------------------

  function buildSkeletonRows(body) {
    for (const width of ["60%", "85%", "40%"]) {
      const skeletonRow = el("div", `${PREFIX}-skeleton`);
      skeletonRow.style.width = width;
      body.appendChild(skeletonRow);
    }
  }

  function buildCalculator(body) {
    // Assigned at the end once the upsell panel exists; locked features call
    // it through this closure.
    let openUpsell = () => {};
    const UPSELL = globalThis.MST_UPSELL;

    const header = el("div", `${PREFIX}-header`);
    header.appendChild(el("h2", `${PREFIX}-title`, T("cardTitle")));
    const badge = el("span", `${PREFIX}-badge`, T("badgeEstimate"));
    badge.setAttribute("title", T("badgeTooltip", [SOURCE.meta.retrievedAt]));
    badge.tabIndex = 0;
    header.appendChild(badge);
    body.appendChild(header);

    // What-if price: editable, pre-filled from the page; reset link restores.
    const priceRow = el("div", `${PREFIX}-row`);
    priceRow.appendChild(el("span", `${PREFIX}-row__label`, T("rowPrice")));
    const priceWrap = el("span", `${PREFIX}-pricewrap`);
    refs.resetPrice = el("button", `${PREFIX}-reset`, T("resetPrice"));
    refs.resetPrice.type = "button";
    refs.resetPrice.addEventListener("click", () => {
      state.priceMXN = state.pagePriceMXN;
      refs.priceInput.syncFromState();
      update();
    });
    refs.priceInput = moneyInput(
      () => state.priceMXN,
      (v) => {
        if (v > 0) state.priceMXN = v; // ignore empty/zero — price can't be 0
        update();
      }
    );
    refs.priceInput.setAttribute("aria-label", T("rowPrice"));
    priceWrap.append(refs.resetPrice, refs.priceInput);
    if (!state.pro) {
      // What-if editing is Pro: input stays visible (shows the page price)
      // but read-only, with a chip that opens the upsell.
      refs.priceInput.disabled = true;
      priceWrap.appendChild(UPSELL.chip(() => openUpsell()));
    }
    priceRow.appendChild(priceWrap);
    body.appendChild(priceRow);

    // Listing type toggle.
    const typeRow = el("div", `${PREFIX}-row`);
    typeRow.appendChild(el("span", `${PREFIX}-row__label`, T("rowListingType")));
    const toggle = el("div", `${PREFIX}-toggle`);
    toggle.setAttribute("role", "group");
    toggle.setAttribute("aria-label", T("rowListingType"));
    refs.toggleButtons = {};
    for (const [id, label] of [["classic", T("typeClassic")], ["premium", T("typePremium")]]) {
      const btn = el("button", `${PREFIX}-toggle__btn`, label);
      btn.type = "button";
      btn.addEventListener("click", () => {
        state.listingTypeId = id;
        update();
      });
      refs.toggleButtons[id] = btn;
      toggle.appendChild(btn);
    }
    typeRow.appendChild(toggle);
    // Clásica vs Premium side-by-side comparison.
    refs.compareBtn = el("button", `${PREFIX}-compare-toggle`, T("btnCompare"));
    refs.compareBtn.type = "button";
    if (!state.pro) refs.compareBtn.classList.add(`${PREFIX}-locked`);
    refs.compareBtn.addEventListener("click", () => {
      if (!state.pro) {
        openUpsell();
        return;
      }
      state.compareOpen = !state.compareOpen;
      update(false);
    });
    typeRow.appendChild(refs.compareBtn);
    // Meses sin intereses (MSI) — Pro. Same locked-toggle pattern as Compare.
    refs.msiBtn = el("button", `${PREFIX}-msi-toggle`, T("btnMsi"));
    refs.msiBtn.type = "button";
    if (!state.pro) refs.msiBtn.classList.add(`${PREFIX}-locked`);
    refs.msiBtn.addEventListener("click", () => {
      if (!state.pro) {
        openUpsell();
        return;
      }
      state.msiOpen = !state.msiOpen;
      update(false);
    });
    typeRow.appendChild(refs.msiBtn);
    body.appendChild(typeRow);

    refs.compareBox = el("div", `${PREFIX}-compare`);
    refs.compareClassic = buildRow(T("typeClassic"));
    refs.comparePremium = buildRow(T("typePremium"));
    refs.compareDiff = buildRow(T("compareDiff"));
    refs.compareBox.append(
      refs.compareClassic.root,
      refs.comparePremium.root,
      refs.compareDiff.root
    );
    body.appendChild(refs.compareBox);

    // MSI box: term selector + editable per-term rate + net/margin with vs
    // without cuotas, side by side. Only built/populated for Pro (the toggle
    // is locked otherwise). Built once; update() shows/hides and patches text.
    refs.msiBox = el("div", `${PREFIX}-msi`);
    refs.msiBox.style.display = "none";

    // What-if note (only when the current listing is Clásica).
    refs.msiWhatIf = el("p", `${PREFIX}-msi__note`, T("msiWhatIfNote"));
    refs.msiBox.appendChild(refs.msiWhatIf);

    // Prominent hint pointing to the seller's real rate source.
    refs.msiBox.appendChild(el("p", `${PREFIX}-msi__note`, T("msiHint")));

    // Term selector.
    const msiTermRow = el("div", `${PREFIX}-row`);
    msiTermRow.appendChild(el("span", `${PREFIX}-row__label`, T("msiTermLabel")));
    const msiTermSel = document.createElement("select");
    msiTermSel.className = `${PREFIX}-select`;
    msiTermSel.setAttribute("aria-label", T("msiTermLabel"));
    for (const months of msiTermMonths) {
      msiTermSel.appendChild(new Option(T("msiTermOption", [String(months)]), String(months)));
    }
    msiTermSel.addEventListener("change", () => {
      const m = Number.parseInt(msiTermSel.value, 10);
      state.msiTerm = msiTermMonths.includes(m) ? m : 3;
      persistMsi();
      refs.msiRateInput.value = String(msiCurrentRate());
      update();
    });
    refs.msiTermSelect = msiTermSel;
    msiTermRow.appendChild(msiTermSel);
    refs.msiBox.appendChild(msiTermRow);

    // Editable rate — the seller's OWN %. Not an .mst-input (that class is
    // reserved for money fields the e2e harness indexes); own class instead.
    const msiRateRow = el("div", `${PREFIX}-row`);
    msiRateRow.appendChild(el("span", `${PREFIX}-row__label`, T("msiRateLabel")));
    const msiRateInput = document.createElement("input");
    msiRateInput.type = "text";
    msiRateInput.inputMode = "decimal";
    msiRateInput.autocomplete = "off";
    msiRateInput.className = `${PREFIX}-msi__rate`;
    msiRateInput.setAttribute("aria-label", T("msiRateAria"));
    const applyRate = () => {
      const pct = CALC.parseMoney(msiRateInput.value);
      state.msiRates[String(state.msiTerm)] = pct; // seller's value wins + persists
      persistMsi();
      update();
    };
    const debouncedRate = debounced(applyRate);
    msiRateInput.addEventListener("input", debouncedRate);
    msiRateInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        msiRateInput.blur();
      }
    });
    msiRateInput.addEventListener("blur", () => {
      debouncedRate.flush();
      msiRateInput.value = String(msiCurrentRate());
    });
    refs.msiRateInput = msiRateInput;
    msiRateRow.appendChild(msiRateInput);
    refs.msiBox.appendChild(msiRateRow);

    // "referencia aproximada" note — shown only while using the reference
    // default (i.e. the seller hasn't entered their own rate for this term).
    refs.msiRefNote = el("p", `${PREFIX}-msi__ref`, T("msiReferenceNote"));
    refs.msiBox.appendChild(refs.msiRefNote);

    // MSI cost line (labeled estimate).
    refs.msiCost = buildRow(T("msiCostLabel"));
    refs.msiBox.appendChild(refs.msiCost.root);

    // Side-by-side columns: without vs with cuotas.
    const msiCols = el("div", `${PREFIX}-msi__cols`);
    const buildMsiCol = (titleKey, withMod) => {
      const col = el("div", `${PREFIX}-msi__col${withMod ? ` ${PREFIX}-msi__col--with` : ""}`);
      col.appendChild(el("div", `${PREFIX}-msi__coltitle`, T(titleKey)));
      const net = el("div", `${PREFIX}-msi__line`, "");
      const margin = el("div", `${PREFIX}-msi__line ${PREFIX}-msi__line--margin`, "");
      col.append(net, margin);
      return { col, net, margin };
    };
    refs.msiWithout = buildMsiCol("msiColWithout", false);
    refs.msiWith = buildMsiCol("msiColWith", true);
    msiCols.append(refs.msiWithout.col, refs.msiWith.col);
    refs.msiBox.appendChild(msiCols);

    body.appendChild(refs.msiBox);

    // Category picker.
    const catRow = el("div", `${PREFIX}-row`);
    catRow.appendChild(el("span", `${PREFIX}-row__label`, T("rowCategory")));
    const select = document.createElement("select");
    select.className = `${PREFIX}-select`;
    select.setAttribute("aria-label", T("rowCategory"));
    const placeholder = new Option(T("categoryPlaceholder"), "");
    placeholder.disabled = true;
    select.appendChild(placeholder);
    for (const group of SOURCE.listCategoryGroups()) {
      select.appendChild(new Option(group.label, group.id));
    }
    select.value = state.categoryGroupId ?? "";
    if (!state.categoryGroupId) placeholder.selected = true;
    select.addEventListener("change", () => {
      state.categoryGroupId = select.value || null;
      state.categoryAutoDetected = false;
      if (state.itemId) {
        // Remember the manual pick for this listing (like product cost).
        const key = `${PREFIX}:catpick:${state.itemId}`;
        if (state.categoryGroupId) {
          chrome.storage.local.set({ [key]: state.categoryGroupId });
        } else {
          chrome.storage.local.remove(key);
        }
      }
      update();
    });
    refs.categorySelect = select;
    catRow.appendChild(select);
    body.appendChild(catRow);
    refs.hint = el("div", `${PREFIX}-hint`, "");
    body.appendChild(refs.hint);

    refs.commission = buildRow(T("rowCommission", [""]));
    body.appendChild(refs.commission.root);

    refs.fixed = buildRow(T("rowFixedCost"));
    body.appendChild(refs.fixed.root);

    refs.effective = buildRow(T("rowEffectiveRate"));
    body.appendChild(refs.effective.root);

    // Weight selector (free — Full mode needs it for accuracy). Picking a
    // weight also fills the shipping estimate for ≥$299 items; the manual
    // shipping input below always overrides.
    const weightRow = el("div", `${PREFIX}-row`);
    weightRow.appendChild(el("span", `${PREFIX}-row__label`, T("rowWeight")));
    const weightSel = document.createElement("select");
    weightSel.className = `${PREFIX}-select`;
    weightSel.setAttribute("aria-label", T("rowWeight"));
    weightSel.appendChild(new Option(T("weightNone"), ""));
    for (const bracket of globalThis.MST_SHIPPING.brackets) {
      weightSel.appendChild(new Option(`≤ ${bracket.maxKg} kg`, String(bracket.maxKg)));
    }
    weightSel.addEventListener("change", () => {
      const kg = Number.parseFloat(weightSel.value);
      state.weightKg = Number.isFinite(kg) && kg > 0 ? kg : 0;
      if (state.weightKg > 0 && state.priceMXN >= SOURCE.freeShippingThresholdMXN) {
        const cost = globalThis.MST_SHIPPING.costForWeight(state.weightKg);
        if (cost !== null) {
          state.shippingCostMXN = cost;
          refs.shippingInput.syncFromState();
        }
      }
      persistInputs();
      update();
    });
    refs.weightSelect = weightSel;
    weightRow.appendChild(weightSel);
    body.appendChild(weightRow);

    // Mercado Envíos Full toggle: under-$299 items pay the variable
    // weight/price service cost instead of the fixed charge (since 2026-04-06).
    const fullRow = el("label", `${PREFIX}-row ${PREFIX}-toggle-row`);
    const fullCheck = document.createElement("input");
    fullCheck.type = "checkbox";
    fullCheck.className = `${PREFIX}-full-toggle`;
    fullCheck.addEventListener("change", () => {
      state.usesFull = fullCheck.checked;
      chrome.storage.sync.set({ usesFull: state.usesFull });
      update();
    });
    refs.fullToggle = fullCheck;
    fullRow.append(el("span", `${PREFIX}-row__label`, T("rowFull")), fullCheck);
    body.appendChild(fullRow);

    // Seller reputation → Mercado Envíos subsidy (free feature). Only affects
    // free-shipping items ≥ $299; picks the subsidy % for the effective cost.
    const repRow = el("div", `${PREFIX}-row`);
    repRow.appendChild(el("span", `${PREFIX}-row__label`, T("rowReputation")));
    const repSel = document.createElement("select");
    repSel.className = `${PREFIX}-select`;
    repSel.setAttribute("aria-label", T("rowReputation"));
    for (const [id, label] of [
      ["verde", T("repVerde")],
      ["amarillo", T("repAmarillo")],
      ["naranja", T("repNaranja")],
      ["none", T("repNone")]
    ]) {
      repSel.appendChild(new Option(label, id));
    }
    repSel.addEventListener("change", () => {
      state.reputationId = repSel.value || "none";
      chrome.storage.sync.set({ reputationId: state.reputationId });
      update();
    });
    refs.reputationSelect = repSel;
    repRow.appendChild(repSel);
    body.appendChild(repRow);

    // Free-shipping toggle: seller offers free shipping (enables the subsidy).
    const freeRow = el("label", `${PREFIX}-row ${PREFIX}-toggle-row`);
    const freeCheck = document.createElement("input");
    freeCheck.type = "checkbox";
    freeCheck.className = `${PREFIX}-free-toggle`;
    freeCheck.addEventListener("change", () => {
      state.freeShipping = freeCheck.checked;
      chrome.storage.sync.set({ freeShipping: state.freeShipping });
      update();
    });
    refs.freeShippingToggle = freeCheck;
    freeRow.append(el("span", `${PREFIX}-row__label`, T("rowFreeShipping")), freeCheck);
    body.appendChild(freeRow);

    // Shipping input. Label is price-dependent (what-if can cross $299).
    const shipRow = el("div", `${PREFIX}-row`);
    refs.shipLabel = el("span", `${PREFIX}-row__label`, T("rowShipping"));
    shipRow.appendChild(refs.shipLabel);
    refs.shippingInput = moneyInput(
      () => state.shippingCostMXN,
      (v) => {
        state.shippingCostMXN = v;
        persistInputs();
        update();
      }
    );
    refs.shippingInput.setAttribute("aria-label", T("inputShippingAria"));
    shipRow.appendChild(refs.shippingInput);
    body.appendChild(shipRow);

    // Shipping subsidy (labeled estimate). Shown only when it actually applies.
    refs.shippingSubsidy = buildRow(T("rowShippingSubsidy"));
    body.appendChild(refs.shippingSubsidy.root);

    refs.net = buildRow(T("rowNet"), "total");
    body.appendChild(refs.net.root);

    // Retenciones (free — accuracy feature): informational rows, default off.
    const wRow = el("label", `${PREFIX}-row ${PREFIX}-toggle-row`);
    const wCheck = document.createElement("input");
    wCheck.type = "checkbox";
    wCheck.className = `${PREFIX}-withholdings-toggle`;
    wCheck.addEventListener("change", () => {
      state.showWithholdings = wCheck.checked;
      chrome.storage.sync.set({ showWithholdings: state.showWithholdings });
      update();
    });
    refs.withholdingsToggle = wCheck;
    wRow.append(el("span", `${PREFIX}-row__label`, T("rowWithholdings")), wCheck);
    body.appendChild(wRow);

    refs.iva = buildRow(T("rowIvaWithheld"));
    body.appendChild(refs.iva.root);
    refs.isr = buildRow(T("rowIsrWithheld"));
    body.appendChild(refs.isr.root);
    refs.netAfter = buildRow(T("rowNetAfterWithholdings"), "total");
    body.appendChild(refs.netAfter.root);
    refs.withholdingsHint = el("div", `${PREFIX}-hint`, T("withholdingsHint"));
    body.appendChild(refs.withholdingsHint);

    // Sweet-spot nudge: clicking applies the suggested what-if price.
    refs.sweetspot = el("button", `${PREFIX}-sweetspot`, "");
    refs.sweetspot.type = "button";
    refs.sweetspot.addEventListener("click", () => {
      const target = Number(refs.sweetspot.dataset.target);
      if (target > 0) {
        state.priceMXN = target;
        refs.priceInput.syncFromState();
        update();
      }
    });
    body.appendChild(refs.sweetspot);

    // Product cost input → profit margin.
    const costRow = el("div", `${PREFIX}-row`);
    costRow.appendChild(el("span", `${PREFIX}-row__label`, T("rowProductCost")));
    refs.costInput = moneyInput(
      () => state.productCostMXN,
      (v) => {
        state.productCostMXN = v;
        persistInputs();
        update();
      }
    );
    refs.costInput.setAttribute("aria-label", T("inputProductCostAria"));
    costRow.appendChild(refs.costInput);
    body.appendChild(costRow);

    refs.profit = buildRow(T("rowProfit"), "profit");
    body.appendChild(refs.profit.root);

    // Breakeven (auto when cost is set).
    refs.breakeven = buildRow(T("rowBreakeven"));
    body.appendChild(refs.breakeven.root);

    if (state.pro) {
      // Ventas/mes → ganancia mensual (feeds the dashboard too).
      const salesRow = el("div", `${PREFIX}-row`);
      salesRow.appendChild(el("span", `${PREFIX}-row__label`, T("rowSales")));
      refs.salesInput = moneyInput(
        () => state.salesPerMonth,
        (v) => {
          state.salesPerMonth = Math.round(v);
          persistInputs();
          update();
        }
      );
      refs.salesInput.setAttribute("aria-label", T("rowSales"));
      salesRow.appendChild(refs.salesInput);
      refs.salesRow = salesRow;
      body.appendChild(salesRow);

      refs.monthly = buildRow(T("rowMonthlyProfit"), "profit");
      body.appendChild(refs.monthly.root);

      // Reverse calculator: target margin % → required listing price.
      const marginRow = el("div", `${PREFIX}-row`);
      marginRow.appendChild(el("span", `${PREFIX}-row__label`, T("rowTargetMargin")));
      refs.marginInput = moneyInput(
        () => state.targetMarginPct,
        (v) => {
          state.targetMarginPct = Math.min(v, 99);
          persistInputs();
          update();
        }
      );
      refs.marginInput.setAttribute("aria-label", T("inputMarginAria"));
      marginRow.appendChild(refs.marginInput);
      refs.targetMarginRow = marginRow;
      body.appendChild(marginRow);

      refs.target = buildRow(T("rowTargetPrice"), "total");
      body.appendChild(refs.target.root);

      // Local price history sparkline (only from this user's own visits).
      const histRow = el("div", `${PREFIX}-row ${PREFIX}-history`);
      histRow.style.display = "none";
      histRow.appendChild(el("span", `${PREFIX}-row__label`, T("rowHistory")));
      body.appendChild(histRow);
      globalThis.MST_HISTORY.get(state.itemId).then((points) => {
        const svg = globalThis.MST_HISTORY.sparkline(points);
        if (svg) {
          histRow.appendChild(svg);
          histRow.style.display = "";
        }
      });
    } else {
      // Locked Pro features: name + PRO chip, click opens the upsell.
      body.appendChild(UPSELL.lockedRow(T("rowTargetPrice"), () => openUpsell()));
      body.appendChild(UPSELL.lockedRow(T("proSweetSpotName"), () => openUpsell()));
      body.appendChild(UPSELL.lockedRow(T("rowSales"), () => openUpsell()));
      body.appendChild(UPSELL.lockedRow(T("rowHistory"), () => openUpsell()));
    }

    // Dashboard link (the dashboard itself is Pro).
    const dashBtn = el("button", `${PREFIX}-dashlink`, T("linkDashboard"));
    dashBtn.type = "button";
    dashBtn.addEventListener("click", () => {
      if (state.pro) {
        globalThis.MST_GATE.openDashboard();
      } else {
        openUpsell();
      }
    });
    if (!state.pro) dashBtn.appendChild(UPSELL.chip(() => openUpsell()));
    body.appendChild(dashBtn);

    // Copy plain-text summary (WhatsApp/notes friendly).
    const copyBtn = el("button", `${PREFIX}-copy`, T("btnCopy"));
    copyBtn.type = "button";
    copyBtn.addEventListener("click", async () => {
      const ok = await copyText(buildSummaryText());
      copyBtn.textContent = ok ? T("btnCopied") : T("btnCopyError");
      copyBtn.disabled = true;
      setTimeout(() => {
        copyBtn.textContent = T("btnCopy");
        copyBtn.disabled = false;
      }, 2000);
    });
    body.appendChild(copyBtn);

    // Upsell panel lives at the bottom of the card; never opens on load.
    const upsell = UPSELL.attach(body);
    openUpsell = () => {
      upsell.panel.hidden = false;
    };
  }

  function buildSummaryText() {
    const { quote, b } = computeCurrent();
    const lines = [];
    lines.push(`${T("cardTitle")} — ${window.location.href}`);
    lines.push(`${T("rowPrice")}: ${fmtMoney(b.priceMXN)}`);
    lines.push(
      `${T("rowListingType")}: ${state.listingTypeId === "premium" ? T("typePremium") : T("typeClassic")}`
    );
    if (quote.categoryGroup) {
      lines.push(`${T("rowCategory")}: ${quote.categoryGroup.label}`);
    }
    lines.push(
      `${T("rowCommission", [fmtPctRange(b.pctMin, b.pctMax)])}: ` +
        fmtCharge(b.commissionMinMXN, b.commissionMaxMXN)
    );
    if (b.fixedCostMXN > 0) {
      lines.push(`${T("rowFixedCost")}: ${fmtCharge(b.fixedCostMXN)}`);
    }
    lines.push(
      `${T("rowEffectiveRate")}: ${fmtPctRange(b.effectiveRateMinPct, b.effectiveRateMaxPct)}`
    );
    if (b.shippingCostMXN > 0) {
      lines.push(`${T("rowShipping")}: ${fmtCharge(b.shippingCostMXN)}`);
    }
    lines.push(`${T("rowNet")}: ${fmtRange(b.netMinMXN, b.netMaxMXN)}`);
    if (b.profitMinMXN !== undefined) {
      lines.push(`${T("rowProductCost")}: ${fmtMoney(b.productCostMXN)}`);
      lines.push(
        `${T("rowProfit")}: ${fmtRange(b.profitMinMXN, b.profitMaxMXN)} ` +
          `(${fmtPctRange(b.marginMinPct, b.marginMaxPct)})`
      );
    }
    lines.push(`${T("badgeEstimate")} · ${SOURCE.meta.retrievedAt} · ${BRAND.name}`);
    return lines.join("\n");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API can fail without focus/permission — textarea fallback.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  // Reset everything tied to a specific product. Called when the card is
  // built for a DIFFERENT item than the current state (SPA navigation) —
  // without this, product B would inherit A's category/cost/what-if price and
  // persistInputs() would write B's numbers under A's storage keys.
  function resetForNewItem() {
    state.priceMXN = 0;
    state.pagePriceMXN = 0;
    state.itemId = null;
    state.listingTypeId = "classic";
    state.categoryGroupId = null;
    state.categoryAutoDetected = false;
    state.productCostMXN = 0;
    state.salesPerMonth = 0;
    state.compareOpen = false;
    state.weightKg = 0;
    state.msiOpen = false;
    // msiTerm/msiRates are account-wide (sync), not per item — keep them.
  }

  // Builds the card element. With pageData it renders the live calculator;
  // without (price missing) it stays in skeleton state and the caller logs why.
  function build(pageData) {
    // No itemId (unrecognized URL shape) → always reset: we can't prove it's
    // the same product, and carrying state across products is the worse bug.
    if (pageData && (pageData.itemId === null || pageData.itemId !== state.itemId)) {
      resetForNewItem();
    }
    const card = el("section", `${PREFIX}-card`);
    card.id = CARD_ID;
    const body = el("div", `${PREFIX}-card__body`);
    card.appendChild(body);

    const footer = el("footer", `${PREFIX}-card__brand`);
    const logo = document.createElement("img");
    logo.src = chrome.runtime.getURL(BRAND.logoPath);
    logo.alt = "";
    logo.width = 12;
    logo.height = 12;
    footer.append(
      logo,
      el("span", null, T("footerRates", [BRAND.name, SOURCE.meta.retrievedAt]))
    );
    card.appendChild(footer);

    if (!pageData) {
      buildSkeletonRows(body);
      return card;
    }

    state.priceMXN = pageData.price.value;
    state.pagePriceMXN = pageData.price.value;
    state.itemId = pageData.itemId;
    state.listingTypeId = pageData.listingTypeGuess;
    // Structured data first (language-stable), visible breadcrumb fallback.
    // A manually saved pick for this listing overrides both (restoreInputs).
    const matched =
      SOURCE.matchCategory(pageData.structuredCategory?.names ?? []) ??
      SOURCE.matchCategory(pageData.breadcrumbs);
    if (matched && !state.categoryGroupId) {
      state.categoryGroupId = matched;
      state.categoryAutoDetected = true;
    }

    state.pro = globalThis.MST_GATE.isPro();
    refs.card = card;
    buildCalculator(body);
    refs.priceInput.syncFromState(); // pre-fill with the page price
    update(false);
    restoreInputs().then(() => {
      refs.priceInput.syncFromState();
      refs.shippingInput.syncFromState();
      refs.costInput.syncFromState();
      refs.marginInput?.syncFromState();
      refs.salesInput?.syncFromState();
      refs.categorySelect.value = state.categoryGroupId ?? "";
      refs.weightSelect.value = state.weightKg > 0 ? String(state.weightKg) : "";
      refs.fullToggle.checked = state.usesFull;
      refs.withholdingsToggle.checked = state.showWithholdings;
      refs.reputationSelect.value = state.reputationId;
      refs.freeShippingToggle.checked = state.freeShipping;
      if (refs.msiTermSelect) {
        refs.msiTermSelect.value = String(state.msiTerm);
        if (document.activeElement !== refs.msiRateInput) {
          refs.msiRateInput.value = String(msiCurrentRate());
        }
      }
      update(false);
    });
    return card;
  }

  return Object.freeze({ build, state });
})();
