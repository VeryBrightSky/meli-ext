// MV3 service worker. Content scripts cannot fetch api.mercadolibre.com
// cross-origin, so all public API calls are proxied through here (Phase 1).
// Phase 0 wires up the message router with a ping handler so the channel is
// testable end to end.
"use strict";

const MELI_API_BASE = "https://api.mercadolibre.com";

const handlers = {
  ping: async () => ({ pong: true, version: chrome.runtime.getManifest().version }),

  // Phase 1: GET /sites/MLM/listing_prices?price=X — commission by listing type.
  fetchListingPrices: async ({ price }) => {
    const url = `${MELI_API_BASE}/sites/MLM/listing_prices?price=${encodeURIComponent(price)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`MELI API ${res.status} for ${url}`);
    }
    return res.json();
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) {
    sendResponse({ ok: false, error: `Unknown message type: ${message?.type}` });
    return false;
  }
  handler(message.payload ?? {})
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
  return true; // keep the channel open for the async response
});
