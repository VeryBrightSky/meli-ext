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
document.title = `${BRAND.name} — ${T("optionsTitle")}`;
document.getElementById("brand-name").textContent = BRAND.name;
document.getElementById("brand-logo").src = chrome.runtime.getURL(BRAND.logoPath);
document.getElementById("lbl-card").textContent = T("optShowCard");
document.getElementById("lbl-strips").textContent = T("optShowStrips");
document.getElementById("lbl-shipping").textContent = T("optDefaultShipping");
document.getElementById("lbl-type").textContent = T("optDefaultType");
document.getElementById("opt-auto").textContent = T("optTypeAuto");
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
document.getElementById("manage-btn").addEventListener("click", () => send("openPaymentPage"));
document.getElementById("login-btn").addEventListener("click", () => send("openLoginPage"));
document.getElementById("dashboard-btn").addEventListener("click", () => send("openDashboard"));

async function loadSubscriptionStatus() {
  const statusEl = document.getElementById("sub-status");
  // Merged status (ExtPay + local reverse trial) — the same one the card uses.
  const s = await globalThis.MST_GATE.refresh();
  statusEl.textContent = s.paid
    ? T("statusPro")
    : s.trialActive
      ? (s.localTrial ? T("statusTrialDays", [String(s.trialDaysLeft)]) : T("statusTrial"))
      : s.trialExpired
        ? T("statusTrialExpired")
        : T("statusFree");

  // Local-only funnel counters for the developer (no network, nothing sent).
  const metricsEl = document.getElementById("metrics");
  if (metricsEl) {
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

resetBtn.addEventListener("click", async () => {
  await chrome.storage.local.clear();
  await chrome.storage.sync.clear();
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  await load();
  resetStatus.textContent = T("optResetDone");
  resetStatus.hidden = false;
  setTimeout(() => {
    resetStatus.hidden = true;
  }, 3000);
});

load();
