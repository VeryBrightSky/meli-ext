# Chrome Web Store Listing (checklist; current text in store-listing-1.4.md)

> Category: **Shopping**. Language: Spanish (Latin America) as primary,
> English listing as secondary. Package: `netio-1.5.5.zip` from
> `npm run build:release`. The paste-ready copy (ES, EN, What's new,
> Privacy tab) lives in `docs/store-listing-1.4.md` and in the release
> folder `store-listing-1.5.5.zip`; this file is the checklist.

## Single purpose statement (for the CWS review form)

Netio is a fee and profit calculator for sellers on Mercado Libre Mexico. On
the mercadolibre.com.mx listing and search pages the seller is viewing, it
reads the price and category from the page and shows the estimated Mercado
Libre commission, fixed fee, shipping cost from the official tables, 2026 tax
withholdings, net payout and profit for the seller's own product cost, plus a
dashboard of the products the seller saved. Everything is computed locally in
the browser.

## Título / Title

Read-only in the dashboard: it is the manifest `name`, stamped by the release
build from `EXT_BRAND.storeName`.

`Netio: Calculadora de comisiones para vendedores de Mercado Libre` (65
characters, limit 75). The English listing shows the same title.

## Descripción corta / Short description (132 max)

Read-only in the dashboard: it is the manifest `description`, not localized.

`Calculadora de comisiones, ganancias y precios para vendedores de Mercado Libre México.` (87 characters)

## Descripción larga / Long description

Paste from `docs/store-listing-1.4.md` (ES 4,216 characters, EN 3,957; limit
16,000). What it must say in v1.5.5:

- Trial: "Tu prueba PRO de 7 días empieza cuando guardas tu primer costo"
  (EN: "Your 7-day PRO trial starts when you save your first cost"). Never
  the older install-time wording.
- Free: commission by category (Clásica and Premium), fixed fee, shipping
  from the official Mercado Envíos tables by reputation and price band ($299,
  $499, $999) with the discount already included, Full and weight, 2026
  withholdings with RFC, profit and margin, break-even price, red alert on a
  loss, one-tap cost chips, Radar preview on search results with shipping
  deducted, Dashboard preview, copy or WhatsApp share, Spanish by default and
  English from the options.
- PRO ($89 MXN/month or $699 MXN/year): target price, max cost, Mercado Ads %
  per product, sweet spot, MSI calculator, Clásica vs Premium, what-if
  pricing, Profitability Radar using saved cost/type/category/weight where
  present plus CSV with the cost used per row, full Dashboard with CSV, local
  price history.
- Privacy paragraph: "No recopilamos datos de navegación ni de ventas. Si
  contratas PRO, ExtensionPay procesa tu correo y pago." plus the local
  price history (browser only, listing pages only, deleted with "Borrar datos
  guardados") and the policy URL. Never claim that no data at all is
  collected: the Privacy tab discloses the ExtensionPay email.
- Accuracy paragraph and the line "Esta extensión no está afiliada a Mercado
  Libre ni a Mercado Pago".

## Screenshot checklist (1280x800, PNG, no alpha)

1. Product page (~$827 item): card with commission, shipping estimate from the
   official table, net payout, profit margin filled in.
2. Product page: target price, max cost and break-even rows visible (cost and
   margin set).
3. Search results (category browse): several strips with Radar verdicts, bar
   with the cost basis line.
4. Search results: one strip expanded showing the breakdown.
5. Options page: toggles, defaults, language.
6. (Optional) Low-price item (<$299) showing the fixed-charge row and the
   interactive "Ofrezco envío gratis" toggle.

Capture in Spanish UI. No personal data visible in any screenshot. Promo tile
440x280 from the release folder.

## Submission checklist

- [ ] `npm run build:release`, then `git checkout manifest.json`
- [ ] Zip says version 1.5.5, name `Netio: Calculadora de comisiones para
      vendedores de Mercado Libre`, `override = false` in gate.js, telemetry
      url empty, no tests/ or scripts/
- [ ] Fee and shipping tables current (`fee-table.js`, `shipping-table.js`
      meta dates)
- [ ] `npm test`, e2e smoke and `npm run test:site` green
- [ ] Manual pass: 3 product pages + 2 search pages, no console errors
- [ ] Privacy policy URL live: https://netiox.netlify.app/privacidad.html
- [ ] Upload the release zip
- [ ] Justify permissions in the developer dashboard: `storage` (seller's
      inputs, trial stamp, local price history), content scripts on
      `mercadolibre.com.mx` (render the card and strips on listings and
      search pages), host `extensionpay.com` (subscription and payment
      verification for the optional PRO tier, processed by ExtensionPay via
      Stripe). Nothing calls `api.mercadolibre.com`.
- [ ] Distribution: Public, regions Mexico (optionally United States)

## Data-usage declaration (PRO tier)

- Personally identifiable information: **email address**, collected by
  ExtensionPay (payment provider) only when the user pays. Used for
  subscription management. Not sold, not shared beyond the payment provider
  (Stripe), not used for unrelated purposes.
- Financial and payment information: subscription status handled by
  ExtensionPay; card data handled by Stripe, never seen by Netio.
- Everything else (costs, sales, price history, settings, the trial stamp):
  stored locally in the browser, never transmitted.
- Disclose ExtensionPay/Stripe as the payment processor in the listing
  description (done in the privacy paragraph).
