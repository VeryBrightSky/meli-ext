// Tablero de Ganancias (Pro): every listing with a saved cost, fee math from
// the bundled table, editable ventas/mes, sortable columns, totals, CSV.
// All local — reads storage only.
"use strict";

(async () => {
  const BRAND = globalThis.EXT_BRAND;
  const PREFIX = BRAND.cssPrefix;
  const T = globalThis.MST_I18N.t;
  const SOURCE = globalThis.MST_FEE_SOURCE;
  const CALC = globalThis.MST_CALC;
  const UI = globalThis.MST_UI;

  document.title = `${BRAND.name} — ${T("dashTitle")}`;
  document.getElementById("brand-logo").src = chrome.runtime.getURL(BRAND.logoPath);
  document.getElementById("dash-title").textContent = T("dashTitle");

  const send = (type) => chrome.runtime.sendMessage({ type }).catch(() => null);

  // --- Pro gate ----------------------------------------------------------------
  const status = await globalThis.MST_GATE.refresh();
  if (!status.pro) {
    const up = document.getElementById("upsell");
    up.hidden = false;
    document.getElementById("upsell-title").textContent = T("upsellTitle");
    document.getElementById("upsell-body").textContent = T("upsellBody");
    document.getElementById("upsell-pricing").textContent = T("upsellPricing");
    const trial = document.getElementById("trial-btn");
    trial.textContent = T("upsellTrial");
    trial.addEventListener("click", () => send("openTrialPage"));
    const plans = document.getElementById("plans-btn");
    plans.textContent = T("upsellPlans");
    plans.addEventListener("click", () => send("openPaymentPage"));
    return;
  }

  // --- Data ----------------------------------------------------------------------
  const all = await chrome.storage.local.get(null);
  const defaultShipping = CALC.parseMoney(
    all[`${PREFIX}:defaults`]?.shippingCostMXN ?? 0
  );

  function computeRow(itemId) {
    const cost = CALC.parseMoney(all[`${PREFIX}:cost:${itemId}`]);
    const meta = all[`${PREFIX}:meta:${itemId}`];
    if (!(cost > 0) || !meta || !(meta.priceMXN > 0)) return null;
    const sales = CALC.parseMoney(all[`${PREFIX}:sales:${itemId}`]);
    const quote = SOURCE.getQuote({
      priceMXN: meta.priceMXN,
      listingTypeId: meta.listingTypeId,
      categoryGroupId: meta.categoryGroupId
    });
    const b = CALC.computeBreakdown(quote, {
      priceMXN: meta.priceMXN,
      shippingCostMXN: defaultShipping,
      productCostMXN: cost
    });
    return { itemId, meta, cost, sales, b };
  }

  let rows = Object.keys(all)
    .filter((k) => k.startsWith(`${PREFIX}:cost:`))
    .map((k) => computeRow(k.slice(`${PREFIX}:cost:`.length)))
    .filter(Boolean);

  // --- Render --------------------------------------------------------------------
  document.getElementById("content").hidden = false;
  document.getElementById("shipping-note").textContent = T("dashShippingNote", [
    UI.fmtMoney(defaultShipping)
  ]);

  const COLS = [
    { key: "title", label: T("csvHeaderTitle"), value: (r) => r.meta.title, sort: (r) => r.meta.title.toLowerCase() },
    { key: "price", label: T("rowPrice"), value: (r) => UI.fmtMoney(r.meta.priceMXN), sort: (r) => r.meta.priceMXN },
    { key: "type", label: T("rowListingType"), value: (r) => (r.meta.listingTypeId === "premium" ? T("typePremium") : T("typeClassic")), sort: (r) => r.meta.listingTypeId },
    { key: "commission", label: T("dashCommission"), value: (r) => UI.fmtCharge(r.b.commissionMinMXN, r.b.commissionMaxMXN), sort: (r) => r.b.commissionMaxMXN },
    { key: "shipping", label: T("dashShipping"), value: (r) => UI.fmtCharge(r.b.shippingCostMXN), sort: (r) => r.b.shippingCostMXN },
    { key: "net", label: T("dashNet"), value: (r) => UI.fmtRange(r.b.netMinMXN, r.b.netMaxMXN), sort: (r) => r.b.netMinMXN },
    { key: "cost", label: T("dashCost"), value: (r) => UI.fmtMoney(r.cost), sort: (r) => r.cost },
    { key: "profit", label: T("rowProfit"), value: (r) => UI.fmtRange(r.b.profitMinMXN, r.b.profitMaxMXN), sort: (r) => r.b.profitMinMXN },
    { key: "margin", label: T("dashMargin"), value: (r) => UI.fmtPctRange(r.b.marginMinPct, r.b.marginMaxPct), sort: (r) => r.b.marginMinPct },
    { key: "sales", label: T("rowSales"), editable: true, sort: (r) => r.sales },
    { key: "monthly", label: T("rowMonthlyProfit"), value: (r) => (r.sales > 0 ? UI.fmtRange(CALC.round2(r.b.profitMinMXN * r.sales), CALC.round2(r.b.profitMaxMXN * r.sales)) : "—"), sort: (r) => r.b.profitMinMXN * r.sales }
  ];

  let sortKey = "monthly";
  let sortDir = -1;

  function renderHead() {
    const tr = document.getElementById("head-row");
    tr.replaceChildren();
    for (const col of COLS) {
      const th = document.createElement("th");
      th.textContent = col.label + (sortKey === col.key ? (sortDir > 0 ? " ↑" : " ↓") : "");
      th.addEventListener("click", () => {
        sortDir = sortKey === col.key ? -sortDir : -1;
        sortKey = col.key;
        render();
      });
      tr.appendChild(th);
    }
  }

  function render() {
    renderHead();
    const col = COLS.find((c) => c.key === sortKey);
    rows.sort((a, b2) => {
      const va = col.sort(a);
      const vb = col.sort(b2);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
    });

    const tbody = document.getElementById("rows");
    tbody.replaceChildren();
    document.getElementById("empty-note").hidden = rows.length > 0;
    document.getElementById("empty-note").textContent = T("dashEmpty");

    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const colDef of COLS) {
        const td = document.createElement("td");
        if (colDef.key === "title") {
          const a = document.createElement("a");
          a.href = row.meta.url;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = row.meta.title || row.itemId;
          td.appendChild(a);
        } else if (colDef.editable) {
          const input = document.createElement("input");
          input.type = "text";
          input.inputMode = "numeric";
          input.value = row.sales > 0 ? String(row.sales) : "";
          input.placeholder = "0";
          input.addEventListener("change", async () => {
            row.sales = Math.round(CALC.parseMoney(input.value));
            input.value = row.sales > 0 ? String(row.sales) : "";
            await chrome.storage.local.set({
              [`${PREFIX}:sales:${row.itemId}`]: row.sales
            });
            render();
          });
          td.appendChild(input);
        } else {
          td.textContent = colDef.value(row);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    // Totals: monthly profit bounds across all rows with sales.
    const totMin = CALC.round2(
      rows.reduce((sum, r) => sum + (r.sales > 0 ? r.b.profitMinMXN * r.sales : 0), 0)
    );
    const totMax = CALC.round2(
      rows.reduce((sum, r) => sum + (r.sales > 0 ? r.b.profitMaxMXN * r.sales : 0), 0)
    );
    const tfoot = document.getElementById("totals-row");
    tfoot.replaceChildren();
    const labelTd = document.createElement("td");
    labelTd.colSpan = COLS.length - 1;
    labelTd.textContent = `${T("dashTotals")} (${rows.length})`;
    const valueTd = document.createElement("td");
    valueTd.textContent = rows.some((r) => r.sales > 0) ? UI.fmtRange(totMin, totMax) : "—";
    tfoot.append(labelTd, valueTd);
  }

  // --- CSV ------------------------------------------------------------------------
  const exportBtn = document.getElementById("export-btn");
  exportBtn.hidden = false;
  exportBtn.textContent = T("btnExportCsv");
  exportBtn.addEventListener("click", () => {
    const esc = (v) => (/[",\n;]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
    const lines = [COLS.map((c) => esc(c.label)).join(",")];
    for (const row of rows) {
      lines.push(
        COLS.map((c) =>
          esc(c.editable ? row.sales : c.value(row))
        ).join(",")
      );
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${BRAND.name.toLowerCase()}-tablero.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  render();
})();
