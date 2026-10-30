// HTML templates for every page of the Netio site. Pure functions: page data
// in, HTML string out. No runtime dependencies.
import { SITE, storeLink } from "./site.mjs";

export const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const stripTags = (s) => String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const CHROME_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 5.6a4.4 4.4 0 0 1 3.86 2.3H12a2.1 2.1 0 0 0-1.9 3l-1.86-3.2A4.39 4.39 0 0 1 12 7.6Zm-7.9 4.9 2 3.45a4.4 4.4 0 0 0 4.2 3.05h.2l1.9-3.3A2.1 2.1 0 0 1 9.9 12a2.1 2.1 0 0 1 .3-1.08L7.3 5.9a8 8 0 0 0-3.2 6.6Zm9.95 6.4a8 8 0 0 0 5.83-10.4H14.2A4.38 4.38 0 0 1 14.05 18.9ZM12 14.1A2.1 2.1 0 1 1 12 9.9a2.1 2.1 0 0 1 0 4.2Z"/></svg>';

export function installButton(source, label = "Agregar a Chrome, es gratis", cls = "btn btn-go") {
  return `<a class="${cls}" href="${esc(storeLink(source))}">${CHROME_ICON} ${esc(label)}</a>`;
}

// ---------------------------------------------------------------- <head>
export function head(page, { jsonld = [] } = {}) {
  const lang = page.lang || "es-MX";
  const url = SITE.baseUrl + page.path;
  const ogLocale = lang === "en" ? "en_US" : "es_MX";
  const alt = page.alternate || null; // { es, en } paths
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.description)}" />
  <meta name="theme-color" content="#2d3277" />
  ${page.noindex ? '<meta name="robots" content="noindex" />' : ""}
  <link rel="canonical" href="${esc(url)}" />
${alt ? `  <link rel="alternate" hreflang="es-MX" href="${SITE.baseUrl}${alt.es}" />
  <link rel="alternate" hreflang="en" href="${SITE.baseUrl}${alt.en}" />
  <link rel="alternate" hreflang="x-default" href="${SITE.baseUrl}${alt.es}" />
` : ""}  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <meta property="og:type" content="${page.type === "home" ? "website" : "article"}" />
  <meta property="og:site_name" content="Netio" />
  <meta property="og:locale" content="${ogLocale}" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:title" content="${esc(page.ogTitle || page.title)}" />
  <meta property="og:description" content="${esc(page.description)}" />
  <meta property="og:image" content="${SITE.ogImage}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${esc(page.ogAlt || "Netio: calculadora de ganancias para vendedores de Mercado Libre México")}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(page.ogTitle || page.title)}" />
  <meta name="twitter:description" content="${esc(page.description)}" />
  <meta name="twitter:image" content="${SITE.ogImage}" />
  <link rel="stylesheet" href="/styles.css" />
