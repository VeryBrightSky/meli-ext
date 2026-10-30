// Pure logic for the private analytics dashboard (index.html inlines this
// file verbatim, minus the `export ` keywords: run
// `node tools/analytics/sync-lib.mjs` after editing; a unit test fails if the
// page and this file ever drift apart). No DOM, no network, no secrets.
//
// The input is the single jsonb returned by public.netio_report(); see
// supabase.sql for the exact shape.

export const FUNNEL_STEPS = [
  { key: "installed", label: "Installed" },
  { key: "active", label: "Opened the product (active day)" },
  { key: "card_seen", label: "Saw the card on a listing" },
  { key: "cost_entered", label: "Entered a product cost" },
  { key: "target_price_used", label: "Used the target price" },
  { key: "paywall_seen", label: "Saw a PRO paywall" },
  { key: "checkout_click", label: "Clicked buy" },
  { key: "paid_detected", label: "Paid" }
];

export const SMALL_SAMPLE = 100;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// Wilson score interval for k successes out of n (default 95%).
export function wilson(k, n, z = 1.96) {
  k = num(k);
  n = num(n);
  if (!(n > 0) || k < 0 || k > n) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export const fmtPct = (x, digits = 0) => `${(x * 100).toFixed(digits)}%`;

// "34% (95% CI 22% to 48%)" or "n/a" when there is no denominator.
export function rateText(k, n) {
  const w = wilson(k, n);
  if (!w) return "n/a";
  return `${fmtPct(w.p)} (95% CI ${fmtPct(w.lo)} to ${fmtPct(w.hi)})`;
}

// Fill every field the page reads, so a missing key never throws.
export function normalizeReport(raw) {
  const r = obj(raw);
  const funnel = (f) => {
    const o = obj(f);
    return Object.fromEntries(FUNNEL_STEPS.map((s) => [s.key, num(o[s.key])]));
  };
  const list = (v) => arr(v).map((x) => ({ k: String(x?.k ?? "?"), n: num(x?.n), events: num(x?.events) }));
  const diag = obj(r.diag);
  const summary = obj(r.summary);
  const unin = obj(r.uninstall);
  const shares = obj(r.shares);
  return {
    sample: r.sample === true,
    sinceDays: num(r.since_days) || 90,
    generatedAt: typeof r.generated_at === "string" ? r.generated_at : null,
    installsPerDay: arr(r.installs_per_day).map((x) => ({ d: String(x?.d ?? ""), n: num(x?.n) })),
    funnel: funnel(r.funnel),
    funnelNew: funnel(r.funnel_new),
    paywallByReason: list(r.paywall_by_reason),
    paywallByKey: list(r.paywall_by_key),
    checkoutByPlan: list(r.checkout_by_plan),
    checkoutByFrom: list(r.checkout_by_from),
    retention: Object.fromEntries(
      ["d0", "d1", "d3", "d7", "d14", "d30"].map((k) => [
        k,
        { eligible: num(obj(obj(r.retention)[k]).eligible), retained: num(obj(obj(r.retention)[k]).retained) }
      ])
    ),
    trialState: list(r.trial_state),
    platform: list(r.platform),
    lang: list(r.lang),
    extVersion: list(r.ext_version),
    chromeMajor: list(r.chrome_major),
    errors: arr(r.errors).map((x) => ({ k: String(x?.k ?? "?"), n: num(x?.n), installs: num(x?.installs) })),
    diag: {
      expired: num(diag.expired),
      expiredNoCost: num(diag.expired_no_cost),
      costNoPaywall: num(diag.cost_no_paywall),
      paywallNoCheckout: num(diag.paywall_no_checkout),
      checkoutNoPaid: num(diag.checkout_no_paid),
      checkoutFailedInstalls: num(diag.checkout_failed_installs),
      checkoutFailedEvents: num(diag.checkout_failed_events),
      cardNoCost: num(diag.card_no_cost)
    },
    summary: {
      cards: num(summary.cards),
      products: num(summary.products),
      searches: num(summary.searches),
      costEntries: num(summary.cost_entries),
      calcs: num(summary.calcs),
      anchorsMissing: num(summary.anchors_missing),
      days: num(summary.days)
    },
    uninstall: {
      n: num(unin.n),
      medianDays: unin.median_days == null ? null : num(unin.median_days),
      reasons: list(unin.reasons)
    },
    shares: {
      shareClicks: num(shares.share_click),
      reviewShown: num(shares.review_shown),
      reviewClicked: num(shares.review_clicked),
      reviewDismissed: num(shares.review_dismissed)
    }
  };
}

// Step-by-step view of a funnel: reach, step conversion vs the previous
// step, conversion vs installs, each with its Wilson interval. A step that
// exceeds the previous one (events lost, or installs from before analytics
// existed) is flagged instead of showing a negative drop.
export function funnelRows(funnel) {
  const rows = [];
  const top = num(funnel.installed);
  FUNNEL_STEPS.forEach((s, i) => {
    const n = num(funnel[s.key]);
    const prev = i === 0 ? null : num(funnel[FUNNEL_STEPS[i - 1].key]);
    const stepOk = prev !== null && prev > 0 && n <= prev;
    const stepRate = stepOk ? wilson(n, prev) : null;
    const overall = top > 0 && n <= top ? wilson(n, top) : null;
    rows.push({
      key: s.key,
      label: s.label,
      n,
      prev,
      stepRate,
      drop: stepOk ? 1 - n / prev : null,
      overall,
      anomaly: prev !== null && n > prev
    });
  });
  return rows;
}

export const isSmallSample = (installs) => num(installs) < SMALL_SAMPLE;

const share = (list, test) => {
  const total = list.reduce((a, x) => a + x.n, 0);
  const hit = list.filter(test).reduce((a, x) => a + x.n, 0);
  return { hit, total };
};

// Rule-based findings, plain English, each with the numbers behind it.
// Level: high (act now), medium (look into it), info (context).
export function diagnose(report) {
  const R = report;
  const F = R.funnel;
  const out = [];
  const add = (id, level, text, numbers) => out.push({ id, level, text, numbers });
  const installs = F.installed;

  if (installs === 0) {
    add("no_data", "info", "No installs in this range yet. Nothing to diagnose.", "installs 0");
    return out;
  }
  if (isSmallSample(installs)) {
    add(
      "low_sample", "info",
      "Too few users to trust any percentage here. Read the numbers as stories about individual people, not rates.",
      `${installs} installs, need about ${SMALL_SAMPLE}+ for stable rates`
    );
  }

  const lang = share(R.lang, (x) => x.k !== "es");
  if (lang.total > 0 && lang.hit / lang.total >= 0.25) {
    add(
      "non_es", "medium",
      "A big share of installs use a browser language other than Spanish. They are probably not Mexican sellers.",
      `${lang.hit} of ${lang.total} installs (${rateText(lang.hit, lang.total)})`
    );
  }
  const cros = share(R.platform, (x) => x.k === "cros");
  if (cros.total > 0 && cros.hit / cros.total >= 0.15) {
    add(
      "chromebooks", "medium",
      "Many installs are on ChromeOS. That is often school Chromebooks, not people selling on Mercado Libre.",
      `${cros.hit} of ${cros.total} installs (${rateText(cros.hit, cros.total)})`
    );
  }

  const noCard = installs - F.card_seen;
  if (installs >= 5 && noCard / installs >= 0.3) {
    add(
      "no_card", noCard / installs >= 0.5 ? "high" : "medium",
      "Many installs never saw the card. Either they never opened a Mercado Libre Mexico product page, or the card did not show up.",
      `${noCard} of ${installs} installs saw no card (${rateText(noCard, installs)})`
    );
  }

  const am = R.summary.anchorsMissing;
  const cardsAll = R.summary.cards + am;
  if (cardsAll >= 10 && am / cardsAll >= 0.1) {
    add(
      "anchors", am / cardsAll >= 0.25 ? "high" : "medium",
      "On a noticeable share of product pages the card could not find the price block. The page layout may have changed.",
      `${am} of ${cardsAll} product pages (${rateText(am, cardsAll)})`
    );
  }

  const cardNoCost = Math.max(0, F.card_seen - F.cost_entered);
  if (F.card_seen >= 5 && cardNoCost / F.card_seen >= 0.5) {
    add(
      "card_no_cost", "high",
      "People saw the card but did not type a product cost. The card may not make it obvious what to do next, or the net number alone was enough for them.",
      `${cardNoCost} of ${F.card_seen} card viewers never entered a cost (${rateText(cardNoCost, F.card_seen)})`
    );
  }

  const trialNow = R.trialState.find((x) => x.k === "trial")?.n ?? 0;
  const cnp = R.diag.costNoPaywall;
  if (F.cost_entered >= 5 && cnp / F.cost_entered >= 0.4) {
    add(
      "cost_no_paywall", "info",
      "Many people who entered a cost never saw a paywall. That is expected while the 7-day trial is running, because PRO is unlocked then.",
      `${cnp} of ${F.cost_entered} cost-entering installs (${rateText(cnp, F.cost_entered)}); ${trialNow} installs are still in trial`
    );
  }

  const pnc = R.diag.paywallNoCheckout;
  if (F.paywall_seen >= 5 && pnc / F.paywall_seen >= 0.8) {
    add(
      "paywall_no_checkout", "high",
      "Almost everyone who saw a paywall did not click buy. The offer, the price, or the timing is not landing.",
      `${pnc} of ${F.paywall_seen} installs that saw a paywall (${rateText(pnc, F.paywall_seen)})`
    );
  }

  const cf = R.diag.checkoutFailedInstalls;
  if (cf > 0) {
    add(
      "checkout_failed", F.checkout_click > 0 && cf / F.checkout_click >= 0.2 ? "high" : "medium",
      "Some people clicked buy but the checkout page could not open (payment provider unreachable or blocked).",
      `${cf} installs hit a checkout failure (${R.diag.checkoutFailedEvents} events) out of ${F.checkout_click} that clicked buy`
    );
  }

  const cnpaid = R.diag.checkoutNoPaid;
  if (F.checkout_click >= 3 && cnpaid / F.checkout_click >= 0.7) {
    add(
      "checkout_no_paid", "medium",
      "Most people who clicked buy have not paid. They may have left on the payment page, or the payment was not detected.",
      `${cnpaid} of ${F.checkout_click} installs that clicked buy (${rateText(cnpaid, F.checkout_click)})`
    );
  }

  if (R.diag.expired >= 3 && R.diag.expiredNoCost / R.diag.expired >= 0.5) {
    add(
      "expired_no_engage", "high",
      "Trials ended for people who never really used the product (no cost ever entered). They never got the value, so a paywall cannot convert them.",
      `${R.diag.expiredNoCost} of ${R.diag.expired} expired trials never entered a cost (${rateText(R.diag.expiredNoCost, R.diag.expired)})`
    );
  }

  for (const e of R.errors) {
    if (e.installs >= 3) {
      add(
        `error_${e.k}`, "medium",
        `Error "${e.k}" is hitting several installs.`,
        `${e.installs} installs, ${e.n} events`
      );
    }
  }

  if (out.every((f) => f.level === "info") && installs >= SMALL_SAMPLE) {
    add("clean", "info", "No rule fired. Nothing stands out as broken.", `${installs} installs`);
  }
  return out;
}

const line = (k, v) => `${k}: ${v}`;
const listText = (l) => (l.length ? l.map((x) => `${x.k} ${x.n}`).join(", ") : "none");

// Compact plain-text report: every number, no secrets, safe to paste anywhere.
export function reportText(report, { cohort = "all" } = {}) {
  const R = report;
  const F = cohort === "new" ? R.funnelNew : R.funnel;
  const rows = funnelRows(F);
  const L = [];
  L.push(`NETIO ANALYTICS REPORT${R.sample ? " (SAMPLE DATA, NOT REAL)" : ""}`);
  L.push(`range: last ${R.sinceDays} days${R.generatedAt ? `, generated ${R.generatedAt}` : ""}, cohort: ${cohort === "new" ? "new installs only" : "all installs"}`);
  if (isSmallSample(F.installed)) L.push(`WARNING: only ${F.installed} installs, too few to trust percentages.`);
  L.push("");
  L.push("FUNNEL (distinct installs; step conversion vs previous step; Wilson 95% CI)");
  for (const r of rows) {
    const step = r.stepRate ? ` | step ${fmtPct(r.stepRate.p)} [${fmtPct(r.stepRate.lo)}-${fmtPct(r.stepRate.hi)}]` : r.anomaly ? " | step n/a (more than previous step)" : "";
    const all = r.overall && r.key !== "installed" ? ` | of installs ${fmtPct(r.overall.p)} [${fmtPct(r.overall.lo)}-${fmtPct(r.overall.hi)}]` : "";
    L.push(`${r.label}: ${r.n}${step}${all}`);
  }
  L.push("");
  L.push("RETENTION (installs active on or after day N / eligible)");
  L.push(
    Object.entries(R.retention).map(([k, v]) => `${k.toUpperCase()} ${v.retained}/${v.eligible}`).join(", ")
  );
  L.push("");
  L.push(line("paywall seen by reason (installs)", listText(R.paywallByReason)));
  L.push(line("paywall seen by upsell key (installs)", listText(R.paywallByKey)));
  L.push(line("checkout clicks by plan (installs)", listText(R.checkoutByPlan)));
  L.push(line("checkout clicks by source (installs)", listText(R.checkoutByFrom)));
  L.push(line("checkout failures", `${R.diag.checkoutFailedInstalls} installs, ${R.diag.checkoutFailedEvents} events`));
  L.push("");
  L.push(line("trial state now (installs)", listText(R.trialState)));
  L.push(line("platform", listText(R.platform)));
  L.push(line("language", listText(R.lang)));
  L.push(line("extension version", listText(R.extVersion)));
  L.push(line("chrome major", listText(R.chromeMajor)));
  L.push("");
  const s = R.summary;
  L.push(
    `DAILY COUNTERS (sums): cards ${s.cards}, distinct products/day ${s.products}, searches ${s.searches}, cost entries ${s.costEntries}, calcs ${s.calcs}, anchors missing ${s.anchorsMissing} (${s.cards + s.anchorsMissing > 0 ? fmtPct(s.anchorsMissing / (s.cards + s.anchorsMissing), 1) : "n/a"} of product pages)`
  );
  L.push(line("errors (installs/events)", R.errors.length ? R.errors.map((e) => `${e.k} ${e.installs}/${e.n}`).join(", ") : "none"));
  L.push(
    line(
      "uninstall survey",
      `${R.uninstall.n} answers; median days used ${R.uninstall.medianDays ?? "n/a"}; reasons ${listText(R.uninstall.reasons)}`
    )
  );
  L.push(
    line("shares and reviews", `share clicks ${R.shares.shareClicks}, review asks shown ${R.shares.reviewShown}, clicked ${R.shares.reviewClicked}, dismissed ${R.shares.reviewDismissed}`)
  );
  L.push("");
  L.push("DIAGNOSIS");
  const findings = diagnose({ ...R, funnel: F });
  for (const f of findings) L.push(`- [${f.level}] ${f.text} (${f.numbers})`);
  return L.join("\n");
}

// Clearly synthetic data so the layout can be reviewed before real data
// exists. Deterministic. The page also shows a SAMPLE DATA watermark.
export function demoReport() {
  const funnel = { installed: 142, active: 118, card_seen: 77, cost_entered: 31, target_price_used: 24, paywall_seen: 19, checkout_click: 5, paid_detected: 2 };
  return {
    sample: true,
    since_days: 30,
    generated_at: "SAMPLE",
    installs_per_day: Array.from({ length: 14 }, (_, i) => ({ d: `2026-10-${String(17 + i).padStart(2, "0")}`, n: [3, 5, 4, 8, 6, 2, 3, 7, 9, 5, 4, 6, 8, 5][i] })),
    funnel,
    funnel_new: { ...funnel, installed: 120, active: 104, card_seen: 70, cost_entered: 28, target_price_used: 22, paywall_seen: 17, checkout_click: 5, paid_detected: 2 },
    paywall_by_reason: [{ k: "teaser", n: 17, events: 22 }, { k: "alert", n: 6, events: 8 }, { k: "upsell", n: 9, events: 14 }, { k: "expired-banner", n: 4, events: 4 }, { k: "radar", n: 3, events: 3 }],
    paywall_by_key: [{ k: "target", n: 17, events: 22 }, { k: "loss", n: 6, events: 8 }, { k: "msi", n: 4, events: 5 }, { k: "sweetspot", n: 3, events: 3 }],
    checkout_by_plan: [{ k: "pro-monthly", n: 4, events: 5 }, { k: "pro-yearly", n: 1, events: 1 }],
    checkout_by_from: [{ k: "upsell", n: 3, events: 4 }, { k: "expired-banner", n: 2, events: 2 }],
    retention: { d0: { eligible: 120, retained: 104 }, d1: { eligible: 111, retained: 48 }, d3: { eligible: 98, retained: 33 }, d7: { eligible: 80, retained: 21 }, d14: { eligible: 52, retained: 11 }, d30: { eligible: 9, retained: 1 } },
    trial_state: [{ k: "trial", n: 44 }, { k: "expired", n: 58 }, { k: "free", n: 3 }, { k: "paid", n: 2 }],
    platform: [{ k: "win", n: 96 }, { k: "mac", n: 14 }, { k: "cros", n: 27 }, { k: "android", n: 0 }, { k: "other", n: 5 }],
    lang: [{ k: "es", n: 101 }, { k: "en", n: 38 }, { k: "pt", n: 3 }],
    ext_version: [{ k: "1.5.0", n: 120 }, { k: "1.4.3", n: 22 }],
    chrome_major: [{ k: "141", n: 70 }, { k: "140", n: 41 }, { k: "139", n: 31 }],
    errors: [{ k: "no_anchor", n: 31, installs: 9 }, { k: "no_price", n: 6, installs: 4 }, { k: "render_fail", n: 1, installs: 1 }],
    diag: { expired: 58, expired_no_cost: 39, cost_no_paywall: 12, paywall_no_checkout: 14, checkout_no_paid: 3, checkout_failed_installs: 1, checkout_failed_events: 2, card_no_cost: 46 },
    summary: { cards: 412, products: 196, searches: 88, cost_entries: 133, calcs: 301, anchors_missing: 57, days: 30 },
    uninstall: { n: 11, median_days: 2, reasons: [{ k: "no_card", n: 4 }, { k: "numbers", n: 2 }, { k: "price", n: 2 }, { k: "not_mx", n: 1 }, { k: "confused", n: 1 }, { k: "other", n: 1 }] },
    shares: { share_click: 6, review_shown: 9, review_clicked: 2, review_dismissed: 5 }
  };
}
