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

  // --- Listing signals read from page text -----------------------------------
  // Premium listings can offer meses sin intereses; Clásica cannot (official
  // help page). MSI wording seen on MX listings: "12 meses sin intereses",
  // "Mismo precio en 12 meses de $X", "Mismo precio 6 cuotas de…", and the
  // newer short form "12x $69 sin interés". The bare token "MSI" is NOT a
  // signal: it is also a laptop brand ("Laptop MSI Katana", seller "Por MSI")
  // and flagged Clásica listings as Premium (v1.5.1 audit).
  const MSI_RE =
    /meses sin inter[eé]s(?:es)?|mismo precio(?: en)? \d+ (?:meses|cuotas)|\b\d+\s*(?:x|cuotas(?: de)?)\s*\$?\s*[\d.,]+(?:\s+\d{2})?\s*sin inter[eé]s(?:es)?/i;
  const isMsiText = (text) => MSI_RE.test(String(text ?? ""));
  // "Envío gratis" and the newer "Llega gratis hoy/mañana".
  const FREE_SHIPPING_RE = /(?:env[ií]o|llega) gratis/i;
  const isFreeShippingText = (text) => FREE_SHIPPING_RE.test(String(text ?? ""));

  // Quick View flags for one result. `scoped` is the text of the card's
  // price/installment/shipping elements when the page has them (null when it
  // does not); `body` is the rest of the card with the title, the seller line
  // and our own strip removed. Only one of them is read, never the title.
  function resultFlags({ scoped = null, body = "" } = {}) {
    const text = typeof scoped === "string" ? scoped : String(body ?? "");
    return {
      freeShipping: isFreeShippingText(text),
      listingTypeGuess: isMsiText(text) ? "premium" : "classic"
    };
  }

  return Object.freeze({
    isMsiText,
    isFreeShippingText,
    resultFlags,
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
