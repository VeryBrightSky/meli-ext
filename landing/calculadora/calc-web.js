// Web calculator for /calculadora/. Pure math lives in NETIO_WEB_CALC.compute
// (testable in Node); the DOM part only runs in a browser. Commission, fixed
// charge and withholdings come from the extension's own modules (copied next
// to this file at build time); the shipping line comes from the official
// Mercado Envíos tables in shipping-official.js.
"use strict";

globalThis.NETIO_WEB_CALC = (() => {
  const SOURCE = globalThis.MST_FEE_SOURCE;
  const CALC = globalThis.MST_CALC;
  const SHIP = globalThis.NETIO_SHIPPING_OFFICIAL;
  const r2 = CALC.round2;

  const REPUTATIONS = ["verde", "amarilla", "naranja"];
  // Withholding rates (Mercado Pago, 15 May 2026): with RFC 8% IVA + 2.5% ISR;
  // without RFC 16% IVA + 20% ISR. Both on the price without IVA, like the extension.
  const RATES_RFC = { vatPct: 16, ivaRetPct: SOURCE.withholdings.ivaRetPct, isrRetPct: SOURCE.withholdings.isrRetPct };
  const RATES_NO_RFC = { vatPct: 16, ivaRetPct: 16, isrRetPct: 20 };

  // inputs: { priceMXN, costMXN, categoryGroupId|null, listingTypeId, reputation,
  //           weightKg, offersFree, hasRFC }
  function compute(inputs) {
    const price = CALC.parseMoney(inputs.priceMXN);
    const cost = CALC.parseMoney(inputs.costMXN);
    const listingTypeId = inputs.listingTypeId === "premium" ? "premium" : "classic";
    const reputation = REPUTATIONS.includes(inputs.reputation) ? inputs.reputation : "verde";
    const weightKg = Number(inputs.weightKg) > 0 ? Number(inputs.weightKg) : 0.3;
    const offersFree = inputs.offersFree === true;
    const hasRFC = inputs.hasRFC !== false;
    const groupId = SOURCE.listCategoryGroups().some((g) => g.id === inputs.categoryGroupId) ? inputs.categoryGroupId : null;

    const quote = SOURCE.getQuote({ priceMXN: price, listingTypeId, categoryGroupId: groupId });
    const ship = SHIP.sellerCost({ priceMXN: price, weightKg, reputation, offersFree });
    const shippingMXN = ship ? ship.costMXN : 0;
    const bd = CALC.computeBreakdown(quote, { priceMXN: price, shippingCostMXN: shippingMXN, productCostMXN: cost });
    const wh = CALC.computeWithholdings(price, hasRFC ? RATES_RFC : RATES_NO_RFC);

    // Net before withholdings (same definition as the extension card), then
    // after. Withholdings are creditable, so both are shown.
    const preMin = r2(bd.netMinMXN - cost);
    const preMax = r2(bd.netMaxMXN - cost);
    const netMin = r2(preMin - wh.totalMXN);
    const netMax = r2(preMax - wh.totalMXN);
    const pct = (n) => (price > 0 ? r2((n / price) * 100) : 0);

    return {
      priceMXN: price,
      costMXN: cost,
      listingTypeId,
      reputation,
      weightKg,
      offersFree,
      hasRFC,
      categoryGroup: quote.categoryGroup,
      pctMin: quote.pctMin,
      pctMax: quote.pctMax,
      isExactRate: quote.pctMin === quote.pctMax,
      rateConfidence: quote.confidence,
      commissionMinMXN: bd.commissionMinMXN,
      commissionMaxMXN: bd.commissionMaxMXN,
      fixedCostMXN: bd.fixedCostMXN,
      shippingMXN,
      shippingInfo: ship,
      withholdings: wh,
      withholdingRates: hasRFC ? RATES_RFC : RATES_NO_RFC,
      preWithholdingMinMXN: preMin,
      preWithholdingMaxMXN: preMax,
      netMinMXN: netMin,
      netMaxMXN: netMax,
      marginMinPct: pct(netMin),
      marginMaxPct: pct(netMax),
      belowMinPrice: price > 0 && price < SOURCE.minPriceMXN
    };
  }

  return Object.freeze({ compute, REPUTATIONS, RATES_RFC, RATES_NO_RFC });
})();

