// Anonymous funnel analytics: the service-worker half. The ONLY place in the
// extension that talks to the analytics backend; content scripts and pages
// just send {type:"track"|"tcount"} runtime messages (telemetry-client.js).
//
// Behaviour in one paragraph: events are validated by MST_TELEMETRY_CORE,
// counted locally (always, for the options ?debug view), and, only when a
// backend is configured AND the seller has not opted out, appended to a ring
// buffer in storage.local and POSTed in batches of <= 50. With no config the
// worker never calls fetch at all (dormant).
//
// Built as a factory with injected chrome/fetch/clock so Node can test it.
"use strict";

globalThis.MST_TELEMETRY_SW = (() => {
  const C = globalThis.MST_TELEMETRY_CORE;
  const K = C.KEYS;
  const COUNTS_KEY = K.counts;

  function create(deps) {
    const storage = deps.storage; // chrome.storage.local-like (promise API)
    const now = deps.now ?? (() => Date.now());
    const fetchFn = deps.fetch;
    const timers = deps.timers ?? { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) };
    const installedKey = deps.installedKey ?? "mst:installedAt";
    const ALL_KEYS = [
      K.iid, K.enabled, K.noticeSeen, K.queue, K.last, K.flags, K.day, K.override,
      COUNTS_KEY, installedKey
    ];

    // Every storage read-modify-write runs one at a time.
    let chain = Promise.resolve();
    const serial = (fn) => {
      const p = chain.then(fn);
      chain = p.catch(() => {});
      return p;
    };

    // --- per-operation working copy ------------------------------------------
    async function load() {
      const stored = (await storage.get(ALL_KEYS)) ?? {};
      let override = null;
      override = stored[K.override] ?? null; // QA override (stripped in release builds)
      const qa = override ? C.normalizeConfig(override, { allowLoopbackHttp: true }) : null;
      const cfg = qa ?? C.normalizeConfig(deps.config);
      const optedOut = stored[K.enabled] === false;
      // Owner mode: the owner's own usage is never recorded or sent. Verified
      // by the caller-supplied check (key hash), never by a storage flag.
      let owner = false;
      try {
        owner = Boolean(await deps.isOwner?.());
      } catch {
        owner = false;
      }
      return {
        stored,
        view: { ...stored },
        patch: {},
        eff: { cfg, optedOut, owner, enabled: Boolean(cfg) && !optedOut && !owner, qa: Boolean(qa) },
        now: now(),
        urlDirty: false,
        wantFlush: false
      };
    }
    // Owner mode: drop everything collected so far (queue, counters, day,
    // install id) so nothing from the owner's browser can ever be sent.
    async function purgeOwner(st) {
      if (!st.eff.owner) return false;
      const keys = [K.iid, K.queue, K.last, K.flags, K.day, COUNTS_KEY].filter((k) => st.stored[k] !== undefined);
      if (timer) timers.clear(timer);
      timer = null;
      if (keys.length) await storage.remove(keys);
      for (const k of keys) {
        delete st.view[k];
        delete st.patch[k];
      }
      return true;
    }
    const setView = (st, key, value) => {
      st.view[key] = value;
      st.patch[key] = value;
    };
    async function commit(st) {
      if (Object.keys(st.patch).length) await storage.set(st.patch);
      if (st.urlDirty) await refreshUninstallUrl(st);
      if (st.wantFlush) scheduleFlush(st);
    }

    const flagsOf = (st) => {
      const f = st.view[K.flags];
      return f && typeof f === "object" ? { once: { ...(f.once ?? {}) }, sawPaywall: f.sawPaywall === true } : { once: {}, sawPaywall: false };
    };

    // --- local counters (options ?debug; no network) ---------------------------
    function bumpCounts(st, clean) {
      const prev = st.view[COUNTS_KEY];
      const counts = prev && typeof prev === "object" ? { ...prev } : {};
      const inc = (k) => {
        counts[k] = (counts[k] ?? 0) + 1;
      };
      inc(clean.event);
      if (clean.event !== "active_day" && clean.event !== "daily_summary") {
        for (const [p, v] of Object.entries(clean.props)) {
          if (typeof v === "string") inc(`${clean.event}:${p}=${v}`);
        }
      }
      setView(st, COUNTS_KEY, counts);
    }

    function ensureIid(st) {
      let iid = st.view[K.iid];
      if (!C.isUuid(iid)) {
        iid = deps.randomUUID();
        setView(st, K.iid, iid);
      }
      return iid;
    }

    // --- emit: validate → once/caps → queue --------------------------------------
    // Returns true when a row was queued. Caller has verified st.eff.enabled.
    function emit(st, event, props, { capped = true } = {}) {
      const clean = C.sanitizeEvent(event, props);
      if (!clean || !st.eff.enabled) return false;
      const flags = flagsOf(st);
      if (C.ONCE_EVER.has(event)) {
        if (flags.once[event]) return false;
        flags.once[event] = 1;
      }
      if (capped && event !== "active_day" && event !== "daily_summary") {
        const day = st.view[K.day];
        if (day && typeof day === "object") {
          const key = C.capKey(clean);
          const used = day.caps?.[key] ?? 0;
          if (used >= C.capMax(event)) return false;
          setView(st, K.day, { ...day, caps: { ...(day.caps ?? {}), [key]: used + 1 } });
        }
      }
      if (event === "paywall_seen") flags.sawPaywall = true;
      if (event === "first_cost_entered" || event === "paywall_seen") st.urlDirty = true;
      setView(st, K.flags, flags);
      const ctx = {
        installId: ensureIid(st),
        extVersion: deps.version,
        lang: deps.uiLang?.(),
        chrome: C.chromeMajor(deps.ua?.()),
        platform: C.platformFrom({ uaPlatform: deps.uaPlatform?.(), ua: deps.ua?.() })
      };
      const item = { ...C.buildRow(ctx, clean), _id: deps.randomId(), _t: st.now };
      const queue = C.pushQueue(st.view[K.queue], item, st.now);
      setView(st, K.queue, queue);
      st.wantFlush = true;
      return true;
    }

    // First activity of a local calendar day: roll the previous day's counters
    // into a daily_summary, then emit active_day (+ one-time state events).
    async function ensureDay(st) {
      const today = C.dayKey(st.now);
      const day = st.view[K.day];
      const valid = day && typeof day === "object" && typeof day.day === "string";
      if (valid && day.day >= today) return day; // same day (or clock moved back: do not flap)
      if (valid && C.hasActivity(day)) emit(st, "daily_summary", C.summaryProps(day), { capped: false });
      const fresh = C.emptyDay(today);
      setView(st, K.day, fresh);
      let ts = { state: "free", pro: false };
      try {
        ts = (await deps.getTrialState?.()) ?? ts;
      } catch {
        // status unknown: report "free" rather than guessing
      }
      emit(st, "active_day", {
        days_since_install: C.daysSinceInstall(st.view[installedKey], st.now),
        trial_state: C.TRIAL_STATES.includes(ts.state) ? ts.state : "free",
        pro: ts.pro === true
      }, { capped: false });
      if (ts.state === "expired") emit(st, "trial_expired_seen", {});
      if (ts.state === "paid") emit(st, "paid_detected", {});
      st.urlDirty = true; // days_used changed
      return fresh;
    }

    // --- public: track / count --------------------------------------------------------
    function track(event, props) {
      return serial(async () => {
        const clean = C.sanitizeEvent(event, props);
        if (!clean) return { ok: false, reason: "rejected" };
        const st = await load();
        if (await purgeOwner(st)) return { ok: true, queued: false, reason: "owner" };
        bumpCounts(st, clean);
        if (!st.eff.enabled) {
          await commit(st);
          return { ok: true, queued: false, reason: st.eff.cfg ? "opt-out" : "dormant" };
        }
        if (!C.PASSIVE.has(clean.event)) await ensureDay(st);
        const queued = emit(st, clean.event, clean.props);
        await commit(st);
        return { ok: true, queued };
      });
    }

    // Daily counters: cards, searches, cost_entries, calcs, anchors_missing,
    // product (a short local hash; only the COUNT of distinct hashes is sent).
    function count(key, arg) {
      return serial(async () => {
        const st = await load();
        if (await purgeOwner(st)) return { ok: true, queued: false };
        if (!st.eff.enabled) return { ok: true, queued: false };
        let day = await ensureDay(st);
        day = { ...day };
        if (key === "product") {
          const h = typeof arg === "string" && /^[0-9a-f]{1,8}$/.test(arg) ? arg : null;
          const set = Array.isArray(day.pset) ? [...day.pset] : [];
          if (h && !set.includes(h) && set.length < 100) set.push(h);
          day.pset = set;
        } else if (["cards", "searches", "cost_entries", "calcs", "anchors_missing"].includes(key)) {
          day[key] = Math.min(9999, (Number(day[key]) || 0) + 1);
        } else {
          return { ok: false, reason: "rejected" };
        }
        setView(st, K.day, day);
        await commit(st);
        return { ok: true };
      });
    }

    // --- flush -------------------------------------------------------------------------
    let flushing = false;
    let timer = null;
    function scheduleFlush(st) {
      const q = st.view[K.queue] ?? [];
      if (q.length >= C.FLUSH_AT) {
        if (timer) timers.clear(timer);
        timer = null;
        flush().catch(() => {});
      } else if (!timer) {
        timer = timers.set(() => {
          timer = null;
          flush().catch(() => {});
        }, C.FLUSH_DEBOUNCE_MS);
      }
    }

    async function post(cfg, batch) {
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      const abort = timers.set(() => ctl?.abort(), 10000);
      try {
        const res = await fetchFn(`${cfg.url}/rest/v1/events`, {
          method: "POST",
          headers: {
            apikey: cfg.key,
            Authorization: `Bearer ${cfg.key}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          },
          body: JSON.stringify(batch.map(C.toWire)),
          keepalive: false,
          signal: ctl?.signal
        });
        if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
        let text = "";
        try {
          text = (await res.text()).slice(0, 160);
        } catch {
          // no body
        }
        return { ok: false, status: res.status, error: `http ${res.status}${text ? `: ${text}` : ""}` };
      } catch (err) {
        return { ok: false, status: 0, error: String(err?.message ?? err).slice(0, 120) };
      } finally {
        timers.clear(abort);
      }
    }

    // 400/413/422: the server rejects the DATA, retrying can never succeed and
    // would block the queue forever, so that batch is dropped. Everything else
    // (network, 5xx, 429, 401/403/404 misconfig) keeps the queue.
    const POISON = new Set([400, 413, 422]);

    async function flush() {
      if (flushing) return { skipped: true };
      flushing = true;
      let sent = 0;
      try {
        for (let i = 0; i < 4; i++) {
          const info = await serial(async () => {
            const st = await load();
            if (!st.eff.enabled) return null;
            const q = C.pruneQueue(st.view[K.queue], st.now);
            if (q.length !== (st.view[K.queue] ?? []).length) {
              await storage.set({ [K.queue]: q });
            }
            return q.length ? { cfg: st.eff.cfg, batch: C.takeBatch(q) } : null;
          });
          if (!info) break;
          const res = await post(info.cfg, info.batch);
          const more = await serial(async () => {
            const st = await load();
            if (!st.eff.enabled) return false; // opted out mid-flight: nothing to record
            const drop = res.ok || POISON.has(res.status);
            if (drop) {
              const ids = new Set(info.batch.map((it) => it._id));
              setView(st, K.queue, C.removeIds(C.pruneQueue(st.view[K.queue], st.now), ids));
            }
            setView(st, K.last, {
              at: st.now,
              status: res.status,
              n: info.batch.length,
              error: res.ok ? null : (drop ? `dropped: ${res.error}` : res.error)
            });
            await commit(st);
            if (res.ok) sent += info.batch.length;
            return drop && (st.view[K.queue] ?? []).length > 0;
          });
          if (!more) break;
        }
      } finally {
        flushing = false;
      }
      return { sent };
    }

    // --- uninstall survey URL --------------------------------------------------------------
    let lastUninstallUrl = null;
    async function refreshUninstallUrl(st) {
      if (!deps.setUninstallURL || !deps.landingUrl || !st.eff.cfg) return; // dormant: no survey
      const flags = flagsOf(st);
      const url = C.buildUninstallUrl(deps.landingUrl, {
        installId: st.eff.enabled ? ensureIid(st) : null,
        extVersion: deps.version,
        days: C.daysSinceInstall(st.view[installedKey], st.now),
        cost: Boolean(flags.once.first_cost_entered),
        paywall: flags.sawPaywall,
        enabled: st.eff.enabled
      });
      if (Object.keys(st.patch).length) await storage.set(st.patch); // an iid created just now
      st.patch = {};
      if (url === lastUninstallUrl) return;
      try {
        await deps.setUninstallURL(url);
        lastUninstallUrl = url;
      } catch {
        // invalid/oversized URL or API missing: the survey is optional
      }
    }

    // --- lifecycle ------------------------------------------------------------------------------
    function onInstalled(details) {
      return serial(async () => {
        const st = await load();
        await purgeOwner(st);
        if (st.eff.enabled) {
          if (details?.reason === "install") {
            emit(st, "install", {});
          } else if (details?.reason === "update") {
            const from = details.previousVersion;
            if (C.sanitizeEvent("update", { from })) emit(st, "update", { from });
            // Sellers who entered costs before analytics existed still count
            // as having reached that step.
            try {
              const all = (await storage.get(null)) ?? {};
              const hasCost = Object.keys(all).some((k) => k.startsWith("mst:cost:") && Number(all[k]) > 0);
              if (hasCost) emit(st, "first_cost_entered", {});
            } catch {
              // best effort
            }
          }
        }
        st.urlDirty = true;
        await commit(st);
      });
    }

    function init() {
      return serial(async () => {
        const st = await load();
        await purgeOwner(st);
        st.urlDirty = true;
        await commit(st);
      });
    }

    function markPaid() {
      return serial(async () => {
        const st = await load();
        if (!st.eff.enabled) return false;
        const ok = emit(st, "paid_detected", {});
        await commit(st);
        return ok;
      });
    }

    // --- settings / state ---------------------------------------------------------------------------
    function setEnabled(on) {
      return serial(async () => {
        const st = await load();
        setView(st, K.enabled, on !== false);
        st.eff = { ...st.eff, optedOut: on === false, enabled: Boolean(st.eff.cfg) && on !== false && !st.eff.owner };
        if (!st.eff.enabled) {
          // Opt-out: unsent data is deleted and nothing more is collected.
          if (timer) timers.clear(timer);
          timer = null;
          setView(st, K.queue, []);
          setView(st, K.day, null);
          await storage.remove([K.day, K.last]);
          delete st.patch[K.day];
        }
        st.urlDirty = true;
        await commit(st);
        return { enabled: st.eff.enabled };
      });
    }

    function markNoticeSeen() {
      return serial(async () => {
        await storage.set({ [K.noticeSeen]: true });
        return true;
      });
    }

    function getState({ debug = false } = {}) {
      return serial(async () => {
        const st = await load();
        const out = {
          configured: Boolean(st.eff.cfg),
          enabled: st.eff.enabled,
          owner: st.eff.owner,
          noticeSeen: st.view[K.noticeSeen] === true
        };
        if (debug) {
          out.queue = Array.isArray(st.view[K.queue]) ? st.view[K.queue].length : 0;
          out.last = st.view[K.last] ?? null;
          out.iid = C.isUuid(st.view[K.iid]) ? st.view[K.iid] : null;
          out.qa = st.eff.qa;
          out.host = st.eff.cfg ? st.eff.cfg.url.replace(/^https?:\/\//, "") : null;
          out.counts = st.view[COUNTS_KEY] ?? {};
          out.flags = flagsOf(st);
          out.day = st.view[K.day] ?? null;
        }
        return out;
      });
    }

    return Object.freeze({ track, count, flush, onInstalled, init, markPaid, setEnabled, markNoticeSeen, getState });
  }

  return Object.freeze({ create, COUNTS_KEY });
})();