${jsonld.map((o) => `  <script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>`;
}

// ---------------------------------------------------------------- header / footer
export function header(lang = "es-MX", { current = "" } = {}) {
  const en = lang === "en";
  const items = en
    ? [["/calculadora/", "Calculator (es)"], ["/guias/", "Guides (es)"], ["/como/", "How to (es)"], ["/comparar/", "Compare (es)"]]
    : [["/calculadora/", "Calculadora"], ["/guias/", "Guías"], ["/como/", "Cómo"], ["/comparar/", "Comparar"]];
  const nav = items.map(([href, label]) =>
    `<a${current.startsWith(href) ? ' aria-current="true"' : ""} href="${href}">${label}</a>`).join("\n        ");
  const langLink = en
    ? '<a href="/" hreflang="es-MX" lang="es-MX">Español</a>'
    : '<a href="/en/" hreflang="en" lang="en">English</a>';
  return `  <a class="skip" href="#contenido">${en ? "Skip to content" : "Saltar al contenido"}</a>
  <header class="top">
    <div class="wrap">
      <a class="lockup" href="/" aria-label="Netio, ${en ? "home" : "inicio"}">
        <img src="/netio-logo.svg" alt="" width="32" height="32" />
        <span>netio</span>
      </a>
      <nav aria-label="${en ? "Main" : "Principal"}">
        ${nav}
        ${langLink}
        <a class="btn btn-sm" href="${esc(storeLink("landing"))}">${en ? "Add to Chrome" : "Agregar a Chrome"}</a>
      </nav>
    </div>
  </header>`;
}

export function footer(lang, pages) {
  const en = lang === "en";
  const group = (type) => pages.filter((p) => p.type === type && !p.noindex);
  const col = (title, items) => `<div><b>${esc(title)}</b><ul>${items.map((p) => `<li><a href="${p.path}">${esc(p.navLabel || p.h1)}</a></li>`).join("")}</ul></div>`;
  return `  <footer>
    <div class="wrap">
      <a class="lockup" href="/" aria-label="Netio, ${en ? "home" : "inicio"}">
        <img src="/netio-logo.svg" alt="" width="28" height="28" />
        <span>netio</span>
      </a>
      <p class="not-aff">${esc(en ? SITE.notAffiliatedEn : SITE.notAffiliated)}</p>
      <nav class="cols" aria-label="${en ? "All pages" : "Todas las páginas"}">
        ${col(en ? "Guides (Spanish)" : "Guías", group("guide"))}
        ${col(en ? "How to (Spanish)" : "Cómo", group("howto"))}
        ${col(en ? "Compare (Spanish)" : "Comparar", group("compare"))}
        <div><b>Netio</b><ul>
          <li><a href="/calculadora/">${en ? "Free calculator (Spanish)" : "Calculadora gratis"}</a></li>
          <li><a href="/">${en ? "Home" : "Inicio"}</a></li>
          <li><a href="/privacidad.html">${en ? "Privacy" : "Privacidad"}</a></li>
          <li><a href="/soporte.html">${en ? "Support" : "Soporte"}</a></li>
          <li><a href="${esc(storeLink("landing"))}">Chrome Web Store</a></li>
          <li>${en ? '<a href="/" hreflang="es-MX" lang="es-MX">Español</a>' : '<a href="/en/" hreflang="en" lang="en">English</a>'}</li>
          <li><a href="/llms.txt">llms.txt</a></li>
        </ul></div>
      </nav>
      <p class="copy">&copy; 2026 Netio. ${en ? "Contact" : "Contacto"}: <a href="mailto:${SITE.supportEmail}">${SITE.supportEmail}</a></p>
    </div>
  </footer>`;
}

// ---------------------------------------------------------------- pieces
export function breadcrumbs(page) {
  const items = [{ name: "Inicio", path: "/" }, ...(page.breadcrumb || [])];
  return `<nav class="crumbs" aria-label="Ubicación"><ol>${items.map((c, i) =>
    i === items.length - 1 ? `<li aria-current="page">${esc(c.name)}</li>` : `<li><a href="${c.path}">${esc(c.name)}</a></li>`).join("")}</ol></nav>`;
}

export function faqHtml(faq) {
  if (!faq?.length) return "";
  return `<section class="faq-sec" id="faq"><h2>Preguntas frecuentes</h2><div class="faq">${faq.map((q) =>
    `<details><summary>${esc(q.q)}</summary><p>${q.a}</p></details>`).join("")}</div></section>`;
}

export function relatedHtml(page, pages) {
  const rel = (page.related || []).map((slug) => pages.find((p) => p.path === slug)).filter(Boolean);
  if (!rel.length) return "";
  return `<section class="related"><h2>Sigue con esto</h2><ul>${rel.map((p) =>
    `<li><a href="${p.path}">${esc(p.h1)}</a><span>${esc(p.description)}</span></li>`).join("")}</ul></section>`;
}

export function ctaHtml(source, { title = "Ve esto en cada venta y publicación, directo en Mercado Libre", body = "Netio es una extensión gratis de Chrome. Muestra comisión, costo fijo, envío, retenciones y ganancia neta debajo del precio de cada publicación y en cada resultado de búsqueda. Al instalar tienes PRO 7 días, sin tarjeta." } = {}) {
  return `<section class="cta-box"><h2>${esc(title)}</h2><p>${esc(body)}</p>${installButton(source)}<p class="small">${esc(SITE.notAffiliated)}</p></section>`;
}

// A ledger ticket for a worked example. lines: [{ label, note, value, cls }]
export function ticket({ title, subtitle, lines, sum, verdict, verdictCls, caption }) {
  return `<figure class="ticket">
  <div class="ticket-head"><b>${esc(title)}</b><span>${esc(subtitle || "")}</span></div>
  <dl>${lines.map((l) => `<div class="row"><dt>${esc(l.label)}${l.note ? `<small>${esc(l.note)}</small>` : ""}</dt><dd${l.cls ? ` class="${l.cls}"` : ""}>${esc(l.value)}</dd></div>`).join("")}</dl>
  <div class="sum"><span class="k">${esc(sum.label)}</span><span class="v ${verdictCls}">${esc(sum.value)}</span></div>
  ${verdict ? `<p class="verdict ${verdictCls}">${esc(verdict)}</p>` : ""}
  ${caption ? `<figcaption>${caption}</figcaption>` : ""}
</figure>`;
}

// ---------------------------------------------------------------- JSON-LD
export function ldOrganization() {
  return {
    "@context": "https://schema.org", "@type": "Organization", "@id": `${SITE.baseUrl}/#org`,
    name: "Netio", url: `${SITE.baseUrl}/`, logo: `${SITE.baseUrl}/icon-512.png`,
    contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", email: SITE.supportEmail, availableLanguage: ["es", "en"] }]
  };
}
export function ldSoftware() {
  return {
    "@context": "https://schema.org", "@type": "SoftwareApplication", "@id": `${SITE.baseUrl}/#app`,
    name: "Netio", applicationCategory: "BrowserApplication", operatingSystem: "Chrome",
    url: SITE.storeUrl, downloadUrl: SITE.storeUrl, image: SITE.ogImage, inLanguage: "es-MX",
    description: "Extensión de Chrome que muestra la ganancia real por venta y por publicación en Mercado Libre México: comisión, costo fijo, envío, retenciones y costo del producto.",
    publisher: { "@id": `${SITE.baseUrl}/#org` },
    offers: [
      { "@type": "Offer", name: "Gratis", price: "0", priceCurrency: "MXN", url: SITE.storeUrl },
      { "@type": "Offer", name: "PRO mensual", price: String(SITE.pro.monthlyMXN), priceCurrency: "MXN", url: SITE.storeUrl },
      { "@type": "Offer", name: "PRO anual", price: String(SITE.pro.yearlyMXN), priceCurrency: "MXN", url: SITE.storeUrl }
    ]
  };
}
export function ldWebPage(page) {
  return {
    "@context": "https://schema.org", "@type": page.type === "howto" ? "WebPage" : "WebPage",
    "@id": `${SITE.baseUrl}${page.path}#webpage`, url: `${SITE.baseUrl}${page.path}`,
    name: page.title, description: page.description, inLanguage: page.lang || "es-MX",
    dateModified: SITE.checkedAt, isPartOf: { "@type": "WebSite", name: "Netio", url: `${SITE.baseUrl}/` },
    publisher: { "@id": `${SITE.baseUrl}/#org` }, about: { "@id": `${SITE.baseUrl}/#app` }
  };
}
export function ldBreadcrumb(page) {
  const items = [{ name: "Inicio", path: "/" }, ...(page.breadcrumb || [])];
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${SITE.baseUrl}${c.path}` }))
  };
}
export function ldFaq(page) {
  if (!page.faq?.length) return null;
  return {
    "@context": "https://schema.org", "@type": "FAQPage", inLanguage: page.lang || "es-MX",
    mainEntity: page.faq.map((q) => ({ "@type": "Question", name: q.q, acceptedAnswer: { "@type": "Answer", text: stripTags(q.a) } }))
  };
}
export function ldHowTo(page) {
  if (!page.steps?.length) return null;
  return {
    "@context": "https://schema.org", "@type": "HowTo", name: page.h1, description: page.description, inLanguage: "es-MX",
    totalTime: page.totalTime || "PT10M",
    tool: [{ "@type": "HowToTool", name: "Calculadora gratis de Netio" }, { "@type": "HowToTool", name: "Extensión Netio para Chrome" }],
    step: page.steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.name, text: stripTags(s.text), url: `${SITE.baseUrl}${page.path}#paso-${i + 1}` }))
  };
}

