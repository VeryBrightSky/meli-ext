// Options page: per-surface toggles, defaults, and stored-data reset.
// Settings live in chrome.storage.sync; per-product costs in storage.local.
"use strict";

const BRAND = globalThis.EXT_BRAND;
const T = globalThis.MST_I18N.t;
const parseMoney = globalThis.MST_CALC.parseMoney;

const DEFAULT_SETTINGS = {
  enabled: true,
  cardEnabled: true,
  stripsEnabled: true,
  // null = "unset" (fall back to the card's last-used shipping); a saved number
  // — including an explicit 0 for genuinely free shipping — is authoritative.
  defaultShippingMXN: null,
  defaultListingType: "auto",
  acquisitionPct: 0,
  radarTargetPct: 30
};

// Branding + i18n strings.
document.title = `${BRAND.name} · ${T("optionsTitle")}`;
document.getElementById("brand-name").textContent = BRAND.name;
document.getElementById("brand-logo").src = chrome.runtime.getURL(BRAND.logoPath);
document.getElementById("lbl-card").textContent = T("optShowCard");
document.getElementById("lbl-strips").textContent = T("optShowStrips");
document.getElementById("lbl-shipping").textContent = T("optDefaultShipping");
document.getElementById("lbl-type").textContent = T("optDefaultType");
document.getElementById("opt-auto").textContent = T("optTypeAuto");
document.getElementById("opt-classic").textContent = T("typeClassic");
document.getElementById("opt-premium").textContent = T("typePremium");
document.getElementById("reset-btn").textContent = T("optReset");
document.getElementById("reset-hint").textContent = T("optResetHint");
document.getElementById("lbl-acquisition").textContent = T("optAcquisition");
document.getElementById("lbl-subscription").textContent = T("optSubscription");
document.getElementById("manage-btn").textContent = T("optManage");
document.getElementById("login-btn").textContent = T("optLogin");
document.getElementById("dashboard-btn").textContent = T("optDashboard");

const cardEnabled = document.getElementById("card-enabled");
const stripsEnabled = document.getElementById("strips-enabled");
const defaultShipping = document.getElementById("default-shipping");
const defaultType = document.getElementById("default-type");
const resetBtn = document.getElementById("reset-btn");
const resetStatus = document.getElementById("reset-status");

async function load() {
  const s = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  cardEnabled.checked = s.cardEnabled;
  stripsEnabled.checked = s.stripsEnabled;
  // Show an explicit saved value (incl. "0.00"); leave the field empty only
  // when truly unset (null/absent) so 0 and unset stay distinguishable.
  defaultShipping.value =
    s.defaultShippingMXN === null || s.defaultShippingMXN === undefined
      ? ""
      : parseMoney(s.defaultShippingMXN).toFixed(2);
  defaultType.value = s.defaultListingType;
  const acq = document.getElementById("acquisition-pct");
  acq.value = s.acquisitionPct > 0 ? String(s.acquisitionPct) : "";
}

cardEnabled.addEventListener("change", () =>
  chrome.storage.sync.set({ cardEnabled: cardEnabled.checked })
);
stripsEnabled.addEventListener("change", () =>
  chrome.storage.sync.set({ stripsEnabled: stripsEnabled.checked })
);
defaultShipping.addEventListener("change", () => {
  // Empty field → null (unset). A typed value, including "0", is saved as a
  // number so a deliberate 0 (no shipping) is honored and never read as unset.
  const raw = defaultShipping.value.trim();
  const v = raw === "" ? null : parseMoney(raw);
  defaultShipping.value = v === null ? "" : v.toFixed(2);
  chrome.storage.sync.set({ defaultShippingMXN: v });
});
defaultType.addEventListener("change", () =>
  chrome.storage.sync.set({ defaultListingType: defaultType.value })
);

// Pro subscription status + actions (via the service worker / ExtPay).
const acquisitionInput = document.getElementById("acquisition-pct");
acquisitionInput.addEventListener("change", () => {
  const v = Math.min(parseMoney(acquisitionInput.value), 99);
  acquisitionInput.value = v > 0 ? String(v) : "";
  chrome.storage.sync.set({ acquisitionPct: v });
});

const send = (type) => chrome.runtime.sendMessage({ type }).catch(() => null);
// Checkout/login open in a new tab; if that fails (offline), say so instead
// of a button that silently does nothing.
const withFeedback = (type) => async () => {
  const res = await send(type);
  if (!res?.ok) document.getElementById("sub-status").textContent = T("upsellOpenFailed");
};
document.getElementById("manage-btn").addEventListener("click", withFeedback("openPaymentPage"));
document.getElementById("login-btn").addEventListener("click", withFeedback("openLoginPage"));
document.getElementById("dashboard-btn").addEventListener("click", () => send("openDashboard"));

