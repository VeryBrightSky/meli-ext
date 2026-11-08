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
  // no longer burns 7 invisible PRO days. There is no automatic start: a
  // seller who never saves a cost stays "pending" and, from day 30 after
  // install, the card reminds them what starts the trial (TRIAL_REMIND_MS).
  //   - pre-1.5.5 installs with a saved cost keep their old window: the
  //     service worker migrates trialStartedAt = installedAt ONCE on the
  //     update to 1.5.5 (migrateTrialOnUpdate) and stamps trialSchema = 2
  //   - with trialSchema = 2 a cost key without a stamp is never migrated
  //     (the stamp is written in the same storage write as the first cost,
  //     so "cost but no stamp" is a cost saved on a page without an item id,
  //     never a lost trial)
  // When it ends the seller visibly loses the target price, radar colors and
  // dashboard they were using, so nothing here is hidden or quiet.
  const TRIAL_REMIND_MS = 30 * 24 * 60 * 60 * 1000;
  const TRIAL_SCHEMA = 2;
  // The release that moved the trial start to the first saved cost.
  const TRIAL_SCHEMA_SINCE = "1.5.5";

  // Pure: where the 7-day window starts, from the stamps in storage.
  //   stamp     a trialStartedAt stamp exists
  //   migrated  pre-1.5.5 install (no trialSchema stamp) with a saved cost:
  //             the window ran from install
  //   pending   installed, no cost yet: not started
  //   none      no stamps at all (first run before the service worker ran)
  function deriveTrialStart({ installedAt, trialStartedAt, hasCost, trialSchema }, nowMs) {
    const ok = (v) => Number.isFinite(v) && v > 0 && v <= nowMs + CLOCK_SKEW_MS;
    // An existing stamp always wins, even one from a clock that was ahead:
    // clamp it to now instead of dropping it (dropping it would fall through
    // to "migrated" and backdate the trial to install, locking the seller out).
    if (Number.isFinite(trialStartedAt) && trialStartedAt > 0) {
      return { startedAt: Math.min(trialStartedAt, nowMs), reason: "stamp" };
    }
    if (!ok(installedAt)) return { startedAt: null, reason: "none" };
    // Schema 2 installs never migrate: the service worker already did it
    // once on the update, so a missing stamp means "not started".
    if (hasCost && trialSchema !== TRIAL_SCHEMA) return { startedAt: installedAt, reason: "migrated" };
    return { startedAt: null, reason: "pending" };
  }

  // Pure: days since install, for the day-30 reminder on a pending trial.
  const daysSinceInstall = (installedAt, nowMs) =>
    Number.isFinite(installedAt) && installedAt > 0 ? Math.floor(Math.max(0, nowMs - installedAt) / 86400000) : 0;

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
      // Pending only: days since install, so the card can remind a seller
      // who has not saved a cost in 30 days what starts the trial.
      trialDaysSinceInstall: local.pending ? (local.daysSinceInstall ?? 0) : 0,
      trialRemind: Boolean(local.pending && !base.trialExpired && !base.lapsed && (local.daysSinceInstall ?? 0) * 86400000 >= TRIAL_REMIND_MS),
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
    const SCHEMA_KEY = `${PREFIX}:trialSchema`;
    // No upper bound: a future-dated stamp is clamped by deriveTrialStart,
    // never discarded.
    const valid = (v) => Number.isFinite(v) && v > 0;
    const earliest = (a, b) => (valid(a) && valid(b) ? Math.min(a, b) : valid(a) ? a : valid(b) ? b : null);
    let installedAt = null;
    let trialStartedAt = null;
    try {
      const stored = await chrome.storage.local.get([INSTALLED_KEY, TRIAL_KEY, SCHEMA_KEY]);
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
      const trialSchema = stored[SCHEMA_KEY];
      let hasCost = false;
      if (trialStartedAt === null && trialSchema !== TRIAL_SCHEMA) {
        // Legacy (pre-1.5.5) install the service worker has not migrated
        // yet: scan for a saved cost. Schema 2 installs never need this.
        const all = await chrome.storage.local.get(null);
        hasCost = Object.keys(all ?? {}).some((k) => k.startsWith(`${PREFIX}:cost:`) && Number(all[k]) > 0);
      }
      const derived = deriveTrialStart({ installedAt, trialStartedAt, hasCost, trialSchema }, nowMs);
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
    const local = computeLocalTrial(trialStartedAt, nowMs);
    local.daysSinceInstall = daysSinceInstall(installedAt, nowMs);
    return { installedAt, trialStartedAt, local };
  }

  // Service worker, onInstalled: stamp the trial schema and, ONCE, migrate a
  // pre-1.5.5 install that has a saved cost and no start stamp to
  // trialStartedAt = installedAt (its old window ran from install). Runs for
  // every reason so a fresh install is schema 2 from its first second; only
  // an update from before TRIAL_SCHEMA_SINCE migrates. Returns what it did.
  async function migrateTrialOnUpdate({ reason, previousVersion } = {}, nowMs = Date.now()) {
    const PREFIX = globalThis.EXT_BRAND?.cssPrefix ?? "mst";
    const INSTALLED_KEY = `${PREFIX}:installedAt`;
    const TRIAL_KEY = `${PREFIX}:trialStartedAt`;
    const SCHEMA_KEY = `${PREFIX}:trialSchema`;
    const valid = (v) => Number.isFinite(v) && v > 0;
    const out = { schemaStamped: false, migrated: false };
    try {
      const all = await chrome.storage.local.get(null);
      let sync = {};
      try {
        sync = (await chrome.storage.sync.get([INSTALLED_KEY, TRIAL_KEY])) ?? {};
      } catch {
        // sync unavailable
      }
      const hasStamp = valid(all?.[TRIAL_KEY]) || valid(sync?.[TRIAL_KEY]);
      const legacy = reason === "update" && versionBefore(previousVersion, TRIAL_SCHEMA_SINCE);
      const alreadySchema = all?.[SCHEMA_KEY] === TRIAL_SCHEMA;
      const writes = {};
      if (!alreadySchema) {
        writes[SCHEMA_KEY] = TRIAL_SCHEMA;
        out.schemaStamped = true;
      }
      if (legacy && !alreadySchema && !hasStamp) {
        const hasCost = Object.keys(all ?? {}).some((k) => k.startsWith(`${PREFIX}:cost:`) && Number(all[k]) > 0);
        const installedAt = [all?.[INSTALLED_KEY], sync?.[INSTALLED_KEY]].filter(valid).sort((a, b) => a - b)[0];
        if (hasCost && valid(installedAt)) {
          writes[TRIAL_KEY] = Math.min(installedAt, nowMs);
          out.migrated = true;
        }
      }
      if (Object.keys(writes).length) {
        await chrome.storage.local.set(writes);
        if (writes[TRIAL_KEY]) quiet(chrome.storage.sync.set({ [TRIAL_KEY]: writes[TRIAL_KEY] }));
      }
    } catch {
      // storage unavailable: readLocalTrial keeps the legacy fallback
    }
    return out;
  }

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

  // The first saved cost starts the 7 PRO days. The card writes the stamp in
  // the SAME storage write as the cost (trialStampForFirstCost) so a
  // navigation right after a chip tap can never leave a cost without its
  // stamp; this then mirrors it to sync, recomputes the status and announces
  // the change through onChange so the card rebuilds as PRO on the spot.
  // Without `stampedAt` (no card write) it writes the stamp itself.
  // Resolves true when a trial was started by this call.
  let lastFresh = null;
  const trialKey = () => `${globalThis.EXT_BRAND?.cssPrefix ?? "mst"}:trialStartedAt`;
  // The entries the card must merge into its first-cost write, or null when
  // no trial is to be started (already running, paid, owner, expired).
  function trialStampForFirstCost(nowMs = Date.now()) {
    if (!current.trialPending || current.paid || current.owner) return null;
    return { [trialKey()]: nowMs };
  }
  async function startTrial({ stampedAt } = {}) {
    if (!current.trialPending || current.paid || current.owner) return false;
    const TRIAL_KEY = trialKey();
    const now = Number.isFinite(stampedAt) && stampedAt > 0 ? stampedAt : Date.now();
    try {
      if (!(Number.isFinite(stampedAt) && stampedAt > 0)) await chrome.storage.local.set({ [TRIAL_KEY]: now });
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
    TRIAL_REMIND_MS,
    TRIAL_SCHEMA,
    METRICS_KEY,
    computeProStatus,
    computeLocalTrial,
    deriveTrialStart,
    daysSinceInstall,
    readLocalTrial,
    migrateTrialOnUpdate,
    versionBefore,
    trialStampForFirstCost,
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
