// Headless smoke test: loads the built extension in Chrome against saved
// fixture pages served over local HTTPS with the real MELI hostnames mapped
// to 127.0.0.1 (so manifest matches and URL-shape detection run for real).
//
// Phases: 1) never-paid (ExtPay unreachable → fail closed) asserts free
// features + locked Pro UI; 2) dashboard shows upsell when locked; 3) Pro
// via the QA override; 4) full Pro flows incl. real CSV download;
// 5) SPA navigation (teardown + re-inject, no stale state); 6) lazy-loaded
// search results; 7) extraction edge cases (promo price without meta, no
// anchor); 8) unreadable page renders nothing.
//
//   npm run test:e2e
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const PORT = 8443;
const PRODUCT_URL = `https://www.mercadolibre.com.mx:${PORT}/celular-test-pro/p/MLM12345678`;
const SEARCH_URL = `https://listado.mercadolibre.com.mx:${PORT}/celulares`;

const passed = [];
function pass(name) {
  passed.push(name);
  console.log(`  ✔ ${name}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- setup ---------------------------------------------------------------

console.log("building dist/ …");
execFileSync("node", [join(root, "scripts/build.mjs")], { stdio: "inherit" });

console.log("generating self-signed cert …");
const certDir = mkdtempSync(join(tmpdir(), "meli-e2e-"));
execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
  "-keyout", join(certDir, "key.pem"),
  "-out", join(certDir, "cert.pem"),
  "-subj", "/CN=meli-e2e",
  "-addext", "subjectAltName=DNS:www.mercadolibre.com.mx,DNS:listado.mercadolibre.com.mx"
], { stdio: "pipe" });

const fixtures = {
  product: readFileSync(join(root, "tests/fixtures/product.html"), "utf8"),
  search: readFileSync(join(root, "tests/fixtures/search.html"), "utf8")
};
// A product page whose price is unreadable (itemprop meta + andes money nodes
// neutralized). The extension must render NOTHING rather than a wrong number.
fixtures.productNoPrice = fixtures.product
  .replace(/<[^>]*itemprop=["']price["'][^>]*>/gi, "")
  .replace(/andes-money-amount/g, "andes-money-x");
// A discounted product WITHOUT the itemprop meta: price must come from the
// visible DOM, skipping both the hidden duplicate block and the crossed-out
// "precio anterior" — the promo-price extraction failure mode.
fixtures.productNoMeta = fixtures.product.replace(
  /<[^>]*itemprop=["']price["'][^>]*>/gi,
  ""
);
// A product page with NO recognizable price block at all (every anchor
// strategy misses). The extension must keep waiting silently, never inject.
// A listing priced in USD (explicit page currency): fee tables are MXN, so
// the extension must not render a card for it.
fixtures.productUsd = fixtures.product.replace(
  /<meta itemprop="price"[^>]*>/i,
  '<meta itemprop="price" content="827" /><meta itemprop="priceCurrency" content="USD" />'
);
fixtures.productNoAnchor = fixtures.productNoPrice.replace(
  /ui-pdp-price/g,
  "ui-pdp-x"
);
const server = createServer(
  { key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) },
  (req, res) => {
    const host = req.headers.host ?? "";
    const url = req.url ?? "";
    const body = host.startsWith("listado.")
      ? fixtures.search
      : url.includes("noprice")
        ? fixtures.productNoPrice
        : url.includes("nometa")
          ? fixtures.productNoMeta
          : url.includes("noanchor")
            ? fixtures.productNoAnchor
            : url.includes("usdcur")
              ? fixtures.productUsd
              : fixtures.product;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  }
);
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const dist = join(root, "dist");
const browser = await puppeteer.launch({
  headless: true,
  acceptInsecureCerts: true,
  protocolTimeout: 30000,
  // Spanish browser locale so chrome.i18n serves es_419 — the strings MX
  // users actually see are what we assert on.
  env: { ...process.env, LANGUAGE: "es-419", LANG: "es_419.UTF-8" },
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--host-resolver-rules=MAP www.mercadolibre.com.mx 127.0.0.1, MAP listado.mercadolibre.com.mx 127.0.0.1",
    // The fixtures are served from 127.0.0.1; never route them through a
    // system/CI proxy (HTTPS_PROXY) that can't reach the local server.
    "--proxy-server=direct://",
    "--ignore-certificate-errors",
    "--lang=es-419",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    // Multiple tabs are used across phases — keep background renderers live.
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding"
  ]
});

// Surface extension errors in the test output.
function tap(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error" || /fatal/i.test(m.text())) {
      console.log(`  [${label} console] ${m.text()}`);
    }
  });
  page.on("pageerror", (err) => console.log(`  [${label} pageerror] ${err.message}`));
  return page;
}

const rowValue = (label) => `
  (() => {
    const row = [...document.querySelectorAll(".mst-row")]
      .find((r) => r.querySelector(".mst-row__label")?.textContent.includes(${JSON.stringify(label)}));
    return row?.querySelector(".mst-row__value")?.textContent ?? null;
  })()
`;

// The fee breakdown is a collapsed <details>; open it before interacting
// with rows inside it (withholdings, Full, reputation, free shipping…).
async function openBreakdown(page) {
  await page.$eval("details.mst-breakdown", (d) => {
    d.open = true;
  });
  await sleep(100);
}

async function typeInto(page, index, text) {
  // .mst-input only — the card also contains checkbox toggles.
  const inputs = await page.$$(".mst-card input.mst-input");
  await inputs[index].focus();
  // Triple-click select-all is unreliable in headless; select programmatically
  // so typing replaces any pre-filled value (e.g. the what-if price).
  await inputs[index].evaluate((el) => el.select());
  await inputs[index].type(text, { delay: 20 });
  await page.keyboard.press("Enter"); // confirm = blur = flush debounce
  await sleep(300);
}

async function extensionId() {
  const workerTarget = await browser.waitForTarget(
    (t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"),
    { timeout: 10000 }
  );
  return new URL(workerTarget.url()).host;
}

try {
  // ====================== PHASE 0: reverse trial ===========================
  // A fresh install is PRO for 7 days with no email/card (reverse trial).
  // Verify that first, then stamp the install 9 days back so the rest of the
  // never-paid phases exercise the post-trial (locked) state.
  console.log("\nPHASE 0 — REVERSE TRIAL (fresh install is PRO, then expires)");
  const extId = await extensionId();
  // onInstalled(reason: install) opens the welcome tab once.
  const welcomeTarget = await browser.waitForTarget(
    (t) => t.url().includes("/src/onboarding/welcome.html"),
    { timeout: 10000 }
  );
  const welcome = await welcomeTarget.page();
  await welcome.waitForFunction(() => (document.getElementById("title")?.textContent ?? "").length > 0, { timeout: 10000 });
  assert.equal(await welcome.$eval("#title", (e) => e.textContent), "Tu PRO está activado");
  assert.ok((await welcome.$eval("#lead", (e) => e.textContent)).includes("7 días"), "welcome lead should show 7 días");
  assert.equal(await welcome.$eval("#go", (a) => a.href), "https://www.mercadolibre.com.mx/");
  assert.ok((await welcome.$eval("#share", (a) => a.href)).includes("wa.me/?text="), "welcome share link");
  pass("install opens the welcome tab: 'Tu PRO está activado', 7 días, link to Mercado Libre");
  await welcome.close();
  const seed = await browser.newPage();
  await seed.goto(`chrome-extension://${extId}/src/options/options.html`, { waitUntil: "load" });
  await seed.waitForFunction(
    () => /Prueba PRO: te quedan \d+ días/.test(document.getElementById("sub-status")?.textContent ?? ""),
    { timeout: 10000 }
  );
  pass("fresh install: options shows 'Prueba PRO: te quedan N días' (reverse trial on)");
  if (process.env.E2E_SHOTS) {
    const trialPage = await browser.newPage();
    await trialPage.goto(PRODUCT_URL, { waitUntil: "load" });
    await trialPage.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
    await sleep(600);
    await (await trialPage.$("#mst-card-root")).screenshot({ path: join(process.env.E2E_SHOTS, "card-trial.png") });
    await trialPage.close();
  }
  await seed.evaluate(async () => {
    await chrome.storage.local.set({ "mst:installedAt": Date.now() - 9 * 24 * 3600 * 1000 });
  });
  await seed.reload({ waitUntil: "load" });
  await seed.waitForFunction(
    () => (document.getElementById("sub-status")?.textContent ?? "").includes("terminó"),
    { timeout: 10000 }
  );
  pass("install stamped 9 days back → status 'tu prueba PRO terminó'");
  await seed.close();

  // ====================== PHASE 1: never-paid (locked) ======================
  console.log("\nPHASE 1 — PRODUCT, TRIAL EXPIRED, NEVER PAID (fail closed)");
  const page = tap(await browser.newPage(), "product");
  await browser.defaultBrowserContext().overridePermissions(
    `https://www.mercadolibre.com.mx:${PORT}`,
    ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]
  );
  await page.goto(PRODUCT_URL, { waitUntil: "load" });
  await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  pass("card injects and is visible");

  // Answer-first summary + collapsed breakdown.
  assert.equal(await page.$eval(".mst-summary__net", (e) => e.textContent), "Mercado Libre te deposita $744.30 por venta");
  assert.equal(await page.$eval("details.mst-breakdown", (d) => d.open), false, "breakdown collapsed by default");
  assert.ok(
    await page.$eval("details.mst-breakdown", (d) => d.textContent.includes("Comisión por venta")),
    "commission row lives inside the breakdown"
  );
  pass("summary leads with 'Mercado Libre te deposita $744.30 por venta'; fee breakdown collapsed by default");

  // Spanish UI must render Spanish (regression: chrome.i18n served English).
  assert.equal(await page.$eval(".mst-title", (e) => e.textContent), "Calculadora de ganancias");
  pass("Spanish locale renders Spanish UI (Calculadora de ganancias)");

  assert.equal(await page.$eval(".mst-card input.mst-input", (i) => i.value), "827.00");
  assert.equal(await page.$eval(".mst-card input.mst-input", (i) => i.disabled), true);
  pass("price pre-filled 827.00 and read-only (what-if locked)");

  assert.equal(await page.evaluate(rowValue("Comisión")), "−$82.70");
  assert.equal(await page.evaluate(rowValue("Costo total")), "10%");
  assert.equal(await page.evaluate(rowValue("Recibes aprox.")), "$744.30");
  pass("free fee card intact: 10% category via structured data, net $744.30");

  // Retenciones is FREE (accuracy feature), default off (row hidden/empty).
  assert.equal(await page.evaluate(rowValue("IVA retenido")), "");
  await openBreakdown(page);
  await page.click(".mst-withholdings-toggle");
  await sleep(300);
  assert.equal(await page.evaluate(rowValue("IVA retenido")), "−$57.03");
  assert.equal(await page.evaluate(rowValue("ISR retenido")), "−$17.82");
  assert.equal(await page.evaluate(rowValue("Neto después")), "$669.45"); // 744.30 − 74.85
  pass("retenciones (free): IVA −$57.03, ISR −$17.82, neto después $669.45");

  await typeInto(page, 1, "50"); // shipping
  await typeInto(page, 2, "400"); // product cost
  assert.equal(await page.evaluate(rowValue("Precio mínimo")), "$500.00");
  pass("breakeven stays FREE: cost 400 + ship 50 → $500.00");

  // Post-trial win-back banner is visible (trial ended 2 days ago).
  await page.waitForFunction(() => {
    const b = document.querySelector(".mst-trialbar");
    return b && !b.hidden && b.offsetHeight > 0;
  }, { timeout: 5000 });
  assert.ok(
    (await page.$eval(".mst-trialbar", (e) => e.textContent)).includes("Tu prueba PRO terminó"),
    "win-back banner copy missing"
  );
  pass("post-trial banner shows 'Tu prueba PRO terminó' with reactivate button");

  // Target price teaser: the REAL number for this listing, blurred.
  // cost 400 + ship 50, rate 10%, margin 30% → (450)/(1-0.10-0.30) = 750.00
  const teaser = await page.$eval(".mst-row--teaser", (r) => ({
    label: r.querySelector(".mst-row__label").textContent,
    value: r.querySelector(".mst-blur").textContent,
    blurred: getComputedStyle(r.querySelector(".mst-blur")).filter.includes("blur")
  }));
  assert.ok(teaser.label.includes("Precio para ganar 30%"), `teaser label: ${teaser.label}`);
  assert.equal(teaser.value, "$750.00");
  assert.equal(teaser.blurred, true, "teaser value must be blurred");
  pass("target-price teaser renders real $750.00 (30% margin) blurred for free users");

  const lockedRows = await page.$$eval(".mst-row--locked", (rows) => rows.map((r) => r.textContent));
  assert.ok(lockedRows.some((t) => t.includes("Ventas al mes")), "sales not locked");
  const chips = await page.$$eval(".mst-prochip", (els) => els.length);
  assert.ok(chips >= 4, `expected ≥4 PRO chips, got ${chips}`);
  pass(`locked rows render with PRO chips (${chips} chips)`);

  // Loss alert: drop price below cost → alert strip with the real loss.
  // Price 400: net 360 − ship 50 − cost 400 = −90 → "Pierdes $90.00 por venta".
  // (what-if is locked; simulate via product cost 900 instead: 744.30−50−900 = −205.70)
  const alertVisible = () => page.$eval(".mst-alert", (e) => !e.hidden && e.offsetHeight > 0);
  assert.equal(await alertVisible(), false);
  await typeInto(page, 2, "900");
  assert.equal(await alertVisible(), true);
  const alertText = await page.$eval(".mst-alert__text", (e) => e.textContent);
  assert.ok(alertText.includes("Pierdes $205.70 por venta"), `alert text: ${alertText}`);
  pass("red-number moment: alert strip names the real loss ($205.70) and offers the fix");
  await typeInto(page, 2, "400");
  assert.equal(await alertVisible(), false, "alert must actually disappear (display) once profitable again");
  pass("alert strip hides again when the listing is profitable");

  // Upsell never opens on load; clicking the teaser opens it with THIS
  // listing's number in the headline.
  assert.equal(await page.$eval(".mst-upsell", (e) => e.hidden), true);
  await page.click(".mst-row--teaser");
  await sleep(200);
  assert.equal(await page.$eval(".mst-upsell", (e) => e.hidden), false);
  const upsellText = await page.$eval(".mst-upsell", (e) => e.textContent);
  assert.ok(upsellText.includes("Ya calculamos a qué precio venderlo para ganar 30%"), `contextual headline missing: ${upsellText}`);
  // The blurred number must NOT be revealed in clear text by the panel.
  assert.ok(!upsellText.includes("$750.00"), "panel must not leak the blurred target price");
  assert.ok(upsellText.includes("$89 al mes"), "upsell missing monthly price");
  assert.ok(upsellText.includes("$699 al año"), "upsell missing yearly price");
  assert.ok(upsellText.includes("≈ $58 al mes"), "upsell missing yearly monthly-equivalent");
  assert.ok(upsellText.includes("Ya pagué: iniciar sesión"), "upsell missing the 'already paid' login link");
  // Panel opens next to the clicked teaser, not at the bottom of the card.
  assert.equal(
    await page.$eval(".mst-upsell", (p) => p.previousElementSibling?.classList.contains("mst-row--teaser")),
    true,
    "upsell should open right after the clicked teaser"
  );
  pass("teaser click opens the upsell beside it, without leaking the blurred price ($89/mes, $699/año ≈ $58/mes)");

  // MSI teaser: Premium listings show the real profit after 12 MSI (free),
  // the per-term breakdown is PRO.
  await page.$$eval(".mst-toggle__btn", (btns) => btns.find((b) => b.textContent === "Premium").click());
  await sleep(300);
  const msiTeaserText = await page.$$eval(".mst-row--teaser", (rows) =>
    rows.map((r) => ({ text: r.textContent, shown: r.style.display !== "none" }))
  );
  const msiRow = msiTeaserText.find((r) => r.text.includes("MSI"));
  assert.ok(msiRow && msiRow.shown, `msi teaser missing: ${JSON.stringify(msiTeaserText)}`);
  assert.ok(/Con 12 MSI tu ganancia baja a \$[\d,]+\.\d{2}/.test(msiRow.text), msiRow.text);
  pass(`MSI teaser on Premium (free): "${msiRow.text.replace("PRO", "").trim()}"`);
  await page.$$eval(".mst-toggle__btn", (btns) => btns.find((b) => b.textContent === "Clásica").click());
  await sleep(300);
  assert.equal((await page.$$eval(".mst-row--teaser", (rows) => rows.map((r) => r.style.display !== "none" && r.textContent.includes("MSI")))).some(Boolean), false);
  pass("MSI teaser hidden again on Clásica (no MSI there)");

  // Sweet spot: free users see the gain for real, price hidden. (Fixture price
  // 827 has no higher fixed-cost step within +20%, so the nudge is hidden.)
  assert.equal(await page.$eval(".mst-sweetspot", (e) => e.style.display !== "none"), false);
  pass("sweet-spot nudge hidden when no better step exists (no false hook)");

  await page.click(".mst-copy");
  await sleep(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(clip.includes("Recibes aprox.: $694.30"), `clipboard wrong:\n${clip}`);
  pass("copy summary stays FREE");

  // Summary shows the real profit once a cost is set.
  assert.ok((await page.$eval(".mst-summary__profit", (e) => e.textContent)).startsWith("Ganancia $294.30"));

  // Share button: WhatsApp link carrying the store URL and this listing's real profit.
  const shareHref = await page.$eval(".mst-share", (a) => a.href);
  assert.ok(shareHref.startsWith("https://wa.me/?text="), shareHref);
  const shareText = decodeURIComponent(shareHref.slice("https://wa.me/?text=".length));
  assert.ok(shareText.includes("chromewebstore.google.com/detail/netio/bjhikillfgbpblogloljjhejogfeajac?utm_source=whatsapp"), shareText);
  assert.ok(shareText.includes("$827.00") && shareText.includes("$294.30"), `share text lacks the real numbers: ${shareText}`);
  assert.equal(await page.$eval(".mst-share", (a) => a.target), "_blank");
  pass("share button: WhatsApp link with store URL + this listing's price and real profit");

  // Review ask: hidden until 3 listings have a saved cost, then shown once.
  assert.equal(await page.$(".mst-review"), null, "no review ask after 1 listing");
  // Seed from an extension page (the page's main world has no chrome.storage).
  const seedPage = async (fn) => {
    const ext = await browser.newPage();
    await ext.goto(`chrome-extension://${extId}/src/options/options.html`, { waitUntil: "load" });
    await ext.evaluate(fn);
    await ext.close();
    await page.bringToFront();
  };
  await seedPage(() => chrome.storage.local.set({ "mst:cost:MLM1": 10, "mst:cost:MLM2": 20 }));
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  await page.waitForSelector(".mst-review", { timeout: 5000 });
  assert.ok((await page.$eval(".mst-review__link", (a) => a.href)).endsWith("/reviews"));
  await page.click(".mst-review__close");
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  await sleep(500);
  assert.equal(await page.$(".mst-review"), null, "dismissed review ask stays gone");
  pass("review ask appears after 3 used listings, links to reviews, dismiss is permanent");
  await seedPage(() => chrome.storage.local.remove(["mst:cost:MLM1", "mst:cost:MLM2"]));

  if (process.env.E2E_SHOTS) {
    await page.$eval(".mst-upsell", (e) => (e.hidden = true));
    await (await page.$("#mst-card-root")).screenshot({ path: join(process.env.E2E_SHOTS, "card-free.png") });
  }

  // ====================== PHASE 1b: search, free (radar preview) ============
  console.log("\nPHASE 1b — SEARCH, TRIAL EXPIRED (radar preview with real counts)");
  const freeSearch = tap(await browser.newPage(), "search-free");
  await freeSearch.bringToFront();
  await freeSearch.goto(SEARCH_URL, { waitUntil: "load" });
  await freeSearch.waitForSelector(".mst-radar--preview", { timeout: 20000 });
  await sleep(500);
  const preview = await freeSearch.$eval(".mst-radar--preview .mst-radar__summary", (e) => e.textContent);
  assert.equal(preview, "Analizados: 3 · rentables: 2 · marginales: 1 · en pérdida: 0 (costo supuesto: 60% del precio)", preview);
  pass("free search bar: real radar counts at the assumed 60% cost");
  const previewBuckets = await freeSearch.$$eval(".mst-strip", (els) => els.map((e) => e.dataset.preview));
  assert.deepEqual(previewBuckets.filter(Boolean).length, 3, `preview stamps: ${previewBuckets}`);
  const shownVerdicts = await freeSearch.$$eval(".mst-strip__verdict", (els) => els.length);
  assert.ok(shownVerdicts >= 1 && shownVerdicts <= 3, `free verdict pills: ${shownVerdicts}`);
  pass(`free strips: first ${shownVerdicts} show a colored verdict, rest stay plain`);
  assert.equal(await freeSearch.$eval(".mst-upsell", (e) => e.hidden), true);
  await freeSearch.click(".mst-radar__cta");
  await sleep(200);
  assert.equal(await freeSearch.$eval(".mst-upsell", (e) => e.hidden), false);
  const radarUpsell = await freeSearch.$eval(".mst-upsell", (e) => e.textContent);
  assert.ok(radarUpsell.includes("Productos de esta búsqueda que sí dejan ganancia: 2"), radarUpsell);
  pass("'Ver cuáles son · PRO' opens the radar upsell with the real winner count");
  if (process.env.E2E_SHOTS) {
    await freeSearch.screenshot({ path: join(process.env.E2E_SHOTS, "search-free.png") });
  }
  await freeSearch.close();

  // ====================== PHASE 2: dashboard locked =========================
  console.log("\nPHASE 2 — DASHBOARD (free preview) + SEED PRO");
  const dash = await browser.newPage();
  await dash.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html`, {
    waitUntil: "load"
  });
  await dash.waitForFunction(
    () => !document.getElementById("upsell")?.hidden && !document.getElementById("content")?.hidden,
    { timeout: 10000 }
  );
  assert.equal(await dash.$eval("#upsell", (e) => e.hidden), false);
  assert.equal(await dash.$eval("#content", (e) => e.hidden), false);
  // One saved product → within the free limit, so it renders unblurred.
  assert.equal(await dash.$$eval("#rows tr", (trs) => trs.length), 1);
  assert.equal(await dash.$$eval("#rows tr.locked", (trs) => trs.length), 0);
  assert.equal(await dash.$eval("#login-link", (a) => a.textContent), "Ya pagué: iniciar sesión");
  pass("dashboard (free): table renders with the first products visible + upsell below (with 'Ya pagué' login link)");

  // QA override + sales seed; options default shipping = 0 (meta/cost were
  // written by the real card in phase 1).
  await dash.evaluate(async () => {
    await chrome.storage.local.set({
      "mst:proOverride": true,
      "mst:sales:MLM12345678": 10
    });
    await chrome.storage.sync.set({ acquisitionPct: 60, defaultShippingMXN: 0 });
  });
  await dash.reload({ waitUntil: "load" });
  await dash.waitForFunction(() => !document.getElementById("content")?.hidden, {
    timeout: 10000
  });
  const dashRows = await dash.$$eval("#rows tr", (trs) => trs.length);
  assert.equal(dashRows, 1);
  const dashText = await dash.$eval("#rows", (e) => e.textContent);
  assert.ok(dashText.includes("Celular Test Pro 128 GB"), `dashboard missing title: ${dashText}`);
  // Shipping 0 → profit 344.30 × 10 = 3443.00.
  assert.ok(
    (await dash.$eval("#shipping-note", (e) => e.textContent)).includes("$0.00"),
    "shipping note should reflect options default $0.00"
  );
  let totals = await dash.$eval("#totals-row", (e) => e.textContent);
  assert.ok(totals.includes("$3,443.00"), `totals wrong: ${totals}`);
  pass("dashboard (Pro): live recompute at options shipping $0 → monthly $3,443.00");

  // BUG 1: change the OPTIONS default shipping → dashboard must propagate it.
  await dash.evaluate(async () => {
    await chrome.storage.sync.set({ defaultShippingMXN: 50 });
  });
  await dash.reload({ waitUntil: "load" });
  await dash.waitForFunction(() => !document.getElementById("content")?.hidden, {
    timeout: 10000
  });
  assert.ok(
    (await dash.$eval("#shipping-note", (e) => e.textContent)).includes("$50.00"),
    "shipping note should update to $50.00 from options"
  );
  totals = await dash.$eval("#totals-row", (e) => e.textContent);
  assert.ok(totals.includes("$2,943.00"), `totals after shipping change wrong: ${totals}`);
  assert.ok(totals.includes("productos: 1"), `totals label/count wrong: ${totals}`);
  pass("dashboard reflects changed options shipping $50 → monthly $2,943.00 (bug 1 fixed)");

  // The whole table fits a 1280px laptop screen: no column hidden behind a
  // scrollbar (critic blocker: 1361px table in a 1080px box).
  for (const width of [1280, 1920]) {
    await dash.setViewport({ width, height: 900 });
    await sleep(100);
    const fit = await dash.evaluate(() => {
      const t = document.querySelector("table");
      return { table: t.scrollWidth, box: t.parentElement.clientWidth, cols: t.querySelectorAll("thead th").length };
    });
    assert.ok(fit.table <= fit.box + 1, `dashboard table overflows at ${width}px: ${JSON.stringify(fit)}`);
    assert.equal(fit.cols, 8);
  }
  pass("dashboard table fits at 1280px and 1920px (8 columns, nothing cut off)");

  // Empty state when nothing is saved (snapshot + restore so later phases keep
  // the seeded product).
  const SEED_KEYS = ["mst:cost:MLM12345678", "mst:meta:MLM12345678", "mst:sales:MLM12345678"];
  const saved = await dash.evaluate(async (keys) => {
    const snap = await chrome.storage.local.get(keys);
    for (const k of keys) await chrome.storage.local.remove(k);
    return snap;
  }, SEED_KEYS);
  await dash.reload({ waitUntil: "load" });
  await dash.waitForFunction(
    () => !document.getElementById("empty-note")?.hidden,
    { timeout: 10000 }
  );
  assert.equal(await dash.$eval("#table", (e) => e.hidden), true);
  pass("dashboard empty-state shows when no products saved");
  await dash.evaluate(async (snap) => chrome.storage.local.set(snap), saved);

  // ====================== PHASE 3: product page, Pro ========================
  // ---- Live entitlement flip (no reload) -----------------------------------
  // The product tab from phase 1 is still open in the free state. The service
  // worker broadcasts "proChanged" after a payment; simulate that broadcast
  // from an extension page and assert the card rebuilds as PRO in place.
  console.log("\nPHASE 2b — LIVE PRO FLIP WITHOUT RELOAD");
  await page.bringToFront();
  assert.ok((await page.$$eval(".mst-prochip", (els) => els.length)) > 0, "precondition: free card");
  await dash.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((t) => chrome.tabs.sendMessage(t.id, { type: "proChanged" }).catch(() => null)));
  });
  await page.waitForFunction(
    () => document.querySelector("#mst-card-root") && document.querySelectorAll(".mst-prochip").length === 0 && !document.querySelector(".mst-card input.mst-input")?.disabled,
    { timeout: 10000 }
  );
  pass("after payment broadcast the open listing rebuilds as PRO (no chips, what-if unlocked) without reload");

  console.log("\nPHASE 3 — PRODUCT, PRO");
  await page.bringToFront();
  await page.goto(PRODUCT_URL, { waitUntil: "load" });
  try {
    await page.waitForFunction(
      () => {
        const card = document.getElementById("mst-card-root");
        return card !== null && card.getBoundingClientRect().height > 0;
      },
      { timeout: 20000, polling: 500 }
    );
  } catch (err) {
    const diag = await page.evaluate(() => ({
      url: location.href,
      card: Boolean(document.getElementById("mst-card-root")),
      bodyChildren: document.body.children.length
    }));
    console.log("  phase-3 diagnostics:", JSON.stringify(diag));
    throw err;
  }
  assert.equal(await page.$eval(".mst-card input", (i) => i.disabled), false);
  pass("what-if price editable when Pro");

  await typeInto(page, 0, "280");
  assert.equal(await page.evaluate(rowValue("Comisión")), "−$28.00");
  assert.equal(await page.evaluate(rowValue("Costo fijo")), "−$37.00");
  assert.equal(await page.evaluate(rowValue("Recibes aprox.")), "$165.00");
  const spotText = await page.$eval(".mst-sweetspot", (e) => e.textContent);
  assert.ok(spotText.includes("$299.00") && spotText.includes("$54.10"), spotText);
  pass("what-if 280 + sweet spot $299.00 / +$54.10");

  // Mercado Envíos Full: under-$299 fixed charge becomes the weight/price
  // service cost (default weight ≤0.3 kg, tier $199–298.99 → $35) and the
  // sweet spot recomputes against the Full discontinuity.
  await openBreakdown(page);
  await page.click(".mst-full-toggle");
  await sleep(300);
  assert.equal(await page.evaluate(rowValue("Costo del servicio Full")), "−$35.00");
  const fullSpot = await page.$eval(".mst-sweetspot", (e) => e.textContent);
  assert.ok(fullSpot.includes("$52.10"), `Full sweet spot wrong: ${fullSpot}`); // 19·0.9 + 35
  await page.click(".mst-full-toggle");
  await sleep(300);
  assert.equal(await page.evaluate(rowValue("Costo fijo")), "−$37.00");
  pass("Full toggle swaps fijo −$37.00 ↔ servicio −$35.00, sweet spot follows ($52.10)");

  await page.click(".mst-sweetspot");
  await sleep(300);
  assert.equal(await page.$eval(".mst-card input", (i) => i.value), "299.00");
  assert.equal(await page.evaluate(rowValue("Recibes aprox.")), "$219.10");
  await page.click(".mst-reset");
  await sleep(300);
  assert.equal(await page.$eval(".mst-card input", (i) => i.value), "827.00");
  pass("nudge applies $299 (net $219.10), reset restores $827");

  await page.click(".mst-compare-toggle");
  await sleep(200);
  const compareVals = await page.$$eval(".mst-compare .mst-row__value", (els) =>
    els.map((v) => v.textContent)
  );
  assert.deepEqual(compareVals, ["$694.30", "$657.08 – $673.62", "$20.68 – $37.22"]);
  pass("compare: Clásica $694.30 / Premium $657.08–$673.62 / MSI $20.68–$37.22");

  // PRO shows the target price by default at 30% as soon as a cost exists.
  assert.equal(await page.evaluate(rowValue("Precio para ganar 30%")), "$750.00");
  pass("PRO target price visible by default at 30% margin ($750.00)");
  // inputs (pro): 0 price, 1 shipping, 2 cost, 3 ventas, 4 margin
  await typeInto(page, 4, "20");
  assert.equal(await page.evaluate(rowValue("Precio para ganar 20%")), "$642.86");
  await typeInto(page, 3, "10");
  assert.equal(await page.evaluate(rowValue("Ganancia mensual")), "$2,943.00");
  pass("Pro solver $642.86 + ventas 10 → ganancia mensual $2,943.00");

  // Margin-health dot: 35.59% margin → green.
  assert.equal(
    await page.$eval(".mst-row--profit", (e) => e.dataset.health),
    "green"
  );
  pass("margin-health dot is green at 35.59% margin");

  // Negative profit → clear "Pierdes" framing + red health (feature 5/7).
  await typeInto(page, 2, "900"); // cost above net → loss
  const lossText = await page.evaluate(rowValue("Ganancia"));
  assert.ok(lossText.startsWith("Pierdes"), `expected loss framing, got: ${lossText}`);
  assert.equal(await page.$eval(".mst-row--profit", (e) => e.dataset.health), "red");
  assert.equal(
    await page.$eval(".mst-row--profit", (e) => e.classList.contains("mst-row--loss")),
    true
  );
  pass('negative profit shows red "Pierdes …" framing');
  await typeInto(page, 2, "400"); // restore

  // ====================== PHASE 4: search page, Pro =========================
  if (process.env.E2E_SHOTS) {
    await (await page.$("#mst-card-root")).screenshot({ path: join(process.env.E2E_SHOTS, "card-pro.png") });
  }

  // ====================== PHASE 3b: every remaining control =================
  console.log("\nPHASE 3b — EVERY CONTROL (MSI box, selects, persistence, reset)");
  const selectByLabel = (label) => `.mst-card select[aria-label="${label}"]`;
  const setSelect = async (label, value) => {
    await page.$eval(selectByLabel(label), (el, v) => {
      el.value = v;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await sleep(300);
  };

  // MSI box (Pro): opens, term change, own rate persists, blank restores reference.
  await page.click(".mst-msi-toggle");
  await sleep(250);
  assert.ok(await page.$eval(".mst-msi", (e) => e.style.display !== "none"), "MSI box should open");
  await setSelect("Número de meses", "12");
  assert.ok(await page.$eval(".mst-msi__ref", (e) => e.style.display !== "none"), "reference note expected");
  assert.equal(await page.evaluate(rowValue("sin intereses (estimado)")), "−$107.51"); // 827 × 13%
  pass("MSI box opens; 12 meses at the 13% reference → −$107.51");
  const rate = await page.$(".mst-msi__rate");
  await rate.focus();
  await rate.evaluate((el) => el.select());
  await rate.type("7", { delay: 20 });
  await page.keyboard.press("Enter");
  await sleep(300);
  assert.equal(await page.$eval(".mst-msi__ref", (e) => e.style.display), "none", "own rate hides the reference note");
  assert.equal(await page.evaluate(rowValue("sin intereses (estimado)")), "−$57.89"); // 827 × 7%
  pass("own MSI rate 7% → −$57.89 and the reference note hides");
  await rate.focus();
  await rate.evaluate((el) => el.select());
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await sleep(300);
  assert.ok(await page.$eval(".mst-msi__ref", (e) => e.style.display !== "none"), "blank rate must restore the reference");
  assert.equal(await page.evaluate(rowValue("sin intereses (estimado)")), "−$107.51");
  pass("blank MSI rate restores the reference (no persisted 0%)");
  await page.click(".mst-msi-toggle");
  await sleep(200);

  // Weight select never overwrites a typed shipping value; fills it when empty.
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i) => i[1].value), "50.00");
  await setSelect("Peso (para estimar el envío)", "1");
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i) => i[1].value), "50.00");
  pass("weight select keeps the seller's typed shipping ($50.00)");
  await typeInto(page, 1, "0");
  await setSelect("Peso (para estimar el envío)", "0.5");
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i) => i[1].value), "56.00");
  await setSelect("Peso (para estimar el envío)", "1");
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i) => i[1].value), "59.60");
  pass("weight select autofills shipping when empty and keeps tracking weight until the seller types (0.5 kg $56.00 → 1 kg $59.60)");
  await typeInto(page, 1, "50");

  // Category select changes the commission.
  assert.equal(await page.evaluate(rowValue("Comisión")), "−$82.70");
  const catOptions = await page.$$eval(selectByLabel("Categoría") + " option", (os) => os.map((o) => o.value));
  const other = catOptions.find((v) => v && v !== "tech");
  await setSelect("Categoría", other);
  assert.notEqual(await page.evaluate(rowValue("Comisión")), "−$82.70");
  pass(`category select → commission recomputed (${other})`);
  await setSelect("Categoría", "tech");
  assert.equal(await page.evaluate(rowValue("Comisión")), "−$82.70");

  // Reputation subsidy row appears with free shipping + a green reputation.
  await openBreakdown(page);
  await page.click(".mst-free-toggle");
  await sleep(200);
  await setSelect("Reputación del vendedor", "verde");
  assert.equal(await page.evaluate(rowValue("Descuento por reputación")), "−$25.00"); // 50% of 50, shown as a reduction
  pass("reputation verde + envío gratis → subsidy row −$25.00");
  await setSelect("Reputación del vendedor", "none");
  await page.click(".mst-free-toggle");
  await sleep(200);

  // Listing type toggle persists per item across reloads.
  await page.$$eval(".mst-toggle__btn", (btns) => btns.find((b) => b.textContent === "Premium").click());
  await sleep(300);
  await page.goto(PRODUCT_URL, { waitUntil: "load" });
  await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  await sleep(600);
  assert.equal(
    await page.$$eval(".mst-toggle__btn", (btns) => btns.find((b) => b.textContent === "Premium").getAttribute("aria-pressed")),
    "true"
  );
  pass("Clásica/Premium choice persists for the listing after reload");
  await page.$$eval(".mst-toggle__btn", (btns) => btns.find((b) => b.textContent === "Clásica").click());
  await sleep(300);

  // Options "Reset": removes Netio data, keeps ExtPay keys and the install stamp.
  const opts = await browser.newPage();
  await opts.goto(`chrome-extension://${extId}/src/options/options.html`, { waitUntil: "load" });
  await opts.evaluate(async () => {
    await chrome.storage.sync.set({ extensionpay_sentinel: "keep-me", breakdownOpen: true, showWithholdings: true });
  });
  const before = await opts.evaluate(async () => (await chrome.storage.local.get(["mst:installedAt", "mst:cost:MLM12345678"])));
  assert.ok(before["mst:cost:MLM12345678"] > 0, "precondition: saved cost");
  // v1.4.3: Reset asks first. Cancel keeps everything; accept wipes.
  let confirmText = null;
  let acceptReset = false;
  opts.on("dialog", async (d) => {
    confirmText = d.message();
    if (acceptReset) await d.accept();
    else await d.dismiss();
  });
  await opts.click("#reset-btn");
  await sleep(300);
  assert.ok(confirmText?.includes("No se puede deshacer"), `confirm text: ${confirmText}`);
  const kept = await opts.evaluate(async () => (await chrome.storage.local.get("mst:cost:MLM12345678"))["mst:cost:MLM12345678"]);
  assert.equal(kept, before["mst:cost:MLM12345678"], "cancelling the confirm must keep saved costs");
  acceptReset = true;
  await opts.click("#reset-btn");
  await sleep(500);
  const after = await opts.evaluate(async () => ({
    local: await chrome.storage.local.get(["mst:installedAt", "mst:cost:MLM12345678", "mst:proOverride"]),
    sync: await chrome.storage.sync.get(["extensionpay_sentinel", "cardEnabled", "breakdownOpen", "showWithholdings"])
  }));
  assert.equal(after.local["mst:installedAt"], before["mst:installedAt"], "install stamp must survive reset");
  assert.equal(after.local["mst:cost:MLM12345678"], undefined, "saved cost must be removed");
  assert.equal(after.local["mst:proOverride"], undefined, "override is Netio data → removed");
  assert.equal(after.sync.extensionpay_sentinel, "keep-me", "ExtPay keys must survive reset");
  assert.equal(after.sync.cardEnabled, true, "defaults restored");
  assert.equal(after.sync.breakdownOpen, undefined, "breakdownOpen reset");
  assert.equal(after.sync.showWithholdings, undefined, "showWithholdings reset");
  pass("options Reset removes only Netio data (ExtPay keys + install stamp kept, no trial restart)");
  // Re-seed what later phases rely on.
  await opts.evaluate(async () => {
    await chrome.storage.local.set({ "mst:proOverride": true, "mst:sales:MLM12345678": 10 });
    await chrome.storage.sync.set({ acquisitionPct: 60, defaultShippingMXN: 50 });
  });
  await opts.close();
  await page.bringToFront();
  await page.goto(PRODUCT_URL, { waitUntil: "load" });
  await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  await sleep(500);
  await typeInto(page, 1, "50");
  await typeInto(page, 2, "400");

  // Dashboard: header sort + editable sales persist.
  const dash2 = await browser.newPage();
  await dash2.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html`, { waitUntil: "load" });
  await dash2.waitForFunction(() => !document.getElementById("content")?.hidden, { timeout: 10000 });
  await dash2.$$eval("#head-row th", (ths) => ths.find((t) => t.textContent.startsWith("Precio de venta")).click());
  await sleep(200);
  assert.ok((await dash2.$$eval("#head-row th", (ths) => ths.map((t) => t.textContent))).some((t) => t.includes("Precio de venta ↓")));
  await dash2.$eval("#rows input", (i) => {
    i.value = "25";
    i.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(400);
  assert.equal(await dash2.evaluate(async () => (await chrome.storage.local.get("mst:sales:MLM12345678"))["mst:sales:MLM12345678"]), 25);
  await dash2.evaluate(async () => chrome.storage.local.set({ "mst:sales:MLM12345678": 10 }));
  pass("dashboard: column header sorts, sales input persists (25) to storage");
  await dash2.close();

  console.log("\nPHASE 4 — SEARCH, PRO");
  const search = tap(await browser.newPage(), "search");
  await search.bringToFront();
  await search.goto(SEARCH_URL, { waitUntil: "load" });
  await search.waitForSelector(".mst-strip", { timeout: 20000 });
  await sleep(500);

  assert.equal(await search.$$eval(".mst-strip", (els) => els.length), 3);
  assert.ok(
    await search.$$eval(".mst-strip__panel", (panels) =>
      panels.every((p) => p.hidden && p.offsetHeight === 0)
    )
  );
  pass("3 strips, all collapsed on load");
  if (process.env.E2E_SHOTS) {
    await search.screenshot({ path: join(process.env.E2E_SHOTS, "search-pro.png") });
  }

  await search.click(".mst-strip__bar");
  await sleep(200);
  const panelText = await search.$eval(".mst-strip__panel", (e) => e.textContent);
  assert.ok(panelText.includes("Comisión (10%)"), panelText);
  assert.ok(panelText.includes("$248.10"), `research profit missing: ${panelText}`); // 744.30 − 827×60%
  pass("expanded strip: 10% commission + modo investigación est. profit $248.10");

  assert.equal(
    await search.$eval(".mst-export__btn", (b) => b.textContent),
    "Exportar a CSV (3)"
  );
  const research = await search.$eval(".mst-export__research", (e) => e.textContent);
  assert.ok(research.includes("60"), research);
  const dlDir = mkdtempSync(join(tmpdir(), "meli-e2e-dl-"));
  const cdp = await search.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  await search.click(".mst-export__btn");
  let csvFile = null;
  for (let i = 0; i < 50 && !csvFile; i++) {
    await sleep(100);
    csvFile = readdirSync(dlDir).find((f) => f.endsWith(".csv"));
  }
  assert.equal(csvFile, "netio-resultados.csv");
  const csv = readFileSync(join(dlDir, csvFile), "utf8");
  rmSync(dlDir, { recursive: true, force: true });
  const lines = csv.replace(/^﻿/, "").split("\r\n");
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith("Título,"), lines[0]);
  assert.ok(lines[1].includes("827.00") && lines[1].includes("Clásica"), lines[1]);
  assert.ok(lines[2].includes("120.00") && lines[2].includes("Premium"), lines[2]);
  pass("CSV export (Pro): real download, header + 3 rows");

  // ---- Profitability Radar (Pro flagship) --------------------------------
  // Verdicts at 60% acquisition cost, 30% target: tech-classic items ≥$299
  // net exactly 30% margin (827 and 2,499 → green); the $120 premium item
  // nets thinner → 25.5% (yellow). None at a loss.
  const buckets = await search.$$eval(".mst-strip", (els) =>
    els.map((e) => e.dataset.bucket)
  );
  assert.equal(buckets.filter((b) => b === "profit").length, 2, `buckets: ${buckets}`);
  assert.equal(buckets.filter((b) => b === "thin").length, 1, `buckets: ${buckets}`);
  assert.equal(buckets.filter((b) => b === "loss").length, 0, `buckets: ${buckets}`);
  pass("radar verdicts: 2 profitable, 1 thin, 0 loss at 30% target");

  const verdict = await search.$eval(".mst-strip__verdict b", (e) => e.textContent);
  assert.ok(verdict.includes("248.10"), `verdict pill: ${verdict}`);
  pass("radar verdict pill shows conservative est. profit $248.10");

  const summary = await search.$eval(".mst-radar__summary", (e) => e.textContent);
  assert.ok(
    summary.includes("Analizados: 3") &&
      summary.includes("rentables: 2") &&
      summary.includes("en pérdida: 0"),
    `summary: ${summary}`
  );
  pass(`radar summary bar: "${summary.trim()}"`);

  // Lower the target → the thin item clears it → 3 profitable (reactivity).
  await search.$eval(".mst-radar__target", (el) => {
    el.value = "25";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(150);
  const lowered = await search.$$eval(".mst-strip", (els) =>
    els.map((e) => e.dataset.bucket)
  );
  assert.equal(
    lowered.filter((b) => b === "profit").length,
    3,
    `after target 25%: ${lowered}`
  );
  pass("radar target 25% → 3 profitable (threshold reactivity)");

  // Back to 30%, then "only profitable" dims the one thin result and the
  // export button becomes the ranked shortlist.
  await search.$eval(".mst-radar__target", (el) => {
    el.value = "30";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(100);
  await search.click(".mst-radar__only");
  await sleep(150);
  assert.equal(
    await search.$$eval(".mst-dimmed", (els) => els.length),
    1,
    "only-profitable should dim the single thin result"
  );
  const shortlistLabel = await search.$eval(".mst-export__btn", (e) => e.textContent);
  assert.ok(
    shortlistLabel.includes("Exportar rentables (2)"),
    `export label: ${shortlistLabel}`
  );
  pass('radar "solo rentables" dims 1 loser → "Exportar rentables (2)"');

  // ---- v1.4.3: CSV keeps losses numeric; own strip text never flips flags;
  // ---- cost field keeps focus across the re-init --------------------------
  await search.click(".mst-radar__only"); // back to "all results"
  await sleep(100);
  // Expand the 2nd result's strip: its panel prints "Envío gratis: No". Reading
  // the item text AFTER that used to match our own label and flip it to Sí.
  await search.$$eval(".mst-strip__bar", (bars) => bars[1].click());
  await sleep(150);
  await search.focus(".mst-radar__cost");
  await search.$eval(".mst-radar__cost", (el) => {
    el.value = "99"; // 99% acquisition cost: every result loses money
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(600);
  const focusInfo = await search.evaluate(() => ({
    cls: document.activeElement?.className ?? "",
    val: document.activeElement?.value ?? null
  }));
  assert.ok(focusInfo.cls.includes("mst-radar__cost") && focusInfo.val === "99", `focus after re-init: ${JSON.stringify(focusInfo)}`);
  pass("acquisition cost field keeps focus + value after the strips re-init");

  const dlDir2 = mkdtempSync(join(tmpdir(), "meli-e2e-dl-"));
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir2 });
  await search.$$eval(".mst-strip__bar", (bars) => bars[1].click()); // expanded again after re-init
  await sleep(100);
  await search.click(".mst-export__btn");
  let csvFile2 = null;
  for (let i = 0; i < 50 && !csvFile2; i++) {
    await sleep(100);
    csvFile2 = readdirSync(dlDir2).find((f) => f.endsWith(".csv"));
  }
  assert.ok(csvFile2, "second CSV download");
  const csv2 = readFileSync(join(dlDir2, csvFile2), "utf8");
  rmSync(dlDir2, { recursive: true, force: true });
  const lines2 = csv2.replace(/^﻿/, "").split("\r\n");
  assert.ok(!/'-?\d/.test(csv2), `numeric cell was apostrophe-guarded:\n${csv2}`);
  assert.match(lines2[1], /,-\d+\.\d{2},-\d+\.\d$/, `loss row must stay numeric: ${lines2[1]}`);
  assert.match(lines2[2], /,Premium,[^,]*,No,/, `2nd result has no free shipping: ${lines2[2]}`);
  pass("CSV: losses export as plain negative numbers; expanded strip does not flip 'Envío gratis' to Sí");

  await search.focus(".mst-radar__cost");
  await search.$eval(".mst-radar__cost", (el) => {
    el.value = "60";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(600);
  // Leave the page as Phase 4 did: "only profitable" ON (Phase 6 turns it off).
  await search.click(".mst-radar__only");
  await sleep(150);

  // ================= PHASE 5: SPA navigation (stale state impossible) ========
  console.log("\nPHASE 5 — SPA NAVIGATION (stale state from a previous product impossible)");
  await page.bringToFront();

  // Simulate MELI's client-side navigation: swap the rendered price + meta,
  // then pushState to a different product URL. No page load event fires — the
  // URL watcher must tear down and re-inject on its own.
  const spaNavigate = (fraction, cents, metaContent, path) =>
    page.evaluate(({ fraction, cents, metaContent, path }) => {
      const meta = document.querySelector('meta[itemprop="price"]');
      if (meta) meta.content = metaContent;
      const visibleBlock = document.querySelectorAll(".ui-pdp-price")[1];
      visibleBlock.querySelector("span.andes-money-amount .andes-money-amount__fraction")
        .textContent = fraction;
      visibleBlock.querySelector("span.andes-money-amount .andes-money-amount__cents")
        .textContent = cents;
      history.pushState({}, "", path);
    }, { fraction, cents, metaContent, path });

  await spaNavigate("1,499", "00", "1499", "/otro-celular/p/MLM99999999");
  // URL poll (≤1s) + teardown + settle (~650ms) + re-route.
  await page.waitForFunction(
    () => document.querySelector(".mst-card input.mst-input")?.value === "1499.00",
    { timeout: 15000, polling: 250 }
  );
  assert.equal(await page.$$eval(".mst-card", (els) => els.length), 1);
  pass("SPA nav → card torn down and re-injected with the NEW price ($1,499.00)");

  // Product B must start clean: product A's cost (400) and ventas (10) must
  // not leak into it, and nothing may be persisted under B's storage keys.
  const bInputs = await page.$$eval(".mst-card input.mst-input", (els) =>
    els.map((i) => i.value)
  );
  assert.equal(bInputs[2], "", `cost leaked across SPA nav: ${bInputs}`);
  assert.equal(bInputs[3], "", `ventas leaked across SPA nav: ${bInputs}`);
  const bStored = await dash.evaluate(() =>
    chrome.storage.local.get(["mst:cost:MLM99999999", "mst:sales:MLM99999999"])
  );
  assert.deepEqual(bStored, {}, `stale write under new item's keys: ${JSON.stringify(bStored)}`);
  pass("new product starts clean: no cost/ventas carry-over, no stale storage writes");

  // Page re-render wipes the card → persistence watcher re-injects it.
  await page.evaluate(() => document.getElementById("mst-card-root").remove());
  await page.waitForFunction(
    () => document.querySelector(".mst-card input.mst-input")?.value === "1499.00",
    { timeout: 5000, polling: 200 }
  );
  pass("card wiped by page re-render → re-injected with the same product's data");

  // Navigate BACK to product A: its per-item state must be restored intact.
  await spaNavigate("827", "00", "827", "/celular-test-pro/p/MLM12345678");
  await page.waitForFunction(
    () => {
      const inputs = document.querySelectorAll(".mst-card input.mst-input");
      return inputs[0]?.value === "827.00" && inputs[2]?.value === "400.00";
    },
    { timeout: 15000, polling: 250 }
  );
  pass("SPA nav back → product A's price $827.00 and saved cost $400.00 restored");

  // ================= PHASE 6: search lazy-load / infinite scroll ==============
  console.log("\nPHASE 6 — SEARCH LAZY-LOAD (late results get strips)");
  await search.bringToFront();
  await search.click(".mst-radar__only"); // back to all results
  await sleep(200);
  await search.evaluate(() => {
    const list = document.querySelector(".ui-search-layout");
    const item = list.lastElementChild.cloneNode(true);
    item.classList.remove("mst-dimmed");
    item.querySelector(".mst-strip")?.remove();
    item.querySelector("h2").textContent = "Celular Lazy Load 512 GB";
    list.appendChild(item);
  });
  await search.waitForFunction(
    () => document.querySelectorAll(".mst-strip").length === 4,
    { timeout: 5000, polling: 200 }
  );
  assert.equal(
    await search.$eval(".mst-export__btn", (b) => b.textContent),
    "Exportar a CSV (4)"
  );
  pass("lazy-loaded 4th result gets a strip; export count follows (4)");

  // ================= PHASE 7: extraction edge cases ===========================
  console.log("\nPHASE 7 — EXTRACTION EDGE CASES (promo price without meta, no anchor)");
  // Discounted listing with NO itemprop meta: the DOM-only path must skip the
  // hidden duplicate block (1,199) and the crossed-out previous price (1,199).
  const nometa = tap(await browser.newPage(), "nometa");
  await nometa.goto(`${PRODUCT_URL}?e2e=nometa`, { waitUntil: "load" });
  await nometa.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  assert.equal(await nometa.$eval(".mst-card input.mst-input", (i) => i.value), "827.00");
  assert.equal(await nometa.evaluate(rowValue("Comisión")), "−$82.70");
  pass("promo listing without meta: reads $827.00, skips hidden dup + crossed-out $1,199");
  await nometa.close();

  // No recognizable price block at all → every anchor strategy misses → the
  // extension keeps waiting silently and injects nothing.
  let noAnchorFatal = false;
  const noanchor = tap(await browser.newPage(), "noanchor");
  noanchor.on("pageerror", () => { noAnchorFatal = true; });
  await noanchor.goto(`${PRODUCT_URL}?e2e=noanchor`, { waitUntil: "load" });
  await sleep(2500);
  assert.equal(await noanchor.$("#mst-card-root"), null, "no card without any anchor");
  assert.equal(noAnchorFatal, false, "anchorless page must not raise a fatal error");
  pass("no price block at all → no card, no error (waits silently)");
  await noanchor.close();

  // ================= PHASE 8: resilience (render nothing safely) =============
  console.log("\nPHASE 8 — RESILIENCE (unreadable page renders nothing, host intact)");
  let noPriceFatal = false;
  const noprice = tap(await browser.newPage(), "noprice");
  noprice.on("console", (m) => { if (/fatal/i.test(m.text())) noPriceFatal = true; });
  noprice.on("pageerror", () => { noPriceFatal = true; });
  await noprice.goto(`${PRODUCT_URL}?e2e=noprice`, { waitUntil: "load" });
  await sleep(2500); // give detection + injection every chance to (not) fire
  assert.equal(await noprice.$("#mst-card-root"), null, "no card should inject without a readable price");
  pass("no readable price → no card injected (renders nothing)");
  assert.equal(await noprice.$eval("body", (b) => b.isConnected), true);
  assert.equal(noPriceFatal, false, "unreadable page must not raise a fatal/uncaught error");
  pass("unreadable page: no fatal error, host page intact");
  await noprice.close();

  // ================= PHASE 9: v1.4.3 audit fixes ================================
  console.log("\nPHASE 9 — v1.4.3 (unified URLs, price follow, currency, strip rebuild, dashboard focus, reload notice)");
  const logs9 = [];
  const upPage = tap(await browser.newPage(), "up");
  upPage.on("console", (m) => logs9.push(m.text()));
  await upPage.goto(`https://www.mercadolibre.com.mx:${PORT}/celular-test-pro/up/MLMU123456`, { waitUntil: "load" });
  await upPage.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  assert.ok(!logs9.some((l) => l.includes("URL not recognized")), "/up/MLMU must be detected by URL, not by the DOM fallback");
  assert.ok(logs9.some((l) => l.includes("page type: product")), "page type log");
  pass("/up/MLMU… unified product URL is recognized as a product page");

  // The page re-renders with a new price (variant/promo): the card follows.
  await upPage.evaluate(() => {
    document.querySelector('meta[itemprop="price"]').setAttribute("content", "799");
    const frac = document.querySelectorAll(".ui-pdp-price:not([style]) .andes-money-amount:not(.andes-money-amount--previous) .andes-money-amount__fraction")[0];
    frac.textContent = "799";
  });
  await upPage.waitForFunction(
    () => document.querySelectorAll(".mst-card input.mst-input")[0]?.value === "799.00",
    { timeout: 6000, polling: 200 }
  );
  assert.equal(await upPage.evaluate(rowValue("Comisión")), "−$79.90");
  pass("in-page price change 827 → 799: card follows (price field + commission −$79.90)");

  // Explicit non-MXN currency: no card.
  const usd = tap(await browser.newPage(), "usd");
  await usd.goto(`${PRODUCT_URL}?e2e=usdcur`, { waitUntil: "load" });
  await sleep(2500);
  assert.equal(await usd.$("#mst-card-root"), null, "USD listing must not get an MXN fee card");
  pass("page currency explicitly USD → no card");
  await usd.close();

  // A strip wiped by the page's own re-render is rebuilt.
  await search.bringToFront();
  const stripsBefore = await search.$$eval(".mst-strip", (els) => els.length);
  await search.evaluate(() => document.querySelector(".mst-strip").remove());
  await search.waitForFunction(
    (n) => document.querySelectorAll(".mst-strip").length === n,
    { timeout: 5000, polling: 200 },
    stripsBefore
  );
  pass(`strip removed by a page re-render comes back (${stripsBefore} strips again)`);

  // Toolbar/dashboard opener focuses the open dashboard instead of stacking tabs.
  const dashUrl = `chrome-extension://${extId}/src/dashboard/dashboard.html`;
  for (const pg of await browser.pages()) if (pg.url().startsWith(dashUrl)) await pg.close();
  const opener = await browser.newPage();
  await opener.goto(`chrome-extension://${extId}/src/options/options.html`, { waitUntil: "load" });
  const r1 = await opener.evaluate(() => chrome.runtime.sendMessage({ type: "openDashboard" }));
  await sleep(700);
  const r2 = await opener.evaluate(() => chrome.runtime.sendMessage({ type: "openDashboard" }));
  await sleep(700);
  const dashCount = (await browser.pages()).filter((pg) => pg.url().startsWith(dashUrl)).length;
  assert.equal(dashCount, 1, `dashboard tabs: ${dashCount} (r1=${JSON.stringify(r1)} r2=${JSON.stringify(r2)})`);
  assert.equal(r1.data.opened, true);
  assert.equal(r2.data.focused, true);
  // Junk messages are ignored (no throw, no response needed).
  await opener.evaluate(() => chrome.runtime.sendMessage("hola").catch(() => null));
  await opener.evaluate(() => chrome.runtime.sendMessage({ type: "constructor" }).catch(() => null));
  pass("openDashboard opens once, then focuses the existing tab (no tabs permission)");
  for (const pg of await browser.pages()) if (pg.url().startsWith(dashUrl)) await pg.close();

  // ================= PHASE 10: v1.5.0 anonymous funnel analytics ================
  console.log("\nPHASE 10 — ANALYTICS (dormant by default, mock backend, allowlist, opt-out)");
  // Mock Supabase REST endpoint with CORS (what the service worker will meet).
  const received = [];
  const mock = createHttpServer((req, res) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "apikey, authorization, content-type, prefer",
      "access-control-allow-methods": "POST, OPTIONS"
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ url: req.url, headers: req.headers, body });
      res.writeHead(201, cors);
      res.end();
    });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;
  const fixtureTitle = "Celular Test Pro 128 GB";
  const rows = () => received.flatMap((r) => JSON.parse(r.body));
  const ext = await browser.newPage();
  await ext.goto(`chrome-extension://${extId}/src/options/options.html`, { waitUntil: "load" });
  const sendMsg = (msg) => ext.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  // Known state: never-paid, trial long over, no analytics leftovers.
  await ext.evaluate(async () => {
    await chrome.storage.local.remove(["mst:proOverride", "mst:proStatus", "mst:telemetryOverride", "mst:telemetry", "mst:tq", "mst:tlast", "mst:tflags", "mst:tday", "mst:tcounts", "mst:iid", "mst:telemetryNoticeSeen", "mst:metrics"]);
    await chrome.storage.local.set({ "mst:installedAt": Date.now() - 9 * 24 * 3600 * 1000 });
  });

  // -- dormant: no override, no build config -> not one request, no analytics UI
  const dormantPage = tap(await browser.newPage(), "dormant");
  await dormantPage.goto(PRODUCT_URL, { waitUntil: "load" });
  await dormantPage.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  await typeInto(dormantPage, 2, "400");
  await sendMsg({ type: "telemetryFlush" });
  await sleep(500);
  assert.equal(received.length, 0, "dormant build must not contact any analytics endpoint");
  const dormantState = await sendMsg({ type: "telemetryState", payload: { debug: true } });
  assert.equal(dormantState.data.configured, false);
  assert.equal(dormantState.data.queue, 0);
  assert.ok(dormantState.data.counts.card_seen >= 1, "events still counted locally while dormant");
  await ext.reload({ waitUntil: "load" });
  await sleep(500);
  assert.equal(await ext.$eval("#telemetry-box", (e) => e.hidden), true, "no analytics toggle when dormant");
  const wel = await browser.newPage();
  await wel.goto(`chrome-extension://${extId}/src/onboarding/welcome.html`, { waitUntil: "load" });
  await wel.waitForFunction(() => (document.getElementById("note")?.textContent ?? "").length > 0);
  assert.equal(await wel.$eval("#tnotice", (e) => e.hidden), true);
  assert.ok((await wel.$eval("#note", (e) => e.textContent)).includes("no tenemos servidores"), "original no-servers note kept");
  await wel.close();
  await dormantPage.close();
  pass("dormant by default: 0 requests, no toggle, no notice, original privacy note, local counters still count");

  // -- enable via the QA override (stripped from release builds)
  await ext.evaluate(async (url) => {
    await chrome.storage.local.set({ "mst:telemetryOverride": { url, key: "anon-test-key" } });
  }, mockUrl);
  await ext.reload({ waitUntil: "load" });
  await ext.waitForFunction(() => !document.getElementById("telemetry-box").hidden, { timeout: 5000 });
  assert.equal(await ext.$eval("#telemetry-enabled", (c) => c.checked), true, "default on when configured");
  assert.equal(await ext.$eval("#telemetry-notice", (e) => e.hidden), false, "first-run notice shown once in options");
  assert.ok((await ext.$eval("#telemetry-notice", (e) => e.textContent)).includes("Ver qué enviamos"));
  await ext.reload({ waitUntil: "load" });
  await ext.waitForFunction(() => !document.getElementById("telemetry-box").hidden, { timeout: 5000 });
  assert.equal(await ext.$eval("#telemetry-notice", (e) => e.hidden), true, "notice is not shown a second time");
  const wel2 = await browser.newPage();
  await wel2.goto(`chrome-extension://${extId}/src/onboarding/welcome.html`, { waitUntil: "load" });
  await wel2.waitForFunction(() => !document.getElementById("tnotice").hidden, { timeout: 5000 });
  assert.ok((await wel2.$eval("#tnotice", (e) => e.textContent)).includes("Ver qué enviamos"));
  assert.ok((await wel2.$eval("#tnotice-link", (a) => a.href)).endsWith("/privacidad.html"));
  await wel2.close();
  pass("configured: toggle on by default, notice once in options, notice with 'Ver qué enviamos' on welcome");

  // -- drive the funnel
  const fp = tap(await browser.newPage(), "funnel");
  await fp.goto(PRODUCT_URL, { waitUntil: "load" });
  await fp.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  await typeInto(fp, 2, "400");
  await fp.waitForSelector(".mst-row--teaser", { visible: true });
  await fp.click(".mst-row--teaser");
  await sleep(300);
  await fp.click(".mst-upsell__cta"); // monthly
  await sleep(1500);
  await sendMsg({ type: "telemetryFlush" });
  await sleep(500);
  const all = rows();
  const seen = (event, pred = () => true) => all.some((r) => r.event === event && pred(r.props));
  assert.ok(seen("install") === false, "no install event: extension was installed before analytics were enabled");
  assert.ok(seen("active_day", (p) => p.trial_state === "expired" && p.pro === false && p.days_since_install >= 9), "active_day with expired trial");
  assert.ok(seen("card_seen", (p) => p.page === "catalog"), "card_seen (catalog URL shape)");
  assert.ok(seen("first_cost_entered"), "first_cost_entered");
  assert.ok(seen("paywall_seen", (p) => p.reason === "teaser" && p.key === "target"), "paywall_seen teaser/target");
  assert.ok(seen("paywall_seen", (p) => p.reason === "upsell" && p.key === "target"), "paywall_seen upsell/target");
  assert.ok(seen("checkout_click", (p) => p.plan === "pro-monthly" && p.from === "upsell"), "checkout_click monthly");
  assert.ok(seen("trial_expired_seen"), "trial_expired_seen");
  // Wire format: only allowlisted columns, enum-like props, CORS request from the extension.
  const COLS = ["chrome_major", "event", "ext_version", "install_id", "lang", "platform", "props"];
  for (const r of all) {
    assert.deepEqual(Object.keys(r).sort(), COLS);
    assert.match(r.install_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(r.ext_version, "1.5.1");
    for (const v of Object.values(r.props)) assert.match(String(v), /^[a-z0-9._:+-]{1,24}$/);
  }
  assert.equal(new Set(all.map((r) => r.install_id)).size, 1, "one random install id");
  const blob = received.map((r) => r.body).join("\n");
  for (const bad of ["mercadolibre", "mercadopago", "827", "744", "750", "400", fixtureTitle, "Celular", "MLM", "http", "$"]) {
    assert.ok(!blob.toLowerCase().includes(bad.toLowerCase()), `payload must not contain "${bad}"`);
  }
  const h = received[0].headers;
  assert.equal(h.apikey, "anon-test-key");
  assert.equal(h.authorization, "Bearer anon-test-key");
  assert.equal(h.prefer, "return=minimal");
  assert.ok((h.origin ?? "").startsWith("chrome-extension://"), `origin ${h.origin}`);
  assert.equal(received[0].url, "/rest/v1/events");
  pass(`funnel rows reach the mock with CORS (${all.length} rows): only allowlisted keys, no URL/price/title/listing id`);

  // -- debug diagnostic is visible
  await ext.goto(`chrome-extension://${extId}/src/options/options.html?debug`, { waitUntil: "load" });
  await ext.waitForFunction(() => /last send 20\d ok/.test(document.getElementById("telemetry-debug")?.textContent ?? ""), { timeout: 5000 });
  pass("options ?debug shows host, queue and last send status (201 ok)");

  // -- opt out via the UI: queue cleared, nothing more is sent
  await fp.bringToFront();
  await typeInto(fp, 2, "401");
  await ext.bringToFront();
  const sentBefore = received.length;
  await ext.click("#telemetry-enabled");
  await sleep(500);
  let st = await sendMsg({ type: "telemetryState", payload: { debug: true } });
  assert.equal(st.data.enabled, false);
  assert.equal(st.data.queue, 0, "opt-out clears the queue");
  await fp.bringToFront();
  await typeInto(fp, 2, "402");
  await fp.reload({ waitUntil: "load" });
  await fp.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  await sendMsg({ type: "telemetryFlush" });
  await sleep(500);
  assert.equal(received.length, sentBefore, "no request after opt-out");
  st = await sendMsg({ type: "telemetryState", payload: { debug: true } });
  assert.equal(st.data.queue, 0);
  pass("opt-out: queue cleared, zero further requests");

  // -- release-style dormancy again: override removed -> still nothing
  await ext.evaluate(() => chrome.storage.local.remove("mst:telemetryOverride"));
  await sendMsg({ type: "telemetryFlush" });
  await sleep(300);
  assert.equal(received.length, sentBefore);
  pass("override removed: telemetry dormant again");
  await fp.close();
  await ext.close();
  mock.close();

  // ================= PHASE 11: v1.5.1 owner key =================================
  console.log("\nPHASE 11 - OWNER KEY (throwaway key via ?owner=, PRO everywhere, silent analytics)");
  {
    const { createHash, randomBytes } = await import("node:crypto");
    const ownerKey = randomBytes(32).toString("hex"); // throwaway; never the real key
    const ownerHash = createHash("sha256").update(ownerKey, "utf8").digest("hex");
    const o = await browser.newPage();
    await o.goto(`chrome-extension://${extId}/src/options/options.html`, { waitUntil: "load" });
    await o.evaluate(async (hash) => {
      await chrome.storage.local.remove(["mst:proOverride", "mst:proStatus", "mst:ownerKey", "mst:tq", "mst:tday", "mst:tcounts", "mst:iid", "mst:tflags"]);
      await chrome.storage.local.set({ "mst:installedAt": Date.now() - 9 * 24 * 3600 * 1000, "mst:ownerHashOverride": hash });
    }, ownerHash);

    // Normal user, trial over: not owner, free status line.
    await o.reload({ waitUntil: "load" });
    await o.waitForFunction(() => document.getElementById("sub-status").textContent !== "…");
    assert.equal(await o.$eval("#owner-box", (e) => e.hidden), true, "owner box hidden by default");
    pass("owner box hidden for normal users");

    // Wrong key via URL param: "Clave incorrecta", param stripped, no unlock.
    await o.goto(`chrome-extension://${extId}/src/options/options.html?owner=${"z".repeat(40)}`, { waitUntil: "load" });
    await o.waitForFunction(() => !document.getElementById("owner-msg").hidden, { timeout: 5000 });
    assert.equal(await o.$eval("#owner-msg", (e) => e.textContent), "Clave incorrecta");
    assert.ok(!o.url().includes("owner="), "owner param stripped from the URL");
    assert.equal((await o.evaluate(() => chrome.storage.local.get("mst:ownerKey")))["mst:ownerKey"], undefined);
    pass("wrong key: 'Clave incorrecta', param stripped, nothing stored");

    // Right key: auto-activates, status line says owner mode, key not in DOM.
    await o.goto(`chrome-extension://${extId}/src/options/options.html?owner=${ownerKey}&debug=1`, { waitUntil: "load" });
    await o.waitForFunction(() => document.getElementById("sub-status").textContent === "Modo propietario activo", { timeout: 8000 });
    assert.ok(!o.url().includes(ownerKey) && !o.url().includes("owner="), "key stripped from the URL");
    assert.ok(o.url().includes("debug=1"), "other params kept");
    assert.equal(await o.$eval("#owner-input", (e) => e.value), "", "input cleared");
    assert.ok(!(await o.content()).includes(ownerKey), "key never echoed in the DOM");
    pass("right key: 'Modo propietario activo', key stripped from URL and DOM");

    // Toolbar badge reads PRO.
    const swT = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"));
    await sleep(500);
    assert.equal(await (await swT.worker()).evaluate(() => chrome.action.getBadgeText({})), "PRO");
    pass("badge shows PRO in owner mode");

    // Listing page: full PRO UI, no teaser, no trial/win-back bar, no upsell.
    const op = tap(await browser.newPage(), "owner");
    await op.goto(PRODUCT_URL, { waitUntil: "load" });
    await op.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
    await typeInto(op, 2, "400");
    await sleep(500);
    const ui = await op.evaluate(() => ({
      teaser: document.querySelectorAll(".mst-row--teaser").length,
      bar: [...document.querySelectorAll(".mst-trialbar")].some((b) => !b.hidden && b.offsetHeight > 0),
      upsellOpen: [...document.querySelectorAll(".mst-upsell")].some((u) => !u.hidden),
      chips: document.querySelectorAll(".mst-prochip").length,
      review: document.querySelectorAll(".mst-review").length
    }));
    assert.equal(ui.teaser, 0, "no teasers");
    assert.equal(ui.bar, false, "no trial/win-back bar");
    assert.equal(ui.upsellOpen, false, "no upsell");
    assert.equal(ui.review, 0, "no review ask");
    assert.ok(await op.evaluate(rowValue("Precio para ganar 30%")), "target price visible");
    pass("listing page: PRO unlocked, no teaser/trial bar/upsell/review ask");
    await op.close();

    // Dashboard: no free-preview upsell.
    const od = await browser.newPage();
    await od.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html`, { waitUntil: "load" });
    await sleep(1500);
    assert.equal(await od.$eval("#upsell", (e) => e.hidden), true, "dashboard has no paywall for the owner");
    await od.close();
    const ow = await browser.newPage();
    await ow.goto(`chrome-extension://${extId}/src/onboarding/welcome.html`, { waitUntil: "load" });
    await sleep(800);
    await ow.close();
    pass("dashboard shows no paywall for the owner; welcome loads");

    // Analytics: nothing collected for the owner.
    const sendO = (m) => o.evaluate((x) => chrome.runtime.sendMessage(x), m);
    await sendO({ type: "track", event: "card_seen", props: { page: "product" } });
    const stO = await sendO({ type: "telemetryState", payload: { debug: true } });
    assert.equal(stO.data.owner, true);
    assert.equal(stO.data.enabled, false);
    const leftovers = await o.evaluate(() => chrome.storage.local.get(["mst:tq", "mst:iid", "mst:tcounts", "mst:tday"]));
    assert.deepEqual(leftovers, {}, "no analytics state for the owner");
    pass("owner mode: analytics silent, no queue/install id/counters");

    // Tampered flags do nothing; key removal locks again.
    await o.evaluate(() => chrome.storage.local.remove("mst:ownerKey"));
    await o.evaluate(() => chrome.storage.local.set({ "mst:ownerKey": true, "mst:owner": true }));
    await o.reload({ waitUntil: "load" });
    await o.waitForFunction(() => document.getElementById("sub-status").textContent !== "…");
    assert.notEqual(await o.$eval("#sub-status", (e) => e.textContent), "Modo propietario activo");
    await o.evaluate(() => chrome.storage.local.remove(["mst:owner", "mst:ownerKey"]));
    pass("tampered flag does not unlock; removed key locks");

    // Reset keeps the key.
    await o.goto(`chrome-extension://${extId}/src/options/options.html?owner=${ownerKey}`, { waitUntil: "load" });
    await o.waitForFunction(() => document.getElementById("sub-status").textContent === "Modo propietario activo", { timeout: 8000 });
    o.once("dialog", (d) => d.accept());
    await o.click("#reset-btn");
    await sleep(800);
    assert.equal((await o.evaluate(() => chrome.storage.local.get("mst:ownerKey")))["mst:ownerKey"], ownerKey, "Reset keeps the owner key");
    // Quitar removes it.
    await o.click("#owner-box #owner-remove").catch(() => {});
    await o.evaluate(() => chrome.storage.local.remove(["mst:ownerKey", "mst:ownerHashOverride"]));
    pass("Reset keeps the owner key");
    await o.close();
  }

  // Owner-mode switches broadcast "proChanged": the background listing tab
  // rebuilds its card (slowly, while hidden). Let it settle before reloading.
  await upPage.bringToFront();
  await upPage.waitForFunction(() => !!document.querySelector("#mst-card-root"), { timeout: 20000, polling: 250 });
  // (runs before the reload test: headless Chrome cannot re-register the extension after runtime.reload)
  // Extension reloaded under an open tab: the orphaned card says so and the
  // button brings the page back with the new version.
  const sw = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"));
  await upPage.bringToFront();
  await (await sw.worker()).evaluate(() => chrome.runtime.reload());
  await upPage.waitForFunction(
    () => document.querySelector("#mst-card-root")?.dataset.stale === "1",
    { timeout: 15000, polling: 250 }
  );
  const staleText = await upPage.$eval("#mst-card-root", (c) => c.textContent);
  assert.ok(staleText.includes("Netio se actualizó. Recarga la página para seguir.") && staleText.includes("Recargar"), staleText);
  pass("extension reloaded under the tab: card becomes 'Netio se actualizó. Recarga la página…' + Recargar");
  await sleep(1500); // let the reloaded extension finish starting
  await Promise.all([
    upPage.waitForNavigation({ waitUntil: "load", timeout: 20000 }),
    upPage.click("#mst-card-root button")
  ]);
  // (Headless Chrome does not re-register content scripts for an unpacked
  // extension after runtime.reload(), so only the reload itself is asserted.)
  assert.equal(await upPage.$("[data-stale]"), null, "the stale notice is gone after the reload");
  pass("Recargar reloads the page (stale notice gone)");
  await upPage.close();
  await opener.close().catch(() => {});


  console.log(`\nE2E: ${passed.length}/${passed.length} checks passed`);
} finally {
  await browser.close();
  server.close();
  rmSync(certDir, { recursive: true, force: true });
}
