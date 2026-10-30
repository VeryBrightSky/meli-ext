// Welcome page opened once by the service worker (install, and the first
// update that brings the reverse trial). Says PRO is on and what to do first.
"use strict";

(async () => {
  const BRAND = globalThis.EXT_BRAND;
  const T = globalThis.MST_I18N.t;
  document.title = `${BRAND.name} · ${T("welcomeTitle")}`;
  document.getElementById("brand-logo").src = chrome.runtime.getURL("src/assets/icons/icon48.png");

  const s = await globalThis.MST_GATE.refresh();
  const days = s.trialDaysLeft || 7;
  document.getElementById("pill").textContent = s.paid ? T("statusPro") : days === 1 ? T("badgeTrialOne") : T("badgeTrial", [String(days)]);
  document.getElementById("title").textContent = s.paid ? T("welcomeTitlePaid") : T("welcomeTitle");
  document.getElementById("lead").textContent = s.paid ? T("welcomeLeadPaid") : days === 1 ? T("welcomeLeadOne") : T("welcomeLead", [String(days)]);
  document.getElementById("s1t").textContent = T("welcomeStep1");
  document.getElementById("s1b").textContent = T("welcomeStep1Body");
  document.getElementById("s2t").textContent = T("welcomeStep2");
  document.getElementById("s2b").textContent = T("welcomeStep2Body");
  document.getElementById("s3t").textContent = T("welcomeStep3");
  document.getElementById("s3b").textContent = T("welcomeStep3Body");
  document.getElementById("go").textContent = T("welcomeGo");
  const dash = document.getElementById("dash");
  dash.textContent = T("optDashboard");
  dash.addEventListener("click", () => globalThis.MST_GATE.openDashboard());
  const share = document.getElementById("share");
  share.textContent = T("btnShareApp");
  share.href = `https://wa.me/?text=${encodeURIComponent(T("shareText", [BRAND.shareUrl("welcome")]))}`;
  share.addEventListener("click", () => {
    globalThis.MST_GATE.track("click:share");
    globalThis.MST_TRACK.event("share_click", { where: "welcome" });
  });
  document.getElementById("note").textContent = T("welcomeNote");
  globalThis.MST_GATE.track("seen:welcome");

  // Anonymous analytics notice: only when a backend is configured in this
  // build (the default build is dormant and keeps the original note).
  const tstate = await globalThis.MST_TRACK.state();
  if (tstate?.configured) {
    document.getElementById("note").textContent = T("welcomeNoteTelemetry");
    const box = document.getElementById("tnotice");
    document.getElementById("tnotice-text").textContent = T("telemetryNotice");
    const link = document.getElementById("tnotice-link");
    link.textContent = T("telemetryNoticeLink");
    link.href = `${BRAND.landingUrl}/privacidad.html`;
    const off = document.getElementById("tnotice-off");
    off.textContent = tstate.enabled ? T("telemetryNoticeOff") : T("telemetryOffDone");
    off.disabled = !tstate.enabled;
    off.addEventListener("click", async () => {
      const res = await globalThis.MST_TRACK.setEnabled(false);
      if (res) {
        off.textContent = T("telemetryOffDone");
        off.disabled = true;
      }
    });
    box.hidden = false;
  }
  globalThis.MST_TRACK.event("welcome_seen");
})();
