# Netio: Chrome Web Store listing (English, secondary language)

Package version: {{version}}. The title comes from the package (manifest `name`, stamped by `npm run build:release`):
`{{storeName}}` ({{titleChars}} characters). It is not typed into the listing.

## Short description (max 132 characters)

On the Chrome Web Store the short description is the manifest `description` field and is read-only in the dashboard. The v{{version}} package ships the Spanish one (`{{shortDescription}}`, {{shortChars}} characters), and the manifest description is not localized, so English visitors see that text too.

Reference wording (126 characters) if a localized manifest description is added in a future version (not in {{version}}):

```
Mercado Libre Mexico fee calculator: your real profit (ganancia) after comisiones, shipping and withholdings. PRO free 7 days.
```

## Long description (paste as is, no Markdown)

```
Netio shows what you actually keep on every sale on Mercado Libre Mexico, right inside the listing.
Commission, fixed fee, shipping from the official tables, 2026 withholdings and your net profit, no spreadsheets.

Your 7-day PRO trial starts when you save your first cost. No email, no card, no account. That way the 7 days are spent calculating real profits, not ticking away on their own.

FREE, FOREVER
• Estimated commission by category (Clásica and Premium) and the per-unit fixed fee
• Shipping estimated from the official Mercado Envíos tables for your reputation (green or MercadoLíder, yellow or no reputation, orange or red) and the price band ($299, $499 and $999). The reputation discount is already built into the table
• Mercado Envíos Full and package weight to refine the shipping estimate; a shipping cost you type always wins
• 2026 withholdings (IVA 8% / ISR 2.5%) for sellers with an RFC
• Profit and margin per sale, and the break-even price
• A red alert when a listing loses you money
• Save your cost with one tap: suggested-cost chips on the card
• Radar preview on search results: how many products on the page are profitable, with shipping already deducted
• Profit Dashboard with your first products
• Copy the summary or send it to another seller on WhatsApp
• Spanish by default; English available from the options page

PRO (${{monthly}} MXN per month or ${{yearly}} MXN per year)
• Target price: what to charge to earn the margin you want
• Max cost: how much you can pay per unit and still earn your margin at the listing's current price
• Advertising: type your Mercado Ads % per product and it is deducted from profit, margin and every calculated price
• Sweet spot: tells you when raising the price a few pesos leaves you more money (lower fixed fee)
• Interest-free installments (MSI) calculator: your real profit per term, with your own rate
• Clásica vs Premium side by side
• What-if pricing without touching your listing
• Profitability Radar: every search result in green, yellow or red by your cost. Where you already saved a listing's cost, type, category or weight, the Radar uses your data; for the rest it uses the assumed cost you set. Profitable-only filter and CSV export with the cost used on every row
• Full Profit Dashboard: all your products ranked by profit, loss-makers on top, monthly sales and monthly profit, CSV export
• Local price history for the listings you visit

HOW IT WORKS
1. Install Netio and open any listing on mercadolibre.com.mx.
2. Type your product cost or tap a cost chip. Netio reads the price and category from the page.
3. See your profit, margin and the full breakdown. Saving your first cost starts your 7-day PRO trial and the product shows up in your Dashboard.

PRIVACY
No account is needed to use Netio. We do not collect browsing or sales data. If you subscribe to PRO, ExtensionPay processes your email and payment. Your costs, your products and the price history of the listings you open are stored only in your browser, never on a server, and only on listing pages (never in the cart or at checkout); you can delete them with "Clear saved data" in the options. The 7-day trial is local: no email, no card, no network call. No analytics, no tracking. Full policy: https://netiox.netlify.app/privacidad.html

ACCURACY
Commission tables come from public seller guides and shipping tables from Mercado Libre's help pages (not an API), so every figure is an estimate; the date they were checked is shown on each card. Exact rates depend on your category and account, and shipping can vary with volumetric weight. Confirm withholdings with your accountant.

This extension is not affiliated with Mercado Libre or Mercado Pago. Mercado Libre, Mercado Envíos and Mercado Pago are trademarks of their respective owners.

Website: https://netiox.netlify.app
Free web calculator: https://netiox.netlify.app/calculadora/
Support: https://netiox.netlify.app/soporte.html or vitowebpro@gmail.com
```

Character count: see `UPLOAD-STEPS.md` ("Counts" section); the limit is 16,000.

## Form fields

| Field | Value |
| --- | --- |
| Category | Shopping |
| Language | English as a secondary language; Spanish (Latin America) from `listing-es.md` is the primary |
| Homepage URL | https://netiox.netlify.app/ |
| Support URL | https://netiox.netlify.app/soporte.html |
| Privacy policy URL | https://netiox.netlify.app/privacidad.html |
| Contact email | vitowebpro@gmail.com |

## What's new (release notes; the Chrome Web Store has no such field, use it on the landing page or launch email)

```
{{whatsNewEn}}
```

## Notes

- No reviews, user counts or savings figures: there is no verifiable data.
- Do not propose another name: the title comes from the package.
- No em dashes anywhere in the text.
- The PRO trial is never described as starting at install time: it starts when the first cost is saved.
