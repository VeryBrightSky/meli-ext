#!/usr/bin/env node
// Builds the Netio landing site into landing/ from site-src/.
//   node scripts/build-site.mjs
// What it does: renders every page in site-src/pages.mjs to clean URLs
// (folder/index.html), copies the extension's fee modules next to the web
// calculator, injects the shared header/footer into the hand-written pages
// (privacidad, soporte, gracias, 404, adios), and regenerates sitemap.xml,
// robots.txt and llms.txt. Static output only; deploy by dragging landing/
// to Netlify Drop.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "landing");
const { PAGES, LEGACY } = await import(path.join(root, "site-src/pages.mjs"));
const { renderPage } = await import(path.join(root, "site-src/render.mjs"));
const { header, footer } = await import(path.join(root, "site-src/templates.mjs"));
const { SITE } = await import(path.join(root, "site-src/site.mjs"));

const today = SITE.checkedAt;
const write = (rel, content) => {
  const p = path.join(out, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return rel;
};

// 1. Calculator modules: one source of truth for the fee math.
for (const f of ["fee-table.js", "shipping-table.js", "calculator.js", "fee-source.js"]) {
  fs.mkdirSync(path.join(out, "calculadora"), { recursive: true });
  fs.copyFileSync(path.join(root, "src/fees", f), path.join(out, "calculadora", f));
}
for (const f of ["shipping-official.js", "calc-web.js"]) {
  fs.copyFileSync(path.join(root, "site-src", f), path.join(out, "calculadora", f));
}

// 2. Rendered pages.
const written = [];
for (const page of PAGES) {
  const html = renderPage(page, PAGES);
  if (/—/.test(html)) throw new Error(`em dash in ${page.path}`);
  const rel = page.path.endsWith("/") ? `${page.path.slice(1)}index.html` : page.path.slice(1);
  written.push(write(rel, html));
}

// 3. Legacy pages: swap the <nav> and <footer> for the shared ones, keep the rest.
const START = "<!-- site-footer:start -->", END = "<!-- site-footer:end -->";
for (const l of LEGACY) {
  const p = path.join(out, l.file);
  let html = fs.readFileSync(p, "utf8");
  const foot = `${START}\n${footer(l.lang, PAGES)}\n${END}`;
  if (html.includes(START)) {
    html = html.replace(new RegExp(`${START}[\\s\\S]*?${END}`), foot);
  } else if (/<footer[\s\S]*?<\/footer>/.test(html)) {
    html = html.replace(/<footer[\s\S]*?<\/footer>/, foot);
  } else {
    html = html.replace("</body>", `${foot}\n</body>`);
  }
  if (!l.footerOnly) {
    const hdr = header(l.lang, { current: `/${l.file}` });
    const HS = "<!-- site-header:start -->", HE = "<!-- site-header:end -->";
    const block = `${HS}\n${hdr}\n${HE}`;
    if (html.includes(HS)) {
      html = html.replace(new RegExp(`${HS}[\\s\\S]*?${HE}`), block);
    } else {
      html = html.replace(/<a class="skip"[^>]*>[^<]*<\/a>\s*<header class="top">[\s\S]*?<\/header>/, block);
    }
  }
  // Root-absolute asset links so the shared chrome works from any folder.
  html = html.replace(/href="styles\.css"/g, 'href="/styles.css"').replace(/href="(favicon\.svg|favicon-32\.png|apple-touch-icon\.png|netio-logo\.svg)"/g, 'href="/$1"');
  if (/—/.test(html)) throw new Error(`em dash in ${l.file}`);
  fs.writeFileSync(p, html);
  written.push(l.file);
}

// 4. sitemap.xml, robots.txt, llms.txt
const indexable = PAGES.filter((p) => !p.noindex);
const legacyIndexable = LEGACY.filter((l) => !l.noindex).map((l) => ({ path: `/${l.file}` }));
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[...indexable, ...legacyIndexable].map((p) => `  <url>
    <loc>${SITE.baseUrl}${p.path}</loc>
    <lastmod>${today}</lastmod>${p.alternate ? `
    <xhtml:link rel="alternate" hreflang="es-MX" href="${SITE.baseUrl}${p.alternate.es}" />
    <xhtml:link rel="alternate" hreflang="en" href="${SITE.baseUrl}${p.alternate.en}" />` : ""}
  </url>`).join("\n")}
</urlset>
`;
write("sitemap.xml", sitemap);

const bots = ["Googlebot", "Bingbot", "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot", "Google-Extended"];
write("robots.txt", `${bots.map((b) => `User-agent: ${b}\nAllow: /\n`).join("\n")}
User-agent: *
Allow: /
Disallow: /gracias.html
Disallow: /adios.html

Sitemap: ${SITE.baseUrl}/sitemap.xml
`);

const byType = (t) => PAGES.filter((p) => p.type === t);
const line = (p) => `- [${p.h1}](${SITE.baseUrl}${p.path}): ${p.description}`;
write("llms.txt", `# Netio

> Netio es una extensión de Chrome para vendedores de Mercado Libre México. Muestra la ganancia real por venta y por publicación (cargo por venta, costo fijo, envío, retenciones de ISR e IVA y costo del producto) debajo del precio de cada publicación y en cada resultado de búsqueda. Plan gratis; PRO ${SITE.pro.monthlyMXN} MXN al mes o ${SITE.pro.yearlyMXN} MXN al año, con ${SITE.pro.trialDays} días de prueba sin tarjeta. No está afiliada a Mercado Libre. Las cifras son estimaciones; las tablas de envío son las oficiales consultadas el ${today}.

> Netio is a Chrome extension for Mercado Libre Mexico sellers. It shows real profit per sale and per listing (commission, fixed fee, shipping, ISR/IVA withholdings and product cost) under the price of every listing and on every search result. Free plan; PRO ${SITE.pro.monthlyMXN} MXN/month or ${SITE.pro.yearlyMXN} MXN/year with a ${SITE.pro.trialDays}-day trial, no card. Not affiliated with Mercado Libre. Figures are estimates; shipping tables are the official ones checked on ${today}.

Instalar / Install: ${SITE.storeUrl}
Soporte / Support: ${SITE.supportEmail}

## Páginas principales / Main pages
- [Inicio (es-MX)](${SITE.baseUrl}/)
- [Home (en)](${SITE.baseUrl}/en/)
- [Calculadora gratis de comisiones y ganancias](${SITE.baseUrl}/calculadora/): ${PAGES.find((p) => p.type === "calculator").description}

## Guías de costos / Fee guides (es-MX)
${byType("guide").map(line).join("\n")}

## Paso a paso / How-to (es-MX)
${byType("howto").map(line).join("\n")}

## Comparaciones / Comparisons (es-MX)
${byType("compare").map(line).join("\n")}

## Otras / Other
- [Política de privacidad / Privacy policy](${SITE.baseUrl}/privacidad.html)
- [Soporte / Support](${SITE.baseUrl}/soporte.html)

## Fuentes oficiales citadas / Official sources cited (checked ${today})
- Cargo por venta: ${SITE.official.cargoVenta}
- Envíos: ${SITE.official.envios} (tablas: ${SITE.official.envioVerde}, ${SITE.official.envioAmarilla}, ${SITE.official.envioNaranja})
- Retenciones 2026: ${SITE.official.retenciones}
- Full: ${SITE.official.full}
`);

console.log(`built ${written.length} pages into landing/:\n  ${written.join("\n  ")}\n  sitemap.xml robots.txt llms.txt calculadora/*.js`);
