// Shared UI helpers for injected surfaces (PDP card, search Quick View).
// Formatting is es-MX everywhere; charges (money leaving the seller) keep
// the minus sign on BOTH bounds of a range.
"use strict";

globalThis.MST_UI = (() => {
  const mxn = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const fmtMoney = (v) => mxn.format(v);

  function fmtRange(min, max) {
    return min === max ? mxn.format(min) : `${mxn.format(min)} – ${mxn.format(max)}`;
  }

  // Negative amounts (commission, fixed cost): "−$2.88" / "−$2.88 – −$5.77".
  function fmtCharge(min, max = min) {
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

  return Object.freeze({ fmtMoney, fmtRange, fmtCharge, fmtPctRange, isVisible });
})();
