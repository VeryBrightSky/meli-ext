// Shared UI helpers for injected surfaces (PDP card, search Quick View).
// Formatting is es-MX everywhere; charges (money leaving the seller) keep
// the minus sign on BOTH bounds of a range.
"use strict";

globalThis.MST_UI = (() => {
  // All amounts are MXN. Spanish UI formats es-MX ("$1,234.50" — locals read
  // that as pesos). English UI formats en-US, which renders MXN as "MX$1,234.50"
  // so a cross-border US seller can't mistake it for USD. Resolved lazily so it
  // tracks whichever locale i18n picked, regardless of script load order.
  const cache = {};
  const formatter = () => {
    const en = globalThis.MST_I18N && globalThis.MST_I18N.locale === "en";
    const locale = en ? "en-US" : "es-MX";
    return (cache[locale] ||= new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }));
  };

  const fmtMoney = (v) => formatter().format(v);

  function fmtRange(min, max) {
    const mxn = formatter();
    return min === max ? mxn.format(min) : `${mxn.format(min)} – ${mxn.format(max)}`;
  }

  // Negative amounts (commission, fixed cost): "−$2.88" / "−$2.88 – −$5.77".
  function fmtCharge(min, max = min) {
    const mxn = formatter();
    // A zero charge is not a charge: "$0.00", never "−$0.00".
    if (min === 0 && max === 0) return mxn.format(0);
    return min === max
      ? `−${mxn.format(min)}`
      : `−${mxn.format(min)} – −${mxn.format(max)}`;
  }

  function fmtPctRange(min, max) {
    return min === max ? `${min}%` : `${min}%–${max}%`;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  // Margin health bucket for the card's status dot: <10% red, 10–25% yellow,
  // >25% green. Negative margins are red.
  function marginHealth(pct) {
    if (!(pct >= 10)) return "red";
    if (pct < 25) return "yellow";
    return "green";
  }

  // --- CSV cells ---------------------------------------------------------------
  // TEXT cells (titles, labels) are seller/page controlled: a leading = + - @
  // would run as a formula in Excel/Sheets, so they get a leading apostrophe.
  // NUMERIC cells must never get that guard: "-12.50" is a number, and
  // prefixing it turns every loss into text that no spreadsheet can sum.
  function csvText(value) {
    let s = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  }

  // A number with fixed decimals, marked so csvCell leaves it unguarded.
  const csvFixed = (n, digits = 2) => ({ csvNum: Number.isFinite(n) ? n.toFixed(digits) : "" });

  function csvCell(value) {
    if (value && typeof value === "object" && "csvNum" in value) return value.csvNum;
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    return csvText(value);
  }

  const csvLine = (cells) => cells.map(csvCell).join(",");

  return Object.freeze({
    csvText,
    csvFixed,
    csvCell,
    csvLine,
    fmtMoney,
    fmtRange,
    fmtCharge,
    fmtPctRange,
    marginHealth,
    isVisible
  });
})();
