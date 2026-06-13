// MV3 service worker. Network activity is limited to ExtensionPay payment
// verification (extensionpay.com) — fee/shipping data stays bundled.
"use strict";

importScripts("../config/branding.js", "../pro/gate.js", "../vendor/extpay.js");

const extpay = ExtPay(globalThis.EXT_BRAND.extpayId);
try {
  extpay.startBackground();
} catch (err) {
  // Placeholder/unregistered id: Pro verification fails closed; free features
  // are unaffected.
  console.warn("[Netio] ExtPay startBackground failed:", err);
}

const DASHBOARD_URL = "src/dashboard/dashboard.html";

const handlers = {
  ping: async () => ({ pong: true, version: chrome.runtime.getManifest().version }),

  getProStatus: async () => {
    const user = await extpay.getUser(); // throws offline → caller uses cache
    return globalThis.MST_GATE.computeProStatus(user, Date.now());
  },

  // payload.plan: ExtPay v3.1 plan nickname → plan-specific checkout page.
  openPaymentPage: async (payload) => extpay.openPaymentPage(payload?.plan),
  // Trial starts when the user opts in here — never on install.
  openTrialPage: async () => extpay.openTrialPage("7 días"),
  openLoginPage: async () => extpay.openLoginPage(),

  openDashboard: async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD_URL) });
    return { opened: true };
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

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD_URL) });
});
