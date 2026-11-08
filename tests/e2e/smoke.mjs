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
  search: readFileSync(join(root, "tests/fixtures/search.html"), "utf8"),
  // Grid layout (fixed-height, overflow-hidden card content) with the v1.5.2
  // listing-signal edge cases (MSI brand, short installment form, shipping
  // words in a title).
  searchGrid: readFileSync(join(root, "tests/fixtures/search-grid.html"), "utf8")
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
// r4: search results WITH links, as MELI renders them. The first result is
// the product fixture's own listing (catalog /p/MLM12345678), the second an
// item link (/MLM-…), the third has no link at all (id cannot be extracted).
fixtures.searchLinked = fixtures.search
  .replace(
    "<h2>Celular Test Pro 128 GB</h2>",
    '<h2><a class="poly-component__title" href="https://www.mercadolibre.com.mx/celular-test-pro/p/MLM12345678?pdp_filters=x#polycard_client=search">Celular Test Pro 128 GB</a></h2>'
  )
  .replace(
    "<h2>Celular Económico 32 GB</h2>",
    '<h2><a class="poly-component__title" href="https://articulo.mercadolibre.com.mx/MLM-2222222222-celular-economico-_JM">Celular Económico 32 GB</a></h2>'
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
      ? (url.includes("grid") ? fixtures.searchGrid : url.includes("linked") ? fixtures.searchLinked : fixtures.search)
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

// Poll storage (from an extension page) until `key` is absent from BOTH the
// local and the sync area, re-removing it if a mirror wrote it back; fails
// after 10 s. Replaces fixed sleeps around stamp removal (r4, minor c).
async function waitForStorageGone(extPage, key, maxMs = 10000) {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const left = await extPage.evaluate(async (k) => ({
      local: (await chrome.storage.local.get(k))[k] ?? null,
      sync: (await chrome.storage.sync.get(k))[k] ?? null
    }), key);
    if (left.local === null && left.sync === null) return;
    assert.ok(Date.now() < deadline, `${key} still in storage after ${maxMs} ms: ${JSON.stringify(left)}`);
    await extPage.evaluate(async (k) => {
      await chrome.storage.sync.remove(k);
      await chrome.storage.local.remove(k);
    }, key);
    await sleep(100);
  }
}

