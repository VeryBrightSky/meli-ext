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

// ExtPay is asked at most once per USER_TTL_MS; the cache is dropped the
// moment a payment lands (onPaid) so PRO shows up immediately.
const USER_TTL_MS = 5 * 60 * 1000;
let userCache = null; // { user, at }
async function getUserCached() {
  if (userCache && Date.now() - userCache.at < USER_TTL_MS) return userCache.user;
  const user = await extpay.getUser();
  userCache = { user, at: Date.now() };
  return user;
}
const PREFIX = globalThis.EXT_BRAND.cssPrefix;
const INSTALLED_KEY = `${PREFIX}:installedAt`;

// Reverse trial: stamp first-run time on install, and on update for users
// who predate it (they get the same 7 PRO days — a reason to look again).
const WELCOME_URL = "src/onboarding/welcome.html";
const REVERSE_TRIAL_SINCE = "1.4.0";

// "1.3.1" < "1.4.0" → true. Numeric, segment by segment.
function versionBefore(a, b) {
  const pa = String(a ?? "0").split(".").map((n) => Number(n) || 0);
  const pb = String(b).split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

const WELCOMED_KEY = `${PREFIX}:welcomed`;
const validStamp = (v) => Number.isFinite(v) && v > 0 && v <= Date.now();

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const [local, sync] = await Promise.all([
      chrome.storage.local.get(INSTALLED_KEY),
      chrome.storage.sync.get(INSTALLED_KEY).catch(() => ({}))
    ]);
    const a = validStamp(local[INSTALLED_KEY]) ? local[INSTALLED_KEY] : null;
    const b = validStamp(sync?.[INSTALLED_KEY]) ? sync[INSTALLED_KEY] : null;
    const stamp = a !== null && b !== null ? Math.min(a, b) : (a ?? b ?? Date.now());
    await chrome.storage.local.set({ [INSTALLED_KEY]: stamp });
    chrome.storage.sync.set({ [INSTALLED_KEY]: stamp }).catch(() => {});
  } catch (err) {
    console.warn("[Netio] could not stamp installedAt:", err);
  }
  refreshBadge();
  // Welcome tab: once on install, and once on the update that first grants
  // the reverse trial (pre-1.4 installs). A persisted flag (not "did we just
  // stamp") decides, so a content-script fallback stamp racing onInstalled
  // can't swallow it.
  try {
    const { [WELCOMED_KEY]: welcomed } = await chrome.storage.local.get(WELCOMED_KEY);
    const firstTrial =
      !welcomed &&
      (details?.reason === "install" ||
        (details?.reason === "update" && versionBefore(details.previousVersion, REVERSE_TRIAL_SINCE)));
    if (firstTrial) {
      await chrome.storage.local.set({ [WELCOMED_KEY]: true });
      chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_URL) }).catch(() => {});
    }
  } catch {
    // welcome is best-effort
  }
});
chrome.runtime.onStartup.addListener(() => refreshBadge());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[INSTALLED_KEY] || changes[`${PREFIX}:proStatus`])) refreshBadge();
  if (area === "sync" && changes.extensionpay_user) {
    userCache = null;
    refreshBadge();
  }
});

// Toolbar badge: "PRO" while entitled, "2d" when the trial is about to end,
// nothing otherwise. No extra permission needed. Pass the ExtPay user when
// the caller already fetched it so a page view costs ONE request, not two.
async function refreshBadge(user) {
  try {
    const stored = await chrome.storage.local.get(INSTALLED_KEY);
    let base = { pro: false, paid: false, trialActive: false, trialExpired: false, trialDaysLeft: 0 };
    try {
      const u = user === undefined ? await getUserCached() : user;
      base = globalThis.MST_GATE.computeProStatus(u, Date.now());
    } catch {
      // Offline / ExtPay down: a paid user must keep the PRO badge, so fall
      // back to the last confirmed status (same 30-day window the card uses).
      try {
        const c = (await chrome.storage.local.get(`${PREFIX}:proStatus`))[`${PREFIX}:proStatus`];
        if (globalThis.MST_GATE.isCacheUsable(c, Date.now()) && c?.paid) base = { ...base, pro: true, paid: true };
      } catch {
        // keep free
      }
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
    const user = await getUserCached(); // throws offline → caller uses cache
    const s = globalThis.MST_GATE.computeProStatus(user, Date.now());
    refreshBadge(user);
    // trialStartedAt rides along so an offline cache can re-evaluate the
    // ExtPay trial window instead of freezing "pro: true" for 30 days.
    return { ...s, trialStartedAt: user?.trialStartedAt ?? null };
  },

  // payload.plan: ExtPay v3.1 plan nickname → plan-specific checkout page.
  openPaymentPage: async (payload) => extpay.openPaymentPage(payload?.plan),
  // Trial starts when the user opts in here — never on install.
  openTrialPage: async () => extpay.openTrialPage("7 dias"),
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

// Tell every open Mercado Libre tab that the entitlement changed so the
// injected UI rebuilds as PRO without a reload. Fire-and-forget per tab.
async function broadcastProChanged() {
  try {
    // No "tabs" permission: query without a URL filter (allowed) and let the
    // message fail silently on tabs that don't run our content script.
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: "proChanged" }).catch(() => {});
    }
  } catch {
    // tabs API unavailable — the next navigation re-routes anyway
  }
}

try {
  extpay.onPaid.addListener(() => {
    userCache = null;
    refreshBadge();
    broadcastProChanged();
  });
} catch {
  // onPaid unavailable with a placeholder id
}

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD_URL) });
});
