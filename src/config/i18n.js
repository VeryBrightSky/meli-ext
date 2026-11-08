// Self-hosted i18n. The injected UI localizes from the bundled MST_MESSAGES
// (generated into locale-data.js from _locales/) instead of chrome.i18n, whose
// message resolution depends on the browser/OS locale config in ways that
// proved unreliable (Spanish Chrome still served English). Deterministic,
// Spanish by default (the product is MX-only), English only when the seller
// picks it in the options, and unit-testable.
//
// locale-data.js MUST load before this script.
"use strict";

globalThis.MST_I18N = (() => {
  // Spanish only by default: the product is for Mercado Libre Mexico sellers,
  // and a Mexican seller on an English Chrome must still see Spanish. The
  // seller switches to English with the options toggle ("Idioma"), stored in
  // chrome.storage.sync under LANG_KEY and applied by init() before any UI
  // renders. The browser locale is never consulted.
  const LANG_KEY = "mst:lang";
  const SUPPORTED = ["es_419", "en"];
  function pickLocale(stored) {
    return stored === "en" ? "en" : "es_419";
  }

  // chrome.i18n placeholder semantics: "$1".."$9" are substitutions, "$$" is a
  // literal "$". Single pass so the two never interfere.
  function applySubs(message, subs) {
    return message.replace(/\$\$|\$([1-9])/g, (m, d) => {
      if (m === "$$") return "$";
      const v = subs && subs[Number(d) - 1];
      return v == null ? "" : String(v);
    });
  }

  const messages = globalThis.MST_MESSAGES || {};
  const api = { t, pickLocale, applySubs, init, setLocale, LANG_KEY, SUPPORTED, locale: "es_419" };
  let dict = messages.es_419 || {};

  function setLocale(l) {
    const next = pickLocale(l);
    api.locale = next;
    dict = messages[next] || messages.es_419 || {};
    return next;
  }

  // Read the stored choice once per context. Resolves to the active locale;
  // Spanish when storage is unavailable or nothing was chosen.
  async function init() {
    try {
      const stored = await chrome.storage.sync.get(LANG_KEY);
      return setLocale(stored?.[LANG_KEY]);
    } catch {
      return setLocale(null);
    }
  }

  function t(key, subs) {
    const message = dict[key];
    if (message != null) return applySubs(message, subs);
    // Last-resort fallback: the key itself (visible, never blank) so a
    // missing key is obvious rather than silently English.
    return key;
  }

  return Object.seal(api);
})();
