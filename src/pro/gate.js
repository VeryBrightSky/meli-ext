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

  let current = { pro: false, paid: false, trialActive: false, trialExpired: false, trialPending: false, trialDaysLeft: 0, source: "init" };

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
  // Every install gets PRO for TRIAL_MS, no email, no card. Since 1.5.5 the
  // clock starts at the FIRST SAVED COST (<prefix>:trialStartedAt), not at
  // install: a seller who installs and only reads the free card for a week
  // no longer burns 7 invisible PRO days. Safety nets:
  //   - no cost ever saved: the trial starts by itself TRIAL_AUTO_START_MS
  //     after install, so nobody is stuck in "not started" forever
  //   - pre-1.5.5 installs with a saved cost keep their old window
  //     (trialStartedAt is migrated to installedAt)
  // When it ends the seller visibly loses the target price, radar colors and
  // dashboard they were using, so nothing here is hidden or quiet.
  const TRIAL_AUTO_START_MS = 30 * 24 * 60 * 60 * 1000;

  // Pure: where the 7-day window starts, from the stamps in storage.
  //   stamp     a trialStartedAt stamp exists
  //   migrated  pre-1.5.5 install with a saved cost: the window ran from install
  //   auto      nothing saved for TRIAL_AUTO_START_MS: starts by itself
  //   pending   installed, no cost yet: not started
  //   none      no stamps at all (first run before the service worker ran)
  function deriveTrialStart({ installedAt, trialStartedAt, hasCost }, nowMs) {
    const ok = (v) => Number.isFinite(v) && v > 0 && v <= nowMs + CLOCK_SKEW_MS;
    // An existing stamp always wins, even one from a clock that was ahead:
    // clamp it to now instead of dropping it (dropping it would fall through
    // to "migrated" and backdate the trial to install, locking the seller out).
    if (Number.isFinite(trialStartedAt) && trialStartedAt > 0) {
      return { startedAt: Math.min(trialStartedAt, nowMs), reason: "stamp" };
    }
    if (!ok(installedAt)) return { startedAt: null, reason: "none" };
    if (hasCost) return { startedAt: installedAt, reason: "migrated" };
    if (nowMs - installedAt >= TRIAL_AUTO_START_MS) {
      return { startedAt: installedAt + TRIAL_AUTO_START_MS, reason: "auto" };
    }
    return { startedAt: null, reason: "pending" };
  }

  // Pure helper: trialStartedAtMs → { active, expired, pending, daysLeft }.
  // No start yet is "pending" (PRO not started, nothing lost, nothing expired).
  function computeLocalTrial(startedAtMs, nowMs) {
    if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) {
      return { active: false, expired: false, pending: true, daysLeft: 0, daysSinceEnd: 0 };
    }
    const elapsed = nowMs - startedAtMs;
    const active = elapsed >= 0 && elapsed < TRIAL_MS;
    const daysLeft = active ? Math.max(1, Math.ceil((TRIAL_MS - elapsed) / 86400000)) : 0;
    const daysSinceEnd = active ? 0 : Math.floor((elapsed - TRIAL_MS) / 86400000);
    return { active, expired: !active && elapsed >= TRIAL_MS, pending: false, daysLeft, daysSinceEnd };
  }

  // Merge ExtPay-derived status with the local reverse trial. Paid always
  // wins; an ExtPay trial (legacy opt-in) counts while active; otherwise the
  // local window decides. `trialExpired` is true only when a trial of either
  // kind has ended without a purchase; `trialPending` when the local trial
  // has not started yet (no cost saved).
  function mergeStatus(base, local) {
    if (base.paid) return { ...base, trialExpired: false, trialPending: false, localTrial: false };
    if (base.trialActive) return { ...base, trialPending: false, localTrial: false };
    if (local.active) {
      return {
        ...base,
        pro: true,
        trialActive: true,
        trialExpired: false,
        trialPending: false,
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
      trialPending: Boolean(local.pending && !base.trialExpired && !base.lapsed),
      trialDaysLeft: 0,
      trialDaysSinceEnd: local.daysSinceEnd,
      localTrial: false
    };
  }

  // Read both stamps (local + sync mirror, earliest wins), derive the start,
  // and persist a derived start (migrated/auto) so it is stable from now on.
  // Returns { installedAt, trialStartedAt, local } for the current moment.
  // Any context with chrome.storage can call it (content, options, worker).
  async function readLocalTrial(nowMs = Date.now()) {
    const PREFIX = globalThis.EXT_BRAND?.cssPrefix ?? "mst";
    const INSTALLED_KEY = `${PREFIX}:installedAt`;
    const TRIAL_KEY = `${PREFIX}:trialStartedAt`;
    // No upper bound: a future-dated stamp is clamped by deriveTrialStart,
    // never discarded.
    const valid = (v) => Number.isFinite(v) && v > 0;
    const earliest = (a, b) => (valid(a) && valid(b) ? Math.min(a, b) : valid(a) ? a : valid(b) ? b : null);
    let installedAt = null;
    let trialStartedAt = null;
    try {
      const stored = await chrome.storage.local.get([INSTALLED_KEY, TRIAL_KEY]);
      let sync = {};
      try {
        sync = (await chrome.storage.sync.get([INSTALLED_KEY, TRIAL_KEY])) ?? {};
      } catch {
        // sync storage unavailable: local stamps only
      }
      // The stamps are mirrored in storage.sync; the earlier of the two wins,
      // so clearing local storage can't restart the trial. (ExtPay's own
      // install time is NOT used: for pre-1.4 users it is months old.)
      installedAt = earliest(stored[INSTALLED_KEY], sync[INSTALLED_KEY]);
      trialStartedAt = earliest(stored[TRIAL_KEY], sync[TRIAL_KEY]);
      if (installedAt === null) {
        // First run before the service worker stamped it: install is now.
        installedAt = nowMs;
      }
      let hasCost = false;
      if (trialStartedAt === null) {
        // Only scanned until the stamp exists (one storage read per page
        // view at most, and only for installs that never saved a cost).
        const all = await chrome.storage.local.get(null);
        hasCost = Object.keys(all ?? {}).some((k) => k.startsWith(`${PREFIX}:cost:`) && Number(all[k]) > 0);
      }
      const derived = deriveTrialStart({ installedAt, trialStartedAt, hasCost }, nowMs);
      trialStartedAt = derived.startedAt;
      const writes = {};
      if (stored[INSTALLED_KEY] !== installedAt) writes[INSTALLED_KEY] = installedAt;
      if (trialStartedAt !== null && stored[TRIAL_KEY] !== trialStartedAt) writes[TRIAL_KEY] = trialStartedAt;
      if (Object.keys(writes).length) {
        quiet(chrome.storage.local.set(writes));
        quiet(chrome.storage.sync.set(writes));
      } else if (sync[INSTALLED_KEY] !== installedAt || (trialStartedAt !== null && sync[TRIAL_KEY] !== trialStartedAt)) {
        const mirror = { [INSTALLED_KEY]: installedAt };
        if (trialStartedAt !== null) mirror[TRIAL_KEY] = trialStartedAt;
        quiet(chrome.storage.sync.set(mirror));
      }
    } catch {
      // storage unavailable: pending (free) until it answers
    }
    return { installedAt, trialStartedAt, local: computeLocalTrial(trialStartedAt, nowMs) };
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
      current = { pro: true, paid: true, lapsed: false, trialActive: false, trialExpired: false, trialPending: false, trialDaysLeft: 0, localTrial: false, owner: true, source: "owner" };
      return current;
    }
    const PREFIX = globalThis.EXT_BRAND?.cssPrefix ?? "mst";
    const CACHE_KEY = `${PREFIX}:proStatus`;
    const OVERRIDE_KEY = `${PREFIX}:proOverride`;
    let cached = null;
    let override = false;
    try {
      const stored = await chrome.storage.local.get([CACHE_KEY, OVERRIDE_KEY]);
      cached = stored[CACHE_KEY] ?? null;
      override = stored[OVERRIDE_KEY] === true;
    } catch {
      // storage unavailable: resolveStatus handles nulls
    }
    const now = Date.now();
    const { local } = await readLocalTrial(now);
    // Bound offline staleness: drop a cache older than the TTL so it can't
    // grant Pro indefinitely without ExtPay ever confirming again.
    if (!isCacheUsable(cached, now)) cached = null;
    // An offline cache that carries the ExtPay trial start is re-evaluated,
    // so a lapsed ExtPay trial can't stay PRO until the cache TTL runs out.
    if (cached && !cached.paid && cached.trialStartedAt) {
      cached = { ...cached, ...computeProStatus({ paid: false, trialStartedAt: cached.trialStartedAt }, now) };
    }

    current = override
      ? { pro: true, paid: true, trialActive: false, trialExpired: false, trialPending: false, trialDaysLeft: 0, localTrial: false, source: "override" }
      : mergeStatus(resolveStatus(fresh, cached), local);
    if (fresh) {
      lastFresh = fresh;
      quiet(chrome.storage.local.set({ [CACHE_KEY]: { ...fresh, fetchedAt: now } }));
    }
    return current;
  }

  // The first saved cost starts the 7 PRO days. Stamps trialStartedAt (local
  // + sync mirror), recomputes the status and announces the change through
  // onChange so the card rebuilds as PRO on the spot. Resolves true when a
  // trial was started by this call.
  let lastFresh = null;
  async function startTrial() {
    if (!current.trialPending || current.paid || current.owner) return false;
    const PREFIX = globalThis.EXT_BRAND?.cssPrefix ?? "mst";
    const TRIAL_KEY = `${PREFIX}:trialStartedAt`;
    const now = Date.now();
    try {
      await chrome.storage.local.set({ [TRIAL_KEY]: now });
      quiet(chrome.storage.sync.set({ [TRIAL_KEY]: now }));
    } catch {
      return false;
    }
    const before = entitlementKey(current);
    await resolveCurrent(lastFresh);
    if (!current.trialActive) return false;
    track("trial:started"); // local funnel counter only
    if (entitlementKey(current) !== before) notify();
    return true;
  }

  function notify() {
    for (const fn of [...listeners]) {
      try {
        fn(current);
      } catch {
        // a listener must not break the others
      }
    }
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
        if (entitlementKey(current) !== before) notify();
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
    TRIAL_AUTO_START_MS,
    METRICS_KEY,
    computeProStatus,
    computeLocalTrial,
    deriveTrialStart,
    readLocalTrial,
    startTrial,
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
