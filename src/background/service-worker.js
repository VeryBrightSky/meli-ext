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
const PREFIX = globalThis.EXT_BRAND.cssPrefix;
const INSTALLED_KEY = `${PREFIX}:installedAt`;

// Reverse trial: stamp first-run time on install, and on update for users
// who predate it (they get the same 7 PRO days — a reason to look again).
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const stored = await chrome.storage.local.get(INSTALLED_KEY);
    if (typeof stored[INSTALLED_KEY] !== "number") {
      await chrome.storage.local.set({ [INSTALLED_KEY]: Date.now() });
    }
  } catch (err) {
    console.warn("[Netio] could not stamp installedAt:", err);
  }
  refreshBadge();
});
chrome.runtime.onStartup.addListener(() => refreshBadge());

// Toolbar badge: "PRO" while entitled, "2d" when the trial is about to end,
// nothing otherwise. No extra permission needed.
async function refreshBadge() {
  try {
    const stored = await chrome.storage.local.get(INSTALLED_KEY);
    let base = { pro: false, paid: false, trialActive: false, trialExpired: false, trialDaysLeft: 0 };
    try {
      base = globalThis.MST_GATE.computeProStatus(await extpay.getUser(), Date.now());
    } catch {
      // offline: local window still decides
    }
    const s = globalThis.MST_GATE.mergeStatus(
      base,
      globalThis.MST_GATE.computeLocalTrial(stored[INSTALLED_KEY], Date.now())
    );
    let text = "";
    if (s.paid) text = "PRO";
    else if (s.trialActive) text = s.trialDaysLeft <= 3 ? `${s.trialDaysLeft}d` : "PRO";
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: s.trialActive && s.trialDaysLeft <= 3 ? "#E0382B" : "#00A650" });
  } catch {
    // badge is cosmetic
  }
}

const handlers = {
  ping: async () => ({ pong: true, version: chrome.runtime.getManifest().version }),

  getProStatus: async () => {
    const user = await extpay.getUser(); // throws offline → caller uses cache
    const s = globalThis.MST_GATE.computeProStatus(user, Date.now());
    refreshBadge();
    return s;
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

try {
  extpay.onPaid.addListener(() => refreshBadge());
} catch {
  // onPaid unavailable with a placeholder id
}
refreshBadge();

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD_URL) });
});
