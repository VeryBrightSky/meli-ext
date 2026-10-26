// Extension pages (dashboard, options, welcome) are not content scripts, so
// the service worker's "proChanged" broadcast never reaches them. ExtPay
// writes its user record to storage.sync on every fetch; reload ONLY on the
// transition unpaid → paid (paidAt appears), never on a routine re-write, so
// a page can't loop.
"use strict";

(() => {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes.extensionpay_user) return;
      const before = changes.extensionpay_user.oldValue;
      const after = changes.extensionpay_user.newValue;
      if (after?.paidAt && !before?.paidAt) location.reload();
    });
  } catch {
    // not in an extension context
  }
})();
