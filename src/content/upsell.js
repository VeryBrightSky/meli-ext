// Pro upsell UI: teaser rows (real number, blurred), loss-moment alert strips,
// and ONE contextual panel per container whose headline is the number the
// seller just lost or almost had — never a generic feature list.
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

  // Reasons map to a headline + body pair in the locale files:
  //   upsell.<reason>.lead / upsell.<reason>.body (vars = $1, $2 …)
  // Fallback is the generic product-page pitch.
  const KNOWN = new Set(["generic", "target", "sweetspot", "breakeven", "loss", "msi", "radar", "dashboard", "whatif", "compare", "expired"]);
  const NEEDS_VARS = { target: 1, sweetspot: 1, loss: 2, msi: 2, radar: 1 };

  // One panel per container (card body / export bar parent).
  function buildPanel() {
    const panel = el("div", `${PREFIX}-upsell`);
    panel.hidden = true;
    const title = el("h3", `${PREFIX}-upsell__title`, T("upsellTitle"));
    const lead = el("p", `${PREFIX}-upsell__lead`, T("upsellHeadline"));
    const body = el("p", `${PREFIX}-upsell__body`, T("upsellBody"));
    const price = el("p", `${PREFIX}-upsell__price`, T("upsellPricing"));
    const actions = el("div", `${PREFIX}-upsell__actions`);
    const note = el("p", `${PREFIX}-upsell__note`, T("upsellNote"));
    // After a plan click the checkout opens in a new tab; say so here and
    // promise the live update (content.js rebuilds on the SW's proChanged).
    const opened = async (plan) => {
      const res = await GATE.openUpgrade(plan, "upsell");
      // Only claim the checkout opened when it did (offline → key creation fails).
      if (res?.ok) {
        note.textContent = T("upsellOpened");
        note.classList.add(`${PREFIX}-upsell__note--active`);
      } else {
        note.textContent = T("upsellOpenFailed");
        note.classList.remove(`${PREFIX}-upsell__note--active`);
      }
    };
    const monthlyBtn = el("button", `${PREFIX}-upsell__cta`, T("upsellMonthly"));
    monthlyBtn.type = "button";
    monthlyBtn.addEventListener("click", () => opened(BRAND.plans.monthly));
    const yearlyBtn = el("button", `${PREFIX}-upsell__alt`, T("upsellYearly"));
    yearlyBtn.type = "button";
    yearlyBtn.addEventListener("click", () => opened(BRAND.plans.yearly));
    actions.append(monthlyBtn, yearlyBtn);
    // Already paid (new browser, reinstalled, other device): sign in with the
    // email used at checkout instead of paying twice.
    const login = el("button", `${PREFIX}-upsell__close ${PREFIX}-upsell__login`, T("optLogin"));
    login.type = "button";
    login.addEventListener("click", async () => {
      const res = await GATE.openLogin("upsell");
      if (!res?.ok) {
        note.textContent = T("upsellOpenFailed");
        note.classList.remove(`${PREFIX}-upsell__note--active`);
      }
    });
    const close = el("button", `${PREFIX}-upsell__close`, T("upsellClose"));
    close.type = "button";
    close.addEventListener("click", () => {
      panel.hidden = true;
    });
    panel.append(title, lead, body, actions, note, login, close);
    return { panel, lead, body };
  }

  // Returns { panel, open(reason, vars), close } — caller appends panel.
  // The panel opens right after the row/strip/banner the seller clicked
  // (tracked in the capture phase), not at the bottom of a 1,000px card.
  const ANCHOR_SEL = [
    "row", "alert", "trialbar", "sweetspot", "dashlink", "radar", "export__main", "summary", "breakdown"
  ].map((c) => `.${PREFIX}-${c}`).join(",");

  function attach(container) {
    const { panel, lead, body } = buildPanel();
    container.appendChild(panel);
    let lastClick = null;
    container.addEventListener("click", (e) => {
      lastClick = e.target instanceof Element ? e.target : null;
    }, true);
    const placeNear = () => {
      let anchor = lastClick?.closest(ANCHOR_SEL);
      // Rows inside the collapsed breakdown anchor to the breakdown itself.
      const det = anchor?.closest(`.${PREFIX}-breakdown`);
      if (det) anchor = det;
      if (anchor && container.contains(anchor) && anchor !== panel && !panel.contains(anchor)) {
        anchor.after(panel);
      }
    };
    const setText = (reason, vars) => {
      let key = KNOWN.has(reason) ? reason : "generic";
      // A reason whose headline needs numbers falls back to the generic pitch
      // when the caller has none (e.g. no product cost entered yet).
      const need = NEEDS_VARS[key] ?? 0;
      const have = Array.isArray(vars) ? vars.filter((v) => v != null && v !== "").length : 0;
      if (have < need) key = "generic";
      lead.textContent = T(`upsellLead_${key}`, vars);
      body.textContent = T(`upsellBody_${key}`, vars);
      panel.dataset.reason = key;
      return key;
    };
    const open = (reason = "generic", vars = []) => {
      placeNear();
      const key = setText(reason, vars);
      panel.hidden = false;
      GATE.track(`open:${key}`);
      globalThis.MST_TRACK.event("paywall_seen", { reason: "upsell", key });
      try {
        panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch {
        // scrollIntoView options unsupported — no-op
      }
    };
    const close = () => {
      panel.hidden = true;
    };
    // Re-render an open panel's numbers after the seller edits an input, so
    // the headline never quotes a price or loss that is no longer true.
    const refresh = (reason, vars) => {
      if (!panel.hidden) setText(reason, vars);
    };
    return { panel, open, close, refresh, toggle: () => (panel.hidden ? open() : close()) };
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

  // Teaser row: label + the REAL computed value rendered blurred + PRO chip.
  // The seller sees that a specific number exists for this listing; the
  // blur, not a lock icon, is what they want removed. Returns { root, value,
  // set(text) } so update() can keep it live without rebuilding.
  function teaserRow(labelText, onOpen, modifier) {
    const root = el("div", `${PREFIX}-row ${PREFIX}-row--locked ${PREFIX}-row--teaser${modifier ? ` ${PREFIX}-row--${modifier}` : ""}`);
    const label = el("span", `${PREFIX}-row__label`, labelText);
    const value = el("span", `${PREFIX}-row__value ${PREFIX}-blur`, "");
    value.setAttribute("aria-hidden", "true");
    root.append(label, value, chip(onOpen));
    root.addEventListener("click", onOpen);
    return {
      root,
      value,
      set(text) {
        if (value.textContent !== text) value.textContent = text;
      }
    };
  }

  // Alert strip for the red-number moment: one sentence with the real loss
  // and a button. Hidden until the caller shows it.
  function alertStrip(onOpen) {
    const root = el("div", `${PREFIX}-alert`);
    root.hidden = true;
    const text = el("span", `${PREFIX}-alert__text`, "");
    const btn = el("button", `${PREFIX}-alert__btn`, T("alertCta"));
    btn.type = "button";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onOpen();
    });
    root.append(text, btn);
    return {
      root,
      show(message, tone) {
        text.textContent = message;
        root.dataset.tone = tone || "loss";
        root.hidden = false;
      },
      hide() {
        root.hidden = true;
      }
    };
  }

  // Trial banner (top of card): countdown while active, win-back after expiry.
  // Dismissal is remembered per state for a day so it never nags.
  const DISMISS_KEY = `${PREFIX}:bannerDismissed`;
  function trialBanner(status, onOpen) {
    const root = el("div", `${PREFIX}-trialbar`);
    root.hidden = true;
    const text = el("span", `${PREFIX}-trialbar__text`, "");
    const btn = el("button", `${PREFIX}-trialbar__btn`, "");
    btn.type = "button";
    const close = el("button", `${PREFIX}-trialbar__close`, "×");
    close.type = "button";
    close.setAttribute("aria-label", T("upsellClose"));
    root.append(text, btn, close);

    // Offline checkout: say so in the banner instead of a dead button.
    const failNote = (res) => {
      if (!res?.ok) text.textContent = T("upsellOpenFailed");
    };

    let stateKey = null;
    if (status.trialActive && status.localTrial) {
      stateKey = status.trialDaysLeft <= 3 ? "ending" : "active";
      root.dataset.tone = status.trialDaysLeft <= 3 ? "ending" : "active";
      const n = status.trialDaysLeft;
      text.textContent =
        n <= 3
          ? (n === 1 ? T("trialEndingOne") : T("trialEnding", [String(n)]))
          : T("trialActiveBanner", [String(n)]);
      // In the last days, make the loss concrete: the seller's own products.
      if (n <= 3) {
        chrome.storage.local.get(null).then((all) => {
          const saved = Object.keys(all).filter((k) => k.startsWith(`${PREFIX}:cost:`) && Number(all[k]) > 0).length;
          if (saved > 0) {
            text.textContent = n === 1
              ? T("trialEndingProductsOne", [String(saved)])
              : T("trialEndingProducts", [String(n), String(saved)]);
          }
        }).catch(() => {});
      }
      btn.textContent = T("trialKeep");
      btn.addEventListener("click", () => GATE.openUpgrade(BRAND.plans.monthly, "trial-banner").then(failNote));
    } else if (status.trialExpired && (status.trialDaysSinceEnd ?? 0) <= 14) {
      stateKey = "expired";
      root.dataset.tone = "expired";
      text.textContent = T("trialExpiredBanner");
      btn.textContent = T("trialReactivate");
      // Straight to the plan picker; no detour through a panel at the bottom.
      btn.addEventListener("click", () => GATE.openUpgrade(undefined, "expired-banner").then(failNote));
    }
    if (!stateKey) return root;

    chrome.storage.local.get(DISMISS_KEY).then((stored) => {
      const d = stored?.[DISMISS_KEY] ?? {};
      const until = d[stateKey] ?? 0;
      if (Date.now() < until) return;
      root.hidden = false;
      if (stateKey === "expired") {
        GATE.track("seen:expired");
        globalThis.MST_TRACK.once("paywall_seen", { reason: "expired-banner", key: "expired" });
      }
    }).catch(() => {});
    close.addEventListener("click", () => {
      root.hidden = true;
      try {
        chrome.storage.local.get(DISMISS_KEY).then((stored) => {
          const d = { ...(stored?.[DISMISS_KEY] ?? {}) };
          d[stateKey] = Date.now() + 24 * 60 * 60 * 1000;
          return chrome.storage.local.set({ [DISMISS_KEY]: d });
        }).catch(() => {});
      } catch {
        // extension context gone: the dismissal just isn't remembered
      }
    });
    return root;
  }

  return Object.freeze({ attach, chip, lockedRow, teaserRow, alertStrip, trialBanner });
})();
