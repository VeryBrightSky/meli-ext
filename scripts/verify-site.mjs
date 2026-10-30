#!/usr/bin/env node
// Verifies the built landing/ site: serves a scratch copy with python's
// http.server, fetches every page without JS (raw HTML checks), then loads
// each one in Chromium via Playwright (console errors, overflow, requests,
// light/dark) and screenshots a sample of pages.
//   node scripts/verify-site.mjs [--screenshots DIR]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const landing = path.join(root, "landing");
const { PAGES, LEGACY } = await import(path.join(root, "site-src/pages.mjs"));
const { SITE } = await import(path.join(root, "site-src/site.mjs"));

const argShots = process.argv.indexOf("--screenshots");
const shotDir = argShots > -1 ? process.argv[argShots + 1] : null;
const scratch = fs.mkdtempSync(path.join(process.env.NETIO_SCRATCH || os.tmpdir(), "netio-site-"));
fs.cpSync(landing, scratch, { recursive: true });

const PORT = 8766 + Math.floor(Math.random() * 200);
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: scratch, stdio: "ignore" });
const base = `http://127.0.0.1:${PORT}`;
await new Promise((r) => setTimeout(r, 700));

const failures = [];
const fail = (page, msg) => failures.push(`${page}: ${msg}`);
const stripTags = (s) => String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");

const pages = [
  ...PAGES.map((p) => ({ path: p.path, data: p })),
  ...LEGACY.map((l) => ({ path: `/${l.file}`, legacy: true }))
];
const allPaths = new Set(pages.map((p) => p.path));
const allowedExternal = (href) => href.startsWith(SITE.storeUrl) || href.startsWith("mailto:") ||
  /^https:\/\/(www\.)?(mercadolibre\.com\.mx|vendedores\.mercadolibre\.com\.mx|mercadopago\.com\.mx|www\.sat\.gob\.mx|sat\.gob\.mx)\//.test(href);

// ---------------------------------------------------------------- raw HTML
for (const pg of pages) {
  const res = await fetch(base + pg.path);
  if (res.status !== 200) { fail(pg.path, `HTTP ${res.status}`); continue; }
  const html = await res.text();
  if (/—/.test(html)) fail(pg.path, "contains an em dash");
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (!h1) fail(pg.path, "no <h1>");
  if (!/<html lang="(es-MX|en)"/.test(html)) fail(pg.path, "html lang missing");
  if (!/rel="canonical"/.test(html) && !pg.legacy) fail(pg.path, "no canonical");
  // images need alt
  for (const img of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(img[0])) fail(pg.path, `img without alt: ${img[0].slice(0, 60)}`);
  // links
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]*)"/g)) {
    const href = decode(m[1]);
    if (href.startsWith("#") || href.startsWith("mailto:")) continue;
    if (/^https?:/.test(href)) { if (!allowedExternal(href)) fail(pg.path, `external link not allowed: ${href}`); continue; }
    const clean = href.split("#")[0].split("?")[0];
    if (!clean) continue;
    const abs = clean.startsWith("/") ? clean : path.posix.join(path.posix.dirname(pg.path), clean);
    const okPath = allPaths.has(abs) || allPaths.has(abs.replace(/index\.html$/, "")) || fs.existsSync(path.join(landing, abs));
    if (!okPath) fail(pg.path, `internal link does not resolve: ${href}`);
  }
  if (pg.legacy) continue;
  const p = pg.data;
  if (p.answer && !html.includes(p.answer.slice(0, 80))) fail(pg.path, "answer paragraph not in raw HTML");
  if (p.h1 && !stripTags(h1?.[1] || "").includes(p.h1)) fail(pg.path, "h1 text differs from data");
  if (p.title && !html.includes(`<title>${p.title.replace(/&/g, "&amp;")}</title>`)) fail(pg.path, "title tag differs");
  // JSON-LD
  const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch (e) { fail(pg.path, `JSON-LD parse error: ${e.message}`); return null; } }).filter(Boolean);
  const types = lds.map((o) => o["@type"]);
  for (const t of ["Organization", "SoftwareApplication", "WebPage", "BreadcrumbList"]) if (!types.includes(t)) fail(pg.path, `JSON-LD ${t} missing`);
  if (p.faq?.length) {
    const visible = [...html.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map((m) => decode(stripTags(m[1])));
    const faqLd = lds.find((o) => o["@type"] === "FAQPage");
    if (!faqLd) fail(pg.path, "FAQPage JSON-LD missing");
    else {
      const ldQs = faqLd.mainEntity.map((q) => q.name);
      if (JSON.stringify(ldQs) !== JSON.stringify(visible)) fail(pg.path, `FAQPage questions differ from visible FAQ\n  ld: ${ldQs.join(" | ")}\n  vis: ${visible.join(" | ")}`);
      if (p.faq.length < 5 && p.type !== "hub") fail(pg.path, `only ${p.faq.length} FAQ entries`);
    }
    if (!html.includes("<details>")) fail(pg.path, "FAQ not in raw HTML");
  }
  if (p.type === "howto" && !types.includes("HowTo")) fail(pg.path, "HowTo JSON-LD missing");
  if (!html.includes('href="/calculadora/')) fail(pg.path, "no link to /calculadora/");
  if (p.type !== "home" && !html.includes("no afiliada a Mercado Libre") && !html.includes("not affiliated with Mercado Libre")) fail(pg.path, "not-affiliated line missing");
  const words = stripTags(p.answer || "").split(/\s+/).length;
  if (p.type !== "hub" && p.type !== "home" && (words < 38 || words > 68)) fail(pg.path, `answer paragraph has ${words} words`);
}