async function loadSubscriptionStatus() {
  const statusEl = document.getElementById("sub-status");
  // Merged status (ExtPay + local reverse trial) — the same one the card uses.
  const s = await globalThis.MST_GATE.refresh();
  statusEl.textContent = s.paid
    ? T("statusPro")
    : s.trialActive
      ? (s.localTrial
          ? (s.trialDaysLeft === 1 ? T("statusTrialDaysOne") : T("statusTrialDays", [String(s.trialDaysLeft)]))
          : T("statusTrial"))
      : s.trialExpired
        ? T("statusTrialExpired")
        : T("statusFree");

  // Local-only funnel counters for the developer (no network, nothing sent).
  const metricsEl = document.getElementById("metrics");
  const debug = new URLSearchParams(location.search).has("debug");
  if (metricsEl && debug) {
    const stored = await chrome.storage.local.get(globalThis.MST_GATE.METRICS_KEY);
    const m = stored[globalThis.MST_GATE.METRICS_KEY] ?? {};
    const parts = Object.entries(m)
      .filter(([k]) => k !== "updatedAt")
      .sort()
      .map(([k, v]) => `${k} ${v}`);
    metricsEl.textContent = parts.length ? `${T("optMetrics")}: ${parts.join(" · ")}` : "";
  }
}
loadSubscriptionStatus();

// Anonymous analytics: the toggle and notice exist only in builds that have a
// backend configured; ?debug also shows the local diagnostic line (queue, last
// send status, HTTP code or error) so a broken backend is visible at once.
async function loadTelemetry() {
  const TRACK = globalThis.MST_TRACK;
  TRACK.event("options_open");
  const debug = new URLSearchParams(location.search).has("debug");
  const st = await TRACK.state(debug);
  if (!st || (!st.configured && !debug)) return;
  const box = document.getElementById("telemetry-box");
  box.hidden = false;
  const row = document.getElementById("telemetry-row");
  const hint = document.getElementById("telemetry-hint");
  const toggle = document.getElementById("telemetry-enabled");
  if (st.configured) {
    document.getElementById("lbl-telemetry").textContent = T("optTelemetry");
    hint.textContent = T("optTelemetryHint");
    toggle.checked = st.enabled;
    toggle.addEventListener("change", async () => {
      await TRACK.setEnabled(toggle.checked);
      renderDebug();
    });
    if (!st.noticeSeen) {
      document.getElementById("telemetry-notice-text").textContent = T("telemetryNotice");
      const link = document.getElementById("telemetry-notice-link");
      link.textContent = T("telemetryNoticeLink");
      link.href = `${BRAND.landingUrl}/privacidad.html`;
      document.getElementById("telemetry-notice").hidden = false;
      TRACK.noticeSeen();
    }
  } else {
    row.hidden = true;
    hint.hidden = true;
  }
  async function renderDebug() {
    if (!debug) return;
    const d = await TRACK.state(true);
    if (!d) return;
    const last = d.last
      ? `${d.last.status || "0"} ${d.last.error ?? "ok"} @ ${new Date(d.last.at).toLocaleTimeString("en-US")}`
      : "none";
    const mode = !d.configured ? "dormant" : d.enabled ? "on" : "off";
    const counts = Object.entries(d.counts ?? {})
      .filter(([k]) => !k.includes(":"))
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ");
    document.getElementById("telemetry-debug").textContent =
      `${T("optTelemetryDebug")}: ${mode} · host ${d.host ?? "-"}${d.qa ? " (QA override)" : ""}` +
      ` · queue ${d.queue} · last send ${last} · id ${d.iid ? d.iid.slice(0, 8) : "-"}` +
      (counts ? ` · ${counts}` : "");
  }
  renderDebug();
}
loadTelemetry().catch(() => {});

// Reset removes ONLY Netio's own data. Never storage.clear(): ExtPay keeps
// the seller's payment key in storage.sync (clearing it drops a paying user
// to free until they log in again), and mst:installedAt must survive so a
// reset is not a free trial restart.
// Analytics keys (install id, opt-out choice, queue, once-ever flags) survive
// a reset too: wiping them would mint a new install id and replay every
// "first time" event.
const KEEP_LOCAL = new Set([
  `${BRAND.cssPrefix}:installedAt`,
  `${BRAND.cssPrefix}:metrics`,
  ...Object.values(globalThis.MST_TELEMETRY_CORE.KEYS)
]);
async function removeOwnKeys(area, extraKeys = []) {
  const all = await area.get(null);
  const mine = Object.keys(all).filter(
    (k) => (k.startsWith(`${BRAND.cssPrefix}:`) && !KEEP_LOCAL.has(k)) || extraKeys.includes(k)
  );
  if (mine.length) await area.remove(mine);
}
resetBtn.addEventListener("click", async () => {
  // Irreversible: costs, sales and price history live only in this browser.
  if (!window.confirm(T("optResetConfirm"))) return;
  globalThis.MST_TRACK.event("reset_clicked");
  await removeOwnKeys(chrome.storage.local);
  await removeOwnKeys(chrome.storage.sync, [
    ...Object.keys(DEFAULT_SETTINGS),
    "msiRates", "msiTerm", "reputationId", "freeShipping", "usesFull",
    "showWithholdings", "breakdownOpen"
  ]);
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  await load();
  resetStatus.textContent = T("optResetDone");
  resetStatus.hidden = false;
  setTimeout(() => {
    resetStatus.hidden = true;
  }, 3000);
});

load();
