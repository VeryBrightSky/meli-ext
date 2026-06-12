// Headless smoke test: loads the built extension in Chrome against saved
// fixture pages served over local HTTPS with the real MELI hostnames mapped
// to 127.0.0.1 (so manifest matches and URL-shape detection run for real).
//
//   npm run test:e2e
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
const server = createServer(
  { key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) },
  (req, res) => {
    const host = req.headers.host ?? "";
    const body = host.startsWith("listado.") ? fixtures.search : fixtures.product;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  }
);
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const dist = join(root, "dist");
const browser = await puppeteer.launch({
  headless: true,
  acceptInsecureCerts: true,
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
    "--disable-dev-shm-usage"
  ]
});

// row lookup helper evaluated in the page
const rowValue = (label) => `
  (() => {
    const row = [...document.querySelectorAll(".mst-row")]
      .find((r) => r.querySelector(".mst-row__label")?.textContent.includes(${JSON.stringify(label)}));
    return row?.querySelector(".mst-row__value")?.textContent ?? null;
  })()
`;

async function typeInto(page, index, text) {
  const inputs = await page.$$(".mst-card input");
  await inputs[index].focus();
  // Triple-click select-all is unreliable in headless; select programmatically
  // so typing replaces any pre-filled value (e.g. the what-if price).
  await inputs[index].evaluate((el) => el.select());
  await inputs[index].type(text, { delay: 20 });
  await page.keyboard.press("Enter"); // confirm = blur = flush debounce
  await new Promise((r) => setTimeout(r, 300));
}

