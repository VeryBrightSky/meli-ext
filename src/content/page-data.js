// Best-effort extraction of listing data from the PDP DOM (the page the user
// is actively viewing — no crawling). Every getter degrades to null and the
// caller decides the fallback UX.
"use strict";

globalThis.MST_PAGE = (() => {
  const TAG = `[${globalThis.EXT_BRAND.name}]`;

  function extractItemId() {
    const { pathname, search } = window.location;
    const catalog = pathname.match(/\/p\/(MLM\d+)/);
    if (catalog) return catalog[1];
    // Unified product pages: /up/MLMU123…
    const up = pathname.match(/\/up\/(MLMU\d+)/);
    if (up) return up[1];
    const item = pathname.match(/MLM-?(\d+)/);
    if (item) return `MLM${item[1]}`;
    const q = new URLSearchParams(search).get("pdp_filters")?.match(/item_id[:%3A]+(MLM\d+)/i);
    if (q) return q[1];
    return null;
  }

  // Parse one Andes money component (fraction + optional cents spans).
  function parseMoneyAmount(money) {
    const fraction = money.querySelector(".andes-money-amount__fraction");
    if (!fraction) return null;
    const whole = Number.parseInt(fraction.textContent.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(whole) || whole <= 0) return null;
    const centsEl = money.querySelector(".andes-money-amount__cents");
    const cents = centsEl
      ? Number.parseInt(centsEl.textContent.replace(/[^\d]/g, ""), 10) || 0
      : 0;
    return whole + cents / 100;
  }

  // The price the buyer would actually pay, read from the DOM near the anchor.
  // Crossed-out "precio anterior" amounts (promos) are skipped — taking the
  // first .andes-money-amount blindly would grab the OLD price on discounted
  // listings.
  function extractDomPrice(anchorEl) {
    const scope = anchorEl ?? document;
    for (const money of scope.querySelectorAll(".andes-money-amount")) {
      if (/previous/.test(money.className) || money.closest("s, del")) continue;
      const value = parseMoneyAmount(money);
      if (value !== null) return value;
    }
    return null;
  }

  // Strategy 1: structured data (meta[itemprop=price] — exact, has cents).
  // Strategy 2: visible Andes money component near the anchor.
  // When BOTH exist but disagree, the DOM wins: the meta can be stale after
  // client-side navigation or variant changes, while the rendered price is
  // what the buyer actually sees. (Sub-peso drift is meta rounding — keep meta.)
  // The page's declared currency, or null when it does not say. Fees here are
  // MXN tables: a USD (or any non-MXN) listing must not be fed through them.
  function explicitCurrency() {
    const raw = document.querySelector('meta[itemprop="priceCurrency"]')?.content;
    const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    return code || null;
  }

  function extractPrice(anchorEl) {
    const currency = explicitCurrency();
    if (currency !== null && currency !== "MXN") return null;
    let metaValue = null;
    const meta = document.querySelector('meta[itemprop="price"]');
    if (meta?.content) {
      const value = Number.parseFloat(meta.content);
      if (Number.isFinite(value) && value > 0) metaValue = value;
    }

    const domValue = extractDomPrice(anchorEl);

    if (metaValue !== null && domValue !== null) {
      return Math.abs(metaValue - domValue) < 1
        ? { value: metaValue, via: "itemprop-meta" }
        : { value: domValue, via: "andes-money-amount (meta stale/mismatched)" };
    }
    if (metaValue !== null) return { value: metaValue, via: "itemprop-meta" };
    if (domValue !== null) return { value: domValue, via: "andes-money-amount" };
    return null;
  }

  function extractBreadcrumbs() {
    const links = document.querySelectorAll(
      ".andes-breadcrumb a, .andes-breadcrumb__link, nav[aria-label] ol a"
    );
    return [...links].map((a) => a.textContent.trim()).filter(Boolean);
  }

  // Category from the page's embedded structured data. Machine translation
  // rewrites visible DOM text but not <script> contents, so these names are
  // language-stable — primary signal, visible breadcrumb is the fallback.
  function extractStructuredCategory() {
    const names = [];
    let categoryId = null;

    // 1. JSON-LD Product blocks: "category" is a string or a "A > B > C" path.
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch {
        continue;
      }
      for (const node of Array.isArray(data) ? data : [data]) {
        if (node && typeof node.category === "string") {
          names.push(
            ...node.category.split(/[>/]/).map((s) => s.trim()).filter(Boolean)
          );
        }
      }
    }

    // 2. Preloaded page state: category_id ("MLM...") and the
    //    path_from_root name chain, scraped with targeted regexes instead of
    //    parsing megabytes of state JSON.
    for (const script of document.querySelectorAll("script:not([src])")) {
      const text = script.textContent;
      if (!text || text.length < 200) continue;
      if (!categoryId) {
        const m = text.match(/"category_id"\s*:\s*"(MLM\d+)"/);
        if (m) categoryId = m[1];
      }
      if (names.length === 0 && text.includes("path_from_root")) {
        const seg = text.match(/"path_from_root"\s*:\s*\[(.{0,2000}?)\]/s);
        if (seg) {
          for (const nm of seg[1].matchAll(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
            try {
              names.push(JSON.parse(`"${nm[1]}"`));
            } catch {
              names.push(nm[1]);
            }
          }
        }
      }
      if (categoryId && names.length > 0) break;
    }

    return { categoryId, names };
  }

  // Premium listings can offer meses sin intereses; Clásica cannot (official
  // help page). MSI on the page is therefore a strong Premium signal — its
  // absence is weaker, so callers treat this as a default, not a fact.
  // MSI wording seen on MX listings: "12 meses sin intereses",
  // "Mismo precio en 12 meses de $X", "Mismo precio 6 cuotas de…", "MSI".
  const MSI_RE = /meses sin intereses|mismo precio(?: en)? \d+ (?:meses|cuotas)|\bmsi\b/i;

  function guessListingType(anchorEl) {
    // Scope the signal to the price/payment area of the VISIBLE price (the
    // anchor): MELI prints "meses sin intereses" in site-wide banners and a
    // hidden sticky-header price block, so a body-wide or first-match scan
    // would call almost every listing Premium.
    const scope =
      anchorEl?.closest(".ui-pdp-container__row, .ui-pdp-price, .ui-pdp-payment") ??
      anchorEl ??
      document.querySelector(".ui-pdp-price, .ui-pdp-payment, #payment_methods");
    let text = (scope ?? document.body).innerText || "";
    // The installment line often sits in the next sibling block.
    const next = scope?.nextElementSibling;
    if (next) text += " " + (next.innerText || "");
    if (MSI_RE.test(text)) return "premium";
    return "classic";
  }

  function collect(anchorEl, { quiet = false } = {}) {
    const data = {
      itemId: extractItemId(),
      price: extractPrice(anchorEl),
      breadcrumbs: extractBreadcrumbs(),
      structuredCategory: extractStructuredCategory(),
      listingTypeGuess: guessListingType(anchorEl)
    };
    if (quiet) return data;
    console.log(TAG, "page data:", {
      itemId: data.itemId,
      price: data.price,
      breadcrumbs: data.breadcrumbs,
      structuredCategory: data.structuredCategory,
      listingTypeGuess: data.listingTypeGuess
    });
    return data;
  }

  return Object.freeze({ collect });
})();
