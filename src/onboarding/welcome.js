// Welcome page opened once by the service worker (install, and the first
// update that brings the reverse trial). Says what the seller actually has
// (trial days, PRO, or the free plan after an expired trial) and what to do
// first.
"use strict";

// Pure: entitlement status → the three header strings. A reinstall after an
// expired trial lands here with trialExpired and 0 days left; it must not be
// told PRO is on for 7 days (v1.5.1 audit).
globalThis.MST_WELCOME_COPY = function welcomeCopy(s, T) {
  if (s.owner || s.paid) {
    return { pill: T("statusPro"), title: T("welcomeTitlePaid"), lead: T("welcomeLeadPaid"), state: "paid" };
  }
  if (s.trialActive && s.trialDaysLeft > 0) {
    const days = s.trialDaysLeft;
    return {
      pill: days === 1 ? T("badgeTrialOne") : T("badgeTrial", [String(days)]),
      title: T("welcomeTitle"),
      lead: days === 1 ? T("welcomeLeadOne") : T("welcomeLead", [String(days)]),
      state: "trial"
    };
  }
  if (s.trialExpired) {
    return { pill: T("statusFree"), title: T("welcomeTitleExpired"), lead: T("welcomeLeadExpired"), state: "expired" };
  }
  // Fresh install (1.5.5+): the 7 days start with the first saved cost.
  if (s.trialPending) {
    return { pill: T("badgeTrialPending"), title: T("welcomeTitlePending"), lead: T("welcomeLeadPending"), state: "pending" };
  }
  return { pill: T("statusFree"), title: T("welcomeTitleFree"), lead: T("welcomeLeadFree"), state: "free" };
};

// Pure: the live demo card for the welcome page, computed with the SAME fee
// logic the card uses (fee table, official shipping table, solvers), so the
// seller sees the product work on a real example before opening a listing.
// Example: a $499 Clásica listing in "Hogar, moda, deportes y general", 0.3 kg,
// no reputation, a $250 cost. Returns { rows, pro, caption } with formatted
// strings; null if the fee modules are not loaded.
globalThis.MST_WELCOME_DEMO = function welcomeDemo(T, { priceMXN = 499, costMXN = 250, marginPct = 30, categoryGroupId = "home-general" } = {}) {
  const SOURCE = globalThis.MST_FEE_SOURCE;
  const CALC = globalThis.MST_CALC;
  const SHIP = globalThis.MST_SHIPPING;
  const UI = globalThis.MST_UI;
  if (!SOURCE || !CALC || !SHIP || !UI) return null;
  const weightKg = 0.3;
  const quote = SOURCE.getQuote({ priceMXN, listingTypeId: "classic", categoryGroupId });
  const shipping = priceMXN >= SOURCE.freeShippingThresholdMXN ? (SHIP.costForWeight(weightKg, priceMXN, "none") ?? 0) : 0;
  const b = CALC.computeBreakdown(quote, { priceMXN, shippingCostMXN: shipping, productCostMXN: costMXN });
  const fixedFn = SOURCE.fixedCostFnFor({ listingTypeId: "classic" });
  const thresholds = [...new Set([...SOURCE.getFixedCostThresholds(null), ...SOURCE.getShippingThresholds()])].sort((a, c) => a - c);
  const shipAt = (p) => (p >= SOURCE.freeShippingThresholdMXN ? (SHIP.costForWeight(weightKg, p, "none") ?? 0) : 0);
  const target = CALC.solveTargetPrice({
    costMXN, shippingMXN: 0, marginPct, ratePct: quote.pctMax,
    fixedCostFn: (p) => fixedFn(p) + shipAt(p), thresholds, minPriceMXN: SOURCE.minPriceMXN ?? 0
  });
  const maxCost = CALC.solveMaxCost({ priceMXN, marginPct, ratePct: quote.pctMax, fixedCostMXN: b.fixedCostMXN, shippingMXN: shipping });
  const rows = [
    [T("rowPrice"), UI.fmtMoney(priceMXN)],
    [T("rowCommission", [UI.fmtPctRange(b.pctMin, b.pctMax)]), UI.fmtCharge(b.commissionMinMXN, b.commissionMaxMXN)]
  ];
  if (b.fixedCostMXN > 0) rows.push([T("stackFixed"), UI.fmtCharge(b.fixedCostMXN)]);
  if (shipping > 0) rows.push([T("stackShippingEstimate", [String(weightKg)]), UI.fmtCharge(shipping)]);
  rows.push([T("stackNet"), UI.fmtRange(b.netMinMXN, b.netMaxMXN)]);
  rows.push([T("rowProductCost"), UI.fmtMoney(costMXN)]);
  rows.push([T("rowProfit"), `${UI.fmtRange(b.profitMinMXN, b.profitMaxMXN)} (${UI.fmtPctRange(b.marginMinPct, b.marginMaxPct)})`]);
  const pro = [
    [T("rowTargetPriceFor", [String(marginPct)]), target !== null ? UI.fmtMoney(target) : T("targetUnreachable")],
    [T("rowMaxCostFor", [String(marginPct)]), maxCost !== null ? UI.fmtMoney(maxCost) : T("maxCostNone")]
  ];
  const group = SOURCE.listCategoryGroups().find((g) => g.id === categoryGroupId);
  return { rows, pro, caption: T("welcomeDemoCaption", [UI.fmtMoney(priceMXN), group ? group.label : categoryGroupId]) };
};

