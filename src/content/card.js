// Seller fee card UI. Renders the breakdown from MST_CALC + MST_FEE_SOURCE
// and owns the card's interactive state (listing type toggle, category
// picker, shipping & product-cost inputs). DOM-only module: no page
// extraction (page-data.js) and no fee math (calculator.js).
"use strict";

globalThis.MST_CARD = (() => {
  const BRAND = globalThis.EXT_BRAND;
  const PREFIX = BRAND.cssPrefix;
  const CARD_ID = `${PREFIX}-card-root`;
  const SOURCE = globalThis.MST_FEE_SOURCE;
  const CALC = globalThis.MST_CALC;

  const mxn = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
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

  function row(label, valueText, modifier) {
    const r = el("div", `${PREFIX}-row${modifier ? ` ${PREFIX}-row--${modifier}` : ""}`);
    r.appendChild(el("span", `${PREFIX}-row__label`, label));
    r.appendChild(el("span", `${PREFIX}-row__value`, valueText));
    return r;
  }

  function moneyInput(value, placeholder, onChange) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "0.01";
    input.placeholder = placeholder;
    input.className = `${PREFIX}-input`;
    if (value > 0) input.value = String(value);
    input.addEventListener("input", () => {
      const parsed = Number.parseFloat(input.value);
      onChange(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
    });
    return input;
  }

  function persistInputs() {
    const record = { shippingCostMXN: state.shippingCostMXN };
    chrome.storage.local.set({ [`${PREFIX}:defaults`]: record });
    if (state.itemId && state.productCostMXN > 0) {
      chrome.storage.local.set({
        [`${PREFIX}:cost:${state.itemId}`]: state.productCostMXN
      });
    }
  }

  async function restoreInputs() {
    const keys = [`${PREFIX}:defaults`];
    if (state.itemId) keys.push(`${PREFIX}:cost:${state.itemId}`);
    const stored = await chrome.storage.local.get(keys);
    state.shippingCostMXN = stored[`${PREFIX}:defaults`]?.shippingCostMXN ?? 0;
    state.productCostMXN = stored[`${PREFIX}:cost:${state.itemId}`] ?? 0;
  }

  // --- Render -----------------------------------------------------------------

  function render(card) {
    const quote = SOURCE.getQuote({
      priceMXN: state.priceMXN,
      listingTypeId: state.listingTypeId,
      categoryGroupId: state.categoryGroupId
    });
    const breakdown = CALC.computeBreakdown(quote, {
      priceMXN: state.priceMXN,
      shippingCostMXN: state.shippingCostMXN,
      productCostMXN: state.productCostMXN
    });

    const body = card.querySelector(`.${PREFIX}-card__body`);
    body.replaceChildren();

    // Header: title + "Estimado" badge with the legal/accuracy tooltip.
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

    body.appendChild(row("Precio de venta", mxn.format(state.priceMXN)));

    // Listing type toggle.
    const typeRow = el("div", `${PREFIX}-row`);
    typeRow.appendChild(el("span", `${PREFIX}-row__label`, "Publicación"));
    const toggle = el("div", `${PREFIX}-toggle`);
    for (const [id, label] of [["classic", "Clásica"], ["premium", "Premium"]]) {
      const btn = el("button", `${PREFIX}-toggle__btn`, label);
      btn.type = "button";
      if (state.listingTypeId === id) btn.classList.add(`${PREFIX}-toggle__btn--active`);
      btn.addEventListener("click", () => {
        state.listingTypeId = id;
        render(card);
      });
      toggle.appendChild(btn);
    }
    typeRow.appendChild(toggle);
    body.appendChild(typeRow);

    // Category: detected label or picker.
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
      render(card);
    });
    catRow.appendChild(select);
    body.appendChild(catRow);
    if (state.categoryGroupId && state.categoryAutoDetected) {
      body.appendChild(el("div", `${PREFIX}-hint`, "Detectada de la página — corrígela si no coincide."));
    } else if (!state.categoryGroupId) {
      body.appendChild(
        el("div", `${PREFIX}-hint`,
          `Sin categoría, la comisión oficial va de ${fmtPctRange(quote.pctMin, quote.pctMax)}.`)
      );
    }

    body.appendChild(
      row(
        `Comisión (${fmtPctRange(breakdown.pctMin, breakdown.pctMax)})`,
        `−${fmtRange(breakdown.commissionMinMXN, breakdown.commissionMaxMXN)}`
      )
    );

    if (breakdown.fixedCostMXN > 0) {
      body.appendChild(
        row("Cargo fijo (precio < $299)", `−${mxn.format(breakdown.fixedCostMXN)}`)
      );
    }

    // Shipping: editable estimate.
    const shipRow = el("div", `${PREFIX}-row`);
    const shipLabel =
      state.priceMXN >= SOURCE.freeShippingThresholdMXN
        ? "Tu costo de envío (envío gratis ≥ $299)"
        : "Tu costo de envío";
    shipRow.appendChild(el("span", `${PREFIX}-row__label`, shipLabel));
    shipRow.appendChild(
      moneyInput(state.shippingCostMXN, "0.00", (v) => {
        state.shippingCostMXN = v;
        persistInputs();
        render(card);
      })
    );
    body.appendChild(shipRow);

    body.appendChild(
      row("Recibirás aprox.", fmtRange(breakdown.netMinMXN, breakdown.netMaxMXN), "total")
    );

    // Profit margin.
    const costRow = el("div", `${PREFIX}-row`);
    costRow.appendChild(el("span", `${PREFIX}-row__label`, "Costo de tu producto"));
    costRow.appendChild(
      moneyInput(state.productCostMXN, "0.00", (v) => {
        state.productCostMXN = v;
        persistInputs();
        render(card);
      })
    );
    body.appendChild(costRow);

    if (breakdown.profitMinMXN !== undefined) {
      const profitText =
        `${fmtRange(breakdown.profitMinMXN, breakdown.profitMaxMXN)} ` +
        `(${fmtPctRange(breakdown.marginMinPct, breakdown.marginMaxPct)})`;
      const profitRow = row("Ganancia", profitText, "profit");
      if (breakdown.profitMaxMXN < 0) profitRow.classList.add(`${PREFIX}-row--loss`);
      body.appendChild(profitRow);
    }
  }

  // --- Public -----------------------------------------------------------------

  function buildSkeletonRows(body) {
    for (const width of ["60%", "85%", "40%"]) {
      const skeletonRow = el("div", `${PREFIX}-skeleton`);
      skeletonRow.style.width = width;
      body.appendChild(skeletonRow);
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

    restoreInputs().then(() => render(card));
    render(card);
    return card;
  }

  return Object.freeze({ build, state });
})();