// ---------------------------------------------------------------- DOM part
if (typeof document !== "undefined") {
  (() => {
    const form = document.getElementById("calc-form");
    if (!form) return;
    const $ = (id) => document.getElementById(id);
    const fmt = (n) => {
      const sign = n < 0 ? "-" : "";
      const abs = Math.abs(n);
      return sign + "$" + abs.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const money = (min, max) => (min === max ? fmt(min) : fmt(min) + " a " + fmt(max));
    const pctText = (min, max) => (min === max ? min + "%" : min + "% a " + max + "%");

    function read() {
      const w = Number(form.peso.value);
      return {
        priceMXN: form.precio.value,
        costMXN: form.costo.value,
        categoryGroupId: form.cat.value || null,
        listingTypeId: form.tipo.value,
        reputation: form.rep.value,
        weightKg: w,
        offersFree: form.gratis.checked,
        hasRFC: form.rfc.value === "si"
      };
    }

    function render() {
      const r = globalThis.NETIO_WEB_CALC.compute(read());
      const out = $("calc-result");
      const below299 = r.priceMXN < 299;
      $("r-precio").textContent = fmt(r.priceMXN);
      $("r-com").textContent = "-" + money(r.commissionMinMXN, r.commissionMaxMXN);
      $("r-com-note").textContent = r.isExactRate
        ? pctText(r.pctMin, r.pctMax) + " estimado para " + (r.categoryGroup ? r.categoryGroup.label : "esta categoría") + ". Mercado Libre muestra el exacto al publicar"
        : "Rango " + pctText(r.pctMin, r.pctMax) + " (categoría desconocida). Mercado Libre muestra el exacto al publicar";
      $("r-fijo").textContent = r.fixedCostMXN > 0 ? "-" + fmt(r.fixedCostMXN) : "$0.00";
      $("r-fijo-note").textContent = r.listingTypeId === "premium"
        ? "Premium no paga costo fijo según los datos de Netio"
        : (below299 ? "Clásica abajo de $299, tramo según los datos de Netio" : "Desde $299 ya no aplica");
      $("r-envio").textContent = r.shippingMXN > 0 ? "-" + fmt(r.shippingMXN) : "$0.00";
      $("r-envio-note").textContent = r.shippingInfo
        ? (r.shippingInfo.costMXN > 0
          ? "Tabla oficial, reputación " + r.reputation + ", " + r.shippingInfo.weightLabel.toLowerCase() + ", " + r.shippingInfo.bandLabel.toLowerCase()
          : "No ofreces envío gratis abajo de $299: lo paga el comprador")
        : "Peso fuera de tabla";
      $("r-ret").textContent = "-" + fmt(r.withholdings.totalMXN);
      $("r-ret-note").textContent = (r.hasRFC ? "Con RFC: IVA 8% + ISR 2.5%" : "Sin RFC: IVA 16% + ISR 20%") +
        " sobre " + fmt(r.withholdings.baseMXN) + " (precio sin IVA). Son acreditables";
      $("r-costo").textContent = r.costMXN > 0 ? "-" + fmt(r.costMXN) : "$0.00";
      $("r-pre").textContent = money(r.preWithholdingMinMXN, r.preWithholdingMaxMXN);
      const net = $("r-neto");
      net.textContent = money(r.netMinMXN, r.netMaxMXN);
      const loss = r.netMaxMXN < 0;
      const mixed = !loss && r.netMinMXN < 0;
      net.className = "v " + (loss ? "loss" : mixed ? "" : "profit");
      const verdict = $("r-verdict");
      verdict.className = "verdict " + (loss ? "loss" : mixed ? "mixed" : "profit");
      if (r.priceMXN <= 0) {
        verdict.textContent = "Escribe un precio de venta para ver la cuenta.";
      } else if (r.belowMinPrice) {
        verdict.textContent = "Mercado Libre no permite publicar abajo de $35.";
      } else if (loss) {
        verdict.textContent = "Pierdes " + money(Math.abs(r.netMaxMXN), Math.abs(r.netMinMXN)) + " en cada venta. Margen " + pctText(r.marginMinPct, r.marginMaxPct) + ".";
      } else if (mixed) {
        verdict.textContent = "Depende del porcentaje exacto de tu categoría: entre " + fmt(r.netMinMXN) + " y " + fmt(r.netMaxMXN) + " por venta.";
      } else {
        verdict.textContent = "Te quedan " + money(r.netMinMXN, r.netMaxMXN) + " por venta. Margen " + pctText(r.marginMinPct, r.marginMaxPct) + ".";
      }
      $("r-margen").textContent = pctText(r.marginMinPct, r.marginMaxPct);
      const gratisRow = $("gratis-row");
      if (gratisRow) gratisRow.hidden = !below299 || r.priceMXN <= 0;
      out.hidden = false;
      // Keep the URL shareable without reloading.
      try {
        const q = new URLSearchParams({
          precio: String(r.priceMXN), costo: String(r.costMXN), cat: form.cat.value || "otra",
          tipo: r.listingTypeId === "premium" ? "premium" : "clasica", rep: r.reputation,
          peso: String(r.weightKg), gratis: r.offersFree ? "si" : "no", rfc: r.hasRFC ? "si" : "no"
        });
        history.replaceState(null, "", "?" + q.toString());
      } catch (e) { /* no-op */ }
    }

    function prefill() {
      const q = new URLSearchParams(location.search);
      const set = (name, v) => { if (v !== null && form[name]) form[name].value = v; };
      set("precio", q.get("precio"));
      set("costo", q.get("costo"));
      const cat = q.get("cat");
      if (cat && Array.from(form.cat.options).some((o) => o.value === cat)) form.cat.value = cat;
      const tipo = q.get("tipo");
      if (tipo) form.tipo.value = tipo === "premium" ? "premium" : "classic";
      const rep = q.get("rep");
      if (rep && globalThis.NETIO_WEB_CALC.REPUTATIONS.includes(rep)) form.rep.value = rep;
      const peso = q.get("peso");
      if (peso) {
        const kg = Number(peso);
        const idx = globalThis.NETIO_SHIPPING_OFFICIAL.weightIndex(kg);
        if (idx >= 0) form.peso.value = String(globalThis.NETIO_SHIPPING_OFFICIAL.weightsMaxKg[idx] === Infinity ? 999 : globalThis.NETIO_SHIPPING_OFFICIAL.weightsMaxKg[idx]);
      }
      const gratis = q.get("gratis");
      if (gratis) form.gratis.checked = gratis === "si" || gratis === "1" || gratis === "true";
      const rfc = q.get("rfc");
      if (rfc) form.rfc.value = rfc === "no" || rfc === "0" ? "no" : "si";
    }

    prefill();
    form.addEventListener("input", render);
    form.addEventListener("change", render);
    form.addEventListener("submit", (e) => { e.preventDefault(); render(); });
    render();
  })();
}