(async () => {
  const BRAND = globalThis.EXT_BRAND;
  const T = globalThis.MST_I18N.t;
  document.title = `${BRAND.name} · ${T("welcomeTitle")}`;
  document.getElementById("brand-logo").src = chrome.runtime.getURL("src/assets/icons/icon48.png");

  const s = await globalThis.MST_GATE.refresh();
  const copy = globalThis.MST_WELCOME_COPY(s, T);
  document.title = `${BRAND.name} · ${copy.title}`;
  document.getElementById("pill").textContent = copy.pill;
  document.getElementById("pill").dataset.state = copy.state;
  document.getElementById("title").textContent = copy.title;
  document.getElementById("lead").textContent = copy.lead;
  document.getElementById("s1t").textContent = T("welcomeStep1");
  document.getElementById("s1t").href = BRAND.listingsUrl;
  document.getElementById("go").href = BRAND.listingsUrl;
  // Only a trial that has not started is told what starts it.
  document.getElementById("s1b").textContent =
    copy.state === "pending" ? `${T("welcomeStep1Body")} ${T("welcomeStep1Trial")}` : T("welcomeStep1Body");
  document.getElementById("s2t").textContent = T("welcomeStep2");
  document.getElementById("s2b").textContent = T("welcomeStep2Body");
  document.getElementById("s3t").textContent = T("welcomeStep3");
  document.getElementById("s3b").textContent = T("welcomeStep3Body");
  document.getElementById("go").textContent = T("welcomeGo");
  // Expired/free states: the lead says "activar PRO", so the pay CTA is right
  // here (yearly plan first, like the card's panel; the same checkout).
  // Owner, paid and trial states never show it.
  const upgrade = document.getElementById("upgrade");
  if (copy.state === "expired" || copy.state === "free") {
    upgrade.textContent = T("upsellYearly");
    upgrade.hidden = false;
    upgrade.addEventListener("click", async () => {
      const res = await globalThis.MST_GATE.openUpgrade(BRAND.plans.yearly, "welcome");
      if (!res?.ok) upgrade.textContent = T("upsellOpenFailed");
    });
  }
  const dash = document.getElementById("dash");
  dash.textContent = T("optDashboard");
  dash.addEventListener("click", () => globalThis.MST_GATE.openDashboard());
  const share = document.getElementById("share");
  share.textContent = T("btnShareApp");
  share.href = `https://wa.me/?text=${encodeURIComponent(T("shareText", [BRAND.shareUrl("welcome")]))}`;
  share.addEventListener("click", () => {
    globalThis.MST_GATE.track("click:share");
    globalThis.MST_TRACK.event("share_click", { where: "welcome" });
  });
  document.getElementById("note").textContent = T("welcomeNote");
  // Live demo: the card on a $499 example, real fee logic, before any visit.
  const demo = globalThis.MST_WELCOME_DEMO(T);
  if (demo) {
    const box = document.getElementById("demo");
    document.getElementById("demo-title").textContent = T("welcomeDemoTitle");
    document.getElementById("demo-caption").textContent = demo.caption;
    const rowsEl = document.getElementById("demo-rows");
    const addRow = (parent, [label, value], cls) => {
      const r = document.createElement("div");
      r.className = `demo-row${cls ? ` ${cls}` : ""}`;
      const l = document.createElement("span");
      l.textContent = label;
      const v = document.createElement("span");
      v.textContent = value;
      r.append(l, v);
      parent.appendChild(r);
    };
    demo.rows.forEach((row, i) => addRow(rowsEl, row, row[0] === T("stackNet") || i === demo.rows.length - 1 ? "demo-row--total" : ""));
    const proEl = document.getElementById("demo-pro");
    document.getElementById("demo-pro-title").textContent = T("welcomeDemoPro");
    for (const row of demo.pro) addRow(proEl, row, "demo-row--pro");
    box.hidden = false;
  }
  globalThis.MST_GATE.track("seen:welcome");

  // Anonymous analytics notice: only when a backend is configured in this
  // build (the default build is dormant and keeps the original note).
  const tstate = await globalThis.MST_TRACK.state();
  if (tstate?.configured) {
    document.getElementById("note").textContent = T("welcomeNoteTelemetry");
    const box = document.getElementById("tnotice");
    document.getElementById("tnotice-text").textContent = T("telemetryNotice");
    const link = document.getElementById("tnotice-link");
    link.textContent = T("telemetryNoticeLink");
    link.href = `${BRAND.landingUrl}/privacidad.html`;
    const off = document.getElementById("tnotice-off");
    off.textContent = tstate.enabled ? T("telemetryNoticeOff") : T("telemetryOffDone");
    off.disabled = !tstate.enabled;
    off.addEventListener("click", async () => {
      const res = await globalThis.MST_TRACK.setEnabled(false);
      if (res) {
        off.textContent = T("telemetryOffDone");
        off.disabled = true;
      }
    });
    box.hidden = false;
  }
  globalThis.MST_TRACK.event("welcome_seen");
})();
