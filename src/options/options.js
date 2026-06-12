// Options page. Phase 0: branding + the single "enabled" toggle, persisted in
// chrome.storage.sync. Phase 3 adds the full settings + i18n scaffold.
"use strict";

const BRAND = globalThis.EXT_BRAND;

document.title = `${BRAND.name} — Opciones`;
document.getElementById("brand-name").textContent = BRAND.name;
document.getElementById("brand-logo").src = chrome.runtime.getURL(BRAND.logoPath);

const enabledInput = document.getElementById("enabled");

chrome.storage.sync.get({ enabled: true }).then(({ enabled }) => {
  enabledInput.checked = enabled;
});

enabledInput.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: enabledInput.checked });
});
