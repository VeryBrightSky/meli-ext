// Self-hosted i18n. The injected UI localizes from the bundled MST_MESSAGES
// (generated into locale-data.js from _locales/) instead of chrome.i18n —
// chrome.i18n's message resolution depends on the browser/OS locale config in
// ways that proved unreliable (Spanish Chrome still served English). This is
// deterministic, synchronous, Spanish-first (the product is MX-only), and
// unit-testable.
//
// locale-data.js MUST load before this script.
"use strict";

globalThis.MST_I18N = (() => {
  // Spanish-first: only switch to English when the UI language is clearly
  // English; anything else (incl. unknown) stays es_419.
  function pickLocale() {
    let ui = "";
    try {
      ui = (chrome.i18n.getUILanguage() || "").toLowerCase();
    } catch {
      ui = "";
    }
    return ui.startsWith("en") ? "en" : "es_419";
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
  const locale = pickLocale();
  const dict = messages[locale] || messages.es_419 || {};

  function t(key, subs) {
    const message = dict[key];
    if (message != null) return applySubs(message, subs);
    // Last-resort fallbacks: chrome.i18n, then the key itself (visible, never
    // blank) so a missing key is obvious rather than silently English.
    try {
      const m = chrome.i18n.getMessage(key, subs);
      if (m) return m;
    } catch {
      /* not in an extension context */
    }
    return key;
  }

  return Object.freeze({ t, locale, pickLocale, applySubs });
})();
