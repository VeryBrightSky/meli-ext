// Best-effort extraction of listing data from the PDP DOM (the page the user
// is actively viewing — no crawling). Every getter degrades to null and the
// caller decides the fallback UX.
"use strict";

globalThis.MST_PAGE = (() => {
  const TAG = `[${globalThis.EXT_BRAND.name}]`;

  function extractItemId() {
    const { pathname } = window.location;
    const catalog = pathname.match(/\/p\/(MLM\d+)/);
    if (catalog) return catalog[1];
    const item = pathname.match(/MLM-?(\d+)/);
    if (item) return `MLM${item[1]}`;
    return null;
  }

  // Strategy 1: structured data. Strategy 2: visible Andes money component
  // near the given anchor (fraction + optional cents spans).
  function extractPrice(anchorEl) {
    const meta = document.querySelector('meta[itemprop="price"]');
    if (meta?.content) {
      const value = Number.parseFloat(meta.content);
      if (Number.isFinite(value) && value > 0) {
        return { value, via: "itemprop-meta" };
      }
    }

    const scope = anchorEl ?? document;
    const money = scope.querySelector(".andes-money-amount");
    if (money) {
      const fraction = money.querySelector(".andes-money-amount__fraction");
      if (fraction) {
        const whole = Number.parseInt(fraction.textContent.replace(/[^\d]/g, ""), 10);
        const centsEl = money.querySelector(".andes-money-amount__cents");
        const cents = centsEl ? Number.parseInt(centsEl.textContent.replace(/[^\d]/g, ""), 10) || 0 : 0;
        if (Number.isFinite(whole) && whole > 0) {
          return { value: whole + cents / 100, via: "andes-money-amount" };
        }
      }
    }
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
  function guessListingType() {
    const text = document.body.innerText;
    if (/meses sin intereses/i.test(text)) return "premium";
    return "classic";
  }

  function collect(anchorEl) {
    const data = {
      itemId: extractItemId(),
      price: extractPrice(anchorEl),
      breadcrumbs: extractBreadcrumbs(),
      structuredCategory: extractStructuredCategory(),
      listingTypeGuess: guessListingType()
    };
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