// uniqueness between articles (rough: shingles of 8 words over visible text)
const texts = {};
for (const pg of pages.filter((x) => !x.legacy && x.data.type !== "home" && x.data.type !== "hub")) {
  const html = fs.readFileSync(path.join(landing, pg.path.slice(1), "index.html"), "utf8");
  const main = html.match(/<main[\s\S]*?<\/main>/)?.[0] || "";
  const body = main.replace(/<figure[\s\S]*?<\/figure>/g, "").replace(/<section class="cta-box">[\s\S]*?<\/section>/g, "").replace(/<section class="related">[\s\S]*?<\/section>/g, "");
  const w = stripTags(body).toLowerCase().split(/\s+/);
  const sh = new Set();
  for (let i = 0; i + 8 <= w.length; i++) sh.add(w.slice(i, i + 8).join(" "));
  texts[pg.path] = sh;
}
for (const [a, sa] of Object.entries(texts)) {
  let maxShared = 0, with_ = "";
  for (const [b, sb] of Object.entries(texts)) {
    if (a === b) continue;
    let shared = 0;
    for (const s of sa) if (sb.has(s)) shared++;
    const ratio = sa.size ? shared / sa.size : 0;
    if (ratio > maxShared) { maxShared = ratio; with_ = b; }
  }
  if (maxShared > 0.4) fail(a, `only ${Math.round((1 - maxShared) * 100)}% unique vs ${with_}`);
}

// ---------------------------------------------------------------- browser
let pw;
try { pw = await import("playwright"); } catch { pw = await import("/opt/npm-tools/node_modules/playwright/index.mjs"); }
const browser = await pw.chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const sample = ["/", "/calculadora/", "/guias/costo-de-envio-mercado-libre-vendedor/", "/como/poner-precio-a-un-producto-en-mercado-libre/", "/comparar/netio-vs-simulador-de-costos-mercado-libre/"];
const results = [];
for (const pg of pages) {
  for (const scheme of ["light", "dark"]) {
    for (const width of [360, 390, 1280]) {
      if (scheme === "dark" && width !== 390) continue;
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [];
      const external = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("request", (r) => { const u = r.url(); if (!u.startsWith(base)) external.push(u); });
      const resp = await page.goto(base + pg.path, { waitUntil: "load" });
      if (!resp || resp.status() !== 200) fail(pg.path, `browser HTTP ${resp?.status()}`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) {
        const culprit = await page.evaluate(() => {
          const w = document.documentElement.clientWidth; let worst = null;
          for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (r.right > w + 1 && (!worst || r.right > worst.r)) worst = { r: r.right, tag: el.tagName + "." + el.className }; }
          return worst;
        });
        fail(pg.path, `horizontal overflow ${over}px at ${width}px ${scheme} (${culprit?.tag})`);
      }
      if (errors.length) fail(pg.path, `console errors at ${width}/${scheme}: ${errors.join("; ")}`);
      if (external.length) fail(pg.path, `external requests: ${external.join(", ")}`);
      if (pg.path === "/calculadora/" && width === 1280 && scheme === "light") {
        // the calculator must compute and react to the query string
        await page.goto(`${base}/calculadora/?precio=149&costo=55&cat=tech&tipo=clasica&rep=verde&peso=0.3&gratis=si&rfc=si`, { waitUntil: "load" });
        const neto = await page.textContent("#r-neto");
        const envio = await page.textContent("#r-envio");
        if (!envio.includes("52.40")) fail(pg.path, `prefill shipping expected 52.40, got ${envio}`);
        if (!neto.includes("23.79")) fail(pg.path, `prefill net expected -23.79, got ${neto}`);
        await page.fill("#precio", "299");
        await page.selectOption("#rep", "naranja");
        const envio2 = await page.textContent("#r-envio");
        if (!envio2.includes("104.80")) fail(pg.path, `naranja $299 0.3 kg expected 104.80, got ${envio2}`);
      }
      if (shotDir && sample.includes(pg.path) && scheme === "light" && (width === 390 || width === 1280)) {
        fs.mkdirSync(shotDir, { recursive: true });
        const name = (pg.path === "/" ? "home" : pg.path.replace(/\//g, "_").replace(/^_|_$/g, "")) + `-${width}.png`;
        await page.goto(base + pg.path, { waitUntil: "load" });
        await page.screenshot({ path: path.join(shotDir, name), fullPage: true });
        results.push(path.join(shotDir, name));
      }
      await ctx.close();
    }
  }
}
await browser.close();
server.kill();
fs.rmSync(scratch, { recursive: true, force: true });

if (results.length) console.log("screenshots:\n  " + results.join("\n  "));
if (failures.length) {
  console.error(`FAILED (${failures.length}):\n- ` + failures.join("\n- "));
  process.exit(1);
}
console.log(`verified ${pages.length} pages: HTTP 200, h1, answer, FAQ, JSON-LD, links, no overflow at 360/390/1280, light/dark, no external requests, no em dashes.`);