const rowValue = (label) => `
  (() => {
    // r2: the zero-cost fee stack repeats breakdown labels; once a cost is
    // saved it is hidden and its rows are stale, so they never count.
    const row = [...document.querySelectorAll(".mst-row")]
      .filter((r) => !r.closest(".mst-stack[hidden]"))
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

// v1.5.5: the cost input moved up under the summary, so the money inputs
// (.mst-input) are ordered cost, price, shipping, then (PRO) sales, margin.
const IDX = { cost: 0, price: 1, ship: 2, sales: 3, margin: 4, ads: 5 };

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

// Telemetry mock server (phase 9); closed in finally so a failed run never
// leaves its port held.
let mock = null;
try {
  // ====================== PHASE 0: reverse trial ===========================
  // v1.5.5: a fresh install has a 7-day PRO trial that starts with the FIRST
  // SAVED COST (not at install). Verify the "not started" copy first, then
  // stamp install + trial start 9 days back so the rest of the never-paid
  // phases exercise the post-trial (locked) state.
  console.log("\nPHASE 0 — REVERSE TRIAL (fresh install: trial pending, then expired)");
  const extId = await extensionId();
  // onInstalled(reason: install) opens the welcome tab once.
  const welcomeTarget = await browser.waitForTarget(
    (t) => t.url().includes("/src/onboarding/welcome.html"),
    { timeout: 10000 }
  );
  const welcome = await welcomeTarget.page();
  await welcome.waitForFunction(() => (document.getElementById("title")?.textContent ?? "").length > 0, { timeout: 10000 });
  assert.equal(await welcome.$eval("#title", (e) => e.textContent), "Tu prueba PRO está lista");
  const welcomeLead = await welcome.$eval("#lead", (e) => e.textContent);
  assert.ok(welcomeLead.includes("7 días") && welcomeLead.includes("primer costo"), `welcome lead: ${welcomeLead}`);
  assert.equal(await welcome.$eval("#pill", (e) => e.textContent), "PRO · 7 días al guardar tu primer costo");
  assert.equal(await welcome.$eval("#go", (a) => a.href), "https://www.mercadolibre.com.mx/publicaciones/listado");
  assert.equal(await welcome.$eval("#s1t", (a) => a.href), "https://www.mercadolibre.com.mx/publicaciones/listado");
  assert.equal(await welcome.$eval("#s1t", (a) => a.textContent), "Abre una de tus publicaciones");
  assert.ok((await welcome.$eval("#s1b", (e) => e.textContent)).includes("empieza cuando guardes tu primer costo"), "step 1 says when the trial starts");
  assert.equal(await welcome.$eval("#upgrade", (b) => b.hidden), true, "no pay button before the trial");
  assert.ok((await welcome.$eval("#share", (a) => a.href)).includes("wa.me/?text="), "welcome share link");
  pass("install opens the welcome tab: 'Tu prueba PRO está lista', 7 días al primer costo, step 1 links to Mis publicaciones");
  await welcome.close();
  const seed = await browser.newPage();
  await seed.goto(`chrome-extension://${extId}/src/options/options.html`, { waitUntil: "load" });
  await seed.waitForFunction(
    () => (document.getElementById("sub-status")?.textContent ?? "") === "Prueba PRO de 7 días: empieza cuando guardes tu primer costo",
    { timeout: 10000 }
  );
  assert.equal(await seed.$eval("#support-label", (e) => e.textContent), "Soporte: vitowebpro@gmail.com");
  assert.equal(await seed.$eval("#lbl-acquisition", (e) => e.textContent), "Radar: costo supuesto (% del precio) cuando no hay costo guardado");
  pass("fresh install: options shows 'Prueba PRO de 7 días: empieza cuando guardes tu primer costo', support line, Radar label");
  // The first saved cost starts the 7 days: the card rebuilds as PRO on the
  // spot and the options page counts down from 7.
  {
    const first = await browser.newPage();
    await first.goto(PRODUCT_URL, { waitUntil: "load" });
    await first.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
    await first.waitForFunction(() => {
      const b = document.querySelector(".mst-trialbar");
      return b && !b.hidden && b.offsetHeight > 0;
    }, { timeout: 5000 });
    assert.equal(await first.$eval(".mst-trialbar", (e) => e.dataset.tone), "pending");
    assert.ok((await first.$eval(".mst-trialbar__text", (e) => e.textContent)).includes("empieza cuando guardes tu primer costo"), "pending banner copy");
    assert.ok((await first.$$eval(".mst-prochip", (els) => els.length)) > 0, "free card before the first cost");
    assert.equal(await first.$eval(".mst-share", (a) => a.hidden), true, "share hidden until a cost is saved");
    // r2 (a): zero-typing value. With no cost the summary carries the whole
    // fee stack at the page price as hard numbers, and the cost row offers
    // one-tap chips at 40/50/60 % of the price.
    const stack = await first.$$eval(".mst-stack:not([hidden]) .mst-stack__row", (rows) =>
      rows.filter((r) => r.style.display !== "none").map((r) => [r.querySelector(".mst-row__label").textContent, r.querySelector(".mst-row__value").textContent]));
    // r3: the headline IS the net ("Te queda $665.70 por venta"), so the
    // stack does not repeat it; the retentions row says the RFC rates are
    // the registered case. "Recibes aprox." lives in the breakdown only.
    assert.deepEqual(stack, [
      ["Precio de venta", "$827.00"],
      ["Comisión por venta (10%)", "−$82.70"],
      ["Envío estimado (hasta 0.3 kg)", "−$78.60"],
      ["Retenciones con RFC (IVA 8% + ISR 2.5%)", "−$74.85, te depositan $590.85"]
    ]);
    // r4 (minor e): the "sin RFC" caveat is a small line under the row, so
    // the row itself is label + value (the value never wraps).
    assert.equal(await first.$eval(".mst-stack__hint", (e) => ({ hidden: e.hidden, text: e.textContent })).then((h) => JSON.stringify(h)), JSON.stringify({ hidden: false, text: "Sin RFC te retienen más" }));
    assert.equal(await first.$eval(".mst-summary__net", (e) => e.textContent), "Te queda $665.70 por venta (antes de IVA/ISR)");
    assert.equal(await first.$$eval(".mst-card .mst-row__label", (ls) => ls.filter((l) => l.textContent === "Te queda").length), 0, "no second 'Te queda' row");
    assert.equal(await first.$$eval(".mst-card .mst-row__label", (ls) => ls.filter((l) => l.textContent === "Recibes aprox.").length), 1, "exactly one 'Recibes aprox.' row");
    assert.ok(await first.$eval(".mst-breakdown", (d) => [...d.querySelectorAll(".mst-row__label")].some((l) => l.textContent === "Recibes aprox.")), "'Recibes aprox.' is inside the breakdown");
    assert.equal(await first.$eval(".mst-row--cost .mst-row__label", (e) => e.textContent), "¿Cuánto te cuesta?");
    assert.deepEqual(await first.$$eval(".mst-chips:not([hidden]) .mst-chip", (c) => c.map((x) => x.textContent)), ["40% · $330.80", "50% · $413.50", "60% · $496.20"]);
    assert.equal(await first.$eval(".mst-summary__profit", (e) => e.textContent), "Toca un costo abajo, o escribe el tuyo, para ver tu ganancia.");
    pass("fresh install, no cost: fee stack ($827, −$82.70, −$78.60, retenciones −$74.85 → $590.85, no duplicate net row) and 40/50/60 % chips");
    // r3 (blocker 1): the trial stamp is written in the SAME storage write as
    // the first cost. Tap a chip and navigate away within 500 ms (before the
    // card can rebuild): the next page must already be in the 7-day trial,
    // and the cost must be saved. Then put the install back to "pending".
    await first.$$eval(".mst-chip", (c) => c[1].click()); // 50% → $413.50
    await first.goto(`https://www.mercadolibre.com.mx:${PORT}/otro-celular/p/MLM99999999`, { waitUntil: "load" });
    await first.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
    await first.waitForFunction(() => {
      const b = document.querySelector(".mst-trialbar");
      return b && !b.hidden && b.offsetHeight > 0;
    }, { timeout: 5000 });
    assert.equal(await first.$eval(".mst-trialbar", (e) => e.dataset.tone), "active", "trial active on the very next page");
    assert.ok((await first.$eval(".mst-trialbar__text", (e) => e.textContent)).includes("te quedan 7 días"), "7 days on the next page");
    const raced = await seed.evaluate(async () => ({
      local: await chrome.storage.local.get(["mst:cost:MLM12345678", "mst:trialStartedAt", "mst:trialSchema"]),
      sync: await chrome.storage.sync.get("mst:trialStartedAt")
    }));
    assert.equal(raced.local["mst:cost:MLM12345678"], 413.5, "chip cost saved despite the navigation");
    assert.ok(raced.local["mst:trialStartedAt"] > 0, "stamp written with the cost");
    assert.equal(raced.local["mst:trialSchema"], 2, "worker stamped the trial schema on install");
    assert.equal(raced.sync["mst:trialStartedAt"], raced.local["mst:trialStartedAt"], "stamp mirrored to sync");
    pass("chip tap + navigation within 500 ms: next page shows 'te quedan 7 días', cost and stamp saved together");
    // r4 (minor c): the trial stamp is mirrored local <-> sync and the
    // service worker re-derives it on every storage change, so removing the
    // local copy while the sync copy still exists could restore it (the old
    // fixed 5 s wait for "pending" then flaked). Remove sync first, then
    // local, and wait until BOTH areas report it gone (max 10 s) before the
    // page that must come up "pending" is loaded.
    await seed.evaluate(async () => {
      await chrome.storage.sync.remove("mst:trialStartedAt");
      await chrome.storage.local.remove(["mst:cost:MLM12345678", "mst:meta:MLM12345678", "mst:trialStartedAt", "mst:hist:MLM99999999"]);
    });
    await waitForStorageGone(seed, "mst:trialStartedAt");
    // Schema 2: a cost key alone never migrates (the cost is gone here too,
    // but a stale cost would not start anything either).
    await first.goto(PRODUCT_URL, { waitUntil: "load" });
    await first.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
    await first.waitForFunction(() => (document.querySelector(".mst-trialbar")?.dataset.tone ?? "") === "pending", { timeout: 10000, polling: 100 });
    assert.equal(await first.$eval(".mst-chips", (e) => e.hidden), false, "chips back (no cost)");
    // r3 (minor 15): no automatic start at day 30. An install 31 days old with
    // no cost is still pending and the banner reminds what starts the trial.
    const installedNow = (await seed.evaluate(async () => chrome.storage.local.get("mst:installedAt")))["mst:installedAt"];
    await seed.evaluate(async () => {
      const back = Date.now() - 31 * 24 * 3600 * 1000;
      await chrome.storage.local.set({ "mst:installedAt": back });
      await chrome.storage.sync.set({ "mst:installedAt": back });
    });
    await first.reload({ waitUntil: "load" });
    await first.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
    await first.waitForFunction(() => {
      const b = document.querySelector(".mst-trialbar");
      return b && !b.hidden && b.offsetHeight > 0;
    }, { timeout: 5000 });
    assert.equal(await first.$eval(".mst-trialbar", (e) => e.dataset.tone), "pending", "still pending at day 31");
    assert.equal(await first.$eval(".mst-trialbar__text", (e) => e.textContent), "Tu prueba PRO empieza cuando guardes tu primer costo");
    assert.ok((await first.$$eval(".mst-prochip", (els) => els.length)) > 0, "still the free card: no automatic trial");
    const day31 = await seed.evaluate(async () => chrome.storage.local.get("mst:trialStartedAt"));
    assert.equal(day31["mst:trialStartedAt"], undefined, "no start stamp written by itself");
    pass("day 31 without a cost: no automatic trial, banner 'Tu prueba PRO empieza cuando guardes tu primer costo'");
    await seed.evaluate(async (ts) => {
      await chrome.storage.local.set({ "mst:installedAt": ts });
      await chrome.storage.sync.set({ "mst:installedAt": ts });
    }, installedNow);
    // r3 (minor 8): Spanish regardless of the browser locale, English only via
    // the options toggle (storage.sync mst:lang); money stays "$" (never MX$).
    await seed.reload({ waitUntil: "load" });
    await seed.waitForFunction(() => (document.getElementById("lbl-lang")?.textContent ?? "") !== "", { timeout: 10000 });
    assert.equal(await seed.$eval("#lbl-lang", (e) => e.textContent), "Idioma");
    assert.equal(await seed.$eval("#lang", (e) => e.value), "es_419");
    assert.equal(await seed.$eval("#lbl-privacy", (e) => e.textContent), "Tus costos, ventas y el historial de precios de las publicaciones que abres se guardan solo en tu navegador. No tenemos servidores.");
    // The options page reloads itself after saving the language: wait for
    // that navigation (a waitForFunction alone can be lost with the old
    // document and time out).
    await Promise.all([seed.waitForNavigation({ waitUntil: "load", timeout: 10000 }), seed.select("#lang", "en")]);
    await seed.waitForFunction(() => (document.getElementById("lbl-lang")?.textContent ?? "") === "Language", { timeout: 10000 });
    assert.equal(await seed.evaluate(async () => (await chrome.storage.sync.get("mst:lang"))["mst:lang"]), "en");
    assert.equal(await seed.$eval("#lbl-card", (e) => e.textContent), "Show the calculator on listings");
    await first.reload({ waitUntil: "load" });
    await first.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
    await first.waitForFunction(() => (document.querySelector(".mst-summary__net")?.textContent ?? "").includes("$665.70"), { timeout: 5000 });
    assert.equal(await first.$eval(".mst-summary__net", (e) => e.textContent), "You keep $665.70 per sale (before VAT/income tax)");
    assert.equal(await first.$eval("#mst-card-root", (c) => c.textContent.includes("MX$")), false, "money stays '$' in English");
    await Promise.all([seed.waitForNavigation({ waitUntil: "load", timeout: 10000 }), seed.select("#lang", "es_419")]);
    await seed.waitForFunction(() => (document.getElementById("lbl-lang")?.textContent ?? "") === "Idioma", { timeout: 10000 });
    await first.reload({ waitUntil: "load" });
    await first.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
    await first.waitForFunction(() => (document.querySelector(".mst-summary__net")?.textContent ?? "").startsWith("Te queda"), { timeout: 5000 });
    pass("language: Spanish by default, options 'Idioma' → English switches the card ('You keep $665.70 per sale', still '$'), back to Spanish");
    // r2 (a): a chip tap saves the cost exactly like typing: input filled,
    // 'Guardado', chips and stack gone, profit shown, trial started.
    await first.$$eval(".mst-chip", (c) => c[1].click()); // 50% → $413.50
    // The first cost starts the trial and the card is rebuilt as PRO at
    // once; "Guardado" must still be visible on the rebuilt card (r3).
    await first.waitForFunction(() => {
      const n = document.querySelector(".mst-saved");
      return n && !n.hidden && document.querySelectorAll(".mst-prochip").length === 0;
    }, { timeout: 3000, polling: 50 });
    assert.equal(await first.$eval(".mst-saved", (e) => e.textContent), "Guardado para esta publicación");
    assert.equal(await first.$$eval(".mst-card input.mst-input", (i, k) => i[k].value, IDX.cost), "413.50");
    assert.equal(await first.$eval(".mst-chips", (e) => e.hidden), true, "chips hide once a cost is saved");
    assert.equal(await first.$eval(".mst-stack", (e) => e.hidden), true, "stack hides once a cost is saved");
    assert.equal(await first.$eval(".mst-row--cost .mst-row__label", (e) => e.textContent), "Costo del producto");
    // startTrial → onChange → the content script rebuilds the card as PRO.
    await first.waitForFunction(
      () => document.querySelector("#mst-card-root") && document.querySelectorAll(".mst-prochip").length === 0 && (document.querySelector(".mst-trialbar")?.dataset.tone ?? "") === "active",
      { timeout: 10000, polling: 250 }
    );
    assert.ok((await first.$eval(".mst-trialbar__text", (e) => e.textContent)).includes("te quedan 7 días"), "active banner after the first cost");
    const proLine = await first.$eval(".mst-summary__pro", (e) => ({ hidden: e.hidden, text: e.textContent }));
    assert.equal(proLine.hidden, false, "PRO line visible with a cost");
    // r3: the margin here (30.49 %) already meets the 30 % target, so the
    // line must not point at a LOWER price ($820.17 for 30 %): it names the
    // price for 10 more points instead (41 %: $1,004.29).
    assert.equal(proLine.text, "PRO: a $1,004.29 ganas el 41%");
    // r4 (minor b): the bold target row must not contradict that line with a
    // LOWER price ($820.17 for 30 %): it states the margin already met at
    // the current price, and the max-cost row under it keeps the target.
    assert.equal(await first.evaluate(rowValue("Ya ganas 30.5% a este precio")), "$827.00");
    assert.equal(await first.evaluate(rowValue("Precio para ganar 30%")), null, "no lower price proposed anywhere on the card");
    assert.equal(await first.$eval("#mst-card-root", (c) => c.textContent.includes("$820.17")), false, "$820.17 (30% at a lower price) is nowhere on the card");
    assert.equal(await first.$eval(".mst-share", (a) => a.hidden), false, "share shown once a cost is saved");
    // 665.70 − 413.50 = 252.20 → 30.49 % of 827
    assert.equal(await first.$eval(".mst-summary__profit", (e) => e.textContent), "Ganancia $252.20 · 30.5%");
    // r2 (c): PRO max cost at the page price for the default 30 %:
    // 827 × (1 − 0.10 − 0.30) − 78.60 = 417.60
    assert.equal(await first.evaluate(rowValue("Costo máximo para ganar 30%")), "$417.60");
    pass("chip tap = first saved cost: 'Guardado', $413.50 in the input, trial starts (7 días), card rebuilds as PRO, Ganancia $252.20 · 30.5%, PRO line points up (41%), costo máximo $417.60");
    // r4 (major a): the Radar strip for THIS listing uses the saved cost, so
    // the search page shows the card's own profit and margin ($252.20 · 30.5%,
    // "tu costo"), not the assumed 60 %. A result whose link carries no id
    // falls back to the assumption with the existing label.
    {
      const linked = await browser.newPage();
      await linked.goto(`${SEARCH_URL}?linked`, { waitUntil: "load" });
      await linked.waitForFunction(() => document.querySelectorAll(".mst-strip").length === 3, { timeout: 20000, polling: 100 });
      const strips = await linked.$$eval(".mst-strip", (els) =>
        els.map((e) => ({
          id: e.dataset.itemId ?? null,
          saved: e.dataset.savedCost ?? null,
          bucket: e.dataset.bucket,
          profit: e.querySelector(".mst-strip__verdict b")?.textContent ?? null,
          margin: e.querySelector(".mst-strip__margin")?.textContent ?? null,
          basis: e.querySelector(".mst-strip__assumed")?.textContent ?? null
        }))
      );
      assert.deepEqual(strips[0], { id: "MLM12345678", saved: "413.5", bucket: "profit", profit: "$252.20", margin: "30.5%", basis: "tu costo" }, JSON.stringify(strips[0]));
      assert.equal(strips[1].id, "MLM2222222222", "item link id");
      assert.equal(strips[1].saved, null, "no saved cost for the 2nd result");
      assert.equal(strips[1].basis, null, "PRO strip without a saved cost carries no basis label");
      assert.equal(strips[2].id, null, "no link → no id");
      assert.equal(strips[2].saved, null);
      await linked.click(".mst-strip__bar");
      await linked.waitForFunction(() => !document.querySelector(".mst-strip__panel").hidden, { timeout: 2000 });
      const rows = await linked.$eval(".mst-strip__panel", (p) =>
        Object.fromEntries([...p.querySelectorAll(".mst-strip__row")].map((r) => [r.querySelector(".mst-strip__label").textContent, r.querySelector(".mst-strip__value").textContent]))
      );
      assert.equal(rows["Recibes aprox."], "$665.70", JSON.stringify(rows));
      assert.equal(rows["Ganancia (tu costo: $413.50)"], "$252.20", JSON.stringify(rows));
      assert.equal(rows["Envío estimado (hasta 0.3 kg)"], "−$78.60", JSON.stringify(rows));
      const summary = await linked.$eval(".mst-radar__summary", (e) => e.textContent);
      assert.ok(summary.startsWith("Analizados: 3 · rentables: 1"), summary);
      await linked.close();
      pass("search strips use the saved cost: $827 result shows $252.20 · 30.5% 'tu costo' like the card; no-id result keeps the assumption");
    }
    // r3 (major 7): the banner button opens the plan panel (yearly first,
    // "ahorras $369"; monthly "$89 al mes (menos de $3 al día)"), never a
    // bare "$89/mes" checkout.
    assert.equal(await first.$eval(".mst-trialbar__btn", (b) => b.textContent), "Quedarme con PRO");
    await first.click(".mst-trialbar__btn");
    await first.waitForFunction(() => !document.querySelector(".mst-upsell")?.hidden, { timeout: 3000 });
    const trialPanel = await first.$eval(".mst-upsell", (p) => ({
      reason: p.dataset.reason,
      lead: p.querySelector(".mst-upsell__lead").textContent,
      pricing: p.querySelector(".mst-upsell__price").textContent,
      buttons: [...p.querySelectorAll(".mst-upsell__actions button")].map((b) => b.textContent)
    }));
    assert.equal(trialPanel.reason, "trial");
    assert.equal(trialPanel.lead, "Quédate con PRO cuando termine tu prueba");
    assert.equal(trialPanel.pricing, "PRO anual: $699 al año (ahorras $369). Mensual: $89 al mes (menos de $3 al día). Sin permanencia.");
    assert.deepEqual(trialPanel.buttons, ["Activar PRO · $699 al año (ahorras $369)", "$89 al mes (menos de $3 al día)"]);
    assert.equal(await first.$eval("#mst-card-root", (c) => /89\/mes/.test(c.textContent)), false, "no '$89/mes' anywhere on the card");
    pass("trial banner 'Quedarme con PRO' opens the plan panel: yearly (ahorras $369) first, monthly ($89 al mes, menos de $3 al día) second");
    await first.close();
    await seed.reload({ waitUntil: "load" });
    await seed.waitForFunction(
      () => (document.getElementById("sub-status")?.textContent ?? "") === "Prueba PRO: te quedan 7 días",
      { timeout: 10000 }
    );
    pass("options after the first cost: 'Prueba PRO: te quedan 7 días'");
    // Back to a clean slate for the never-paid phases (cost removed; the
    // trial stamps are set explicitly below).
    await seed.evaluate(async () => {
      await chrome.storage.local.remove(["mst:cost:MLM12345678", "mst:meta:MLM12345678"]);
    });
  }
  if (process.env.E2E_SHOTS) {
    const trialPage = await browser.newPage();
    await trialPage.goto(PRODUCT_URL, { waitUntil: "load" });
    await trialPage.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
    await sleep(600);
    await (await trialPage.$("#mst-card-root")).screenshot({ path: join(process.env.E2E_SHOTS, "card-trial.png") });
    await trialPage.close();
  }
  await seed.evaluate(async () => {
    const back = Date.now() - 9 * 24 * 3600 * 1000;
    await chrome.storage.local.set({ "mst:installedAt": back, "mst:trialStartedAt": back });
    await chrome.storage.sync.set({ "mst:installedAt": back, "mst:trialStartedAt": back });
  });
  await seed.reload({ waitUntil: "load" });
  await seed.waitForFunction(
    () => (document.getElementById("sub-status")?.textContent ?? "").includes("terminó"),
    { timeout: 10000 }
  );
  pass("install + trial start stamped 9 days back → status 'tu prueba PRO terminó'");
  // v1.5.2 (E): the welcome page after an expired trial (reinstall case) must
  // not claim 7 days of PRO.
  await seed.goto(`chrome-extension://${extId}/src/onboarding/welcome.html`, { waitUntil: "load" });
  await seed.waitForFunction(() => (document.getElementById("title")?.textContent ?? "").length > 0, { timeout: 10000 });
  assert.equal(await seed.$eval("#title", (e) => e.textContent), "Tu prueba PRO ya terminó");
  assert.equal(await seed.$eval("#lead", (e) => e.textContent), "Puedes seguir usando la calculadora gratis o activar PRO. Así le sacas provecho:");
  assert.equal(await seed.$eval("#pill", (e) => e.textContent), "Plan gratuito");
  assert.ok(!(await seed.$eval("main", (e) => e.textContent)).includes("7 días"), "welcome must not promise 7 días after the trial");
  const upg = await seed.$eval("#upgrade", (b) => ({ hidden: b.hidden, text: b.textContent, shown: b.offsetWidth > 0 }));
  assert.deepEqual(upg, { hidden: false, text: "Activar PRO · $699 al año (ahorras $369)", shown: true });
  pass("welcome after an expired trial: 'Tu prueba PRO ya terminó', free pill, no '7 días', 'Activar PRO' button");
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

  // Answer-first summary + collapsed breakdown. v1.5.2 (I): with no shipping
  // set anywhere, an $827 listing (free shipping mandatory, seller pays) is
  // headlined with the 0.3 kg Mercado Envíos estimate the sweet spot already
  // assumed, instead of $0. v1.5.3: the estimate comes from the OFFICIAL
  // table of the seller's reputation at the listing's price band; the default
  // "Sin reputación" reads the amarilla table and $827 sits in the
  // $499–998.99 band → $78.60 (v1.5.2 showed $52.40, the verde $299 column):
  // 827 − 82.70 − 78.60 = 665.70.
  await page.waitForFunction(() => (document.querySelector(".mst-summary__net")?.textContent ?? "").includes("$665.70"), { timeout: 5000 });
  assert.equal(await page.$eval(".mst-summary__net", (e) => e.textContent), "Te queda $665.70 por venta (antes de IVA/ISR)");
  assert.equal(await page.$eval("details.mst-breakdown", (d) => d.open), false, "breakdown collapsed by default");
  assert.ok(
    await page.$eval("details.mst-breakdown", (d) => d.textContent.includes("Comisión por venta")),
    "commission row lives inside the breakdown"
  );
  pass("summary leads with 'Te queda $665.70 por venta (antes de IVA/ISR)' (0.3 kg official estimate, sin reputación, $499–998.99 band); fee breakdown collapsed by default");
  // r3: the shipping label says who pays from $299, and the shipping input
  // sits inside the breakdown ("Ver desglose de cargos y envío").
  const shipLabels = await page.$$eval(".mst-card .mst-row__label", (ls) => ls.map((l) => l.textContent).filter((t) => t.startsWith("Tu costo de envío")));
  assert.deepEqual(shipLabels, ["Tu costo de envío (desde $299 lo pagas tú)"]);
  assert.ok(await page.$eval("details.mst-breakdown", (d) => d.contains(document.querySelectorAll(".mst-card input.mst-input")[2])), "shipping input inside the breakdown");
  pass("shipping label 'Tu costo de envío (desde $299 lo pagas tú)', input inside the breakdown");
  // The estimate sits in the shipping row, marked as an estimate, editable.
  const shipEst = await page.$$eval(".mst-card input.mst-input", (inputs, k) => ({
    value: inputs[k].value,
    estimate: inputs[k].dataset.estimate,
    title: inputs[k].title,
    disabled: inputs[k].disabled
  }), IDX.ship);
  assert.deepEqual(shipEst, { value: "78.60", estimate: "1", title: "Estimado", disabled: false });
  const estTag = await page.$eval(".mst-estimate-tag", (e) => ({ hidden: e.hidden, text: e.textContent, shown: e.offsetWidth > 0 }));
  assert.deepEqual(estTag, { hidden: false, text: "est.", shown: true });
  pass("shipping row shows the autofilled 78.60 estimate (marked 'Estimado' + visible 'est.' tag, editable)");
  // The estimate carries the 40% amarilla / sin reputación discount already;
  // the row says so instead of subtracting anything again.
  await openBreakdown(page);
  assert.equal(await page.evaluate(rowValue("Descuento por reputación")), "Ya incluido en la tabla (40%)");
  pass("reputation discount row: 'Ya incluido en la tabla (40%)' for the sin reputación estimate (nothing subtracted twice)");

  // Spanish UI must render Spanish (regression: chrome.i18n served English).
  assert.equal(await page.$eval(".mst-title", (e) => e.textContent), "Calculadora de ganancias");
  pass("Spanish locale renders Spanish UI (Calculadora de ganancias)");

  assert.equal(await page.$$eval(".mst-card input.mst-input", (i, k) => i[k].value, IDX.price), "827.00");
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i, k) => i[k].disabled, IDX.price), true);
  pass("price pre-filled 827.00 and read-only (what-if locked)");

  assert.equal(await page.evaluate(rowValue("Comisión")), "−$82.70");
  assert.equal(await page.evaluate(rowValue("Costo total")), "10%");
  assert.equal(await page.evaluate(rowValue("Recibes aprox.")), "$665.70");
  pass("free fee card intact: 10% category via structured data, net $665.70 (827 − 82.70 − 78.60 est. shipping)");

  // Retenciones is FREE (accuracy feature), default off (row hidden/empty).
  assert.equal(await page.evaluate(rowValue("IVA retenido")), "");
  await openBreakdown(page);
  await page.click(".mst-withholdings-toggle");
  await sleep(300);
  assert.equal(await page.evaluate(rowValue("IVA retenido")), "−$57.03");
  assert.equal(await page.evaluate(rowValue("ISR retenido")), "−$17.82");
  assert.equal(await page.evaluate(rowValue("Neto después")), "$590.85"); // 665.70 − 74.85
  pass("retenciones (free): IVA −$57.03, ISR −$17.82, neto después $590.85");
  // v1.5.5: the headline is before IVA/ISR, so with the toggle on one line
  // under it names the retentions and what lands after them.
  assert.equal(
    await page.$eval(".mst-summary__retentions", (e) => (e.hidden ? "" : e.textContent)),
    "Retenciones IVA 8% + ISR 2.5%: $74.85. Después de retenciones te quedan $590.85"
  );
  pass("summary retentions line: 'Retenciones IVA 8% + ISR 2.5%: $74.85. Después de retenciones te quedan $590.85'");
  // v1.5.5: the category picker lives in the breakdown while the category is
  // known, and jumps above the fold (under the cost) with a hint when it is
  // not, so the seller can fix the range without opening the details.
  assert.ok(await page.$("details.mst-breakdown .mst-select"), "category select inside the breakdown when detected");
  await page.evaluate(() => {
    const sel = document.querySelector("details.mst-breakdown .mst-select");
    sel.value = "";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(200);
  const catAbove = await page.evaluate(() => {
    const slot = document.querySelector(".mst-catslot");
    return {
      select: Boolean(slot?.querySelector(".mst-select")),
      hint: slot?.querySelector(".mst-hint")?.textContent ?? "",
      beforeBreakdown: Boolean(slot && document.querySelector("details.mst-breakdown") && (slot.compareDocumentPosition(document.querySelector("details.mst-breakdown")) & Node.DOCUMENT_POSITION_FOLLOWING))
    };
  });
  assert.deepEqual(catAbove, { select: true, hint: "No detectamos la categoría. Elígela para ver un número exacto.", beforeBreakdown: true });
  // r2 (item 8): unknown category → the headline is the worst case as ONE
  // number (official 8–17 %: 827 − 140.59 − 78.60 = 607.81), the best case
  // on a small line, and the range stays in the breakdown.
  assert.equal(await page.$eval(".mst-summary__net", (e) => e.textContent), "Te quedan al menos $607.81 por venta");
  assert.equal(await page.$eval(".mst-summary__upto", (e) => (e.hidden ? "" : e.textContent)), "hasta $682.24 según la categoría");
  assert.equal(await page.evaluate(rowValue("Recibes aprox.")), "$607.81 – $682.24");
  pass("no category: headline 'Te quedan al menos $607.81 por venta', 'hasta $682.24 según la categoría', range kept in 'Recibes aprox.'");
  await page.evaluate(() => {
    const sel = document.querySelector(".mst-catslot .mst-select");
    sel.value = "tech";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(200);
  assert.ok(await page.$("details.mst-breakdown .mst-select"), "category select back in the breakdown once picked");
  assert.equal(await page.evaluate(rowValue("Comisión")), "−$82.70");
  assert.equal(await page.$eval(".mst-summary__upto", (e) => e.hidden), true, "no 'hasta' line with an exact rate");
  pass("no category: selector + 'No detectamos la categoría. Elígela para ver un número exacto.' above the fold; picked again → back in the breakdown");

  // v1.5.2 critic: with nothing configured, the dashboard applies the same
  // 0.3 kg estimate as the card, so both show the same ganancia for this
  // listing (v1.5.3 official table: 827 − 82.70 − 78.60 − 400 = 265.70).
  await typeInto(page, IDX.cost, "400"); // product cost (persists cost + meta, not the estimate)
  await openBreakdown(page);
  const cardProfit = await page.evaluate(rowValue("Ganancia"));
  assert.ok(cardProfit.startsWith("$265.70"), `card profit: ${cardProfit}`);
  {
    const d0 = await browser.newPage();
    await d0.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html`, { waitUntil: "load" });
    await d0.waitForFunction(() => !document.getElementById("content")?.hidden, { timeout: 10000 });
    const rowText = await d0.$eval("#rows tr", (tr) => tr.textContent);
    assert.ok(rowText.includes("$265.70"), `dashboard row: ${rowText}`);
    const note = await d0.$eval("#shipping-note", (e) => e.textContent);
    assert.equal(note, "Envío: estimado con la tabla oficial de Mercado Envíos según peso, precio y reputación (0.3 kg si no elegiste peso). Cifras estimadas.");
    assert.ok(!note.includes("$0.00"));
    await d0.close();
  }
  pass("card and dashboard agree on the shipping estimate: ganancia $265.70 in both, dashboard note says 'estimado'");

  await typeInto(page, IDX.ship, "50"); // shipping: typed, replaces the estimate
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i, k) => i[k].dataset.estimate, IDX.ship), "", "typed shipping is no longer marked as an estimate");
  assert.equal(await page.$eval(".mst-estimate-tag", (e) => e.hidden), true, "'est.' tag hides once the seller types");
  assert.equal(await page.evaluate(rowValue("Recibes aprox.")), "$694.30");
  await typeInto(page, IDX.cost, "400"); // product cost
  assert.equal(await page.evaluate(rowValue("Precio mínimo")), "$500.00");
  pass("typed shipping 50 replaces the estimate (net $694.30); breakeven stays FREE: cost 400 + ship 50 → $500.00");

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
  // r2 (e): the banner and the panel name what THIS seller loses with their
  // own numbers: one saved product (this listing, cost 400, typed shipping
  // 50 → ganancia $294.30, 35.59 %), yearly plan first. The banner reads
  // storage when the card is built, so reload now that a cost is saved.
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  await page.waitForFunction(() => (document.querySelector(".mst-summary__profit")?.textContent ?? "").startsWith("Ganancia"), { timeout: 10000 });
  const ganancia = (await page.evaluate(rowValue("Ganancia"))).split(" ")[0];
  await page.waitForFunction((g) => (document.querySelector(".mst-trialbar__text")?.textContent ?? "").includes(g), { timeout: 5000 }, ganancia);
  const banner = await page.$eval(".mst-trialbar__text", (e) => e.textContent);
  assert.ok(banner.startsWith("Tu prueba PRO terminó. Tu producto guardado, ") && banner.endsWith(`, deja ${ganancia} por venta.`), banner);
  await page.click(".mst-trialbar__btn");
  await page.waitForFunction(() => !document.querySelector(".mst-upsell")?.hidden, { timeout: 3000 });
  await page.waitForFunction(() => (document.querySelector(".mst-upsell__lead")?.textContent ?? "").includes("producto guardado"), { timeout: 3000 });
  const expiredPanel = await page.$eval(".mst-upsell", (p) => ({
    reason: p.dataset.reason,
    lead: p.querySelector(".mst-upsell__lead").textContent,
    body: p.querySelector(".mst-upsell__body").textContent,
    buttons: [...p.querySelectorAll(".mst-upsell__actions button")].map((b) => b.textContent),
    afterBanner: p.previousElementSibling?.classList.contains("mst-trialbar")
  }));
  assert.equal(expiredPanel.reason, "expired");
  assert.equal(expiredPanel.lead, "Tu prueba PRO terminó: tu producto guardado se quedó sin precio objetivo");
  assert.ok(expiredPanel.body.includes(`deja ${ganancia} por venta`) && expiredPanel.body.includes("costo máximo"), expiredPanel.body);
  assert.deepEqual(expiredPanel.buttons, ["Activar PRO · $699 al año (ahorras $369)", "$89 al mes (menos de $3 al día)"]);
  assert.equal(expiredPanel.afterBanner, true, "panel opens right under the banner");
  await page.$$eval(".mst-upsell__close", (b) => b[b.length - 1].click()); // Ahora no
  assert.equal(await page.$eval(".mst-upsell", (e) => e.hidden), true);
  pass(`expired: banner 'Tu producto guardado, …, deja ${ganancia} por venta', panel with own numbers, yearly ($699, ahorras $369) first`);

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
  await typeInto(page, IDX.cost, "900");
  assert.equal(await alertVisible(), true);
  const alertText = await page.$eval(".mst-alert__text", (e) => e.textContent);
  assert.ok(alertText.includes("Pierdes $205.70 por venta"), `alert text: ${alertText}`);
  // r3: nobody forwards a loss: the share link hides while the margin is ≤ 0.
  assert.equal(await page.$eval(".mst-share", (a) => a.hidden), true, "share hidden on a loss");
  pass("red-number moment: alert strip names the real loss ($205.70) and offers the fix; share link hidden on a loss");
  await typeInto(page, IDX.cost, "400");
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
  // r2: yearly first with the saving in pesos (12 × 89 − 699 = 369), monthly
  // second with the per-day figure (89 / 30 = 2.97), and the pricing line.
  const planOrder = await page.$$eval(".mst-upsell__actions button", (b) => b.map((x) => x.textContent));
  assert.deepEqual(planOrder, ["Activar PRO · $699 al año (ahorras $369)", "$89 al mes (menos de $3 al día)"], "yearly first, monthly second");
  assert.ok(upsellText.includes("PRO anual: $699 al año (ahorras $369). Mensual: $89 al mes (menos de $3 al día)."), "upsell missing the one plan message");
  assert.ok(!/89\/mes|89 al mes(?! \(menos)/.test(upsellText), `stray monthly-only price: ${upsellText}`);
  assert.ok(upsellText.includes("Ya pagué: iniciar sesión"), "upsell missing the 'already paid' login link");
  // Panel opens next to the clicked teaser, not at the bottom of the card.
  assert.equal(
    await page.$eval(".mst-upsell", (p) => p.previousElementSibling?.classList.contains("mst-row--teaser")),
    true,
    "upsell should open right after the clicked teaser"
  );
  pass("teaser click opens the upsell beside it, without leaking the blurred price (yearly $699 ahorras $369 first, $89/mes menos de $3 al día second)");

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

  // Review ask (v1.5.5): never for an expired-trial user, even with 3+ used
  // listings. The positive path is asserted in the PRO phase.
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
  await sleep(600);
  assert.equal(await page.$(".mst-review"), null, "expired trial: never asked for a review");
  pass("review ask never shown to an expired-trial user (3 used listings)");
  await seedPage(() => chrome.storage.local.remove(["mst:cost:MLM1", "mst:cost:MLM2"]));
  // r4 (minor d): an ads % saved during the trial is not in the free card's
  // numbers (the input is PRO); the card says so under the summary instead
  // of dropping it silently. Net stays $694.30 (no ads deducted).
  await seedPage(() => chrome.storage.local.set({ "mst:ads:MLM12345678": 10 }));
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector(".mst-summary__adshint")?.hidden, { timeout: 5000, polling: 100 });
  assert.equal(await page.$eval(".mst-summary__adshint", (e) => e.textContent), "Publicidad (10%) solo se aplica con PRO");
  assert.equal(await page.evaluate(rowValue("Recibes aprox.")), "$694.30", "free net ignores the saved ads %");
  assert.equal(await page.evaluate(rowValue("Publicidad (10%)")), null, "no ads row on the free card");
  pass("expired trial with a saved 10% ads: hint 'Publicidad (10%) solo se aplica con PRO', net unchanged ($694.30)");
  await seedPage(() => chrome.storage.local.remove("mst:ads:MLM12345678"));
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  await page.waitForFunction(() => document.querySelector(".mst-summary__adshint")?.hidden === true, { timeout: 5000, polling: 100 });

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
  // r3 (blocker 2): every strip pays the same shipping the card does for the
  // listing: the seller's typed $50 (card default) on all three results.
  // 827: 694.30 − 496.20 = 198.10 (23.95 %, thin); 2,499: 699.70 (28 %, thin);
  // the $120 Premium item: 52.60 − 72 = −19.40 (loss). No winner at 30 %.
  const preview = await freeSearch.$eval(".mst-radar--preview .mst-radar__summary", (e) => e.textContent);
  assert.equal(preview, "Analizados: 3 · rentables: 0 · marginales: 2 · en pérdida: 1 (costo supuesto: 60% del precio)", preview);
  pass("free search bar: real radar counts at the assumed 60% cost, shipping included (0 rentables, 2 marginales, 1 pérdida)");
  const previewBuckets = await freeSearch.$$eval(".mst-strip", (els) => els.map((e) => e.dataset.preview));
  assert.deepEqual(previewBuckets.filter(Boolean).length, 3, `preview stamps: ${previewBuckets}`);
  const shownVerdicts = await freeSearch.$$eval(".mst-strip__verdict", (els) => els.length);
  assert.equal(shownVerdicts, 3, `free verdict pills: ${shownVerdicts}`);
  // Each visible free verdict names its assumption inline.
  const assumedLabels = await freeSearch.$$eval(".mst-strip__assumed", (els) => els.map((e) => e.textContent));
  assert.deepEqual(assumedLabels, ["con costo supuesto 60%", "con costo supuesto 60%", "con costo supuesto 60%"]);
  // The first strip ($827) shows the same net the card shows for it.
  await freeSearch.click(".mst-strip__bar");
  await sleep(150);
  const freePanel = await freeSearch.$eval(".mst-strip__panel", (e) => e.textContent);
  assert.ok(freePanel.includes("Tu costo de envío") && freePanel.includes("−$50.00"), `strip panel lacks the shipping row: ${freePanel}`);
  assert.ok(freePanel.includes("Recibes aprox.") && freePanel.includes("$694.30"), `strip net must match the card ($694.30): ${freePanel}`);
  await freeSearch.click(".mst-strip__bar");
  pass("free strips: all 3 show a verdict labeled 'con costo supuesto 60%'; the $827 strip nets $694.30 like the card");
  // All verdicts on the page are visible: there is nothing to "see", so the
  // CTA hides. A 4th result (lazy load) brings it back with the hidden count.
  assert.equal(await freeSearch.$eval(".mst-radar__cta", (e) => e.hidden), true, "CTA hidden when every verdict is visible");
  assert.equal(await freeSearch.$eval(".mst-radar__more", (e) => e.textContent), "");
  await freeSearch.evaluate(() => {
    const list = document.querySelector(".ui-search-layout");
    const item = list.lastElementChild.cloneNode(true);
    item.querySelector(".mst-strip")?.remove();
    item.querySelector("h2").textContent = "Celular Lazy Load 512 GB";
    list.appendChild(item);
  });
  await freeSearch.waitForFunction(() => document.querySelectorAll(".mst-strip").length === 4 && !document.querySelector(".mst-radar__cta").hidden, { timeout: 5000, polling: 200 });
  assert.equal(await freeSearch.$eval(".mst-radar__more", (e) => e.textContent), "Más resultados con veredicto en PRO: 1");
  assert.equal(await freeSearch.$eval(".mst-upsell", (e) => e.hidden), true);
  await freeSearch.click(".mst-radar__cta");
  await sleep(200);
  assert.equal(await freeSearch.$eval(".mst-upsell", (e) => e.hidden), false);
  pass("'Ver cuáles son · PRO' hides with 3 visible verdicts, returns with a 4th result and opens the radar upsell");
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

  // v1.5.2 (D): on a 360px phone the page itself never scrolls sideways; only
  // the table does, inside its own box, and the export button stays reachable.
  await dash.setViewport({ width: 360, height: 740 });
  await sleep(150);
  const mobile = await dash.evaluate(() => {
    const exp = document.getElementById("export-btn");
    const r = exp.getBoundingClientRect();
    const scroller = document.querySelector(".table-scroll");
    return {
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      exportVisible: !exp.hidden && r.width > 0 && r.right <= 360 && r.left >= 0,
      exportText: exp.textContent,
      tableScrolls: scroller.scrollWidth > scroller.clientWidth
    };
  });
  assert.ok(mobile.scrollWidth <= 360, `dashboard overflows at 360px: ${JSON.stringify(mobile)}`);
  assert.ok(mobile.bodyScrollWidth <= 360, `dashboard body overflows at 360px: ${JSON.stringify(mobile)}`);
  assert.ok(mobile.exportVisible, `export button off-screen at 360px: ${JSON.stringify(mobile)}`);
  assert.ok(mobile.tableScrolls, "the table scrolls inside its own box at 360px");
  pass("dashboard at 360px: no page-wide horizontal scroll, table scrolls in its box, 'Exportar a CSV' reachable");
  await dash.setViewport({ width: 1280, height: 900 });

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
  const emptyState = await dash.evaluate(() => ({
    note: document.getElementById("empty-note").textContent,
    open: (() => { const a = document.getElementById("empty-open"); return { hidden: a.hidden, href: a.href, text: a.textContent }; })(),
    rows: document.querySelectorAll("#rows tr").length,
    example: document.querySelector("#rows tr.example td")?.textContent ?? "",
    upsellHidden: document.getElementById("upsell").hidden,
    exportHidden: document.getElementById("export-btn").hidden
  }));
  assert.equal(emptyState.note, "Guarda el costo en cualquier publicación y aparecerá aquí");
  assert.deepEqual(emptyState.open, { hidden: false, href: "https://www.mercadolibre.com.mx/publicaciones/listado", text: "Abrir Mercado Libre" });
  assert.equal(emptyState.rows, 1, "one sample row");
  assert.ok(emptyState.example.startsWith("Ejemplo"), `sample row: ${emptyState.example}`);
  assert.equal(emptyState.upsellHidden, true, "no PRO pitch on an empty table");
  assert.equal(emptyState.exportHidden, true);
  pass("dashboard empty-state: one 'Ejemplo' row, 'Abrir Mercado Libre', 'Guarda el costo en cualquier publicación y aparecerá aquí', no PRO pitch");
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
    () => document.querySelector("#mst-card-root") && document.querySelectorAll(".mst-prochip").length === 0 && !document.querySelectorAll(".mst-card input.mst-input")[1]?.disabled,
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
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i, k) => i[k].disabled, IDX.price), false);
  pass("what-if price editable when Pro");

  await typeInto(page, IDX.price, "280");
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
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i, k) => i[k].value, IDX.price), "299.00");
  assert.equal(await page.evaluate(rowValue("Recibes aprox.")), "$219.10");
  await page.click(".mst-reset");
  await sleep(300);
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i, k) => i[k].value, IDX.price), "827.00");
  pass("nudge applies $299 (net $219.10), reset restores $827");

  await page.click(".mst-compare-toggle");
  await sleep(200);
  const compareVals = await page.$$eval(".mst-compare .mst-row__value", (els) =>
    els.map((v) => v.textContent)
  );
  assert.deepEqual(compareVals, ["$694.30", "$657.08 – $673.62", "$20.68 – $37.22"]);
  pass("compare: Clásica $694.30 / Premium $657.08–$673.62 / MSI $20.68–$37.22");

  // PRO shows the target row by default at 30% as soon as a cost exists.
  // r3/r4: at $827 this listing already makes 35.59 % (> 30 %), so neither
  // the row nor the PRO line suggests $750 (a lower price): the row states
  // the margin met at the current price, the PRO line points up (46 % at
  // $1,022.73), and the max-cost row keeps the 30 % number.
  assert.equal(await page.evaluate(rowValue("Ya ganas 35.59% a este precio")), "$827.00");
  assert.equal(await page.evaluate(rowValue("Precio para ganar 30%")), null, "no lower price on the card");
  assert.equal(await page.$eval("#mst-card-root", (c) => c.textContent.includes("$750.00")), false, "$750.00 nowhere on the card");
  assert.equal(await page.$eval(".mst-summary__pro", (e) => (e.hidden ? "" : e.textContent)), "PRO: a $1,022.73 ganas el 46%");
  assert.equal(await page.evaluate(rowValue("Costo máximo para ganar 30%")), "$446.20"); // 827 × 0.60 − 50
  pass("PRO target row at 30%: 'Ya ganas 35.59% a este precio: $827.00' (no $750), PRO line points up ('a $1,022.73 ganas el 46%'), max cost $446.20");
  // Review ask (v1.5.5): paid PRO with 3+ used listings → shown once,
  // links to the store reviews, dismiss is permanent.
  {
    const seedExt = async (fn) => {
      const ext = await browser.newPage();
      await ext.goto(`chrome-extension://${extId}/src/options/options.html`, { waitUntil: "load" });
      await ext.evaluate(fn);
      await ext.close();
      await page.bringToFront();
    };
    await seedExt(() => chrome.storage.local.set({ "mst:cost:MLM1": 10, "mst:cost:MLM2": 20 }));
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
    await page.waitForSelector(".mst-review", { timeout: 5000 });
    assert.ok((await page.$eval(".mst-review__link", (a) => a.href)).endsWith("/reviews"));
    await page.click(".mst-review__close");
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
    await sleep(500);
    assert.equal(await page.$(".mst-review"), null, "dismissed review ask stays gone");
    pass("review ask (paid PRO) appears after 3 used listings, links to reviews, dismiss is permanent");
    await seedExt(() => chrome.storage.local.remove(["mst:cost:MLM1", "mst:cost:MLM2"]));
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll(".mst-card input.mst-input").length >= 5, { timeout: 10000 });
  }
  // inputs (pro): 0 cost, 1 price, 2 shipping, 3 ventas, 4 margin
  await typeInto(page, IDX.margin, "20");
  // r4: 35.59 % already beats 20 %, so the row never shows the lower $642.86
  // (the solver's number is unit-tested); it states the margin at $827.
  assert.equal(await page.evaluate(rowValue("Ya ganas 35.59% a este precio")), "$827.00");
  assert.equal(await page.evaluate(rowValue("Precio para ganar 20%")), null, "no lower price while the margin is met");
  await typeInto(page, IDX.sales, "10");
  assert.equal(await page.evaluate(rowValue("Ganancia mensual")), "$2,943.00");
  pass("Pro solver $642.86 + ventas 10 → ganancia mensual $2,943.00");
  // r2 (item 9): max cost for the margin at the page price, and ads % folded
  // into everything. 827 × (1 − 0.10 − 0.20) − 50 = 528.90; with 5 % ads
  // 827 × 0.65 − 50 = 487.55, ads row −$41.35, net 694.30 − 41.35 = 652.95,
  // target 450 / 0.65 = 692.31, monthly (652.95 − 400) × 10 = 2,529.50.
  assert.equal(await page.evaluate(rowValue("Costo máximo para ganar 20%")), "$528.90");
  await typeInto(page, IDX.ads, "5");
  assert.equal(await page.evaluate(rowValue("Publicidad (5%)")), "−$41.35");
  assert.equal(await page.evaluate(rowValue("Recibes aprox.")), "$652.95");
  // r3 (minor 11): breakdown order: the ads row sits under the shipping
  // input, right before "Recibes aprox.", never right above "Costo total".
  const order = await page.$eval("details.mst-breakdown", (d) =>
    [...d.querySelectorAll(".mst-row")].filter((r) => r.style.display !== "none").map((r) => r.querySelector(".mst-row__label")?.textContent ?? ""));
  const iAds = order.findIndex((t) => t.startsWith("Publicidad ("));
  const iShip = order.findIndex((t) => t.startsWith("Tu costo de envío"));
  const iNet = order.indexOf("Recibes aprox.");
  const iTotal = order.findIndex((t) => t.startsWith("Costo total de Mercado Libre"));
  assert.ok(iAds > iShip && iAds < iNet, `ads row not between shipping and net: ${order.join(" | ")}`);
  assert.notEqual(order[iTotal - 1], order[iAds], "ads must not sit right above 'Costo total'");
  assert.ok(iAds > iTotal, `ads row must come after 'Costo total': ${order.join(" | ")}`);
  // With 5 % ads the margin is (652.95 − 400) / 827 = 30.59 %: still met.
  assert.equal(await page.evaluate(rowValue("Ya ganas 30.59% a este precio")), "$827.00");
  assert.equal(await page.evaluate(rowValue("Costo máximo para ganar 20%")), "$487.55");
  assert.equal(await page.evaluate(rowValue("Ganancia mensual")), "$2,529.50");
  // Persisted per product: survives a reload.
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  await page.waitForFunction((k) => document.querySelectorAll(".mst-card input.mst-input")[k]?.value === "5.00", { timeout: 10000 }, IDX.ads);
  assert.equal(await page.evaluate(rowValue("Ya ganas 30.59% a este precio")), "$827.00");
  // r3 (major 4): the dashboard folds the saved 5 % ads in exactly like the
  // card: monthly (652.95 − 400) × 10 = $2,529.50, not $2,943.00.
  {
    const dashAds = await browser.newPage();
    await dashAds.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html`, { waitUntil: "load" });
    await dashAds.waitForFunction(() => !document.getElementById("content")?.hidden, { timeout: 10000 });
    const t = await dashAds.$eval("#totals-row", (e) => e.textContent);
    assert.ok(t.includes("$2,529.50"), `dashboard ignores the ads %: ${t}`);
    const rowText = await dashAds.$eval("#rows", (e) => e.textContent);
    assert.ok(rowText.includes("$652.95") && rowText.includes("$252.95"), `dashboard row net/profit without ads: ${rowText}`);
    await dashAds.close();
    await page.bringToFront();
    pass("dashboard folds the product's 5% ads in: net $652.95, profit $252.95, monthly $2,529.50 (same as the card)");
  }
  await typeInto(page, IDX.ads, "0");
  assert.equal(await page.evaluate(rowValue("Ya ganas 35.59% a este precio")), "$827.00");
  assert.equal(await page.evaluate(rowValue("Costo máximo para ganar 20%")), "$528.90");
  pass("PRO: costo máximo para ganar 20% $528.90; publicidad 5% → −$41.35, net $652.95, 'Ya ganas 30.59%', max cost $487.55, monthly $2,529.50; persisted per product; back to 0");

  // Margin-health dot: 35.59% margin → green.
  assert.equal(
    await page.$eval(".mst-row--profit", (e) => e.dataset.health),
    "green"
  );
  pass("margin-health dot is green at 35.59% margin");

  // Negative profit → clear "Pierdes" framing + red health (feature 5/7).
  await typeInto(page, IDX.cost, "900"); // cost above net → loss
  const lossText = await page.evaluate(rowValue("Ganancia"));
  assert.ok(lossText.startsWith("Pierdes"), `expected loss framing, got: ${lossText}`);
  assert.equal(await page.$eval(".mst-row--profit", (e) => e.dataset.health), "red");
  assert.equal(
    await page.$eval(".mst-row--profit", (e) => e.classList.contains("mst-row--loss")),
    true
  );
  // r4: below the target the row proposes the price for the margin in
  // effect (20 %): (900 + 50) / (1 − 0.10 − 0.20) = $1,357.15 (cent up).
  assert.equal(await page.evaluate(rowValue("Precio para ganar 20%")), "$1,357.15");
  assert.equal(await page.evaluate(rowValue("a este precio")), null, "no 'Ya ganas' row on a loss");
  pass('negative profit shows red "Pierdes …" framing; target row proposes $1,357.15 for 20%');
  await typeInto(page, IDX.cost, "400"); // restore

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
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i, k) => i[k].value, IDX.ship), "50.00");
  await setSelect("Peso (para estimar el envío)", "1");
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i, k) => i[k].value, IDX.ship), "50.00");
  pass("weight select keeps the seller's typed shipping ($50.00)");
  // v1.5.3: the autofill reads the official amarilla / sin reputación table at
  // the $499–998.99 band of this $827 listing (v1.5.2: verde $299 column
  // 56.00 / 59.60).
  await typeInto(page, IDX.ship, "0");
  await setSelect("Peso (para estimar el envío)", "0.5");
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i, k) => i[k].value, IDX.ship), "84.00");
  await setSelect("Peso (para estimar el envío)", "1");
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i, k) => i[k].value, IDX.ship), "89.40");
  pass("weight select autofills shipping when empty and keeps tracking weight until the seller types (0.5 kg $84.00 → 1 kg $89.40, sin reputación, $499 band)");
  await typeInto(page, IDX.ship, "50");

  // Category select changes the commission.
  assert.equal(await page.evaluate(rowValue("Comisión")), "−$82.70");
  const catOptions = await page.$$eval(selectByLabel("Categoría") + " option", (os) => os.map((o) => o.value));
  const other = catOptions.find((v) => v && v !== "tech");
  await setSelect("Categoría", other);
  assert.notEqual(await page.evaluate(rowValue("Comisión")), "−$82.70");
  pass(`category select → commission recomputed (${other})`);
  await setSelect("Categoría", "tech");
  assert.equal(await page.evaluate(rowValue("Comisión")), "−$82.70");

  // v1.5.3: reputation selects the official table. A typed cost is charged as
  // typed (no discount row: v1.5.2 showed −$25.00 here, half of the typed 50);
  // an autofilled estimate follows the chosen table and names its discount.
  await openBreakdown(page);
  await page.click(".mst-free-toggle");
  await sleep(200);
  await setSelect("Reputación del vendedor", "verde");
  assert.equal(await page.evaluate(rowValue("Descuento por reputación")), "", "typed shipping gets no discount row");
  assert.equal(await page.evaluate(rowValue("Recibes aprox.")), "$694.30"); // 827 − 82.70 − 50 typed, untouched by verde
  await typeInto(page, IDX.ship, "0"); // clear the typed cost: the 1 kg estimate refills from the verde table
  await setSelect("Peso (para estimar el envío)", "1");
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i, k) => i[k].value, IDX.ship), "74.50"); // verde, 1 kg, $499–998.99
  assert.equal(await page.evaluate(rowValue("Descuento por reputación")), "Ya incluido en la tabla (50%)");
  await setSelect("Reputación del vendedor", "naranja");
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i, k) => i[k].value, IDX.ship), "149.00"); // naranja, 1 kg, $499–998.99
  assert.equal(await page.evaluate(rowValue("Descuento por reputación")), "", "no discount in the naranja table");
  assert.equal(await page.evaluate(rowValue("Recibes aprox.")), "$595.30"); // 827 − 82.70 − 149
  await setSelect("Reputación del vendedor", "none");
  assert.equal(await page.$$eval(".mst-card input.mst-input", (i, k) => i[k].value, IDX.ship), "89.40"); // amarilla / sin reputación
  assert.equal(await page.evaluate(rowValue("Descuento por reputación")), "Ya incluido en la tabla (40%)");
  pass("reputation picks the official table: typed $50 stays $50 (no row); 1 kg estimate verde $74.50 (50% incluido) → naranja $149.00 (no row) → sin reputación $89.40 (40% incluido)");
  await typeInto(page, IDX.ship, "50");
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
  await typeInto(page, IDX.ship, "50");
  await typeInto(page, IDX.cost, "400");

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
  // r3 (blocker 2): the card's own net for the $827 listing right now (PRO,
  // options default shipping $50, cost 400): the strip must show the same.
  await page.bringToFront();
  await page.goto(PRODUCT_URL, { waitUntil: "load" });
  await page.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  await sleep(600);
  const cardNet827 = await page.evaluate(rowValue("Recibes aprox."));
  assert.equal(cardNet827, "$694.30", `card net for the fixture: ${cardNet827}`);
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
  assert.ok(panelText.includes("Tu costo de envío") && panelText.includes("−$50.00"), `shipping row missing: ${panelText}`);
  const stripNet827 = await search.$eval(".mst-strip__panel", (p) =>
    [...p.querySelectorAll(".mst-strip__row")].find((r) => r.querySelector(".mst-strip__label").textContent === "Recibes aprox.")?.querySelector(".mst-strip__value").textContent);
  assert.equal(stripNet827, cardNet827, `strip net (${stripNet827}) must equal the card net (${cardNet827})`);
  assert.ok(panelText.includes("$198.10"), `research profit missing: ${panelText}`); // 694.30 − 827×60%
  pass("expanded strip: 10% commission, shipping −$50.00, net $694.30 == card net, modo investigación est. profit $198.10");

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
  // Verdicts at 60% acquisition cost, 30% target, WITH the card's $50
  // shipping (r3): 827 → 198.10 (23.95 %, thin); 2,499 → 699.70 (28 %,
  // thin); the $120 Premium item → −19.40 (loss). No winner at 30 %.
  const buckets = await search.$$eval(".mst-strip", (els) =>
    els.map((e) => e.dataset.bucket)
  );
  assert.equal(buckets.filter((b) => b === "profit").length, 0, `buckets: ${buckets}`);
  assert.equal(buckets.filter((b) => b === "thin").length, 2, `buckets: ${buckets}`);
  assert.equal(buckets.filter((b) => b === "loss").length, 1, `buckets: ${buckets}`);
  pass("radar verdicts: 0 profitable, 2 thin, 1 loss at 30% target (shipping included, same as the card)");

  const verdict = await search.$eval(".mst-strip__verdict b", (e) => e.textContent);
  assert.ok(verdict.includes("198.10"), `verdict pill: ${verdict}`);
  pass("radar verdict pill shows conservative est. profit $198.10 (net after shipping minus the assumed cost)");

  const summary = await search.$eval(".mst-radar__summary", (e) => e.textContent);
  assert.ok(
    summary.includes("Analizados: 3") &&
      summary.includes("rentables: 0") &&
      summary.includes("marginales: 2") &&
      summary.includes("en pérdida: 1"),
    `summary: ${summary}`
  );
  pass(`radar summary bar: "${summary.trim()}"`);

  // Lower the target → 25 %: the 2,499 item clears it (28 %); 20 %: 827 too.
  const setTarget = async (v) => {
    await search.$eval(".mst-radar__target", (el, val) => {
      el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, v);
    await sleep(150);
    return search.$$eval(".mst-strip", (els) => els.map((e) => e.dataset.bucket));
  };
  const at25 = await setTarget("25");
  assert.equal(at25.filter((b) => b === "profit").length, 1, `after target 25%: ${at25}`);
  const at20 = await setTarget("20");
  assert.equal(at20.filter((b) => b === "profit").length, 2, `after target 20%: ${at20}`);
  assert.equal(at20.filter((b) => b === "loss").length, 1, `after target 20%: ${at20}`);
  pass("radar target 25% → 1 profitable, 20% → 2 profitable (threshold reactivity)");

  // At 25 %, "only profitable" dims the thin and the losing result and the
  // export button becomes the ranked shortlist.
  await setTarget("25");
  await search.click(".mst-radar__only");
  await sleep(150);
  assert.equal(
    await search.$$eval(".mst-dimmed", (els) => els.length),
    2,
    "only-profitable should dim the thin and the losing result"
  );
  const shortlistLabel = await search.$eval(".mst-export__btn", (e) => e.textContent);
  assert.ok(
    shortlistLabel.includes("Exportar rentables (1)"),
    `export label: ${shortlistLabel}`
  );
  pass('radar "solo rentables" dims 2 → "Exportar rentables (1)"');

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
  await setTarget("30"); // back to the default target for the later phases
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
    () => document.querySelectorAll(".mst-card input.mst-input")[1]?.value === "1499.00",
    { timeout: 15000, polling: 250 }
  );
  assert.equal(await page.$$eval(".mst-card", (els) => els.length), 1);
  pass("SPA nav → card torn down and re-injected with the NEW price ($1,499.00)");

  // Product B must start clean: product A's cost (400) and ventas (10) must
  // not leak into it, and nothing may be persisted under B's storage keys.
  const bInputs = await page.$$eval(".mst-card input.mst-input", (els) =>
    els.map((i) => i.value)
  );
  assert.equal(bInputs[IDX.cost], "", `cost leaked across SPA nav: ${bInputs}`);
  assert.equal(bInputs[IDX.sales], "", `ventas leaked across SPA nav: ${bInputs}`);
  const bStored = await dash.evaluate(() =>
    chrome.storage.local.get(["mst:cost:MLM99999999", "mst:sales:MLM99999999"])
  );
  assert.deepEqual(bStored, {}, `stale write under new item's keys: ${JSON.stringify(bStored)}`);
  pass("new product starts clean: no cost/ventas carry-over, no stale storage writes");

  // Page re-render wipes the card → persistence watcher re-injects it.
  await page.evaluate(() => document.getElementById("mst-card-root").remove());
  await page.waitForFunction(
    () => document.querySelectorAll(".mst-card input.mst-input")[1]?.value === "1499.00",
    { timeout: 5000, polling: 200 }
  );
  pass("card wiped by page re-render → re-injected with the same product's data");

  // Navigate BACK to product A: its per-item state must be restored intact.
  await spaNavigate("827", "00", "827", "/celular-test-pro/p/MLM12345678");
  await page.waitForFunction(
    () => {
      const inputs = document.querySelectorAll(".mst-card input.mst-input");
      return inputs[1]?.value === "827.00" && inputs[0]?.value === "400.00"; // price, cost
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

  // ================= PHASE 6b: grid layout + listing signals (v1.5.2 A, B) ====
  console.log("\nPHASE 6b — GRID LAYOUT (strip not clipped) + MSI brand / shipping-in-title signals");
  const grid = tap(await browser.newPage(), "grid");
  await grid.goto(`https://listado.mercadolibre.com.mx:${PORT}/laptops-grid`, { waitUntil: "load" });
  await grid.waitForFunction(() => document.querySelectorAll(".mst-strip").length === 4, { timeout: 10000, polling: 200 });
  const gridGeom = await grid.evaluate(() => {
    const out = [];
    for (const li of document.querySelectorAll("li.ui-search-layout__item")) {
      const strip = li.querySelector(".mst-strip");
      const r = strip.getBoundingClientRect();
      const lr = li.getBoundingClientRect();
      // Any overflow-clipping ancestor between the strip and the <li> must
      // contain the strip entirely, or it is cut off.
      let clipped = false;
      for (let a = strip.parentElement; a && a !== li; a = a.parentElement) {
        const ov = getComputedStyle(a).overflow;
        if (/hidden|clip|auto|scroll/.test(ov)) {
          const ar = a.getBoundingClientRect();
          if (r.bottom > ar.bottom + 0.5 || r.top < ar.top - 0.5) clipped = true;
        }
      }
      out.push({
        hasOffsetParent: strip.offsetParent !== null,
        height: Math.round(r.height),
        withinLi: r.bottom <= lr.bottom + 0.5 && r.top >= lr.top - 0.5,
        clipped,
        inContentBox: Boolean(strip.closest(".poly-card__content"))
      });
    }
    return out;
  });
  for (const [i, g] of gridGeom.entries()) {
    assert.ok(g.hasOffsetParent && g.height > 0, `grid strip ${i} not rendered: ${JSON.stringify(g)}`);
    assert.ok(g.withinLi, `grid strip ${i} outside its <li>: ${JSON.stringify(g)}`);
    assert.ok(!g.clipped, `grid strip ${i} clipped by a fixed-height box: ${JSON.stringify(g)}`);
    assert.ok(!g.inContentBox, `grid strip ${i} still inside the fixed-height content box`);
  }
  pass("grid layout: all 4 strips rendered on the <li>, fully visible, none clipped by the fixed-height card box");

  const gridRows = await grid.$$eval("li.ui-search-layout__item", (lis) =>
    lis.map((li) => {
      const rows = [...li.querySelectorAll(".mst-strip__row")];
      const val = (label) => rows.find((r) => r.querySelector(".mst-strip__label").textContent === label)?.querySelector(".mst-strip__value").textContent;
      return { type: val("Tipo (estimado)"), free: val("Envío gratis"), seller: val("Vendedor") ?? null };
    })
  );
  assert.deepEqual(gridRows.map((r) => r.type), ["Clásica", "Premium", "Clásica", "Premium"], JSON.stringify(gridRows));
  assert.deepEqual(gridRows.map((r) => r.free), ["Sí", "No", "No", "Sí"], JSON.stringify(gridRows));
  assert.equal(gridRows[0].seller, "Por MSI");
  pass("signals: 'Laptop MSI Katana' / 'Por MSI' stays Clásica; '12x $1,041 sin interés' and '6 meses sin intereses' are Premium; 'ENVÍO GRATIS' in a title is not free shipping");
  // The strip on the <li> still expands in place.
  await grid.click("li.ui-search-layout__item:nth-child(3) .mst-strip__bar");
  await sleep(200);
  const panels = await grid.$$eval("li.ui-search-layout__item", (lis) => lis.map((li) => li.querySelector(".mst-strip__panel").hidden));
  assert.deepEqual(panels, [true, true, false, true]);
  await grid.close();

  // ================= PHASE 7: extraction edge cases ===========================
  console.log("\nPHASE 7 — EXTRACTION EDGE CASES (promo price without meta, no anchor)");
  // Discounted listing with NO itemprop meta: the DOM-only path must skip the
  // hidden duplicate block (1,199) and the crossed-out previous price (1,199).
  const nometa = tap(await browser.newPage(), "nometa");
  await nometa.goto(`${PRODUCT_URL}?e2e=nometa`, { waitUntil: "load" });
  await nometa.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  assert.equal(await nometa.$$eval(".mst-card input.mst-input", (i, k) => i[k].value, IDX.price), "827.00");
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
    () => document.querySelectorAll(".mst-card input.mst-input")[1]?.value === "799.00",
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
  mock = createHttpServer((req, res) => {
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
    const back = Date.now() - 9 * 24 * 3600 * 1000;
    await chrome.storage.local.set({ "mst:installedAt": back, "mst:trialStartedAt": back });
  });

  // -- dormant: no override, no build config -> not one request, no analytics UI
  const dormantPage = tap(await browser.newPage(), "dormant");
  await dormantPage.goto(PRODUCT_URL, { waitUntil: "load" });
  await dormantPage.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
  await typeInto(dormantPage, IDX.cost, "400");
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
  await typeInto(fp, IDX.cost, "400");
  await fp.waitForSelector(".mst-row--teaser", { visible: true });
  await fp.click(".mst-row--teaser");
  await sleep(300);
  await fp.click(".mst-upsell__alt"); // monthly (second since r2; yearly is the cta)
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
    assert.equal(r.ext_version, "1.5.5");
    for (const v of Object.values(r.props)) assert.match(String(v), /^[a-z0-9._:+-]{1,24}$/);
  }
  assert.equal(new Set(all.map((r) => r.install_id)).size, 1, "one random install id");
  // Strip the random install id (a UUID can contain "400", "744"...) and the
  // Chrome major before scanning for forbidden substrings.
  const blob = received
    .map((r) => JSON.stringify(JSON.parse(r.body).map(({ install_id, chrome_major, ...rest }) => rest)))
    .join("\n");
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
  // The debug line is rendered once on load; a flush still in flight at that
  // moment lands a moment later, so poll (reload) for up to 10 s.
  {
    const deadline = Date.now() + 10000;
    let seen = false;
    while (!seen && Date.now() < deadline) {
      seen = await ext.evaluate(() => /last send 20\d ok/.test(document.getElementById("telemetry-debug")?.textContent ?? ""));
      if (!seen) {
        await sleep(500);
        await ext.reload({ waitUntil: "load" });
        await sleep(300);
      }
    }
    assert.ok(seen, `debug line never showed a 2xx send: ${await ext.$eval("#telemetry-debug", (e) => e.textContent)}`);
  }
  pass("options ?debug shows host, queue and last send status (201 ok)");

  // -- opt out via the UI: queue cleared, nothing more is sent
  await fp.bringToFront();
  await typeInto(fp, IDX.cost, "401");
  await ext.bringToFront();
  const sentBefore = received.length;
  await ext.click("#telemetry-enabled");
  await sleep(500);
  let st = await sendMsg({ type: "telemetryState", payload: { debug: true } });
  assert.equal(st.data.enabled, false);
  assert.equal(st.data.queue, 0, "opt-out clears the queue");
  await fp.bringToFront();
  await typeInto(fp, IDX.cost, "402");
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
  console.log("\nPHASE 11 - OWNER KEY (throwaway key typed in the box, PRO everywhere, silent analytics)");
  {
    const { createHash, randomBytes } = await import("node:crypto");
    const ownerKey = randomBytes(32).toString("hex"); // throwaway; never the real key
    const ownerHash = createHash("sha256").update(ownerKey, "utf8").digest("hex");
    const o = await browser.newPage();
    await o.goto(`chrome-extension://${extId}/src/options/options.html`, { waitUntil: "load" });
    await o.evaluate(async (hash) => {
      await chrome.storage.local.remove(["mst:proOverride", "mst:proStatus", "mst:ownerKey", "mst:tq", "mst:tday", "mst:tcounts", "mst:iid", "mst:tflags"]);
      const back = Date.now() - 9 * 24 * 3600 * 1000;
      await chrome.storage.local.set({ "mst:installedAt": back, "mst:trialStartedAt": back, "mst:ownerHashOverride": hash });
    }, ownerHash);

    // Normal user, trial over: not owner, free status line.
    await o.reload({ waitUntil: "load" });
    await o.waitForFunction(() => document.getElementById("sub-status").textContent !== "…");
    assert.equal(await o.$eval("#owner-box", (e) => e.hidden), true, "owner box hidden by default");
    pass("owner box hidden for normal users");

    // v1.5.2 (F): no URL activation path (the key would stay in Chrome's
    // history). A ?owner= parameter is ignored and the box stays hidden.
    await o.goto(`chrome-extension://${extId}/src/options/options.html?owner=${ownerKey}`, { waitUntil: "load" });
    await o.waitForFunction(() => document.getElementById("sub-status").textContent !== "…");
    await sleep(500);
    assert.equal(await o.$eval("#owner-box", (e) => e.hidden), true, "URL param does not open the box");
    assert.notEqual(await o.$eval("#sub-status", (e) => e.textContent), "Modo propietario activo");
    assert.equal((await o.evaluate(() => chrome.storage.local.get("mst:ownerKey")))["mst:ownerKey"], undefined, "URL param stores nothing");
    pass("?owner= in the URL activates nothing (no key in browser history)");

    // Five clicks on the version label open the box (password input).
    await o.goto(`chrome-extension://${extId}/src/options/options.html?debug=1`, { waitUntil: "load" });
    await o.waitForFunction(() => document.getElementById("sub-status").textContent !== "…");
    for (let i = 0; i < 5; i++) await o.click("#version-label");
    assert.equal(await o.$eval("#owner-box", (e) => e.hidden), false, "box opens after 5 clicks");
    assert.equal(await o.$eval("#owner-input", (e) => e.type), "password");
    assert.equal(await o.$eval("#owner-paste", (e) => e.textContent), "Pegar y activar");
    // "Pegar y activar" with nothing usable on the clipboard (headless: the
    // read is denied or empty) just focuses the input; it never throws.
    await o.click("#owner-paste");
    await sleep(300);
    assert.equal(await o.evaluate(() => document.activeElement?.id), "owner-input", "paste helper focuses the input when the clipboard gives nothing");
    assert.equal(await o.$eval("#owner-box", (e) => e.hidden), false);
    // Wrong key typed: "Clave incorrecta", nothing stored.
    await o.type("#owner-input", "z".repeat(40));
    await o.click("#owner-activate");
    await o.waitForFunction(() => !document.getElementById("owner-msg").hidden, { timeout: 5000 });
    assert.equal(await o.$eval("#owner-msg", (e) => e.textContent), "Clave incorrecta");
    assert.equal((await o.evaluate(() => chrome.storage.local.get("mst:ownerKey")))["mst:ownerKey"], undefined);
    assert.equal(await o.$eval("#owner-input", (e) => e.value), "", "input cleared after a wrong key");
    pass("5 clicks open the box; wrong key typed: 'Clave incorrecta', nothing stored");

    // Right key typed with surrounding whitespace (as pasted from a note):
    // status line says owner mode, key not in DOM or URL.
    await sleep(1100); // one try per second
    await o.type("#owner-input", `  ${ownerKey}  `);
    await o.keyboard.press("Enter");
    await o.waitForFunction(() => document.getElementById("sub-status").textContent === "Modo propietario activo", { timeout: 8000 });
    assert.ok(!o.url().includes(ownerKey) && !o.url().includes("owner="), "key never in the URL");
    assert.ok(o.url().includes("debug=1"), "URL untouched");
    assert.equal(await o.$eval("#owner-input", (e) => e.value), "", "input cleared");
    assert.ok(!(await o.content()).includes(ownerKey), "key never echoed in the DOM");
    assert.equal((await o.evaluate(() => chrome.storage.local.get("mst:ownerKey")))["mst:ownerKey"], ownerKey, "stored trimmed");
    pass("right key typed (with spaces): 'Modo propietario activo', stored trimmed, never in URL or DOM");

    // Toolbar badge reads PRO.
    const swT = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"));
    await sleep(500);
    assert.equal(await (await swT.worker()).evaluate(() => chrome.action.getBadgeText({})), "PRO");
    pass("badge shows PRO in owner mode");

    // Listing page: full PRO UI, no teaser, no trial/win-back bar, no upsell.
    const op = tap(await browser.newPage(), "owner");
    await op.goto(PRODUCT_URL, { waitUntil: "load" });
    await op.waitForSelector("#mst-card-root", { visible: true, timeout: 20000 });
    await typeInto(op, IDX.cost, "400");
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
    // The PRO target row (r4: "Ya ganas X% a este precio" once the margin is met).
    assert.ok((await op.evaluate(rowValue("Precio para ganar 30%"))) || (await op.evaluate(rowValue("a este precio"))), "target row visible");
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
    await ow.waitForFunction(() => (document.getElementById("title")?.textContent ?? "").length > 0, { timeout: 10000 });
    assert.equal(await ow.$eval("#pill", (e) => e.textContent), "PRO activo");
    assert.equal(await ow.$eval("#title", (e) => e.textContent), "Netio PRO está activo");
    assert.equal(await ow.$eval("#upgrade", (b) => b.hidden), true, "no pay button for the owner");
    await ow.close();
    pass("dashboard shows no paywall for the owner; welcome says 'PRO activo'");

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

    // Reset keeps the key (re-activate through the box first).
    await o.goto(`chrome-extension://${extId}/src/options/options.html`, { waitUntil: "load" });
    await o.waitForFunction(() => document.getElementById("sub-status").textContent !== "…");
    for (let i = 0; i < 5; i++) await o.click("#version-label");
    await o.type("#owner-input", ownerKey);
    await o.click("#owner-activate");
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
  mock?.close();
  rmSync(certDir, { recursive: true, force: true });
}
