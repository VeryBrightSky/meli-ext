// Pro upsell UI: PRO chips on locked features and an inline upsell panel.
// Never opens on page load, never covers host content — it expands inside
// our own injected containers only.
"use strict";

globalThis.MST_UPSELL = (() => {
  const BRAND = globalThis.EXT_BRAND;
  const PREFIX = BRAND.cssPrefix;
  const GATE = globalThis.MST_GATE;
  const T = globalThis.MST_I18N.t;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // One panel per container (card body / export bar parent).
  function buildPanel() {
    const panel = el("div", `${PREFIX}-upsell`);
    panel.hidden = true;
    panel.appendChild(el("h3", `${PREFIX}-upsell__title`, T("upsellTitle")));
    panel.appendChild(el("p", `${PREFIX}-upsell__lead`, T("upsellHeadline")));
    panel.appendChild(el("p", `${PREFIX}-upsell__body`, T("upsellBody")));
    panel.appendChild(el("p", `${PREFIX}-upsell__price`, T("upsellPricing")));
    const actions = el("div", `${PREFIX}-upsell__actions`);
    const trialBtn = el("button", `${PREFIX}-upsell__cta`, T("upsellTrial"));
    trialBtn.type = "button";
    trialBtn.addEventListener("click", () => GATE.startTrial());
    const monthlyBtn = el("button", `${PREFIX}-upsell__alt`, T("upsellMonthly"));
    monthlyBtn.type = "button";
    monthlyBtn.addEventListener("click", () => GATE.openUpgrade(BRAND.plans.monthly));
    const yearlyBtn = el("button", `${PREFIX}-upsell__alt`, T("upsellYearly"));
    yearlyBtn.type = "button";
    yearlyBtn.addEventListener("click", () => GATE.openUpgrade(BRAND.plans.yearly));
    actions.append(trialBtn, monthlyBtn, yearlyBtn);
    panel.appendChild(actions);
    return panel;
  }

  // Returns { panel, toggle } — caller appends panel where it belongs.
  function attach(container) {
    const panel = buildPanel();
    container.appendChild(panel);
    const toggle = () => {
      panel.hidden = !panel.hidden;
    };
    return { panel, toggle };
  }

  function chip(onClick) {
    const tag = el("button", `${PREFIX}-prochip`, T("proTag"));
    tag.type = "button";
    tag.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return tag;
  }

  // A locked feature row: name + PRO chip; whole row opens the upsell.
  function lockedRow(labelText, onOpen) {
    const row = el("div", `${PREFIX}-row ${PREFIX}-row--locked`);
    row.appendChild(el("span", `${PREFIX}-row__label`, labelText));
    row.appendChild(chip(onOpen));
    row.addEventListener("click", onOpen);
    return row;
  }

  return Object.freeze({ attach, chip, lockedRow });
})();
