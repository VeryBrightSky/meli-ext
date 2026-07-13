// Headless smoke test: loads the built extension in Chrome against saved
// fixture pages served over local HTTPS with the real MELI hostnames mapped
// to 127.0.0.1 (so manifest matches and URL-shape detection run for real).
//
// Phases: 1) never-paid (ExtPay unreachable → fail closed) asserts free
// features + locked Pro UI; 2) dashboard shows upsell when locked; 3) Pro
// via the QA override; 4) full Pro flows incl. real CSV download.
//
//   npm run test:e2e
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
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
const server = createServer(
  { key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) },
  (req, res) => {
    const host = req.headers.host ?? "";
    const body = host.startsWith("listado.")
      ? fixtures.search
      : (req.url ?? "").includes("noprice")
        ? fixtures.productNoPrice
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
  // ====================== PHASE 1: never-paid (locked) ======================
  console.log("\nPHASE 1 — PRODUCT, NEVER-PAID (fail closed)");
  const page = tap(await browser.newPage(), "product");
  await browser.defaultBrowserContext().overridePermissions(
    `https://www.mercadolibre.com.mx:${PORT}`,
    ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]
  );
  await page.goto(PRODUCT_URL, { waitUntil: "load" });
  await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  pass("card injects and is visible");

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

  const lockedRows = await page.$$eval(".mst-row--locked", (rows) =>
    rows.map((r) => r.textContent)
  );
  assert.ok(lockedRows.some((t) => t.includes("Precio objetivo")), "target price not locked");
  assert.ok(lockedRows.some((t) => t.includes("Ventas al mes")), "sales not locked");
  const chips = await page.$$eval(".mst-prochip", (els) => els.length);
  assert.ok(chips >= 4, `expected ≥4 PRO chips, got ${chips}`);
  pass(`locked rows render with PRO chips (${chips} chips)`);

  assert.equal(
    await page.$eval(".mst-sweetspot", (e) => e.style.display !== "none"),
    false
  );
  assert.equal(await page.$eval(".mst-upsell", (e) => e.hidden), true);
  await page.click(".mst-compare-toggle");
  await sleep(200);
  assert.equal(await page.$eval(".mst-upsell", (e) => e.hidden), false);
  const upsellText = await page.$eval(".mst-upsell", (e) => e.textContent);
  assert.ok(upsellText.includes("7 días"), "upsell missing trial copy");
  assert.ok(upsellText.includes("$89 MXN/mes"), "upsell missing monthly price");
  assert.ok(upsellText.includes("$699 MXN/año"), "upsell missing yearly price");
  assert.ok(upsellText.includes("ahorra 35%"), "upsell missing yearly savings");
  pass("locked feature click opens upsell (trial + MXN founder pricing), never on load");

  await page.click(".mst-copy");
  await sleep(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(clip.includes("Recibes aprox.: $694.30"), `clipboard wrong:\n${clip}`);
  pass("copy summary stays FREE");

  // ====================== PHASE 2: dashboard locked =========================
  console.log("\nPHASE 2 — DASHBOARD (locked) + SEED PRO");
  const extId = await extensionId();
  const dash = await browser.newPage();
  await dash.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html`, {
    waitUntil: "load"
  });
  await dash.waitForFunction(
    () => !document.getElementById("upsell")?.hidden || !document.getElementById("content")?.hidden,
    { timeout: 10000 }
  );
  assert.equal(await dash.$eval("#upsell", (e) => e.hidden), false);
  assert.equal(await dash.$eval("#content", (e) => e.hidden), true);
  pass("dashboard shows upsell when not Pro");

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
  assert.ok(totals.includes("1 productos"), `totals label/count wrong: ${totals}`);
  pass("dashboard reflects changed options shipping $50 → monthly $2,943.00 (bug 1 fixed)");

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

  // inputs (pro): 0 price, 1 shipping, 2 cost, 3 ventas, 4 margin
  await typeInto(page, 4, "20");
  assert.equal(await page.evaluate(rowValue("Precio objetivo")), "$642.86");
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
    summary.includes("3 productos") &&
      summary.includes("2 rentables") &&
      summary.includes("0 en pérdida"),
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

  // ================= PHASE 5: resilience (render nothing safely) =============
  console.log("\nPHASE 5 — RESILIENCE (unreadable page renders nothing, host intact)");
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

  console.log(`\nE2E: ${passed.length}/${passed.length} checks passed`);
} finally {
  await browser.close();
  server.close();
  rmSync(certDir, { recursive: true, force: true });
}
