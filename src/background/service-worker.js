// MV3 service worker. v1.0.0 makes NO network requests — fee data is the
// bundled table (src/fees/fee-table.js).
//
// V2 (authed listing_prices lookups): re-add the
// "https://api.mercadolibre.com/*" host permission and a fetch handler here;
// content scripts can't call the API cross-origin, so it must be proxied
// through this worker. The UI already talks to the swappable fee-source
// interface, so nothing else changes.
"use strict";

const handlers = {
  ping: async () => ({ pong: true, version: chrome.runtime.getManifest().version })
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
