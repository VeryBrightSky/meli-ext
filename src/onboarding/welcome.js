// Welcome page opened once by the service worker (install, and the first
// update that brings the reverse trial). Says PRO is on and what to do first.
"use strict";

(async () => {
  const BRAND = globalThis.EXT_BRAND;
  const T = globalThis.MST_I18N.t;
  document.title = `${BRAND.name} — ${T("welcomeTitle")}`;
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
  share.textContent = T("btnShare");
  share.href = `https://wa.me/?text=${encodeURIComponent(T("shareText", [BRAND.shareUrl("welcome")]))}`;
  share.addEventListener("click", () => globalThis.MST_GATE.track("click:share"));
  document.getElementById("note").textContent = T("welcomeNote");
  globalThis.MST_GATE.track("seen:welcome");
})();
