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
    itemId: null,
    listingTypeId: "classic",
    categoryGroupId: null,
    categoryAutoDetected: false,
    shippingCostMXN: 0,
    productCostMXN: 0,
    targetMarginPct: 0
  };

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
        [`${PREFIX}:cost:${state.itemId}`]: state.productCostMXN
      });
    }
  }

  async function restoreInputs() {
    const keys = [`${PREFIX}:defaults`];
    if (state.itemId) {
      keys.push(`${PREFIX}:cost:${state.itemId}`, `${PREFIX}:catpick:${state.itemId}`);
    }
    const [stored, settings] = await Promise.all([
      chrome.storage.local.get(keys),
      chrome.storage.sync.get({ defaultShippingMXN: 0, defaultListingType: "auto" })
    ]);
    const defaults = stored[`${PREFIX}:defaults`];
    // Sanitize: storage may hold junk from previous buggy sessions. Card-level
    // saved values win over the options-page default.
    state.shippingCostMXN = CALC.parseMoney(
      defaults?.shippingCostMXN ?? settings.defaultShippingMXN ?? 0
    );
    state.targetMarginPct = CALC.parseMoney(defaults?.targetMarginPct ?? 0);
    state.productCostMXN = CALC.parseMoney(stored[`${PREFIX}:cost:${state.itemId}`] ?? 0);
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
      categoryGroupId: state.categoryGroupId
    });
    const b = CALC.computeBreakdown(quote, {
      priceMXN: state.priceMXN,
      shippingCostMXN: state.shippingCostMXN,
      productCostMXN: state.productCostMXN
    });
    return { quote, b };
  }

  function update(flash = true) {
    if (!refs.card) return;
    const { quote, b } = computeCurrent();

    patchRow(
      refs.commission,
      T("rowCommission", [fmtPctRange(b.pctMin, b.pctMax)]),
      fmtCharge(b.commissionMinMXN, b.commissionMaxMXN),
      flash
    );

    refs.fixed.root.style.display = b.fixedCostMXN > 0 ? "" : "none";
    if (b.fixedCostMXN > 0) {
      patchRow(refs.fixed, null, fmtCharge(b.fixedCostMXN), flash);
    }

    patchRow(
      refs.effective,
      null,
      fmtPctRange(b.effectiveRateMinPct, b.effectiveRateMaxPct),
      flash
    );

    patchRow(refs.net, null, fmtRange(b.netMinMXN, b.netMaxMXN), flash);

    const hasProfit = b.profitMinMXN !== undefined;
    refs.profit.root.style.display = hasProfit ? "" : "none";
    if (hasProfit) {
      patchRow(
        refs.profit,
        null,
        `${fmtRange(b.profitMinMXN, b.profitMaxMXN)} (${fmtPctRange(b.marginMinPct, b.marginMaxPct)})`,
        flash
      );
      refs.profit.root.classList.toggle(`${PREFIX}-row--loss`, b.profitMaxMXN < 0);
    }

    // Breakeven + target price (reverse calculator). Range rates produce a
    // price range; the WORST case (pctMax) is the safe number to act on.
    const hasCost = state.productCostMXN > 0;
    const solve = (ratePct, marginPct) =>
      CALC.solveTargetPrice({
        costMXN: state.productCostMXN,
        shippingMXN: state.shippingCostMXN,
        marginPct,
        ratePct,
        fixedCostFn: SOURCE.getFixedCost
      });

    refs.breakeven.root.style.display = hasCost ? "" : "none";
    if (hasCost) {
      const lo = solve(quote.pctMin, 0);
      const hi = solve(quote.pctMax, 0);
      patchRow(refs.breakeven, null, lo !== null && hi !== null ? fmtRange(lo, hi) : "—", flash);
    }

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
    const header = el("div", `${PREFIX}-header`);
    header.appendChild(el("h2", `${PREFIX}-title`, T("cardTitle")));
    const badge = el("span", `${PREFIX}-badge`, T("badgeEstimate"));
    badge.setAttribute("title", T("badgeTooltip", [SOURCE.meta.retrievedAt]));
    badge.tabIndex = 0;
    header.appendChild(badge);
    body.appendChild(header);

    const priceRow = buildRow(T("rowPrice"));
    priceRow.value.textContent = fmtMoney(state.priceMXN);
    body.appendChild(priceRow.root);

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
    body.appendChild(typeRow);

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

    // Shipping input.
    const shipRow = el("div", `${PREFIX}-row`);
    const shipLabel =
      state.priceMXN >= SOURCE.freeShippingThresholdMXN
        ? T("rowShippingFree")
        : T("rowShipping");
    shipRow.appendChild(el("span", `${PREFIX}-row__label`, shipLabel));
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

    refs.net = buildRow(T("rowNet"), "total");
    body.appendChild(refs.net.root);

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

  // Builds the card element. With pageData it renders the live calculator;
  // without (price missing) it stays in skeleton state and the caller logs why.
  function build(pageData) {
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

    refs.card = card;
    buildCalculator(body);
    update(false);
    restoreInputs().then(() => {
      refs.shippingInput.syncFromState();
      refs.costInput.syncFromState();
      refs.marginInput.syncFromState();
      refs.categorySelect.value = state.categoryGroupId ?? "";
      update(false);
    });
    return card;
  }

  return Object.freeze({ build, state });
})();
