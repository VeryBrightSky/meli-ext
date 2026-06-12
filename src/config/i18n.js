// Tiny chrome.i18n wrapper. Source locale is es_419 (default_locale; Chrome
// has no es_MX — Latin American Spanish is the closest), en is the fallback
// translation. Returns the key itself when the runtime is
// unavailable (Node tests) so missing strings are visible, never blank.
"use strict";

globalThis.MST_I18N = (() => {
  const available =
    typeof chrome !== "undefined" && Boolean(chrome.i18n?.getMessage);

  function t(key, substitutions) {
    if (available) {
      const msg = chrome.i18n.getMessage(key, substitutions);
      if (msg) return msg;
    }
    return key;
  }

  return Object.freeze({ t });
})();