try {
  // --- product page -------------------------------------------------------
  console.log("\nPRODUCT FIXTURE");
  const page = await browser.newPage();
  await browser.defaultBrowserContext().overridePermissions(
    `https://www.mercadolibre.com.mx:${PORT}`,
    ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]
  );
  await page.goto(PRODUCT_URL, { waitUntil: "load" });

  await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  const cardBox = await (await page.$("#mst-card-root")).boundingBox();
  assert.ok(cardBox && cardBox.width > 0 && cardBox.height > 0, "card has no on-screen box");
  pass("card injects and is visible");

  const priceValue = await page.$eval(".mst-card input", (i) => i.value);
  assert.equal(priceValue, "827.00");
  pass("price input pre-filled 827.00 (not the crossed-out $1,199)");

  // structured-data category: breadcrumb is English, so tech (10%) proves
  // the embedded-state path worked
  assert.equal(await page.evaluate(rowValue("Comisión")), "−$82.70");
  assert.equal(await page.evaluate(rowValue("Costo total MELI")), "10%");
  pass("category from structured data → Comisión (10%) = −$82.70, Costo total MELI 10%");

  assert.equal(await page.evaluate(rowValue("Recibirás aprox.")), "$827.00".replace("827.00", "744.30"));
  pass("net payout $744.30");

  await typeInto(page, 1, "50"); // shipping (input 0 is the what-if price)
  await typeInto(page, 2, "400"); // product cost
  assert.equal(await page.evaluate(rowValue("Precio mínimo")), "$500.00");
  pass("cost 400 + shipping 50 → breakeven $500.00");

  await typeInto(page, 3, "20"); // target margin
  assert.equal(await page.evaluate(rowValue("Precio objetivo")), "$642.86");
  pass("margin 20% → target price $642.86");

  await page.click(".mst-copy");
  await new Promise((r) => setTimeout(r, 300));
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  for (const expected of [
    "Precio de venta: $827.00",
    "Comisión (10%): −$82.70",
    "Costo total MELI: 10%",
    "Recibirás aprox.: $694.30",
    "Ganancia: $294.30 (35.59%)"
  ]) {
    assert.ok(clip.includes(expected), `clipboard missing "${expected}"\n--- got:\n${clip}`);
  }
  pass("copy summary writes expected text to clipboard");

  // --- v1.1: what-if price + sweet spot ------------------------------------
  const spotVisibleAt827 = await page.$eval(
    ".mst-sweetspot",
    (e) => e.style.display !== "none"
  );
  assert.equal(spotVisibleAt827, false, "sweet spot should be hidden at $827");

  await typeInto(page, 0, "280"); // what-if price near the $299 threshold
  assert.equal(await page.evaluate(rowValue("Comisión")), "−$28.00");
  assert.equal(await page.evaluate(rowValue("Cargo fijo")), "−$37.00");
  assert.equal(await page.evaluate(rowValue("Recibirás aprox.")), "$165.00");
  pass("what-if price 280 recalculates live (commission −$28.00, fijo −$37.00, net $165.00)");

  const spotText = await page.$eval(".mst-sweetspot", (e) => e.textContent);
  assert.ok(spotText.includes("$299.00"), `sweet spot missing $299.00: ${spotText}`);
  assert.ok(spotText.includes("$54.10"), `sweet spot missing $54.10: ${spotText}`);
  pass("sweet spot nudges $299.00 with exact net gain $54.10");

  await page.click(".mst-sweetspot");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await page.$eval(".mst-card input", (i) => i.value), "299.00");
  assert.equal(await page.evaluate(rowValue("Recibirás aprox.")), "$219.10");
  pass("clicking the nudge applies $299 (net $219.10)");

  await page.click(".mst-reset");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await page.$eval(".mst-card input", (i) => i.value), "827.00");
  assert.equal(await page.evaluate(rowValue("Recibirás aprox.")), "$694.30");
  assert.equal(
    await page.$eval(".mst-sweetspot", (e) => e.style.display !== "none"),
    false
  );
  pass("reset restores page price $827 and hides the nudge");

  // --- v1.1: Clásica vs Premium compare -------------------------------------
  await page.click(".mst-compare-toggle");
  await new Promise((r) => setTimeout(r, 200));
  const compare = await page.evaluate(() => {
    const box = document.querySelector(".mst-compare");
    const vals = [...box.querySelectorAll(".mst-row__value")].map((v) => v.textContent);
    return { visible: box.style.display !== "none", vals };
  });
  assert.equal(compare.visible, true);
  assert.equal(compare.vals[0], "$694.30"); // Clásica 10%, shipping 50
  assert.equal(compare.vals[1], "$657.08 – $673.62"); // Premium 12.5–14.5%
  assert.equal(compare.vals[2], "$20.68 – $37.22"); // MSI cost interval
  pass("compare shows Clásica $694.30 vs Premium $657.08–$673.62, MSI cost $20.68–$37.22");

  // --- search page ----------------------------------------------------------
  console.log("\nSEARCH FIXTURE");
  const search = await browser.newPage();
  await search.goto(SEARCH_URL, { waitUntil: "load" });
  await search.waitForSelector(".mst-strip", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 500)); // let the scan finish all items

  const stripCount = await search.$$eval(".mst-strip", (els) => els.length);
  assert.equal(stripCount, 3);
  pass("3 strips injected (one per result)");

  const collapsed = await search.$$eval(".mst-strip__panel", (panels) =>
    panels.every((p) => p.hidden && p.offsetHeight === 0)
  );
  assert.ok(collapsed, "a strip panel is visible before any click");
  pass("all strips collapsed on load");

  await search.click(".mst-strip__bar");
  await new Promise((r) => setTimeout(r, 200));
  const first = await search.evaluate(() => {
    const panel = document.querySelector(".mst-strip__panel");
    return { hidden: panel.hidden, height: panel.offsetHeight, text: panel.textContent };
  });
  assert.equal(first.hidden, false);
  assert.ok(first.height > 0, "panel has zero height after click");
  assert.ok(first.text.includes("Comisión (10%)"), "expanded panel missing Comisión (10%)");
  assert.ok(first.text.includes("Envío gratis"), "expanded panel missing free-shipping row");
  pass("first strip expands on click with 10% commission + free shipping");

  const firstBar = await search.$eval(".mst-strip__bar b", (b) => b.textContent);
  assert.equal(firstBar, "$744.30");
  pass("collapsed bar shows net $744.30 (skipped crossed-out $999)");

  // --- v1.1: CSV export -------------------------------------------------------
  const exportLabel = await search.$eval(".mst-export__btn", (b) => b.textContent);
  assert.equal(exportLabel, "Exportar CSV (3)");
  pass("export bar present with count (3)");

  // Content scripts live in an isolated world — hooking URL.createObjectURL
  // from the main world can't see the call. Capture the real download instead.
  const dlDir = mkdtempSync(join(tmpdir(), "meli-e2e-dl-"));
  const cdp = await search.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: dlDir
  });
  await search.click(".mst-export__btn");
  let csvFile = null;
  for (let i = 0; i < 50 && !csvFile; i++) {
    await new Promise((r) => setTimeout(r, 100));
    csvFile = readdirSync(dlDir).find((f) => f.endsWith(".csv"));
  }
  assert.ok(csvFile, "no CSV file downloaded within 5s");
  assert.equal(csvFile, "netio-resultados.csv");
  const csv = readFileSync(join(dlDir, csvFile), "utf8");
  rmSync(dlDir, { recursive: true, force: true });
  const lines = csv.replace(/^﻿/, "").split("\r\n");
  assert.equal(lines.length, 4, `expected header + 3 rows, got ${lines.length}`);
  assert.ok(lines[0].startsWith("Título,"), `bad header: ${lines[0]}`);
  assert.ok(
    lines[1].includes("827.00") && lines[1].includes("Clásica") && lines[1].includes("Sí"),
    `row1 wrong: ${lines[1]}`
  );
  assert.ok(
    lines[2].includes("120.00") && lines[2].includes("Premium"),
    `row2 wrong: ${lines[2]}`
  );
  assert.ok(lines[1].includes("Tecnología y electrónica"), `category missing: ${lines[1]}`);
  pass("CSV export: header + 3 rows with prices, types, category, free-shipping");

  console.log(`\nE2E: ${passed.length}/${passed.length} checks passed`);
} finally {
  await browser.close();
  server.close();
  rmSync(certDir, { recursive: true, force: true });
}