// ---------------------------------------------------------------- page bodies
export function renderArticle(page, pages) {
  const steps = page.steps?.length
    ? `<section class="steps-sec"><h2>${esc(page.stepsTitle || "Paso a paso")}</h2><ol class="steps">${page.steps.map((s, i) =>
      `<li id="paso-${i + 1}"><div><h3>${esc(s.name)}</h3>${s.text}</div></li>`).join("")}</ol></section>`
    : "";
  const jsonld = [ldOrganization(), ldSoftware(), ldWebPage(page), ldBreadcrumb(page), ldFaq(page), ldHowTo(page)].filter(Boolean);
  return `${head(page, { jsonld })}
<body>
${header(page.lang, { current: page.path })}
  <main id="contenido" class="article">
    <div class="wrap">
      ${breadcrumbs(page)}
      <h1>${esc(page.h1)}</h1>
      <p class="answer">${page.answer}</p>
      <p class="updated">Tarifas consultadas en las páginas oficiales el ${SITE.checkedAtText}. Netio no está afiliado a Mercado Libre.</p>
      ${page.body}
      ${steps}
      ${page.example ? `<section class="example" id="ejemplo"><h2>${esc(page.example.title)}</h2>${page.example.intro ? `<p>${page.example.intro}</p>` : ""}<div class="example-grid">${page.example.ticket}<div class="example-notes">${page.example.notes}<p><a class="btn btn-line" href="${esc(page.example.calcHref)}">Abrir este ejemplo en la calculadora</a></p></div></div></section>` : ""}
      ${faqHtml(page.faq)}
      ${ctaHtml(page.utmSource || "guia")}
      ${relatedHtml(page, pages)}
    </div>
  </main>
${footer(page.lang, pages)}
</body>
</html>
`;
}

export function renderShell(page, pages, mainHtml, extraJsonld = []) {
  const jsonld = [ldOrganization(), ldSoftware(), ldWebPage(page), ldBreadcrumb(page), ldFaq(page), ...extraJsonld].filter(Boolean);
  return `${head(page, { jsonld })}
<body>
${header(page.lang, { current: page.path })}
${mainHtml}
${footer(page.lang, pages)}
</body>
</html>
`;
}
