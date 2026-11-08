# Netio

Chrome extension (Manifest V3, vanilla JS) for **MercadoLibre Mexico sellers**:
fee and net-payout calculator on product pages, plus a Quick View fee strip on
search results. Spanish (es-MX) first, English fallback.

> All branding lives in `src/config/branding.js`; `npm run build` stamps it
> into `manifest.json`.

## Features

- **Product pages** — injected card under the price block: estimated MELI
  commission (Clásica/Premium), low-price fixed charge, editable shipping
  cost, net payout, profit margin from your product cost, break-even price,
  and a reverse calculator (target margin % → required listing price).
- **Search results** — collapsed per-result strip with estimated net payout;
  expands to a mini breakdown (listing type guess, category, free shipping,
  seller, commission).
- **Options** — per-surface toggles, default shipping cost, default listing
  type, clear stored data.

Fees are **estimates** from a bundled, versioned table
(`src/fees/fee-table.js`) transcribed from Mercado Libre's published rates —
sources and retrieval date are cited inside the file. MELI's anonymous API was
closed in 2024, so live rates require OAuth (planned V2 via the
`src/fees/fee-source.js` interface, which the UI is already built against).

## Development

```bash
npm test            # syntax checks + unit tests (fees, solver, locales)
npm run build       # stamp manifest from branding.js, refresh dist/
npm run build:release  # release name (no "(dev)"), CWS zip only
npm run release     # zip + store listing in one folder (see Release)
npm run icons       # regenerate icon artwork (reproducible, pure stdlib)
```

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → repo
root (or `dist/`). Open any `mercadolibre.com.mx` listing; diagnostics are
logged under the `[Netio]` console prefix.

## Structure

```
manifest.json            MV3 manifest (name/version stamped by the build)
_locales/                es_419 (default; Chrome has no es_MX) + en
src/config/              branding.js (single branding source), i18n.js
src/fees/                fee-table.js (data) → fee-source.js (interface)
                         → calculator.js (pure math, unit-tested)
src/content/             content.js (detect/inject/persist), page-data.js,
                         card.js (PDP UI), quickview.js (search UI),
                         format.js (shared es-MX formatting), content.css
src/options/             settings page
src/background/          service worker (V2 API proxy stub)
scripts/                 build.mjs, release.mjs, cws-publish.mjs, cws-auth.mjs
store/                   templates/ (listing, privacy tab, upload steps),
                         assets/ (screenshots, promo tile), SETUP-CWS-API.md
docs/                    RELEASE-<version>.md (what's new, read by the release)
tests/                   node --test suite
```

## Release

One command produces one folder with everything the Chrome Web Store needs,
always in sync with the build:

```bash
npm run release            # build + render release/netio-<version>/
npm run release:publish    # same, then upload the zip and submit for review
git checkout manifest.json # the build stamps the store name into it
```

`release/netio-<version>/` contains `netio-<version>.zip`, `listing-es.md`,
`listing-en.md`, `privacy-tab.md`, `UPLOAD-STEPS.md`, `assets/` and a Spanish
`README.txt` that says what to paste where. Version, store name, short
description and PRO prices come from `src/config/branding.js`; the what's new
text comes from `docs/RELEASE-<version>.md` (sections "Novedades (Chrome Web
Store)" and "What's new (Chrome Web Store, English)"); the release fails if
that file or either section is missing, if a description exceeds the store
limits, or if any text contains an em dash.

Before releasing: bump `version` in `src/config/branding.js`, `package.json`
and `manifest.json`, write `docs/RELEASE-<version>.md`, run `npm test`,
`npm run test:e2e` and `npm run test:site`.

Automatic upload (`release:publish`) uses the Chrome Web Store Publish API
with credentials from a git-ignored `.cws.env`. One-time setup:
`store/SETUP-CWS-API.md`, then `node scripts/cws-auth.mjs`. The listing text,
images and the Privacy tab are still pasted by hand (3 pastes: ES description,
EN description, Privacy tab).

## Updating the fee table

1. Check MELI's published rates (source URLs in `fee-table.js` meta).
2. Update values, bump `meta.version` and `meta.retrievedAt`.
3. `npm test` (tier boundary tests will catch slips), then `npm run release`.

## Compliance notes

- Reads only the DOM of the page the user is viewing; no background crawling.
- All data stays in `chrome.storage` (local/sync); no external servers, no
  analytics, no data collection. See `PRIVACY.md`.
- Every injected element carries the extension logo + name (third-party
  identification).
