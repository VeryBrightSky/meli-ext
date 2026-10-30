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
  // Returns { pro, paid, lapsed, trialActive, trialExpired, trialDaysLeft }:
  //   lapsed        - paid before (paidAt present) but not paid now: a former
  //                   subscriber, who must never be told their trial ended
  //   trialActive   — inside the 7-day window and not paid
  //   trialExpired  — a trial was started, the window passed, and never paid
  //                   (the one moment a win-back prompt is justified)
  //   trialDaysLeft — ceil(days) remaining while active, else 0
  function computeProStatus(user, nowMs) {
    if (!user) return { pro: false, paid: false, lapsed: false, trialActive: false, trialExpired: false, trialDaysLeft: 0 };
    const paid = Boolean(user.paid);
    const lapsed = !paid && Boolean(user.paidAt);
    let trialActive = false;
    let trialExpired = false;
    let trialDaysLeft = 0;
    if (user.trialStartedAt) {
      const startedAt = new Date(user.trialStartedAt).getTime();
      if (Number.isFinite(startedAt)) {
        // Clamp: a client clock behind the server must not yield "8 days".
        const elapsed = Math.max(0, nowMs - startedAt);
        trialActive = elapsed < TRIAL_MS;
        trialExpired = !trialActive && !paid;
        if (trialActive) trialDaysLeft = Math.max(1, Math.ceil((TRIAL_MS - elapsed) / 86400000));
      }
    }
    return { pro: paid || trialActive, paid, lapsed, trialActive, trialExpired: trialExpired && !lapsed, trialDaysLeft };
  }

  function resolveStatus(fresh, cached) {
    if (fresh) return { ...fresh, source: "fresh" };
    if (cached && cached.pro) return { ...cached, source: "cache" };
    return { pro: false, paid: false, lapsed: false, trialActive: false, trialExpired: false, trialDaysLeft: 0, source: "default" };
  }

  // An offline Pro cache is honored only within this window; past it a fresh
  // check is required, so a lapsed-then-permanently-offline user can't hold Pro
  // forever. A legacy cache with no timestamp is treated as usable — the write
  // that first stamps fetchedAt must never revoke an entitlement mid-session.
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const STATUS_TIMEOUT_MS = 1500;
  const CLOCK_SKEW_MS = 60 * 1000;
  function isCacheUsable(cached, nowMs) {
    if (!cached) return false;
    // A legacy (pre-1.4) cache without a timestamp is honored only if it was a
    // PAID entitlement; an unstamped trial cache can't be re-verified, so it
    // is dropped rather than kept forever.
    if (typeof cached.fetchedAt !== "number") return cached.paid === true;
    // A stamp from the future (clock moved back, or tampering) would make the
    // cache look fresh forever; allow only a minute of clock skew.
    if (cached.fetchedAt > nowMs + CLOCK_SKEW_MS) return false;
    return nowMs - cached.fetchedAt <= CACHE_TTL_MS;
  }

  // --- runtime (requires chrome.*) -------------------------------------------

  let current = { pro: false, paid: false, trialActive: false, trialExpired: false, trialDaysLeft: 0, source: "init" };

  // Local-only funnel counters (no network, no PII): how often the upsell is
  // seen vs. the trial/plan buttons clicked. Shown on the options page so the
  // developer can tell whether a gate change moved anything.
  const METRICS_KEY = "mst:metrics";
  function track(event) {
    if (current.owner) return;
    try {
      chrome.storage.local.get(METRICS_KEY).then((stored) => {
        const m = { ...(stored?.[METRICS_KEY] ?? {}) };
        m[event] = (m[event] ?? 0) + 1;
        m.updatedAt = Date.now();
        return chrome.storage.local.set({ [METRICS_KEY]: m });
      }).catch(() => {});
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
      // A lapsed subscriber is not a "trial ended" case (wrong message).
      trialExpired: Boolean((base.trialExpired || local.expired) && !base.lapsed),
      trialDaysLeft: 0,
      trialDaysSinceEnd: local.daysSinceEnd,
      localTrial: false
    };
  }

  // Subscribers notified when a status that arrived AFTER the timeout changes
  // what the seller is entitled to (see refresh()).
  const listeners = new Set();
  const onChange = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  const quiet = (p) => p?.catch?.(() => {});
  const entitlementKey = (st) => `${st.pro}|${st.paid}|${st.trialActive}|${st.trialExpired}`;

  // Read storage, merge the (possibly null) fresh ExtPay answer with the cache
  // and the local reverse trial, cache a fresh answer, and set `current`.
  const ownerActive = async () => {
    try {
      return Boolean(await globalThis.MST_OWNER?.isActive());
    } catch {
      return false;
    }
  };

  async function resolveCurrent(fresh) {
    // Re-verified against the key hash on every computation: a flag or hash
    // pasted into storage proves nothing.
    if (await ownerActive()) {
      current = { pro: true, paid: true, lapsed: false, trialActive: false, trialExpired: false, trialDaysLeft: 0, localTrial: false, owner: true, source: "owner" };
      return current;
    }
    const PREFIX = globalThis.EXT_BRAND?.cssPrefix ?? "mst";
    const CACHE_KEY = `${PREFIX}:proStatus`;
    const OVERRIDE_KEY = `${PREFIX}:proOverride`;
    const INSTALLED_KEY = `${PREFIX}:installedAt`;
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
      // The trial start is mirrored in storage.sync; the earlier of the two
      // wins, so clearing local storage can't restart the trial. (ExtPay's own
      // install time is NOT used: for pre-1.4 users it is months old and
      // would cancel the 7 days they are promised on update.)
      try {
        const sync = await chrome.storage.sync.get(INSTALLED_KEY);
        const mirror = sync?.[INSTALLED_KEY];
        const okMirror = Number.isFinite(mirror) && mirror > 0 && mirror <= Date.now();
        if (okMirror) installedAt = installedAt === null ? mirror : Math.min(installedAt, mirror);
        if (installedAt !== null && (!okMirror || mirror !== installedAt)) {
          quiet(chrome.storage.sync.set({ [INSTALLED_KEY]: installedAt }));
          quiet(chrome.storage.local.set({ [INSTALLED_KEY]: installedAt }));
        }
      } catch {
        // sync storage unavailable: local stamp only
      }
      if (installedAt === null) {
        // First run before the service worker stamped it (or a pre-1.4 install
        // updating): the reverse trial starts now.
        installedAt = Date.now();
        quiet(chrome.storage.local.set({ [INSTALLED_KEY]: installedAt }));
      }
    } catch {
      // storage unavailable: resolveStatus handles nulls
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
      quiet(chrome.storage.local.set({ [CACHE_KEY]: { ...fresh, fetchedAt: now } }));
    }
    return current;
  }

  // ExtPay must never block the card: a slow or unreachable server falls
  // back to the cache after STATUS_TIMEOUT_MS and free features render now.
  // If the real answer lands later and says something different (a paying
  // user on a slow connection), it is applied, cached, and announced through
  // onChange so the UI rebuilds instead of showing free until the next visit.
  async function refresh({ timeoutMs = STATUS_TIMEOUT_MS } = {}) {
    let fresh = null;
    let timedOut = false;
    let pending = null;
    // Owner mode never asks ExtensionPay anything.
    if (await ownerActive()) return resolveCurrent(null);
    try {
      pending = Promise.resolve(chrome.runtime.sendMessage({ type: "getProStatus" }));
      const res = await Promise.race([
        pending,
        new Promise((r) => setTimeout(() => {
          timedOut = true;
          r(null);
        }, timeoutMs))
      ]);
      if (res?.ok) fresh = res.data;
    } catch {
      // service worker / ExtPay unreachable
    }
    const result = await resolveCurrent(fresh);
    if (timedOut && pending) {
      pending.then(async (late) => {
        if (!late?.ok) return;
        const before = entitlementKey(current);
        await resolveCurrent(late.data);
        if (entitlementKey(current) !== before) {
          for (const fn of [...listeners]) {
            try {
              fn(current);
            } catch {
              // a listener must not break the others
            }
          }
        }
      }).catch(() => {});
    }
    return result;
  }

  const isPro = () => current.pro;
  const isOwner = () => current.owner === true;
  const status = () => current;
  // Never throws or rejects: an orphaned context ("Extension context
  // invalidated") answers {ok:false} like any other failure.
  const send = (type, payload) => {
    try {
      return Promise.resolve(chrome.runtime.sendMessage({ type, payload })).catch(() => ({ ok: false }));
    } catch {
      return Promise.resolve({ ok: false });
    }
  };
  // plan: ExtPay plan nickname ("pro-monthly" / "pro-yearly"); omit for the
  // generic choose-plan page.
  // `from` names the surface that asked (a paywall reason or "trial-banner"):
  // it feeds the anonymous funnel only, never the checkout request.
  const openUpgrade = async (plan, from = "upsell") => {
    track(plan ? `click:${plan}` : "click:plans");
    const T = globalThis.MST_TRACK;
    T?.event("checkout_click", { plan: plan || "plans", from });
    const res = await send("openPaymentPage", plan ? { plan } : undefined);
    if (!res?.ok) T?.event("checkout_failed", { from });
    return res;
  };
  const openLogin = (from = "upsell") => {
    globalThis.MST_TRACK?.event("login_click", { from });
    return send("openLoginPage");
  };
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
    isOwner,
    status,
    track,
    openUpgrade,
    onChange,
    openLogin,
    openDashboard
  });
})();
