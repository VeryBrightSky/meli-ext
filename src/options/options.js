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
  defaultShippingMXN: 0,
  defaultListingType: "auto"
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
  defaultShipping.value = s.defaultShippingMXN > 0 ? s.defaultShippingMXN.toFixed(2) : "";
  defaultType.value = s.defaultListingType;
}

cardEnabled.addEventListener("change", () =>
  chrome.storage.sync.set({ cardEnabled: cardEnabled.checked })
);
stripsEnabled.addEventListener("change", () =>
  chrome.storage.sync.set({ stripsEnabled: stripsEnabled.checked })
);
defaultShipping.addEventListener("change", () => {
  const v = parseMoney(defaultShipping.value);
  defaultShipping.value = v > 0 ? v.toFixed(2) : "";
  chrome.storage.sync.set({ defaultShippingMXN: v });
});
defaultType.addEventListener("change", () =>
  chrome.storage.sync.set({ defaultListingType: defaultType.value })
);

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
