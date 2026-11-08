// Local price history: a snapshot per visit (storage.local, capped). No
// background fetching of any kind — data exists only for pages the user
// actually opened. Display is Pro; recording is always on so history is
// already there when a user upgrades.
"use strict";

globalThis.MST_HISTORY = (() => {
  const PREFIX = globalThis.EXT_BRAND.cssPrefix;
  const MAX_POINTS = 30;
  // Skip a new point when price is unchanged within this window.
  const DEDUPE_MS = 12 * 60 * 60 * 1000;

  const key = (itemId) => `${PREFIX}:hist:${itemId}`;

  // Only listing pages are recorded: the same URL shapes content.js treats as
  // a product (catalog /p/MLM…, unified /up/MLMU…, item /MLM-…, the articulo
  // host). Cart, checkout and payment pages carry a price too, but a price
  // seen there is not a listing visit and is never written down.
  const EXCLUDED_PATH = /\/(checkout|gz\/checkout|gz\/cart|cart|carrito|pago|pagos|compra|comprar)(\/|$)/i;
  const PRODUCT_PATH = /\/p\/MLM\d+|\/up\/MLMU\d+|^\/MLM-\d+/;
  function isRecordableUrl(href) {
    let u;
    try {
      u = new URL(String(href));
    } catch {
      return false;
    }
    const host = u.hostname.toLowerCase();
    if (!(host === "mercadolibre.com.mx" || host.endsWith(".mercadolibre.com.mx"))) return false;
    if (EXCLUDED_PATH.test(u.pathname)) return false;
    if (host === "articulo.mercadolibre.com.mx") return true;
    return PRODUCT_PATH.test(u.pathname);
  }

  // Bound the number of items kept: one key per visited listing, forever,
  // would grow storage.local without limit. Oldest-visited histories are
  // pruned once the index passes MAX_ITEMS.
  const MAX_ITEMS = 300;
  const INDEX_KEY = `${PREFIX}:hist-index`;

  async function record(itemId, priceMXN, href = globalThis.location?.href) {
    if (!itemId || !(priceMXN > 0)) return;
    if (!isRecordableUrl(href)) return;
    const k = key(itemId);
    const stored = await chrome.storage.local.get([k, INDEX_KEY]);
    const points = Array.isArray(stored[k]) ? stored[k] : [];
    const last = points[points.length - 1];
    const now = Date.now();
    const index = stored[INDEX_KEY] && typeof stored[INDEX_KEY] === "object" ? stored[INDEX_KEY] : {};
    index[itemId] = now;
    const updates = { [INDEX_KEY]: index };
    const ids = Object.keys(index);
    const toRemove = [];
    if (ids.length > MAX_ITEMS) {
      ids.sort((a, b2) => index[a] - index[b2]);
      for (const old of ids.slice(0, ids.length - MAX_ITEMS)) {
        delete index[old];
        toRemove.push(key(old));
      }
    }
    if (!(last && last.p === priceMXN && now - last.t < DEDUPE_MS)) {
      points.push({ p: priceMXN, t: now });
      updates[k] = points.slice(-MAX_POINTS);
    }
    await chrome.storage.local.set(updates);
    if (toRemove.length) await chrome.storage.local.remove(toRemove);
  }

  async function get(itemId) {
    if (!itemId) return [];
    const k = key(itemId);
    const stored = await chrome.storage.local.get(k);
    return Array.isArray(stored[k]) ? stored[k] : [];
  }

  // Inline SVG sparkline; returns null with fewer than 2 points.
  function sparkline(points, width = 120, height = 24) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const prices = points.map((pt) => pt.p);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min || 1;
    const step = width / (points.length - 1);
    const coords = prices
      .map((p, i) => {
        const x = (i * step).toFixed(1);
        const y = (height - 2 - ((p - min) / span) * (height - 4)).toFixed(1);
        return `${x},${y}`;
      })
      .join(" ");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", coords);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#3483FA");
    line.setAttribute("stroke-width", "1.5");
    svg.appendChild(line);
    return svg;
  }

  return Object.freeze({ isRecordableUrl, record, get, sparkline, MAX_POINTS });
})();
