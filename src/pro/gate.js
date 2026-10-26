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
  // Returns { pro, paid, trialActive, trialExpired, trialDaysLeft }:
  //   trialActive   — inside the 7-day window and not paid
  //   trialExpired  — a trial was started, the window passed, and never paid
  //                   (the one moment a win-back prompt is justified)
  //   trialDaysLeft — ceil(days) remaining while active, else 0
  function computeProStatus(user, nowMs) {
    if (!user) return { pro: false, paid: false, trialActive: false, trialExpired: false, trialDaysLeft: 0 };
    const paid = Boolean(user.paid);
    let trialActive = false;
    let trialExpired = false;
    let trialDaysLeft = 0;
    if (user.trialStartedAt) {
      const startedAt = new Date(user.trialStartedAt).getTime();
      if (Number.isFinite(startedAt)) {
        const elapsed = nowMs - startedAt;
        trialActive = elapsed < TRIAL_MS;
        trialExpired = !trialActive && !paid;
        if (trialActive) trialDaysLeft = Math.max(1, Math.ceil((TRIAL_MS - elapsed) / 86400000));
      }
    }
    return { pro: paid || trialActive, paid, trialActive, trialExpired, trialDaysLeft };
  }

  function resolveStatus(fresh, cached) {
    if (fresh) return { ...fresh, source: "fresh" };
    if (cached && cached.pro) return { ...cached, source: "cache" };
    return { pro: false, paid: false, trialActive: false, trialExpired: false, trialDaysLeft: 0, source: "default" };
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

  let current = { pro: false, paid: false, trialActive: false, trialExpired: false, trialDaysLeft: 0, source: "init" };

  // Local-only funnel counters (no network, no PII): how often the upsell is
  // seen vs. the trial/plan buttons clicked. Shown on the options page so the
  // developer can tell whether a gate change moved anything.
  const METRICS_KEY = "mst:metrics";
  function track(event) {
    try {
      chrome.storage.local.get(METRICS_KEY).then((stored) => {
        const m = { ...(stored?.[METRICS_KEY] ?? {}) };
        m[event] = (m[event] ?? 0) + 1;
        m.updatedAt = Date.now();
        chrome.storage.local.set({ [METRICS_KEY]: m });
      });
    } catch {
      // metrics are best-effort
    }
  }

  // --- Reverse trial ----------------------------------------------------------
  // Every install gets PRO for TRIAL_MS from first run, no email, no card
  // (stamped by the service worker on install/update; the content script
  // stamps it too as a fallback). When it ends the seller visibly loses the
  // target price, radar colors and dashboard they were using — loss aversion
  // is the whole mechanism, so nothing here is hidden or quiet.
  // Pure helper: installedAtMs → { active, expired, daysLeft }.
  function computeLocalTrial(installedAtMs, nowMs) {
    if (!Number.isFinite(installedAtMs) || installedAtMs <= 0) {
      return { active: false, expired: false, daysLeft: 0, daysSinceEnd: 0 };
    }
    const elapsed = nowMs - installedAtMs;
    const active = elapsed >= 0 && elapsed < TRIAL_MS;
    const daysLeft = active ? Math.max(1, Math.ceil((TRIAL_MS - elapsed) / 86400000)) : 0;
    const daysSinceEnd = active ? 0 : Math.floor((elapsed - TRIAL_MS) / 86400000);
    return { active, expired: !active && elapsed >= TRIAL_MS, daysLeft, daysSinceEnd };
  }

  // Merge ExtPay-derived status with the local reverse trial. Paid always
  // wins; an ExtPay trial (legacy opt-in) counts while active; otherwise the
  // local window decides. `trialExpired` is true only when a trial of either
  // kind has ended without a purchase.
  function mergeStatus(base, local) {
    if (base.paid) return { ...base, trialExpired: false, localTrial: false };
    if (base.trialActive) return { ...base, localTrial: false };
    if (local.active) {
      return {
        ...base,
        pro: true,
        trialActive: true,
        trialExpired: false,
        trialDaysLeft: local.daysLeft,
        localTrial: true
      };
    }
    return {
      ...base,
      pro: false,
      trialActive: false,
      trialExpired: Boolean(base.trialExpired || local.expired),
      trialDaysLeft: 0,
      trialDaysSinceEnd: local.daysSinceEnd,
      localTrial: false
    };
  }

  async function refresh() {
    const PREFIX = globalThis.EXT_BRAND?.cssPrefix ?? "mst";
    const CACHE_KEY = `${PREFIX}:proStatus`;
    const OVERRIDE_KEY = `${PREFIX}:proOverride`;
    const INSTALLED_KEY = `${PREFIX}:installedAt`;

    let fresh = null;
    try {
      const res = await chrome.runtime.sendMessage({ type: "getProStatus" });
      if (res?.ok) fresh = res.data;
    } catch {
      // service worker / ExtPay unreachable
    }
    let cached = null;
    let override = false;
    let installedAt = null;
    try {
      const stored = await chrome.storage.local.get([CACHE_KEY, OVERRIDE_KEY, INSTALLED_KEY]);
      cached = stored[CACHE_KEY] ?? null;
      override = stored[OVERRIDE_KEY] === true;
      const raw = stored[INSTALLED_KEY];
      // A corrupt (NaN/0) or future-dated stamp is treated as missing and
      // re-stamped, so no install is ever stuck without its trial.
      installedAt = Number.isFinite(raw) && raw > 0 && raw <= Date.now() ? raw : null;
      if (installedAt === null) {
        // First run before the service worker stamped it (or a pre-1.4 install
        // updating): the reverse trial starts now.
        installedAt = Date.now();
        chrome.storage.local.set({ [INSTALLED_KEY]: installedAt });
      }
    } catch {
      // storage unavailable — resolveStatus handles nulls
    }
    // Bound offline staleness: drop a cache older than the TTL so it can't
    // grant Pro indefinitely without ExtPay ever confirming again.
    const now = Date.now();
    if (!isCacheUsable(cached, now)) cached = null;
    // An offline cache that carries the ExtPay trial start is re-evaluated,
    // so a lapsed ExtPay trial can't stay PRO until the cache TTL runs out.
    if (cached && !cached.paid && cached.trialStartedAt) {
      cached = { ...cached, ...computeProStatus({ paid: false, trialStartedAt: cached.trialStartedAt }, now) };
    }

    current = override
      ? { pro: true, paid: true, trialActive: false, trialExpired: false, trialDaysLeft: 0, localTrial: false, source: "override" }
      : mergeStatus(resolveStatus(fresh, cached), computeLocalTrial(installedAt, now));
    if (fresh) {
      chrome.storage.local.set({ [CACHE_KEY]: { ...fresh, fetchedAt: now } });
    }
    return current;
  }

  const isPro = () => current.pro;
  const status = () => current;
  const send = (type, payload) =>
    chrome.runtime.sendMessage({ type, payload }).catch(() => {});
  // plan: ExtPay plan nickname ("pro-monthly" / "pro-yearly"); omit for the
  // generic choose-plan page.
  const openUpgrade = (plan) => {
    track(plan ? `click:${plan}` : "click:plans");
    return send("openPaymentPage", plan ? { plan } : undefined);
  };
  const startTrial = () => {
    track("click:trial");
    return send("openTrialPage");
  };
  const openLogin = () => send("openLoginPage");
  const openDashboard = () => send("openDashboard");

  return Object.freeze({
    TRIAL_MS,
    METRICS_KEY,
    computeProStatus,
    computeLocalTrial,
    mergeStatus,
    resolveStatus,
    isCacheUsable,
    refresh,
    isPro,
    status,
    track,
    openUpgrade,
    startTrial,
    openLogin,
    openDashboard
  });
})();
