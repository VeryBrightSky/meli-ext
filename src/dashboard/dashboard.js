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

  document.title = `${BRAND.name} · ${T("dashTitle")}`;
  document.getElementById("brand-logo").src = chrome.runtime.getURL(BRAND.logoPath);
  document.getElementById("dash-title").textContent = T("dashTitle");
  const shareBtn = document.getElementById("share-btn");
  shareBtn.textContent = T("btnShareApp");
  shareBtn.href = `https://wa.me/?text=${encodeURIComponent(T("shareText", [BRAND.shareUrl("dashboard")]))}`;
  shareBtn.addEventListener("click", () => globalThis.MST_GATE.track("click:share"));

  const send = (type, payload) =>
    chrome.runtime.sendMessage({ type, payload }).catch(() => null);

  // --- Pro gate ----------------------------------------------------------------
  // Free: the dashboard still opens with the first FREE_ROWS products (worst
  // margin first) so the seller sees it work; the rest of the rows are
  // blurred and the panel below sells the whole table.
  const FREE_ROWS = 3;
  const status = await globalThis.MST_GATE.refresh();
  const pro = status.pro;
  if (!pro) {
    const up = document.getElementById("upsell");
    up.hidden = false;
    document.getElementById("upsell-title").textContent = T("upsellTitle");
    document.getElementById("upsell-body").textContent =
      `${T("upsellLead_dashboard")}. ${T("upsellBody_dashboard")}`;
    document.getElementById("upsell-pricing").textContent = T("upsellPricing");
    const upgrade = async (plan) => {
      const res = await globalThis.MST_GATE.openUpgrade(plan);
      const note = document.getElementById("upsell-pricing");
      note.textContent = res?.ok ? T("upsellOpened") : T("upsellOpenFailed");
    };
    const trial = document.getElementById("trial-btn");
    trial.hidden = true;
    const monthly = document.getElementById("monthly-btn");
    monthly.textContent = T("upsellMonthly");
    monthly.addEventListener("click", () => upgrade(BRAND.plans.monthly));
    const yearly = document.getElementById("yearly-btn");
    yearly.textContent = T("upsellYearly");
    yearly.addEventListener("click", () => upgrade(BRAND.plans.yearly));
    // Already paid (other browser/device): log in instead of paying twice.
    const loginLink = document.getElementById("login-link");
    loginLink.textContent = T("optLogin");
    loginLink.addEventListener("click", async (e) => {
      e.preventDefault();
      const res = await globalThis.MST_GATE.openLogin();
      if (!res?.ok) document.getElementById("upsell-pricing").textContent = T("upsellOpenFailed");
    });
    globalThis.MST_GATE.track("open:dashboard-page");
  }
  // A PRO answer that arrives after the 1.5s status timeout: reload once so
  // a paying user sees the full table instead of the free preview.
  globalThis.MST_GATE.onChange((st) => {
    if (st.pro !== pro) location.reload();
  });

  // Stored listing URLs came from a page we ran on, but storage is plain data:
  // only ever link to https Mercado Libre Mexico (never javascript:/data:).
  function safeListingUrl(raw) {
    try {
      const u = new URL(String(raw));
      const host = u.hostname.toLowerCase();
      const ok = u.protocol === "https:" && (host === "mercadolibre.com.mx" || host.endsWith(".mercadolibre.com.mx"));
      return ok ? u.href : null;
    } catch {
      return null;
    }
  }

  // --- Data (recomputed live; see dashboard-model.js) ---------------------------
  const DASH = globalThis.MST_DASH;
  const all = await chrome.storage.local.get(null);
  // null default so an unset options value stays distinguishable from an
  // explicit 0 (resolveDefaultShipping falls back to the card's last-used value
  // only when unset).
  const sync = await chrome.storage.sync.get({
    defaultShippingMXN: null,
    usesFull: false,
    reputationId: "none",
    freeShipping: false
  });
  const defaultShipping = DASH.resolveDefaultShipping(sync, all[`${PREFIX}:defaults`]);

  let rows = DASH.computeRows(all, PREFIX, defaultShipping, sync);
  // Free preview shows the same FREE_ROWS products no matter how the table is
  // sorted afterwards (worst margin first at load), so re-sorting can't be
  // used to read every row three at a time.
  const freeIds = new Set(
    [...rows]
      .sort((a, b2) => a.b.marginMinPct - b2.b.marginMinPct)
      .slice(0, FREE_ROWS)
      .map((r) => r.itemId)
  );

  // --- Render --------------------------------------------------------------------
  document.getElementById("content").hidden = false;
  document.getElementById("shipping-note").textContent = T("dashShippingNote", [
    UI.fmtMoney(defaultShipping)
  ]);

  // num: right-align; tone(r): "pos"/"neg"/null for green/red coloring.
  const toneBy = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : null);
  const COLS = [
    { key: "title", label: T("csvHeaderTitle"), value: (r) => r.meta.title || "", sort: (r) => (r.meta.title || "").toLowerCase() },
    { key: "price", label: T("rowPrice"), num: true, value: (r) => UI.fmtMoney(r.meta.priceMXN), sort: (r) => r.meta.priceMXN },
    { key: "type", csvOnly: true, label: T("rowListingType"), value: (r) => (r.meta.listingTypeId === "premium" ? T("typePremium") : T("typeClassic")), sort: (r) => r.meta.listingTypeId },
    { key: "commission", csvOnly: true, label: T("dashCommission"), num: true, value: (r) => UI.fmtCharge(r.b.commissionMinMXN, r.b.commissionMaxMXN), sort: (r) => r.b.commissionMaxMXN },
    { key: "shipping", csvOnly: true, label: T("dashShipping"), num: true, value: (r) => UI.fmtCharge(r.b.shippingCostMXN), sort: (r) => r.b.shippingCostMXN },
    { key: "net", label: T("dashNet"), num: true, value: (r) => UI.fmtRange(r.b.netMinMXN, r.b.netMaxMXN), sort: (r) => r.b.netMinMXN },
    { key: "cost", label: T("dashCost"), num: true, value: (r) => UI.fmtMoney(r.cost), sort: (r) => r.cost },
    { key: "profit", label: T("rowProfit"), num: true, value: (r) => UI.fmtRange(r.b.profitMinMXN, r.b.profitMaxMXN), tone: (r) => toneBy(r.b.profitMinMXN), sort: (r) => r.b.profitMinMXN },
    { key: "margin", label: T("dashMargin"), num: true, value: (r) => UI.fmtPctRange(r.b.marginMinPct, r.b.marginMaxPct), tone: (r) => toneBy(r.b.marginMinPct), sort: (r) => r.b.marginMinPct },
    { key: "sales", label: T("rowSales"), num: true, editable: true, sort: (r) => r.sales },
    { key: "monthly", label: T("rowMonthlyProfit"), num: true, value: (r) => (r.sales > 0 ? UI.fmtRange(CALC.round2(r.b.profitMinMXN * r.sales), CALC.round2(r.b.profitMaxMXN * r.sales)) : "—"), tone: (r) => (r.sales > 0 ? toneBy(r.b.profitMinMXN) : null), sort: (r) => r.b.profitMinMXN * r.sales }
  ];

  // Commission, shipping and type stay in the CSV; the on-screen table keeps
  // the 8 columns that fit a 1280px screen (net already includes those fees).
  const TABLE_COLS = COLS.filter((c) => !c.csvOnly);

  // Default sort: worst margin first, so loss-makers surface at the top.
  let sortKey = "margin";
  let sortDir = 1;

  function renderHead() {
    const tr = document.getElementById("head-row");
    tr.replaceChildren();
    for (const col of TABLE_COLS) {
      const th = document.createElement("th");
      if (col.num) th.className = "num";
      const arrow = sortKey === col.key ? (sortDir > 0 ? " ↑" : " ↓") : "";
      th.textContent = col.label + arrow;
      if (sortKey === col.key) th.classList.add("sorted");
      th.addEventListener("click", () => {
        sortDir = sortKey === col.key ? -sortDir : -1;
        sortKey = col.key;
        render();
      });
      tr.appendChild(th);
    }
  }

  // Portfolio summary: per-SKU intelligence over the already-computed rows.
  function renderPortfolio() {
    const box = document.getElementById("portfolio");
    // Free mode summarizes only the products it shows, so locked rows can't
    // leak through the "best/worst" chips or the totals.
    const s = DASH.portfolioSummary(pro ? rows : rows.filter((r) => freeIds.has(r.itemId)));
    box.replaceChildren();

    const h = document.createElement("h2");
    h.className = "portfolio-title";
    h.textContent = T("dashPortfolio");
    box.appendChild(h);

    const stats = document.createElement("div");
    stats.className = "portfolio-stats";

    const chip = (text, tone) => {
      const span = document.createElement("span");
      span.className = "portfolio-chip";
      if (tone) span.classList.add(tone);
      span.textContent = text;
      return span;
    };

    stats.appendChild(chip(T("dashTotalsLabel", [String(s.count)])));
    stats.appendChild(chip(T("dashProfitableCount", [String(s.profitable)]), "pos"));
    if (s.lossMakers > 0) {
      stats.appendChild(chip(T("dashLossCount", [String(s.lossMakers)]), "neg"));
    } else {
      stats.appendChild(chip(T("dashLossCount", [String(s.lossMakers)])));
    }
    stats.appendChild(chip(T("dashAvgMargin", [String(s.avgMarginPct)])));
    if (s.bestMargin) {
      stats.appendChild(
        chip(T("dashBest", [s.bestMargin.title || s.bestMargin.itemId, String(s.bestMargin.marginPct)]), "pos")
      );
    }
    if (s.worstMargin) {
      stats.appendChild(
        chip(
          T("dashWorst", [s.worstMargin.title || s.worstMargin.itemId, String(s.worstMargin.marginPct)]),
          s.worstMargin.marginPct < 0 ? "neg" : null
        )
      );
    }
    box.appendChild(stats);
  }

  function render() {
    // Empty state: hide the table, show a friendly message.
    const empty = rows.length === 0;
    document.getElementById("table").hidden = empty;
    document.getElementById("shipping-note").hidden = empty;
    document.getElementById("portfolio").hidden = empty;
    const note = document.getElementById("empty-note");
    note.hidden = !empty;
    note.textContent = T("dashEmpty");
    document.getElementById("export-btn").hidden = empty;
    if (empty) return;

    renderPortfolio();

    renderHead();
    const col = COLS.find((c) => c.key === sortKey);
    rows.sort((a, b2) => {
      const va = col.sort(a);
      const vb = col.sort(b2);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
    });

    const tbody = document.getElementById("rows");
    tbody.replaceChildren();

    const limitNote = document.getElementById("limit-note");
    if (!pro && rows.length > FREE_ROWS) {
      limitNote.hidden = false;
      limitNote.textContent = T("dashFreeLimit", [String(FREE_ROWS), String(rows.length)]);
    } else {
      limitNote.hidden = true;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      // Flag loss-makers (worst-case profit below zero) for visual call-out.
      if (row.b.profitMinMXN < 0) tr.classList.add(`${PREFIX}-row--loss`);
      const locked = !pro && !freeIds.has(row.itemId);
      if (locked) tr.classList.add("locked");
      for (const colDef of TABLE_COLS) {
        const td = document.createElement("td");
        if (colDef.num) td.className = "num";
        const tone = colDef.tone ? colDef.tone(row) : null;
        if (tone) td.classList.add(tone);
        if (colDef.key === "title" && !locked) {
          const href = safeListingUrl(row.meta.url);
          const label = row.meta.title || row.itemId;
          if (href) {
            const a = document.createElement("a");
            a.href = href;
            a.target = "_blank";
            a.rel = "noopener";
            a.textContent = label;
            td.appendChild(a);
          } else {
            td.textContent = label;
          }
        } else if (colDef.key === "title") {
          td.textContent = row.meta.title || row.itemId;
        } else if (colDef.editable && pro) {
          const input = document.createElement("input");
          input.type = "text";
          input.inputMode = "numeric";
          input.value = row.sales > 0 ? String(row.sales) : "";
          input.placeholder = "0";
          input.addEventListener("change", async () => {
            row.sales = Math.round(CALC.parseMoney(input.value));
            input.value = row.sales > 0 ? String(row.sales) : "";
            render();
            try {
              await chrome.storage.local.set({
                [`${PREFIX}:sales:${row.itemId}`]: row.sales
              });
            } catch {
              // storage write failed; the table already shows the new value
            }
          });
          td.appendChild(input);
        } else if (colDef.editable) {
          td.textContent = row.sales > 0 ? String(row.sales) : "—";
        } else {
          td.textContent = colDef.value(row);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });

    // Grand totals: monthly projected profit across all rows + product count.
    const tot = DASH.totals(pro ? rows : rows.filter((r) => freeIds.has(r.itemId)));
    const tfoot = document.getElementById("totals-row");
    tfoot.replaceChildren();
    const labelTd = document.createElement("td");
    labelTd.colSpan = TABLE_COLS.length - 1;
    labelTd.textContent = T("dashTotalsLabel", [String(tot.count)]);
    const valueTd = document.createElement("td");
    valueTd.className = "num";
    if (tot.withSales > 0) {
      valueTd.textContent = UI.fmtRange(tot.monthlyMinMXN, tot.monthlyMaxMXN);
      valueTd.classList.add(toneBy(tot.monthlyMinMXN) || "pos");
    } else {
      valueTd.textContent = "—";
    }
    tfoot.append(labelTd, valueTd);
  }

  // --- CSV ------------------------------------------------------------------------
  const exportBtn = document.getElementById("export-btn");
  exportBtn.hidden = false;
  exportBtn.textContent = T("btnExportCsv");
  exportBtn.addEventListener("click", () => {
    if (!pro) {
      document.getElementById("upsell").scrollIntoView({ behavior: "smooth" });
      globalThis.MST_GATE.track("open:dashboard-csv");
      return;
    }
    // Text cells: a seller-controlled title starting with = + - @ would run as
    // a formula in Excel, so it gets a leading apostrophe. Money/percent
    // columns are exported as raw numbers (worst case), which spreadsheets
    // can sum; formatted ranges like "-$12.00 – $3.00" broke into #NAME?.
    const esc = UI.csvText;
    const RAW = {
      price: (r) => r.meta.priceMXN,
      commission: (r) => r.b.commissionMaxMXN,
      shipping: (r) => r.b.shippingCostMXN,
      net: (r) => r.b.netMinMXN,
      cost: (r) => r.cost,
      profit: (r) => r.b.profitMinMXN,
      margin: (r) => r.b.marginMinPct,
      sales: (r) => r.sales,
      monthly: (r) => (r.sales > 0 ? CALC.round2(r.b.profitMinMXN * r.sales) : "")
    };
    const lines = [COLS.map((c) => esc(c.label)).join(",")];
    for (const row of rows) {
      lines.push(
        COLS.map((c) => {
          const raw = RAW[c.key];
          if (raw) {
            const n = raw(row);
            return n === "" || n === undefined || n === null ? "" : String(n);
          }
          return esc(c.value(row));
        }).join(",")
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
