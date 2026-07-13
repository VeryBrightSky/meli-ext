// Pro gating. Single isPro() consumed by every gated feature.
//
// Pure logic (computeProStatus / resolveStatus) is chrome-free and
// unit-tested in Node. Runtime policy:
//   - fresh ExtPay status (via the service worker) always wins and is cached
//   - ExtPay unreachable → fail OPEN for users whose cache says entitled
//     (paying users keep what they paid for), fail CLOSED for never-paid
//   - storage.local "<prefix>:proOverride" = true forces Pro (QA/e2e only;
//     client-side gating is advisory by nature)
"use strict";

globalThis.MST_GATE = (() => {
  const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;

  // user: ExtPay user object ({ paid, trialStartedAt, ... }) or null.
  function computeProStatus(user, nowMs) {
    if (!user) return { pro: false, paid: false, trialActive: false };
    const paid = Boolean(user.paid);
    let trialActive = false;
    if (user.trialStartedAt) {
      const startedAt = new Date(user.trialStartedAt).getTime();
      trialActive = Number.isFinite(startedAt) && nowMs - startedAt < TRIAL_MS;
    }
    return { pro: paid || trialActive, paid, trialActive };
  }

  function resolveStatus(fresh, cached) {
    if (fresh) return { ...fresh, source: "fresh" };
    if (cached && cached.pro) return { ...cached, source: "cache" };
    return { pro: false, paid: false, trialActive: false, source: "default" };
  }

  // An offline Pro cache is honored only within this window; past it a fresh
  // check is required, so a lapsed-then-permanently-offline user can't hold Pro
  // forever. A legacy cache with no timestamp is treated as usable — the write
  // that first stamps fetchedAt must never revoke an entitlement mid-session.
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  function isCacheUsable(cached, nowMs) {
    if (!cached) return false;
    if (typeof cached.fetchedAt !== "number") return true;
    return nowMs - cached.fetchedAt <= CACHE_TTL_MS;
  }

  // --- runtime (requires chrome.*) -------------------------------------------

  let current = { pro: false, paid: false, trialActive: false, source: "init" };

  async function refresh() {
    const PREFIX = globalThis.EXT_BRAND?.cssPrefix ?? "mst";
    const CACHE_KEY = `${PREFIX}:proStatus`;
    const OVERRIDE_KEY = `${PREFIX}:proOverride`;

    let fresh = null;
    try {
      const res = await chrome.runtime.sendMessage({ type: "getProStatus" });
      if (res?.ok) fresh = res.data;
    } catch {
      // service worker / ExtPay unreachable
    }
    let cached = null;
    let override = false;
    try {
      const stored = await chrome.storage.local.get([CACHE_KEY, OVERRIDE_KEY]);
      cached = stored[CACHE_KEY] ?? null;
      override = stored[OVERRIDE_KEY] === true;
    } catch {
      // storage unavailable — resolveStatus handles nulls
    }
    // Bound offline staleness: drop a cache older than the TTL so it can't
    // grant Pro indefinitely without ExtPay ever confirming again.
    if (!isCacheUsable(cached, Date.now())) cached = null;

    current = override
      ? { pro: true, paid: true, trialActive: false, source: "override" }
      : resolveStatus(fresh, cached);
    if (fresh) {
      chrome.storage.local.set({ [CACHE_KEY]: { ...fresh, fetchedAt: Date.now() } });
    }
    return current;
  }

  const isPro = () => current.pro;
  const status = () => current;
  const send = (type, payload) =>
    chrome.runtime.sendMessage({ type, payload }).catch(() => {});
  // plan: ExtPay plan nickname ("pro-monthly" / "pro-yearly"); omit for the
  // generic choose-plan page.
  const openUpgrade = (plan) => send("openPaymentPage", plan ? { plan } : undefined);
  const startTrial = () => send("openTrialPage");
  const openLogin = () => send("openLoginPage");
  const openDashboard = () => send("openDashboard");

  return Object.freeze({
    TRIAL_MS,
    computeProStatus,
    resolveStatus,
    isCacheUsable,
    refresh,
    isPro,
    status,
    openUpgrade,
    startTrial,
    openLogin,
    openDashboard
  });
})();
