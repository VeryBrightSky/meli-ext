// Headless smoke test: loads the built extension in Chrome against saved
// fixture pages served over local HTTPS with the real MELI hostnames mapped
// to 127.0.0.1 (so manifest matches and URL-shape detection run for real).
//
//   npm run test:e2e
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  await inputs[index].click({ clickCount: 3 });
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

  assert.equal(await page.evaluate(rowValue("Precio de venta")), "$827.00");
  pass("price read $827.00 (not the crossed-out $1,199)");

  // structured-data category: breadcrumb is English, so tech (10%) proves
  // the embedded-state path worked
  assert.equal(await page.evaluate(rowValue("Comisión")), "−$82.70");
  assert.equal(await page.evaluate(rowValue("Costo total MELI")), "10%");
  pass("category from structured data → Comisión (10%) = −$82.70, Costo total MELI 10%");

  assert.equal(await page.evaluate(rowValue("Recibirás aprox.")), "$827.00".replace("827.00", "744.30"));
  pass("net payout $744.30");

  await typeInto(page, 0, "50"); // shipping
  await typeInto(page, 1, "400"); // product cost
  assert.equal(await page.evaluate(rowValue("Precio mínimo")), "$500.00");
  pass("cost 400 + shipping 50 → breakeven $500.00");

  await typeInto(page, 2, "20"); // target margin
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

  console.log(`\nE2E: ${passed.length}/${passed.length} checks passed`);
} finally {
  await browser.close();
  server.close();
  rmSync(certDir, { recursive: true, force: true });
}
