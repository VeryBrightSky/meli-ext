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
  const SAFE = globalThis.MST_SAFE;
  // Anonymous funnel events (typed, allowlisted in the service worker).
  const TRACK = globalThis.MST_TRACK;
  // Hard ceiling for any typed money/percent value (mirrors CALC's clamp).
  const MAX_INPUT = 1e9;

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
    shippingAutofilled: false,
    productCostMXN: 0,
    targetMarginPct: 0,
    salesPerMonth: 0,
    // Mercado Ads spend as % of the price (PRO what-if, saved per product).
    adsPct: 0,
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

  // Free-tier teaser defaults: the margin the blurred target price is solved
  // for, and the margin below which the "thin" alert fires.
  const DEFAULT_TEASER_MARGIN_PCT = 30;
  // The seller's margin if set, else the default (PRO target price + teaser).
  const effectiveMargin = () => (state.targetMarginPct > 0 ? state.targetMarginPct : DEFAULT_TEASER_MARGIN_PCT);
  const THIN_MARGIN_PCT = 10;

  // Live references into the current card DOM, repopulated on each build().
  const refs = {};
  // "Guardado" survives the rebuild the first saved cost triggers (the trial
  // starts and the card is rebuilt as PRO on the spot): the note is shown
  // again on the new card for what is left of its 2 s.
  const SAVED_NOTE_MS = 2000;
  let savedNoteUntil = 0;
  let savedNoteItemId = null;

  const { fmtMoney, fmtRange, fmtCharge, fmtPctRange } = UI;

  // --- Extension-context safety -------------------------------------------------
  // After an extension update the old content script keeps running but every
  // chrome.* call throws. Writes go through save()/unsave(), which never throw
  // and swap the card for a "reload the page" notice once the context is gone.
  function save(area, items) {
    try {
      if (!SAFE.alive()) {
        showStale();
        return;
      }
      chrome.storage[area].set(items)?.catch?.(() => {});
    } catch {
      if (!SAFE.alive()) showStale();
    }
  }

  function unsave(area, key) {
    try {
      if (!SAFE.alive()) {
        showStale();
        return;
      }
      chrome.storage[area].remove(key)?.catch?.(() => {});
    } catch {
      if (!SAFE.alive()) showStale();
    }
  }

  // Replace the whole card with a short notice + reload button. Idempotent.
  function showStale() {
    const card = document.getElementById(CARD_ID);
    if (!card || card.dataset.stale === "1") return;
    card.dataset.stale = "1";
    const box = el("div", `${PREFIX}-card__body`);
    box.appendChild(el("p", `${PREFIX}-stale`, T("staleNotice")));
    const btn = el("button", `${PREFIX}-copy`, T("staleReload"));
    btn.type = "button";
    btn.addEventListener("click", () => window.location.reload());
    box.appendChild(btn);
    card.replaceChildren(box);
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
  // onCommit(value) fires on blur/Enter (after the pending edit is applied):
  // the moment a typed value is final, as opposed to a debounced keystroke.
  function moneyInput(getValue, onValue, { onCommit } = {}) {
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.placeholder = "0.00";
    input.className = `${PREFIX}-input`;

    const apply = () => {
      TRACK.count("calcs"); // a committed (debounced) edit, never a keystroke
      onValue(Math.min(CALC.parseMoney(input.value), MAX_INPUT));
    };
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
      if (onCommit) onCommit(v);
    });

    input.syncFromState = () => {
      if (document.activeElement === input) return; // never fight the user
      const v = getValue();
      input.value = v > 0 ? v.toFixed(2) : "";
    };
    return input;
  }

  // Keys already present in storage for the current item. A 0 is only written
  // over a key that exists (a deliberate clear); a fresh item never gets
  // cost/sales/weight keys full of zeros just because a toggle was clicked.
  const persistedKeys = new Set();

  // extra: entries written in the SAME storage write as the per-item keys
  // (the trial start stamp rides with the first saved cost, so a navigation
  // right after a chip tap can never separate the two). Only written when
  // the item has an id, like the cost itself.
  function persistInputs(extra = null) {
    if (!SAFE.alive()) {
      showStale();
      return;
    }
    const defaultsKey = `${PREFIX}:defaults`;
    try {
      if (state.shippingAutofilled) {
        // The shipping figure was filled from the weight select, not typed by
        // the seller: it must not become their default. Merge so the stored
        // default shipping survives.
        chrome.storage.local.get(defaultsKey).then((cur) => {
          const prev = cur?.[defaultsKey] && typeof cur[defaultsKey] === "object" ? cur[defaultsKey] : {};
          save("local", { [defaultsKey]: { ...prev, targetMarginPct: state.targetMarginPct } });
        }).catch(() => {});
      } else {
        save("local", {
          [defaultsKey]: {
            shippingCostMXN: state.shippingCostMXN,
            targetMarginPct: state.targetMarginPct
          }
        });
      }
    } catch {
      return;
    }
    if (state.itemId) {
      const entries = {};
      for (const [name, value] of [
        ["cost", state.productCostMXN],
        ["sales", state.salesPerMonth],
        ["weight", state.weightKg],
        ["ads", state.adsPct]
      ]) {
        const key = `${PREFIX}:${name}:${state.itemId}`;
        if (value > 0 || persistedKeys.has(key)) {
          entries[key] = value;
          persistedKeys.add(key);
        }
      }
      if (extra) Object.assign(entries, extra);
      if (Object.keys(entries).length) save("local", entries);
      // Listing snapshot for the dashboard (only meaningful with a cost).
      if (state.productCostMXN > 0) {
        save("local", {
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
    save("sync", { msiRates: state.msiRates, msiTerm: state.msiTerm });
  }

  async function restoreInputs() {
    const keys = [`${PREFIX}:defaults`];
    if (state.itemId) {
      keys.push(
        `${PREFIX}:cost:${state.itemId}`,
        `${PREFIX}:catpick:${state.itemId}`,
        `${PREFIX}:sales:${state.itemId}`,
        `${PREFIX}:weight:${state.itemId}`,
        `${PREFIX}:type:${state.itemId}`,
        `${PREFIX}:ads:${state.itemId}`
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
    for (const k of Object.keys(stored)) persistedKeys.add(k);
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
    const optShipSet = !(optShip === null || optShip === undefined);
    state.shippingCostMXN = optShipSet
      ? CALC.parseMoney(optShip)
      : CALC.parseMoney(defaults?.shippingCostMXN ?? 0);
    state.shippingAutofilled = false;
    state.targetMarginPct = CALC.parseMoney(defaults?.targetMarginPct ?? 0);
    state.productCostMXN = CALC.parseMoney(stored[`${PREFIX}:cost:${state.itemId}`] ?? 0);
    state.salesPerMonth = CALC.parseMoney(stored[`${PREFIX}:sales:${state.itemId}`] ?? 0);
    state.adsPct = Math.min(CALC.parseMoney(stored[`${PREFIX}:ads:${state.itemId}`] ?? 0), 99);
    if (settings.defaultListingType !== "auto") {
      state.listingTypeId = settings.defaultListingType === "premium" ? "premium" : "classic";
    }
    // The seller's own toggle for this listing beats both the options
    // default and the page guess.
    const savedType = stored[`${PREFIX}:type:${state.itemId}`];
    if (savedType === "premium" || savedType === "classic") state.listingTypeId = savedType;
    // Manual category pick saved for this listing beats auto-detection.
    const savedPick = stored[`${PREFIX}:catpick:${state.itemId}`];
    if (savedPick && SOURCE.listCategoryGroups().some((g) => g.id === savedPick)) {
      state.categoryGroupId = savedPick;
      state.categoryAutoDetected = false;
    }
    // Shipping unset everywhere (no options value, nothing typed before) on a
    // listing at/above $299, where free shipping is mandatory and the seller
    // pays it: the headline used to count shipping as $0 while the sweet spot
    // already assumed the smallest bracket (0.3 kg). Both now assume the same
    // estimate, shown in the shipping row as an autofilled value (the same
    // mechanics as the weight select) so it never becomes the saved default
    // and anything the seller types replaces it. An explicit options $0 is a
    // deliberate "my shipping is free" and is left alone.
    if (!optShipSet && !(state.shippingCostMXN > 0)) applyShippingEstimate();
  }

  // Does the seller pay Mercado Envíos at price p? From $299 free shipping is
  // mandatory; below it only when they offer free shipping (optional).
  const shippingApplies = (p, forceFree = false) =>
    forceFree || state.freeShipping || p >= SOURCE.freeShippingThresholdMXN;

  // Official seller cost for a weight at price p from the table the chosen
  // reputation reads (discount already included; below $299 the "envío
  // gratis opcional" column). 0 when the table has no row.
  const tableShipping = (kg, p) =>
    globalThis.MST_SHIPPING.costForWeight(kg, p, state.reputationId) ?? 0;

  // Fill the shipping row with the official Mercado Envíos estimate for the
  // chosen weight (or 0.3 kg) at the current price and reputation when the
  // seller has not typed a cost and shipping applies. Returns true when a
  // value was filled.
  function applyShippingEstimate() {
    if (!shippingApplies(state.priceMXN)) return false;
    if (state.shippingCostMXN > 0 && !state.shippingAutofilled) return false;
    const cost = tableShipping(state.weightKg > 0 ? state.weightKg : 0.3, state.priceMXN);
    if (!(cost > 0)) return false;
    state.shippingCostMXN = cost;
    state.shippingAutofilled = true;
    return true;
  }

  // An autofilled estimate follows the price band, weight and reputation
  // (the official tables step at $299, $499 and $999); a typed cost never
  // moves. Returns true when the shown value changed.
  function refreshShippingEstimate() {
    if (!state.shippingAutofilled) return false;
    const next = tableShipping(state.weightKg > 0 ? state.weightKg : 0.3, state.priceMXN);
    if (!(next > 0) || next === state.shippingCostMXN) return false;
    state.shippingCostMXN = next;
    return true;
  }

  // --- Update (no DOM rebuilding) ---------------------------------------------

  // What the seller pays to ship at price p. A typed cost is charged as is
  // (the official tables already include the reputation discount, so nothing
  // is subtracted from it). An estimate is read from the official table at
  // price p, so it is a step function of price ($299 / $499 / $999 bands) and
  // the reverse solver must evaluate it at the price it returns.
  function shipAt(p, { forceFree = false, fallbackKg = 0 } = {}) {
    if (state.shippingCostMXN > 0 && !state.shippingAutofilled) return state.shippingCostMXN;
    const kg = state.weightKg > 0 ? state.weightKg : state.shippingAutofilled ? 0.3 : fallbackKg;
    if (!(kg > 0)) return 0;
    // An autofilled estimate was placed in the shipping row because shipping
    // applied; like a typed cost it stays charged at every what-if price.
    // Without one, shipping only counts where it applies.
    if (!state.shippingAutofilled && !shippingApplies(p, forceFree)) return 0;
    return tableShipping(kg, p);
  }

  function computeCurrent() {
    const quote = SOURCE.getQuote({
      priceMXN: state.priceMXN,
      listingTypeId: state.listingTypeId,
      categoryGroupId: state.categoryGroupId,
      fullWeightKg: fullWeightKg()
    });
    const effectiveShipping = shipAt(state.priceMXN);
    const b = CALC.computeBreakdown(quote, {
      priceMXN: state.priceMXN,
      shippingCostMXN: effectiveShipping,
      productCostMXN: state.productCostMXN,
      adsPct: effectiveAdsPct()
    });
    return { quote, b, effectiveShipping };
  }

  // Ads only count while the input that sets them is on the card (PRO): a
  // percentage saved during the trial must not keep lowering the free net
  // from a field the seller can no longer see.
  const effectiveAdsPct = () => (state.pro && state.adsPct > 0 ? state.adsPct : 0);

  function update(flash = true) {
    if (!refs.card) return;
    try {
      updateUnsafe(flash);
    } catch (err) {
      // A render failure must never leave inputs dead mid-typing; log once
      // and keep the last consistent view.
      console.warn(`[${BRAND.name}] card update failed (keeping last view):`, err);
      TRACK.error("render_fail");
    }
  }

  function renderUnavailable(quote, b) {
    const na = T("feeUnavailable");
    refs.fixed.root.style.display = "";
    patchRow(refs.fixed, T("rowServiceCost"), na, false);
    patchRow(refs.commission, T("rowCommission", [fmtPctRange(b.pctMin, b.pctMax)]), fmtCharge(b.commissionMinMXN, b.commissionMaxMXN), false);
    patchRow(refs.net, null, na, false);
    refs.summaryNet.textContent = `${T("rowNet")} ${na}`;
    refs.summaryProfit.hidden = true;
    refs.summaryRetentions.hidden = true;
    refs.summaryUpto.hidden = true;
    refs.proLine.hidden = true;
    refs.adsHint.hidden = true;
    refs.stack.hidden = true;
    for (const node of [
      refs.profit?.root, refs.breakeven?.root, refs.target?.root, refs.targetTeaser?.root,
      refs.msiTeaser?.root, refs.monthly?.root, refs.sweetspot, refs.compareBox, refs.msiBox,
      refs.maxCost?.root, refs.ads?.root
    ]) {
      if (node) node.style.display = "none";
    }
    refs.alert?.hide();
  }

  // Labels are single-line with an ellipsis; the title carries the full text
  // for the narrow card (and for localized strings that run long).
  function syncLabelTitles() {
    for (const label of refs.card.querySelectorAll(`.${PREFIX}-row__label`)) {
      const text = label.textContent;
      if (label.title !== text) label.title = text;
    }
  }

  function updateUnsafe(flash) {
    try {
      updateBody(flash);
    } finally {
      syncLabelTitles();
    }
  }

  function updateBody(flash) {
    // A what-if price can cross an official band ($299 / $499 / $999): an
    // autofilled estimate follows it before anything is computed.
    if (refreshShippingEstimate()) refs.shippingInput?.syncFromState();
    const { quote, b, effectiveShipping } = computeCurrent();

    const pro = state.pro;
    // Full mode and no service-cost row for this weight/price: say so instead
    // of showing a net that silently counts the missing fee as $0.
    if (quote.fixedCostUnavailable) {
      TRACK.error("fee_unavailable");
      renderUnavailable(quote, b);
      return;
    }
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

    // Sweet spot (worst-case rate so the promised gain is conservative).
    // Pro: actionable (click applies the price). Free: the gain is shown for
    // real, the price is what PRO unlocks.
    // Crossing $299 makes free shipping mandatory: from there the seller pays
    // shipping (their typed cost, else the official estimate for the chosen
    // weight or the smallest bracket at the target price), so a fixed-charge
    // drop that shipping eats is not a sweet spot.
    const spot = CALC.findSweetSpot({
      priceMXN: state.priceMXN,
      ratePct: quote.pctMax,
      fixedCostFn,
      thresholds: SOURCE.getFixedCostThresholds(fullWeightKg()),
      shippingFn: (p) => shipAt(p, { fallbackKg: state.weightKg > 0 ? state.weightKg : 0.3 })
    });
    refs.sweetspot.style.display = spot ? "" : "none";
    if (spot) {
      TRACK.once("first_sweetspot_seen");
      if (!pro) TRACK.once("paywall_seen", { reason: "teaser", key: "sweetspot" });
      refs.sweetspot.textContent = pro
        ? T("sweetSpot", [fmtMoney(spot.targetPriceMXN), fmtMoney(spot.netGainMXN)])
        : T("sweetSpotTeaser", [fmtMoney(spot.netGainMXN)]);
      refs.sweetspot.dataset.target = String(spot.targetPriceMXN);
      refs.sweetspot.dataset.gain = fmtMoney(spot.netGainMXN);
    } else {
      delete refs.sweetspot.dataset.target;
      delete refs.sweetspot.dataset.gain;
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

    // Free: one-line MSI teaser on Premium listings with the REAL profit after
    // the reference 12-MSI cost; the per-term breakdown is PRO.
    if (!pro && refs.msiTeaser) {
      const teaserTerm = 12;
      const show = state.listingTypeId === "premium" && b.profitMinMXN !== undefined;
      refs.msiTeaser.root.style.display = show ? "" : "none";
      if (show) {
        TRACK.once("paywall_seen", { reason: "teaser", key: "msi" });
        const cost = CALC.msiCost(state.priceMXN, msiReferencePct(teaserTerm));
        const after = CALC.round2(b.profitMinMXN - cost);
        refs.msiTeaser.set(T("msiTeaser", [String(teaserTerm), fmtMoney(after)]));
        refs.msiTeaser.vars = [String(teaserTerm), fmtMoney(after)];
        refs.msiTeaser.root.classList.toggle(`${PREFIX}-row--loss`, after < 0);
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
    refs.summaryRetentions.hidden = !showW;
    if (showW) {
      const w = CALC.computeWithholdings(state.priceMXN, SOURCE.withholdings);
      patchRow(refs.iva, null, fmtCharge(w.ivaMXN), flash);
      patchRow(refs.isr, null, fmtCharge(w.isrMXN), flash);
      const afterW = fmtRange(
        CALC.round2(b.netMinMXN - w.totalMXN),
        CALC.round2(b.netMaxMXN - w.totalMXN)
      );
      patchRow(refs.netAfter, null, afterW, flash);
      // One line under the headline: the headline is before IVA/ISR, so an
      // RFC seller sees what actually lands after the 2026 retentions.
      refs.summaryRetentions.textContent = T("summaryRetentions", [fmtMoney(w.totalMXN), afterW]);
    }

    patchRow(
      refs.effective,
      null,
      fmtPctRange(b.effectiveRateMinPct, b.effectiveRateMaxPct),
      flash
    );

    // Reputation discount: informational. The official table already includes
    // it, so the row only says which discount the shown estimate carries;
    // a typed cost is the seller's own number and gets no row.
    const discountPct = globalThis.MST_SHIPPING.discountPctFor(state.reputationId);
    const discountShown = state.shippingAutofilled && effectiveShipping > 0 && discountPct > 0;
    refs.shippingSubsidy.root.style.display = discountShown ? "" : "none";
    if (discountShown) {
      patchRow(refs.shippingSubsidy, null, T("shippingDiscountIncluded", [String(discountPct)]), flash);
    } else {
      refs.shippingSubsidy.value.textContent = ""; // never leave a stale percentage behind
    }

    // Ads row (PRO what-if): only when a percentage is in effect.
    refs.ads.root.style.display = b.adsCostMXN > 0 ? "" : "none";
    if (b.adsCostMXN > 0) {
      patchRow(refs.ads, T("rowAdsCost", [String(b.adsPct)]), fmtCharge(b.adsCostMXN), flash);
    }
    // Free/expired card with a saved ads %: the numbers above ignore it (the
    // input is PRO), so one line says the percentage is waiting for PRO.
    const adsDropped = !pro && state.adsPct > 0;
    refs.adsHint.hidden = !adsDropped;
    if (adsDropped) refs.adsHint.textContent = T("summaryAdsProOnly", [String(state.adsPct)]);

    patchRow(refs.net, null, fmtRange(b.netMinMXN, b.netMaxMXN), flash);
    // Headline: one number. With an exact rate it is the number; with an
    // unknown category it is the WORST case ("al menos"), and the best case
    // goes on a small line under it. The range itself stays in the breakdown.
    const ranged = b.netMinMXN !== b.netMaxMXN;
    refs.summaryNet.textContent = ranged
      ? T("summaryNetWorst", [fmtMoney(b.netMinMXN)])
      : T("summaryNet", [fmtMoney(b.netMinMXN)]);
    refs.summaryUpto.hidden = !ranged;
    if (ranged) refs.summaryUpto.textContent = T("summaryUpto", [fmtMoney(b.netMaxMXN)]);
    renderStack(quote, b, effectiveShipping);
    renderCostChips();
    // Share only once there is a real number to share (a saved cost): a
    // "recommend the app" button on first sight is noise.
    // ...and only a profit worth showing: nobody forwards a loss (r3).
    if (refs.shareBtn) {
      const canShare = state.productCostMXN > 0 && b.profitMinMXN !== undefined && b.marginMinPct > 0;
      refs.shareBtn.hidden = !canShare;
      if (canShare) {
        refs.shareBtn.href = buildShareUrl();
        refs.shareBtn.textContent = T("btnShare");
      }
    }
    if (b.profitMinMXN !== undefined) {
      const losing = b.profitMaxMXN < 0;
      refs.summaryProfit.hidden = false;
      if (!ranged) {
        refs.summaryProfit.textContent = losing
          ? T("summaryLoss", [fmtMoney(-b.profitMinMXN)])
          : T("summaryProfit", [fmtMoney(b.profitMinMXN), fmtPctRange(b.marginMinPct, b.marginMinPct)]);
      } else if (losing) {
        // Both bounds lose: the sure loss leads, the worst case follows.
        refs.summaryProfit.textContent = T("summaryLossWorst", [fmtMoney(-b.profitMaxMXN)]);
        refs.summaryUpto.textContent = T("summaryLossUpto", [fmtMoney(-b.profitMinMXN)]);
      } else if (b.profitMinMXN < 0) {
        // Worst case loses, best case gains: say the possible loss first.
        refs.summaryProfit.textContent = T("summaryMixedWorst", [fmtMoney(-b.profitMinMXN)]);
        refs.summaryUpto.textContent = T("summaryMixedUpto", [fmtMoney(b.profitMaxMXN)]);
      } else {
        refs.summaryProfit.textContent = T("summaryProfitWorst", [fmtMoney(b.profitMinMXN), String(b.marginMinPct)]);
        refs.summaryUpto.textContent = T("summaryUpto", [fmtMoney(b.profitMaxMXN)]);
      }
      refs.summaryProfit.dataset.tone = losing || b.profitMinMXN < 0 ? "loss" : "profit";
    } else {
      refs.summaryProfit.hidden = false;
      refs.summaryProfit.textContent = T("summaryNoCost");
      refs.summaryProfit.dataset.tone = "hint";
    }

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
    // Shipping is folded into the step function (free shipping becomes the
    // seller's cost at $299 and the official tables step again at $499 and
    // $999), so the solver charges it at the price it returns. With no
    // typed cost or estimate, the answer still pays shipping where it
    // applies, for the chosen weight or the smallest bracket (0.3 kg).
    const solveThresholds = [
      ...new Set([...SOURCE.getFixedCostThresholds(fullWeightKg()), ...SOURCE.getShippingThresholds()])
    ].sort((a, c) => a - c);
    const solveShipping = (p) => shipAt(p, { fallbackKg: state.weightKg > 0 ? state.weightKg : 0.3 });
    // Ads are a % of the price, so they add to the rate the solver keeps.
    const solve = (ratePct, marginPct) =>
      CALC.solveTargetPrice({
        costMXN: state.productCostMXN,
        shippingMXN: 0,
        marginPct,
        ratePct: ratePct + effectiveAdsPct(),
        fixedCostFn: (p) => fixedCostFn(p) + solveShipping(p),
        thresholds: solveThresholds,
        minPriceMXN: SOURCE.minPriceMXN ?? 0
      });

    refs.breakeven.root.style.display = hasCost ? "" : "none";
    if (hasCost) {
      const lo = solve(quote.pctMin, 0);
      const hi = solve(quote.pctMax, 0);
      patchRow(refs.breakeven, null, lo !== null && hi !== null ? fmtRange(lo, hi) : T("noValue"), flash);
    }

    if (!pro) {
      // Free: the target price for the default margin exists and is shown
      // blurred; the loss/thin-margin alert names the real number. Both open
      // the contextual upsell with the exact figures for THIS listing.
      // A margin saved during the trial is honored, but never below the thin
      // threshold (the alert must always promise MORE than the seller has).
      const teaserPct = Math.max(state.targetMarginPct || 0, DEFAULT_TEASER_MARGIN_PCT);
      refs.targetTeaser.root.style.display = hasCost ? "" : "none";
      if (hasCost) {
        TRACK.once("paywall_seen", { reason: "teaser", key: "target" });
        const hi = solve(quote.pctMax, teaserPct);
        const text = hi !== null ? fmtMoney(hi) : T("targetUnreachable");
        refs.targetTeaser.label.textContent = T("rowTargetTeaser", [String(teaserPct)]);
        refs.targetTeaser.set(text);
        // No number → the panel falls back to the generic pitch, never
        // "necesitas vender a Precio inalcanzable".
        refs.targetTeaser.vars = hi !== null ? [String(teaserPct), text] : [];
      }
      if (hasCost && b.profitMinMXN !== undefined) {
        const losing = b.profitMaxMXN < 0;
        const thin = !losing && b.marginMinPct < THIN_MARGIN_PCT;
        if (losing) {
          TRACK.once("paywall_seen", { reason: "alert", key: "loss" });
          refs.alert.show(T("alertLoss", [fmtMoney(-b.profitMaxMXN), String(teaserPct)]), "loss");
          refs.alert.reason = ["loss", [fmtMoney(-b.profitMaxMXN), String(teaserPct)]];
        } else if (thin) {
          TRACK.once("paywall_seen", { reason: "alert", key: "target" });
          refs.alert.show(T("alertThin", [String(b.marginMinPct), String(teaserPct)]), "thin");
          refs.alert.reason = ["target", refs.targetTeaser.vars];
        } else {
          refs.alert.hide();
        }
      } else {
        refs.alert.hide();
      }
    }

    if (pro) {
      // The target price is the feature the trial sells: it shows by default
      // at 30% (or the seller's own margin) as soon as a cost is entered.
      const margin = effectiveMargin();
      // The margin and the max cost need no product cost: they are the PRO
      // answer a seller gets before typing anything ("how much may I pay
      // for this to make 30% at this price").
      refs.targetMarginRow.style.display = "";
      const hasTarget = hasCost && margin > 0;
      refs.target.root.style.display = hasTarget ? "" : "none";
      refs.proLine.hidden = true;
      refs.maxCost.root.style.display = margin > 0 ? "" : "none";
      if (margin > 0) {
        const maxCost = CALC.solveMaxCost({
          priceMXN: state.priceMXN,
          marginPct: margin,
          ratePct: quote.pctMax,
          adsPct: effectiveAdsPct(),
          fixedCostMXN: b.fixedCostMXN,
          shippingMXN: effectiveShipping
        });
        refs.maxCost.label.textContent = T("rowMaxCostFor", [String(margin)]);
        patchRow(refs.maxCost, null, maxCost !== null ? fmtMoney(maxCost) : T("maxCostNone"), flash);
        refs.maxCost.root.classList.toggle(`${PREFIX}-row--loss`, maxCost === null);
      }
      if (hasTarget) {
        const lo = solve(quote.pctMin, margin);
        const hi = solve(quote.pctMax, margin);
        // r4: one proposed price per card, never a price below the current
        // one for a lower margin. When the current worst-case margin already
        // meets the target, the bold row says so at the current price ("Ya
        // ganas 30.5% a este precio: $827.00"); the max-cost row under it
        // keeps the target's number, and the PRO line below the summary is
        // the only place that proposes a (higher) price.
        const currentMargin = b.marginMinPct ?? 0;
        const targetMet = currentMargin >= margin;
        refs.target.root.classList.toggle(`${PREFIX}-row--met`, targetMet);
        if (targetMet) {
          refs.target.label.textContent = T("rowTargetMet", [String(currentMargin)]);
          patchRow(refs.target, null, fmtMoney(state.priceMXN), flash);
        } else {
          refs.target.label.textContent = T("rowTargetPriceFor", [String(margin)]);
          patchRow(
            refs.target,
            null,
            lo !== null && hi !== null ? fmtRange(lo, hi) : T("targetUnreachable"),
            flash
          );
        }
        // One short line under the summary so the seller sees what PRO just
        // did for this listing (worst-case price for the margin in effect).
        // r3: never recommend a LOWER price for a margin the seller already
        // has. When the current worst-case margin already meets the target,
        // the line points up instead: the price for 10 more points, or, if
        // no price reaches that, the most this unit may cost at the current
        // price for the target margin.
        if (targetMet) {
          const upMargin = Math.min(99, Math.ceil(currentMargin + 10));
          const up = upMargin > currentMargin ? solve(quote.pctMax, upMargin) : null;
          if (up !== null && up > state.priceMXN) {
            refs.proLine.textContent = T("proDidLine", [fmtMoney(up), String(upMargin)]);
            refs.proLine.hidden = false;
          } else {
            const maxCost = CALC.solveMaxCost({
              priceMXN: state.priceMXN,
              marginPct: margin,
              ratePct: quote.pctMax,
              adsPct: effectiveAdsPct(),
              fixedCostMXN: b.fixedCostMXN,
              shippingMXN: effectiveShipping
            });
            if (maxCost !== null) {
              refs.proLine.textContent = T("proDidLineMaxCost", [String(margin), fmtMoney(maxCost)]);
              refs.proLine.hidden = false;
            }
          }
        } else if (hi !== null) {
          refs.proLine.textContent = T("proDidLine", [fmtMoney(hi), String(margin)]);
          refs.proLine.hidden = false;
        }
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

    // Category hint + toggle button states. With no category the selector
    // and its hint sit above the fold (next to the summary), because the
    // range the card shows is only exact once the seller picks one; with a
    // category they live in the collapsed breakdown.
    if (!state.categoryGroupId) {
      refs.hint.textContent = T("hintNoCategory");
      refs.hint.style.display = "";
    } else if (state.categoryAutoDetected) {
      refs.hint.textContent = T("hintDetected");
      refs.hint.style.display = "";
    } else {
      refs.hint.style.display = "none";
    }
    placeCategoryPicker(!state.categoryGroupId);
    for (const [id, btn] of Object.entries(refs.toggleButtons)) {
      const active = state.listingTypeId === id;
      btn.classList.toggle(`${PREFIX}-toggle__btn--active`, active);
      btn.setAttribute("aria-pressed", String(active));
    }

    // An open upsell panel quotes this listing's numbers: keep them current
    // after an edit, and close it when the loss it describes is gone.
    if (refs.upsellPanel && !refs.upsellPanel.panel.hidden && refs.upsellReason) {
      const r = refs.upsellReason;
      if (r === "loss") {
        if (refs.alert && !refs.alert.root.hidden && refs.alert.reason?.[0] === "loss") {
          refs.upsellPanel.refresh("loss", refs.alert.reason[1]);
        } else {
          refs.upsellPanel.close();
        }
      } else if (r === "target") {
        refs.upsellPanel.refresh("target", refs.targetTeaser?.vars ?? []);
      } else if (r === "msi") {
        refs.upsellPanel.refresh("msi", refs.msiTeaser?.vars ?? []);
      } else if (r === "sweetspot") {
        if (refs.sweetspot.dataset.gain) refs.upsellPanel.refresh("sweetspot", [refs.sweetspot.dataset.gain]);
        else refs.upsellPanel.close();
      }
    }
  }

  // The zero-cost fee stack under the headline: every charge at the page
  // price as a hard number, and what an RFC seller is actually paid after
  // the 2026 retentions. Hidden as soon as a cost is saved.
  function renderStack(quote, b, effectiveShipping) {
    const show = !(state.productCostMXN > 0);
    refs.stack.hidden = !show;
    if (!show) return;
    const rows = refs.stackRows;
    patchRow(rows.price, T("rowPrice"), fmtMoney(b.priceMXN), false);
    patchRow(rows.commission, T("rowCommission", [fmtPctRange(b.pctMin, b.pctMax)]), fmtCharge(b.commissionMinMXN, b.commissionMaxMXN), false);
    rows.fixed.root.style.display = b.fixedCostMXN > 0 ? "" : "none";
    if (b.fixedCostMXN > 0) {
      patchRow(rows.fixed, quote.isFullServiceCost ? T("rowServiceCost") : T("stackFixed"), fmtCharge(b.fixedCostMXN), false);
    }
    rows.shipping.root.style.display = effectiveShipping > 0 ? "" : "none";
    if (effectiveShipping > 0) {
      const kg = state.weightKg > 0 ? state.weightKg : 0.3;
      patchRow(
        rows.shipping,
        state.shippingAutofilled ? T("stackShippingEstimate", [String(kg)]) : T("rowShipping"),
        fmtCharge(effectiveShipping),
        false
      );
    }
    rows.ads.root.style.display = b.adsCostMXN > 0 ? "" : "none";
    if (b.adsCostMXN > 0) patchRow(rows.ads, T("rowAdsCost", [String(b.adsPct)]), fmtCharge(b.adsCostMXN), false);
    const w = CALC.computeWithholdings(b.priceMXN, SOURCE.withholdings);
    // The RFC rates shown are the registered-RFC ones. The label stays short
    // so the value keeps one line at 340 px (r4); while the seller has not
    // opened the retentions rows, a small line under it says that an
    // unregistered account is withheld more (r3), so the figure is never
    // read as the only case.
    patchRow(
      rows.retentions,
      T("stackRetentions"),
      T("stackRetentionsValue", [fmtMoney(w.totalMXN), fmtRange(CALC.round2(b.netMinMXN - w.totalMXN), CALC.round2(b.netMaxMXN - w.totalMXN))]),
      false
    );
    refs.stackNoRfc.hidden = state.showWithholdings;
  }

  // Cost chips (40/50/60 % of the page price) show until a cost is saved.
  function renderCostChips() {
    if (!refs.chips) return;
    const show = !(state.productCostMXN > 0) && state.pagePriceMXN > 0;
    refs.chips.hidden = !show;
    refs.costLabel.textContent = show ? T("costAsk") : T("rowProductCost");
    if (!show) return;
    for (const chip of refs.chipButtons) {
      const pct = Number(chip.dataset.pct);
      const v = CALC.round2((state.pagePriceMXN * pct) / 100);
      const text = T("costChip", [String(pct), fmtMoney(v)]);
      if (chip.textContent !== text) chip.textContent = text;
      chip.setAttribute("aria-label", T("costChipAria", [fmtMoney(v)]));
    }
  }

  // --- Build (once per injection) -----------------------------------------------

  // Category picker + hint: above the fold (right under the cost) while the
  // category is unknown, inside the collapsed breakdown once it is known.
  // Idempotent; called from build and from every update.
  function placeCategoryPicker(above) {
    const row = refs.categorySelect?.closest(`.${PREFIX}-row`);
    if (!row || !refs.hint || !refs.catSlot) return;
    if (above) {
      if (refs.catSlot.contains(row)) return;
      refs.catSlot.append(row, refs.hint);
    } else if (refs.breakdown) {
      if (refs.breakdown.contains(row)) return;
      const toggle = refs.breakdown.querySelector(`.${PREFIX}-breakdown__toggle`);
      if (toggle) toggle.after(row, refs.hint);
      else refs.breakdown.append(row, refs.hint);
    }
  }

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

    const gateStatus = globalThis.MST_GATE.status();

    // Trial banner (countdown / win-back) sits above everything; it decides
    // its own visibility and remembers dismissal.
    body.appendChild(UPSELL.trialBanner(gateStatus, (reason) => openUpsell(reason)));

    const header = el("div", `${PREFIX}-header`);
    header.appendChild(el("h2", `${PREFIX}-title`, T("cardTitle")));
    const badge = el("span", `${PREFIX}-badge`, T("badgeEstimate"));
    badge.setAttribute("title", T("badgeTooltip", [SOURCE.meta.retrievedAt]));
    badge.tabIndex = 0;
    header.appendChild(badge);
    body.appendChild(header);

    // Answer first: what the seller keeps, before any breakdown.
    refs.summary = el("div", `${PREFIX}-summary`);
    refs.summaryNet = el("div", `${PREFIX}-summary__net`, "");
    // Best case on a small line when the headline is a worst case (unknown
    // category), or the best-case profit once a cost is set.
    refs.summaryUpto = el("div", `${PREFIX}-summary__upto`, "");
    refs.summaryUpto.hidden = true;
    refs.summaryRetentions = el("div", `${PREFIX}-summary__retentions`, "");
    refs.summaryRetentions.hidden = true;
    refs.summaryProfit = el("div", `${PREFIX}-summary__profit`, "");
    refs.summaryProfit.hidden = true;
    refs.proLine = el("div", `${PREFIX}-summary__pro`, "");
    refs.proLine.hidden = true;
    // r4 (minor d): a saved ads % is ignored on the free card (the input is
    // PRO); say so instead of silently dropping it from the numbers.
    refs.adsHint = el("div", `${PREFIX}-summary__adshint`, "");
    refs.adsHint.hidden = true;
    // Zero-typing value: while no cost is saved, the whole fee stack at the
    // page price (commission, fixed charge, shipping, retentions) sits under
    // the headline as hard numbers. Once a cost exists the profit lines take
    // its place; the breakdown keeps every row.
    refs.stack = el("div", `${PREFIX}-stack`);
    refs.stack.hidden = true;
    refs.stackRows = {};
    // No net row here: the headline right above IS the net ("Te queda"), one
    // number, said once (r3).
    for (const id of ["price", "commission", "fixed", "shipping", "ads", "retentions"]) {
      const r = buildRow("");
      r.root.classList.add(`${PREFIX}-stack__row`);
      refs.stackRows[id] = r;
      refs.stack.appendChild(r.root);
    }
    // Under the retentions row: the registered-RFC rates are not the only
    // case. Hidden once the seller opens the retentions rows.
    refs.stackNoRfc = el("div", `${PREFIX}-stack__hint`, T("stackRetentionsNoRfc"));
    refs.stack.appendChild(refs.stackNoRfc);
    refs.summary.append(refs.summaryNet, refs.summaryUpto, refs.summaryRetentions, refs.summaryProfit, refs.proLine, refs.adsHint, refs.stack);
    body.appendChild(refs.summary);

    // Product cost: the one input that turns fees into profit, so it sits
    // right under the answer. Saving is confirmed for 2 s; the first saved
    // cost also starts the 7 PRO days (gate.startTrial).
    const costRow = el("div", `${PREFIX}-row ${PREFIX}-row--cost`);
    refs.costLabel = el("span", `${PREFIX}-row__label`, T("rowProductCost"));
    costRow.appendChild(refs.costLabel);
    refs.savedNote = el("div", `${PREFIX}-saved`, T("costSaved"));
    refs.savedNote.hidden = true;
    let savedTimer = null;
    const showSaved = (ms = SAVED_NOTE_MS) => {
      refs.savedNote.hidden = false;
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => {
        refs.savedNote.hidden = true;
      }, ms);
    };
    if (savedNoteItemId !== null && savedNoteItemId === state.itemId && Date.now() < savedNoteUntil) {
      showSaved(savedNoteUntil - Date.now());
    }
    // One path for a typed cost and a tapped chip. A keystroke only
    // recalculates; the cost is saved when it is final (blur/Enter, or a chip
    // tap), and the FIRST saved cost carries the trial start stamp in the
    // same storage write (no debounce, no second write a navigation could
    // cut off). A page without an item id saves nothing and starts nothing.
    let lastCommittedCost = state.productCostMXN;
    let costDirty = false; // typed since the last commit
    refs.markCostCommitted = (v) => {
      lastCommittedCost = v;
      costDirty = false;
    };
    const applyCost = (v, { how, commit }) => {
      state.productCostMXN = v;
      update();
      if (!commit) {
        costDirty = true;
        return;
      }
      // A blur that typed nothing (focus in, focus out) is not a save.
      if (!costDirty && how !== "chip" && v === lastCommittedCost) return;
      costDirty = false;
      lastCommittedCost = v;
      const GATE = globalThis.MST_GATE;
      const stamp = v > 0 && state.itemId ? GATE.trialStampForFirstCost() : null;
      persistInputs(stamp);
      if (v > 0) {
        TRACK.once("first_cost_entered");
        TRACK.count("cost_entries");
        if (how === "chip") GATE.track("cost:chip"); // local funnel counter only
        if (state.itemId && SAFE.alive()) {
          savedNoteUntil = Date.now() + SAVED_NOTE_MS;
          savedNoteItemId = state.itemId;
          showSaved();
        }
        if (stamp) GATE.startTrial({ stampedAt: Object.values(stamp)[0] }).catch(() => {});
      }
    };
    refs.costInput = moneyInput(
      () => state.productCostMXN,
      (v) => applyCost(v, { how: "typed", commit: false }),
      { onCommit: (v) => applyCost(v, { how: "typed", commit: true }) }
    );
    refs.costInput.setAttribute("aria-label", T("inputProductCostAria"));
    // Cost chips: the first cost is one tap. 40 / 50 / 60 % of the page
    // price, each showing the peso amount it stands for; hidden once a cost
    // is saved (the input stays for a correction).
    refs.chips = el("span", `${PREFIX}-chips`);
    refs.chipButtons = [];
    for (const pct of [40, 50, 60]) {
      const chip = el("button", `${PREFIX}-chip`, "");
      chip.type = "button";
      chip.dataset.pct = String(pct);
      chip.addEventListener("click", () => {
        const v = CALC.round2((state.pagePriceMXN * pct) / 100);
        if (!(v > 0)) return;
        applyCost(v, { how: "chip", commit: true });
        refs.costInput.syncFromState();
      });
      refs.chipButtons.push(chip);
      refs.chips.appendChild(chip);
    }
    costRow.append(refs.chips, refs.costInput);
    body.appendChild(costRow);
    body.appendChild(refs.savedNote);
    // Category picker lands here when the category is unknown (see
    // placeCategoryPicker); otherwise it lives in the breakdown.
    refs.catSlot = el("div", `${PREFIX}-catslot`);
    body.appendChild(refs.catSlot);

    // Review ask: only after the seller has used Netio on 3+ listings (saved
    // a cost) AND either pays for PRO or has been around 14+ days, never to
    // someone whose trial just expired (they are not in a rating mood). Once,
    // dismissible forever. Ratings drive Chrome Web Store ranking.
    const REVIEW_KEY = `${PREFIX}:reviewAsk`;
    const reviewEligible = (all) => {
      if (gateStatus.paid) return true;
      if (gateStatus.trialExpired) return false;
      const installedAt = Number(all[`${PREFIX}:installedAt`]);
      return Number.isFinite(installedAt) && installedAt > 0 && Date.now() - installedAt >= 14 * 86400000;
    };
    if (SAFE.alive()) chrome.storage.local.get(null).then((all) => {
      if (!all || all[REVIEW_KEY] || globalThis.MST_GATE.isOwner()) return;
      if (!reviewEligible(all)) return;
      const used = Object.keys(all).filter((k) => k.startsWith(`${PREFIX}:cost:`) && Number(all[k]) > 0).length;
      if (used < 3) return;
      const ask = el("div", `${PREFIX}-review`);
      const link = el("a", `${PREFIX}-review__link`, T("reviewAsk"));
      link.href = BRAND.storeReviewsUrl;
      link.target = "_blank";
      link.rel = "noopener";
      const close = el("button", `${PREFIX}-review__close`, "×");
      close.type = "button";
      close.setAttribute("aria-label", T("upsellClose"));
      const done = (how) => {
        ask.remove();
        save("local", { [REVIEW_KEY]: how });
        globalThis.MST_GATE.track(`review:${how}`);
        TRACK.event("review_ask", { state: how });
      };
      link.addEventListener("click", () => done("clicked"));
      close.addEventListener("click", () => done("dismissed"));
      ask.append(link, close);
      refs.summary.after(ask);
      TRACK.once("review_ask", { state: "shown" });
    }).catch(() => {});

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
      priceWrap.appendChild(UPSELL.chip(() => openUpsell("whatif")));
    }
    priceRow.appendChild(priceWrap);
    body.appendChild(priceRow);

    // Listing type toggle.
    const typeRow = el("div", `${PREFIX}-row ${PREFIX}-row--controls`);
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
        update(); // render first: a dead extension context must not freeze the UI
        if (state.itemId) save("local", { [`${PREFIX}:type:${state.itemId}`]: id });
        persistInputs(); // keep the dashboard snapshot in step
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
        openUpsell("compare");
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
        openUpsell("msi", refs.msiTeaser?.vars);
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
      refs.msiRateInput.value = String(msiCurrentRate());
      update();
      persistMsi();
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
      // A real value wins and persists; blank/0 means "use the reference
      // again" rather than a saved 0% that would hide the MSI cost forever.
      if (pct > 0) state.msiRates[String(state.msiTerm)] = Math.min(pct, 99);
      else delete state.msiRates[String(state.msiTerm)];
      update();
      persistMsi();
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
      update();
      if (state.itemId) {
        // Remember the manual pick for this listing (like product cost).
        const key = `${PREFIX}:catpick:${state.itemId}`;
        if (state.categoryGroupId) save("local", { [key]: state.categoryGroupId });
        else unsave("local", key);
      }
      persistInputs(); // keep the dashboard snapshot in step
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

    // Mercado Ads (PRO what-if): shown only while a percentage is in effect.
    refs.ads = buildRow(T("rowAdsCost", ["0"]));
    refs.ads.root.style.display = "none";
    body.appendChild(refs.ads.root);

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
      // Autofill the estimated shipping only when the seller hasn't typed
      // one (empty, or a value this select filled earlier): a manual value
      // or a saved default always wins.
      if (state.weightKg > 0 && applyShippingEstimate()) {
        refs.shippingInput.syncFromState();
      }
      update();
      persistInputs();
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
      update();
      save("sync", { usesFull: state.usesFull });
    });
    refs.fullToggle = fullCheck;
    fullRow.append(el("span", `${PREFIX}-row__label`, T("rowFull")), fullCheck);
    body.appendChild(fullRow);

    // Seller reputation → which official Mercado Envíos table the shipping
    // estimate reads (free feature). The tables already include the
    // reputation discount (50% verde, 40% amarilla or none, 0% naranja).
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
      // An autofilled estimate follows the reputation's table; a typed cost stays.
      if (refreshShippingEstimate()) refs.shippingInput.syncFromState();
      update();
      save("sync", { reputationId: state.reputationId });
    });
    refs.reputationSelect = repSel;
    repRow.appendChild(repSel);
    body.appendChild(repRow);

    // Free-shipping toggle: the seller offers free shipping below $299
    // (optional there; mandatory from $299). Offering it means paying the
    // official "envío gratis opcional" column, so with no typed cost the
    // estimate is filled when ticked and removed again when unticked.
    const freeRow = el("label", `${PREFIX}-row ${PREFIX}-toggle-row`);
    const freeCheck = document.createElement("input");
    freeCheck.type = "checkbox";
    freeCheck.className = `${PREFIX}-free-toggle`;
    freeCheck.addEventListener("change", () => {
      state.freeShipping = freeCheck.checked;
      if (state.freeShipping) {
        if (applyShippingEstimate()) refs.shippingInput.syncFromState();
      } else if (state.shippingAutofilled && !(state.priceMXN >= SOURCE.freeShippingThresholdMXN)) {
        state.shippingCostMXN = 0;
        state.shippingAutofilled = false;
        refs.shippingInput.syncFromState();
      }
      update();
      save("sync", { freeShipping: state.freeShipping });
    });
    refs.freeShippingToggle = freeCheck;
    freeRow.append(el("span", `${PREFIX}-row__label`, T("rowFreeShipping")), freeCheck);
    body.appendChild(freeRow);

    // Shipping input. Label is price-dependent (what-if can cross $299).
    const shipRow = el("div", `${PREFIX}-row`);
    refs.shipLabel = el("span", `${PREFIX}-row__label`, T("rowShipping"));
    shipRow.appendChild(refs.shipLabel);
    // An autofilled estimate is marked so the seller can tell it from a cost
    // they typed (title + class; the value itself stays editable).
    const estTag = el("span", `${PREFIX}-estimate-tag`, T("shippingEstimateTag"));
    estTag.title = T("badgeEstimate");
    estTag.hidden = true;
    const markShippingEstimate = () => {
      const est = state.shippingAutofilled && state.shippingCostMXN > 0;
      refs.shippingInput.classList.toggle(`${PREFIX}-input--estimate`, est);
      refs.shippingInput.dataset.estimate = est ? "1" : "";
      if (est) refs.shippingInput.title = T("badgeEstimate");
      else refs.shippingInput.removeAttribute("title");
      estTag.hidden = !est;
    };
    refs.shippingInput = moneyInput(
      () => state.shippingCostMXN,
      (v) => {
        state.shippingCostMXN = v;
        state.shippingAutofilled = false; // typed by the seller: never overwritten
        markShippingEstimate();
        update();
        persistInputs();
      }
    );
    refs.shippingInput.setAttribute("aria-label", T("inputShippingAria"));
    const syncShipping = refs.shippingInput.syncFromState;
    refs.shippingInput.syncFromState = () => {
      syncShipping();
      markShippingEstimate();
    };
    shipRow.append(estTag, refs.shippingInput);
    body.appendChild(shipRow);

    // Reputation discount carried by the shown estimate. Shown only for an
    // autofilled estimate from a discounted table (verde, amarilla / none).
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
      update();
      save("sync", { showWithholdings: state.showWithholdings });
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
      if (!state.pro) {
        openUpsell("sweetspot", [refs.sweetspot.dataset.gain ?? ""]);
        return;
      }
      const target = Number(refs.sweetspot.dataset.target);
      if (target > 0) {
        state.priceMXN = target;
        refs.priceInput.syncFromState();
        update();
      }
    });
    body.appendChild(refs.sweetspot);

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
          update();
          persistInputs();
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
        () => effectiveMargin(),
        (v) => {
          state.targetMarginPct = Math.min(v, 99);
          update();
          persistInputs();
          if (v > 0) TRACK.once("first_target_price_used");
        }
      );
      refs.marginInput.setAttribute("aria-label", T("inputMarginAria"));
      marginRow.appendChild(refs.marginInput);
      refs.targetMarginRow = marginRow;
      body.appendChild(marginRow);

      refs.target = buildRow(T("rowTargetPrice"), "total");
      body.appendChild(refs.target.root);

      // Inverse of the target price: the most this unit may cost to make the
      // margin AT THE PAGE PRICE. Needs no product cost.
      refs.maxCost = buildRow(T("rowMaxCostFor", [String(DEFAULT_TEASER_MARGIN_PCT)]), "total");
      refs.maxCost.root.classList.add(`${PREFIX}-row--maxcost`);
      body.appendChild(refs.maxCost.root);

      // Mercado Ads as % of the price (the seller's ACOS), saved per product
      // and folded into net, profit, margin and every solved price.
      const adsRow = el("div", `${PREFIX}-row`);
      adsRow.appendChild(el("span", `${PREFIX}-row__label`, T("rowAds")));
      refs.adsInput = moneyInput(
        () => state.adsPct,
        (v) => {
          state.adsPct = Math.min(v, 99);
          update();
          persistInputs();
        }
      );
      refs.adsInput.placeholder = "0";
      refs.adsInput.setAttribute("aria-label", T("inputAdsAria"));
      adsRow.appendChild(refs.adsInput);
      body.appendChild(adsRow);

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
      }).catch(() => {});
    } else {
      // Free: the red-number alert, then the target price as a blurred REAL
      // number for this listing (what PRO unlocks), then the two remaining
      // locked rows. Every one opens the panel with this listing's figures.
      refs.alert = UPSELL.alertStrip(() => {
        const [reason, vars] = refs.alert.reason ?? ["target", refs.targetTeaser?.vars];
        openUpsell(reason, vars);
      });
      body.appendChild(refs.alert.root);
      refs.targetTeaser = UPSELL.teaserRow(
        T("rowTargetTeaser", [String(DEFAULT_TEASER_MARGIN_PCT)]),
        () => openUpsell("target", refs.targetTeaser.vars),
        "total"
      );
      refs.targetTeaser.label = refs.targetTeaser.root.querySelector(`.${PREFIX}-row__label`);
      refs.targetTeaser.root.style.display = "none";
      body.appendChild(refs.targetTeaser.root);
      refs.msiTeaser = UPSELL.teaserRow("", () => openUpsell("msi", refs.msiTeaser.vars));
      refs.msiTeaser.label = refs.msiTeaser.root.querySelector(`.${PREFIX}-row__label`);
      refs.msiTeaser.set = (text) => {
        if (refs.msiTeaser.label.textContent !== text) refs.msiTeaser.label.textContent = text;
      };
      refs.msiTeaser.value.remove();
      refs.msiTeaser.root.style.display = "none";
      body.appendChild(refs.msiTeaser.root);
      body.appendChild(UPSELL.lockedRow(T("rowSales"), () => openUpsell("dashboard")));
    }

    // Dashboard link (the dashboard itself is Pro).
    const dashBtn = el("button", `${PREFIX}-dashlink`, T("linkDashboard"));
    dashBtn.type = "button";
    dashBtn.addEventListener("click", () => {
      if (state.pro) {
        globalThis.MST_GATE.openDashboard();
      } else {
        openUpsell("dashboard");
      }
    });
    if (!state.pro) dashBtn.appendChild(UPSELL.chip(() => openUpsell("dashboard")));
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

    // Share with another seller (WhatsApp is where MX sellers talk). The
    // message carries the store link and, when a cost is set, this listing's
    // real profit so the recipient sees what the tool does before installing.
    refs.shareBtn = el("a", `${PREFIX}-share`, T("btnShare"));
    refs.shareBtn.target = "_blank";
    refs.shareBtn.rel = "noopener";
    refs.shareBtn.hidden = true; // shown by update() once a cost is saved
    refs.shareBtn.href = buildShareUrl();
    refs.shareBtn.addEventListener("click", () => {
      refs.shareBtn.href = buildShareUrl();
      globalThis.MST_GATE.track("click:share");
      TRACK.event("share_click", { where: "card" });
    });
    refs.summary.appendChild(refs.shareBtn);

    // Fee breakdown ("cargos y envío"): collapsed by default so the card
    // answers first and explains on demand. The seller's choice (open/closed)
    // is remembered. Order (r3): the charges, then the shipping inputs and
    // the shipping cost, then ads (a % of the price, like shipping a cost the
    // seller controls, never next to "Costo total de Mercado Libre"), then the
    // net ("Recibes aprox.", said once here; the summary says "Te queda"),
    // then the retentions.
    const details = el("details", `${PREFIX}-breakdown`);
    details.appendChild(el("summary", `${PREFIX}-breakdown__toggle`, T("breakdownToggle")));
    const shipRowEl = refs.shippingInput.closest(`.${PREFIX}-row`);
    const moveIntoDetails = [
      refs.commission?.root,
      refs.fixed?.root,
      refs.effective?.root,
      refs.weightSelect?.closest(`.${PREFIX}-row`),
      refs.fullToggle?.closest(`.${PREFIX}-row`),
      refs.reputationSelect?.closest(`.${PREFIX}-row`),
      refs.freeShippingToggle?.closest(`.${PREFIX}-row`),
      shipRowEl,
      refs.shippingSubsidy?.root,
      refs.ads?.root,
      refs.net?.root,
      refs.withholdingsToggle?.closest(`.${PREFIX}-row`),
      refs.iva?.root,
      refs.isr?.root,
      refs.netAfter?.root,
      refs.withholdingsHint
    ].filter(Boolean);
    shipRowEl.before(details);
    for (const node of moveIntoDetails) details.appendChild(node);
    refs.breakdown = details;
    placeCategoryPicker(!state.categoryGroupId);
    try {
      chrome.storage.sync.get({ breakdownOpen: false }).then((v) => {
        if (v.breakdownOpen) details.open = true;
      }).catch(() => {});
    } catch {
      // context gone: the card is replaced by the reload notice shortly
    }
    details.addEventListener("toggle", () => save("sync", { breakdownOpen: details.open }));

    // Upsell panel; never opens on load. It is moved next to whatever the
    // seller clicked (see upsell.js) so it never appears 900px away.
    const upsell = UPSELL.attach(body);
    refs.upsellPanel = upsell;
    openUpsell = (reason, vars) => {
      refs.upsellReason = reason;
      upsell.open(reason, vars);
    };
  }

  function buildShareUrl() {
    const { b } = computeCurrent();
    const hasProfit = b.profitMinMXN !== undefined && state.productCostMXN > 0;
    const text = hasProfit
      ? T("shareTextProfit", [fmtMoney(b.priceMXN), fmtRange(b.profitMinMXN, b.profitMaxMXN), BRAND.shareUrl("card")])
      : T("shareText", [BRAND.shareUrl("card")]);
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  function buildSummaryText() {
    const { quote, b } = computeCurrent();
    const lines = [];
    if (quote.fixedCostUnavailable) {
      lines.push(`${T("cardTitle")} · ${window.location.href}`);
      lines.push(`${T("rowNet")}: ${T("feeUnavailable")}`);
      return lines.join("\n");
    }
    lines.push(`${T("cardTitle")} · ${window.location.href}`);
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
    if (b.adsCostMXN > 0) {
      lines.push(`${T("rowAdsCost", [String(b.adsPct)])}: ${fmtCharge(b.adsCostMXN)}`);
    }
    lines.push(
      `${T("rowEffectiveRate")}: ${fmtPctRange(b.effectiveRateMinPct, b.effectiveRateMaxPct)}`
    );
    if (b.shippingCostMXN > 0) {
      lines.push(`${T("rowShipping")}: ${fmtCharge(b.shippingCostMXN)}`);
    }
    lines.push(`${T("rowNet")}: ${fmtRange(b.netMinMXN, b.netMaxMXN)}`);
    // What the card shows, the summary shows: withholdings when enabled,
    // break-even when a cost is set.
    if (state.showWithholdings) {
      const w = CALC.computeWithholdings(state.priceMXN, SOURCE.withholdings);
      lines.push(`${T("rowIvaWithheld")}: ${fmtCharge(w.ivaMXN)}`);
      lines.push(`${T("rowIsrWithheld")}: ${fmtCharge(w.isrMXN)}`);
      lines.push(
        `${T("rowNetAfterWithholdings")}: ${fmtRange(CALC.round2(b.netMinMXN - w.totalMXN), CALC.round2(b.netMaxMXN - w.totalMXN))}`
      );
    }
    if (b.profitMinMXN !== undefined) {
      lines.push(`${T("rowProductCost")}: ${fmtMoney(b.productCostMXN)}`);
      lines.push(
        `${T("rowProfit")}: ${fmtRange(b.profitMinMXN, b.profitMaxMXN)} ` +
          `(${fmtPctRange(b.marginMinPct, b.marginMaxPct)})`
      );
      const be = refs.breakeven?.value?.textContent;
      if (be) lines.push(`${T("rowBreakeven")}: ${be}`);
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
    state.adsPct = 0;
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

    // A re-injection of the SAME listing (MELI re-render) keeps a PRO
    // seller's what-if price; a new listing or an unchanged price resets it.
    const sameItem = pageData.itemId !== null && pageData.itemId === state.itemId;
    if (!sameItem || state.priceMXN === state.pagePriceMXN || !(state.priceMXN > 0)) {
      state.priceMXN = pageData.price.value;
    }
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
      refs.markCostCommitted?.(state.productCostMXN);
      refs.marginInput?.syncFromState();
      refs.salesInput?.syncFromState();
      refs.adsInput?.syncFromState();
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
    }).catch((err) => {
      // storage unavailable (extension reloaded): keep the page-price view
      console.warn(`[${BRAND.name}] could not restore saved inputs:`, err);
      if (SAFE.alive()) TRACK.error("storage_fail");
    });
    return card;
  }

  // The page re-rendered: follow an in-page price change (variant picked,
  // promo started) so the card never keeps calculating on a stale price.
  // A what-if price the seller typed is kept; only the page price moves.
  function refreshFromPage(data) {
    if (!refs.card || !data?.price || data.itemId !== state.itemId) return false;
    const next = data.price.value;
    if (!(next > 0) || next === state.pagePriceMXN) return false;
    const following = state.priceMXN === state.pagePriceMXN;
    state.pagePriceMXN = next;
    if (following) {
      state.priceMXN = next;
      refs.priceInput?.syncFromState();
    }
    update(true);
    if (state.productCostMXN > 0) persistInputs(); // refresh the dashboard snapshot
    return true;
  }

  return Object.freeze({ build, state, showStale, refreshFromPage });
})();
