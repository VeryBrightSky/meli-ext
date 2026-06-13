# Chrome Web Store Listing

> Category: **Shopping** (or Productivity → Tools). Language: Spanish
> (Mexico), with English listing as secondary.

## Single purpose statement (for the CWS review form)

Shows MercadoLibre Mexico sellers an estimated fee and net-payout breakdown on
the listing pages they visit.

## Título / Title

- ES: `Netio — Calculadora de comisiones para vendedores`
- EN: `Netio — Fee calculator for sellers`

## Descripción corta / Short description (≤132 chars)

- ES: `Calcula comisiones, cargo fijo y ganancia neta de Mercado Libre México directamente en cada publicación.`
- EN: `See Mercado Libre Mexico fees, fixed charges and your net payout directly on every listing.`

## Descripción larga — Español

¿Vendes en Mercado Libre México? Mira cuánto recibirás realmente por cada
venta, sin salir de la publicación.

**En páginas de producto:**
- Comisión estimada por categoría (Clásica y Premium)
- Cargo fijo para productos de menos de $299
- Tu costo de envío y costo de producto → ganancia y margen
- Precio mínimo para no perder (punto de equilibrio)
- Precio objetivo: ingresa tu margen deseado y te decimos a qué precio publicar

**En resultados de búsqueda:**
- Resumen plegable por producto: neto aproximado, tipo de publicación,
  envío gratis y comisión estimada

**Privacidad primero:** sin cuentas, sin servidores, sin recopilación de
datos. Todo se guarda solo en tu navegador.

Las cifras son estimaciones basadas en las tarifas publicadas por Mercado
Libre (fecha citada en cada tarjeta). El porcentaje exacto depende de tu
categoría y cuenta. Esta extensión no está afiliada a Mercado Libre.

## Long description — English

Selling on Mercado Libre Mexico? See what you'll actually receive from every
sale, right on the listing.

**On product pages:** estimated commission by category (Clásica & Premium),
the fixed charge on items under $299, your shipping and product cost → profit
and margin, break-even price, and a target-price calculator (enter your
desired margin, get the listing price you need).

**On search results:** a collapsible per-item summary with approximate net
payout, listing type, free-shipping flag and estimated commission.

**Privacy first:** no accounts, no servers, no data collection. Everything is
stored only in your browser.

Figures are estimates based on Mercado Libre's published rates (date cited on
every card). Exact percentages depend on your category and account. This
extension is not affiliated with Mercado Libre.

## Screenshot checklist (1280×800, PNG)

1. Product page (~$827 item) — card with commission, net payout, profit
   margin filled in.
2. Product page — target price + break-even rows visible (cost + margin set).
3. Search results (category browse) — several collapsed strips visible.
4. Search results — one strip expanded showing the breakdown.
5. Options page — toggles and defaults.
6. (Optional) Low-price item (<$299) showing the fixed-charge row.

Capture in Spanish UI. No personal data visible in any screenshot.

## Submission checklist

- [ ] Final name + real icons in `branding.js` / `src/assets/icons`, then
      `npm run build:release`
- [ ] Bump `version` in branding.js
- [ ] Verify fee table is current (`fee-table.js` meta) — re-check sources
- [ ] `npm test` green
- [ ] Manual pass: 3 product pages + 2 search pages, no console errors
- [ ] Privacy policy URL (host `PRIVACY.md` contents publicly)
- [ ] Upload zip from `npm run build:release`
- [ ] Justify permissions in the developer dashboard: `storage` (user
      settings), host `mercadolibre.com.mx` (render cards on listings),
      host `extensionpay.com` (subscription/payment verification for the
      optional Pro tier — processed by ExtensionPay via Stripe).
      Note: `api.mercadolibre.com` was removed for v1.0.0 (nothing calls
      it); re-add with justification when V2 ships authed fee lookups.

## Data-usage declaration (v1.2+, Pro tier)

- Personally identifiable information: **email address** — collected by
  ExtensionPay (payment provider) only when the user starts a trial or pays.
  Used for account/subscription management. Not sold, not shared beyond the
  payment provider (Stripe), not used for unrelated purposes.
- Authentication information: subscription status token handled by
  ExtensionPay.
- Everything else (costs, sales, price history, settings): stored locally in
  the browser, never transmitted.
- Update the "no data collected" answer from v1.0.0 accordingly — declare the
  above instead. Disclose ExtensionPay/Stripe as the payment processor in the
  listing description.
