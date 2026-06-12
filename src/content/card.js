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

  const mxn = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  // Mutable card state — survives re-injection because the module outlives
  // the DOM node (persistence watcher rebuilds from this).
  const state = {
    priceMXN: 0,
    itemId: null,
    listingTypeId: "classic",
    categoryGroupId: null,
    categoryAutoDetected: false,
    shippingCostMXN: 0,
    productCostMXN: 0
  };

  // Live references into the current card DOM, repopulated on each build().
  const refs = {};

  function fmtRange(min, max) {
    return min === max ? mxn.format(min) : `${mxn.format(min)} – ${mxn.format(max)}`;
  }

  function fmtPctRange(min, max) {
    return min === max ? `${min}%` : `${min}%–${max}%`;
  }

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
    const record = { shippingCostMXN: state.shippingCostMXN };
    chrome.storage.local.set({ [`${PREFIX}:defaults`]: record });
    if (state.itemId) {
      chrome.storage.local.set({
        [`${PREFIX}:cost:${state.itemId}`]: state.productCostMXN
      });
    }
  }

  async function restoreInputs() {
    const keys = [`${PREFIX}:defaults`];
    if (state.itemId) keys.push(`${PREFIX}:cost:${state.itemId}`);
    const stored = await chrome.storage.local.get(keys);
    // Sanitize: storage may hold junk from previous buggy sessions.
    state.shippingCostMXN = CALC.parseMoney(stored[`${PREFIX}:defaults`]?.shippingCostMXN ?? 0);
    state.productCostMXN = CALC.parseMoney(stored[`${PREFIX}:cost:${state.itemId}`] ?? 0);
  }

  // --- Update (no DOM rebuilding) ---------------------------------------------

  function update(flash = true) {
    if (!refs.card) return;
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

    patchRow(
      refs.commission,
      `Comisión (${fmtPctRange(b.pctMin, b.pctMax)})`,
      `−${fmtRange(b.commissionMinMXN, b.commissionMaxMXN)}`,
      flash
    );

    refs.fixed.root.style.display = b.fixedCostMXN > 0 ? "" : "none";
    if (b.fixedCostMXN > 0) {
      patchRow(refs.fixed, null, `−${mxn.format(b.fixedCostMXN)}`, flash);
    }

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

    // Category hint + toggle button states.
    if (!state.categoryGroupId) {
      refs.hint.textContent = `Sin categoría, la comisión oficial va de ${fmtPctRange(quote.pctMin, quote.pctMax)}.`;
      refs.hint.style.display = "";
    } else if (state.categoryAutoDetected) {
      refs.hint.textContent = "Detectada de la página — corrígela si no coincide.";
      refs.hint.style.display = "";
    } else {
      refs.hint.style.display = "none";
    }
    for (const [id, btn] of Object.entries(refs.toggleButtons)) {
      btn.classList.toggle(`${PREFIX}-toggle__btn--active`, state.listingTypeId === id);
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
    header.appendChild(el("h2", `${PREFIX}-title`, "Calculadora del vendedor"));
    const badge = el("span", `${PREFIX}-badge`, "Estimado");
    badge.setAttribute(
      "title",
      `Estimación basada en las tarifas publicadas por Mercado Libre ` +
        `(consultadas el ${SOURCE.meta.retrievedAt}). El porcentaje exacto ` +
        `depende de tu categoría y cuenta. No incluye retenciones fiscales ` +
        `(ISR/IVA) ni el costo real de Mercado Envíos.`
    );
    header.appendChild(badge);
    body.appendChild(header);

    const priceRow = buildRow("Precio de venta");
    priceRow.value.textContent = mxn.format(state.priceMXN);
    body.appendChild(priceRow.root);

    // Listing type toggle.
    const typeRow = el("div", `${PREFIX}-row`);
    typeRow.appendChild(el("span", `${PREFIX}-row__label`, "Publicación"));
    const toggle = el("div", `${PREFIX}-toggle`);
    refs.toggleButtons = {};
    for (const [id, label] of [["classic", "Clásica"], ["premium", "Premium"]]) {
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
    catRow.appendChild(el("span", `${PREFIX}-row__label`, "Categoría"));
    const select = document.createElement("select");
    select.className = `${PREFIX}-select`;
    const placeholder = new Option("Selecciona categoría…", "");
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
      update();
    });
    catRow.appendChild(select);
    body.appendChild(catRow);
    refs.hint = el("div", `${PREFIX}-hint`, "");
    body.appendChild(refs.hint);

    refs.commission = buildRow("Comisión");
    body.appendChild(refs.commission.root);

    refs.fixed = buildRow("Cargo fijo (precio < $299)");
    body.appendChild(refs.fixed.root);

    // Shipping input.
    const shipRow = el("div", `${PREFIX}-row`);
    const shipLabel =
      state.priceMXN >= SOURCE.freeShippingThresholdMXN
        ? "Tu costo de envío (envío gratis ≥ $299)"
        : "Tu costo de envío";
    shipRow.appendChild(el("span", `${PREFIX}-row__label`, shipLabel));
    refs.shippingInput = moneyInput(
      () => state.shippingCostMXN,
      (v) => {
        state.shippingCostMXN = v;
        persistInputs();
        update();
      }
    );
    shipRow.appendChild(refs.shippingInput);
    body.appendChild(shipRow);

    refs.net = buildRow("Recibirás aprox.", "total");
    body.appendChild(refs.net.root);

    // Product cost input → profit margin.
    const costRow = el("div", `${PREFIX}-row`);
    costRow.appendChild(el("span", `${PREFIX}-row__label`, "Costo de tu producto"));
    refs.costInput = moneyInput(
      () => state.productCostMXN,
      (v) => {
        state.productCostMXN = v;
        persistInputs();
        update();
      }
    );
    costRow.appendChild(refs.costInput);
    body.appendChild(costRow);

    refs.profit = buildRow("Ganancia", "profit");
    body.appendChild(refs.profit.root);
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
      el("span", null, `${BRAND.name} · tarifas al ${SOURCE.meta.retrievedAt}`)
    );
    card.appendChild(footer);

    if (!pageData) {
      buildSkeletonRows(body);
      return card;
    }

    state.priceMXN = pageData.price.value;
    state.itemId = pageData.itemId;
    state.listingTypeId = pageData.listingTypeGuess;
    const matched = SOURCE.matchCategory(pageData.breadcrumbs);
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
      update(false);
    });
    return card;
  }

  return Object.freeze({ build, state });
})();
