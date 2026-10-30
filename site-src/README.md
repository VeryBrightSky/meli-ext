# Netio site (landing/)

The public site at https://netiox.netlify.app is built from this folder. Everything in `landing/` that is a guide, how-to, comparison, the calculator, the two homepages, `sitemap.xml`, `robots.txt` and `llms.txt` is generated. Do not edit those files by hand; edit the data here and rebuild.

## Files

- `pages.mjs`: every page as one object (slug, title, meta description, H1, answer paragraph, body HTML, worked example, FAQ, related pages, breadcrumb). Worked examples are computed at build time with the extension's own fee modules, so the numbers in the prose always match the calculator.
- `shipping-official.js`: the three official Mercado Envíos tables (verde, amarilla, naranja) by weight and price band, checked 2026-10-30. Used by the web calculator for the shipping line.
- `calc-web.js`: the web calculator (math + form). Pure math is `NETIO_WEB_CALC.compute`, tested in Node.
- `site.mjs`: base URL, store URL, prices, official source URLs, date checked.
- `templates.mjs` and `render.mjs`: HTML templates (head, header, footer, JSON-LD, article, calculator, home).

The fee math (commission, fixed charge, withholdings, target price) is NOT here: the build copies `src/fees/{fee-table,shipping-table,calculator,fee-source}.js` into `landing/calculadora/`, so the extension stays the single source of truth.

## Build

```
node scripts/build-site.mjs      # or: npm run build:site
```

Writes every page into `landing/` with clean URLs (`landing/guias/<slug>/index.html`), copies the calculator modules, injects the shared header/footer into the hand-written pages (`privacidad.html`, `soporte.html`, `gracias.html`, `404.html`, `adios.html` footer only) and regenerates `sitemap.xml`, `robots.txt` and `llms.txt`. The build refuses to write a page that contains an em dash.

## Test and verify

```
npm run test:site                # builds, then runs tests/site/calculator.test.mjs (hand-derived expectations)
node tests/site/calculator-csv.mjs out.csv   # web calculator vs extension vs official, one row per case
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/verify-site.mjs --screenshots shots/
```

`verify-site.mjs` serves a scratch copy of `landing/`, fetches every page without JS (H1, answer, FAQ, JSON-LD, links, alt text, em dashes), then opens each page in Chromium at 360/390/1280 in light and dark (console errors, horizontal overflow, external requests) and exercises the calculator's query-string prefill.

## Add a page

1. Open `pages.mjs` and copy an object of the same type (`guide`, `howto` or `compare`). Give it a new `path` (the URL, with leading and trailing slash), `title`, `description`, `h1`, a 40 to 60 word `answer`, a `body` (HTML), an `example` (use the `example()` helper with real inputs so the numbers are computed), 5 to 8 `faq` entries, two `related` paths and a `breadcrumb`.
2. Add the object to the `PAGES` array at the bottom. Order inside the array is the order in the footer and hub pages.
3. `node scripts/build-site.mjs`, then `node scripts/verify-site.mjs`.

Rules for copy: Mexican Spanish, tuteo, accents, no em dashes, no personal names or phone numbers, no money figure that is not from an official page or from `src/fees/`. Say "estimado" wherever the extension's data is secondary-sourced. Every page keeps the not-affiliated line (the footer has it).

## Deploy

Drag the whole `landing/` folder onto Netlify Drop for the netiox site. `_headers` is already in the folder. Nothing to install on the server: static HTML, one stylesheet, six small scripts for the calculator, no fonts, no analytics.
