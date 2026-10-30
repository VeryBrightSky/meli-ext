// Error isolation for everything we inject. One failing component must never
// kill the rest of the extension, and no exception of ours may surface as an
// unprefixed uncaught error on the host page's console.
//
// Two layers:
//   - MST_SAFE.wrap/run: per-callback try/catch chokepoints (observers, event
//     handlers, injection paths). Failures log once per label per minute so a
//     hot loop (observer firing 10×/s) can't flood the console.
//   - window "error"/"unhandledrejection" listeners: last-resort logging of
//     anything of OURS that slipped through (filtered to this extension's
//     source URL — host-page errors are not our business and are ignored).
"use strict";

globalThis.MST_SAFE = (() => {
  const TAG = `[${globalThis.EXT_BRAND.name}]`;
  const LOG_THROTTLE_MS = 60 * 1000;
  const lastLog = new Map();

  // Anonymous error code for the funnel analytics (enum only, never the
  // message or stack). An orphaned context cannot message the worker, so
  // "context invalidated" is not reportable from here by design.
  function codeFor(label) {
    const l = String(label);
    if (l.startsWith("uncaught@") || l === "unhandledrejection") return "uncaught";
    if (l.startsWith("page-data")) return "parse_fail";
    if (l.startsWith("card")) return l === "card-recover" ? "route_fail" : "render_fail";
    if (/quick|strip|export-bar/.test(l)) return "quickview_fail";
    return "route_fail";
  }

  function report(label, err) {
    try {
      globalThis.MST_TRACK?.error(codeFor(label));
    } catch {
      // analytics must never break error reporting
    }
    const now = Date.now();
    const prev = lastLog.get(label) ?? 0;
    if (now - prev < LOG_THROTTLE_MS) return;
    lastLog.set(label, now);
    console.warn(`${TAG} component "${label}" failed (degrading gracefully):`, err);
  }

  // Run fn now; on throw, log and return fallback. The extension's per-
  // component degradation primitive.
  function run(label, fn, fallback = undefined) {
    try {
      return fn();
    } catch (err) {
      report(label, err);
      return fallback;
    }
  }

  // Wrap a callback (observer, event listener, timer) so a throw degrades to
  // a logged no-op instead of an uncaught error.
  function wrap(label, fn) {
    return function wrapped(...args) {
      try {
        return fn.apply(this, args);
      } catch (err) {
        report(label, err);
        return undefined;
      }
    };
  }

  // After the extension is reloaded/updated, an already-injected content
  // script is orphaned: chrome.runtime.id goes undefined and every chrome.*
  // call throws "Extension context invalidated". Callers check this first.
  function alive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  // Last-resort catcher for OUR async/uncaught leftovers. Filter hard: the
  // host page's own errors must not be rebranded with our prefix.
  const extensionUrl = (() => {
    try {
      return chrome.runtime.getURL("");
    } catch {
      return null;
    }
  })();

  if (extensionUrl) {
    window.addEventListener("error", (event) => {
      if (event.filename && event.filename.startsWith(extensionUrl)) {
        report(`uncaught@${event.filename.slice(extensionUrl.length)}`, event.error ?? event.message);
      }
    });
    window.addEventListener("unhandledrejection", (event) => {
      const stack = event.reason?.stack;
      if (typeof stack === "string" && stack.includes(extensionUrl)) {
        report("unhandledrejection", event.reason);
      }
    });
  }

  return Object.freeze({ run, wrap, alive });
})();
