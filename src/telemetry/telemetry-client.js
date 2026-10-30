// Anonymous funnel analytics: the page/content-script half. These contexts
// NEVER touch the network for analytics; they only hand a small typed message
// to the service worker, which validates it (allowlist) and decides whether
// anything is queued or sent at all. Every call is fire-and-forget and can
// never throw (an orphaned content script must not surface errors).
"use strict";

globalThis.MST_TRACK = (() => {
  const seen = new Set();
  const errorsSent = new Map();

  function post(message) {
    try {
      const p = chrome.runtime.sendMessage(message);
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      // extension context invalidated, or no runtime: analytics is best-effort
    }
  }

  const event = (name, props) => post({ type: "track", event: name, props: props ?? {} });

  // At most once per page/script lifetime (the service worker dedupes across
  // sessions); keeps hot paths such as card updates from messaging each time.
  function once(name, props) {
    const k = `${name}|${JSON.stringify(props ?? {})}`;
    if (seen.has(k)) return;
    seen.add(k);
    event(name, props);
  }

  // Daily-summary counters: key is one of cards|searches|cost_entries|calcs|
  // anchors_missing, or "product" with a short local hash (never the id).
  const count = (key, arg) => post({ type: "tcount", key, arg });

  // Stable 32-bit FNV-1a of a string, as hex. Used only to count DISTINCT
  // listings locally; the raw id never leaves the content script.
  function hash(text) {
    let h = 0x811c9dc5;
    const s = String(text ?? "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
  }

  // Error codes are validated by the service worker; a page also stops after
  // 3 per code so a hot failure loop cannot flood messaging.
  function error(code) {
    const n = errorsSent.get(code) ?? 0;
    if (n >= 3) return;
    errorsSent.set(code, n + 1);
    event("error", { code });
  }

  // Items-on-page bucket for radar_preview_seen (mirrors the core allowlist).
  function bucket(n) {
    const x = Number(n);
    if (!(x >= 1)) return "0";
    if (x < 10) return "1-9";
    if (x < 25) return "10-24";
    if (x < 50) return "25-49";
    return "50+";
  }

  async function call(type, payload) {
    try {
      const res = await chrome.runtime.sendMessage({ type, payload });
      return res?.ok ? res.data : null;
    } catch {
      return null;
    }
  }

  return Object.freeze({
    event,
    once,
    count,
    error,
    hash,
    bucket,
    // { configured, enabled, noticeSeen } (+ debug fields when asked)
    state: (debug = false) => call("telemetryState", { debug }),
    setEnabled: (enabled) => call("telemetrySet", { enabled: enabled !== false }),
    noticeSeen: () => call("telemetryNoticeSeen"),
    flushNow: () => call("telemetryFlush")
  });
})();
