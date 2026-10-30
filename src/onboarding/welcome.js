// Welcome page opened once by the service worker (install, and the first
// update that brings the reverse trial). Says what the seller actually has
// (trial days, PRO, or the free plan after an expired trial) and what to do
// first.
"use strict";

// Pure: entitlement status → the three header strings. A reinstall after an
// expired trial lands here with trialExpired and 0 days left; it must not be
// told PRO is on for 7 days (v1.5.1 audit).
globalThis.MST_WELCOME_COPY = function welcomeCopy(s, T) {
  if (s.owner || s.paid) {
    return { pill: T("statusPro"), title: T("welcomeTitlePaid"), lead: T("welcomeLeadPaid"), state: "paid" };
  }
  if (s.trialActive && s.trialDaysLeft > 0) {
    const days = s.trialDaysLeft;
    return {
      pill: days === 1 ? T("badgeTrialOne") : T("badgeTrial", [String(days)]),
      title: T("welcomeTitle"),
      lead: days === 1 ? T("welcomeLeadOne") : T("welcomeLead", [String(days)]),
      state: "trial"
    };
  }
  if (s.trialExpired) {
    return { pill: T("statusFree"), title: T("welcomeTitleExpired"), lead: T("welcomeLeadExpired"), state: "expired" };
  }
  return { pill: T("statusFree"), title: T("welcomeTitleFree"), lead: T("welcomeLeadFree"), state: "free" };
};

(async () => {
  const BRAND = globalThis.EXT_BRAND;
  const T = globalThis.MST_I18N.t;
  document.title = `${BRAND.name} · ${T("welcomeTitle")}`;
  document.getElementById("brand-logo").src = chrome.runtime.getURL("src/assets/icons/icon48.png");

  const s = await globalThis.MST_GATE.refresh();
  const copy = globalThis.MST_WELCOME_COPY(s, T);
  document.title = `${BRAND.name} · ${copy.title}`;
  document.getElementById("pill").textContent = copy.pill;
  document.getElementById("pill").dataset.state = copy.state;
  document.getElementById("title").textContent = copy.title;
  document.getElementById("lead").textContent = copy.lead;
  document.getElementById("s1t").textContent = T("welcomeStep1");
  document.getElementById("s1b").textContent = T("welcomeStep1Body");
  document.getElementById("s2t").textContent = T("welcomeStep2");
  document.getElementById("s2b").textContent = T("welcomeStep2Body");
  document.getElementById("s3t").textContent = T("welcomeStep3");
  document.getElementById("s3b").textContent = T("welcomeStep3Body");
  document.getElementById("go").textContent = T("welcomeGo");
  // Expired/free states: the lead says "activar PRO", so the pay CTA is right
  // here (monthly plan, the same checkout the card's banners open). Owner,
  // paid and trial states never show it.
  const upgrade = document.getElementById("upgrade");
  if (copy.state === "expired" || copy.state === "free") {
    upgrade.textContent = T("upsellMonthly");
    upgrade.hidden = false;
    upgrade.addEventListener("click", async () => {
      const res = await globalThis.MST_GATE.openUpgrade(BRAND.plans.monthly, "welcome");
      if (!res?.ok) upgrade.textContent = T("upsellOpenFailed");
    });
  }
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
