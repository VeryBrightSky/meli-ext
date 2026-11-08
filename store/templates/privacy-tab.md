# Netio v{{version}}: Chrome Web Store "Privacy" tab answers

Everything below matches PRIVACY.md and https://netiox.netlify.app/privacidad.html (effective 2026-10-30, version {{version}}) and the manifest in the uploaded package:
permissions `storage`; host permission `https://extensionpay.com/*`; content scripts on
`articulo.mercadolibre.com.mx`, `www.mercadolibre.com.mx`, `listado.mercadolibre.com.mx` and `extensionpay.com`.

## Single purpose description

```
Netio is a fee and profit calculator for sellers on Mercado Libre Mexico. On the mercadolibre.com.mx listing and search pages the seller is viewing, it reads the price and category from the page and shows the estimated Mercado Libre commission, fixed fee, shipping cost, 2026 tax withholdings, net payout and profit for the seller's own product cost, plus a dashboard of the products the seller saved. Everything is computed locally in the browser.
```

## Permission justifications

**storage**

```
Saves the seller's own inputs in the browser (product costs, monthly sales, default shipping cost, seller reputation, package weight, MSI rates, Mercado Ads %, language and display preferences, the local 7-day trial stamp written when the first cost is saved, and the local price history of the listings the seller opens) so the calculator, the search Radar and the Profit Dashboard remember them between visits. Some preferences use chrome.storage.sync so they follow the seller's own Chrome profile. Nothing is sent to any server of ours; we have none. We do not collect browsing or sales data. If the seller subscribes to PRO, ExtensionPay processes their email and payment.
```

**Host permission: https://extensionpay.com/\***

```
Used only for Netio PRO payments and subscription checks through ExtensionPay (the payment processor). The extension contacts extensionpay.com only after the user opens checkout or chooses "Ya pagué: iniciar sesión", and from then on to verify the subscription status. No Mercado Libre page data or browsing data is sent there. The 7-day trial is local (it starts when the seller saves a first cost) and makes no network call.
```

**Content scripts on mercadolibre.com.mx (listed under content_scripts, not a host permission)**

```
The calculator card and the search Radar strips are injected on mercadolibre.com.mx product and search pages. The script reads the price, category and listing data of the page the user is viewing to compute fees. It does not crawl, does not open pages in the background and does not transmit page content anywhere.
```

**Remote code**: No. All JavaScript ships inside the package (ExtensionPay's client library is bundled as `src/vendor/extpay.js`). No eval, no remote scripts, no WebAssembly fetched at runtime.

## Data usage (check only these)

| Data type | Collected? | Notes to write in the form |
| --- | --- | --- |
| Personally identifiable information | Yes: email address | Collected by ExtensionPay (payment processor) only if the user pays for PRO. Not collected during the free plan or the 7-day trial. |
| Health information | No | |
| Financial and payment information | Yes: payment/subscription status (safer disclosure) | Card data is handled by Stripe through ExtensionPay; Netio never sees or stores card numbers. Netio only receives whether the subscription is active. Google's definition includes "payment history", so ticking it is the conservative choice; over-disclosure is not penalized, under-disclosure is. |
| Authentication information | No | No Netio account exists. A random ExtensionPay payment ID is created only if the user opens checkout or logs in. |
| Personal communications | No | |
| Location | No | |
| Web history | No | The extension does not record visited pages. Price snapshots of listings the user opened are kept only in the user's browser (listing pages only, never cart or checkout), never transmitted, and the user deletes them with "Borrar datos guardados" in the options. |
| User activity | No | No analytics, no click tracking, no identifiers. |
| Website content | No | Page content is read locally to compute fees and is never transmitted. |

## Certifications (tick all three)

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy URL

```
https://netiox.netlify.app/privacidad.html
```

## Wording rule for the listing and this tab

Do not claim that no data at all is collected (the 1.0 wording) anywhere: the form above discloses that ExtensionPay collects the email of paying PRO users, and the two statements would contradict each other. Use instead: "No recopilamos datos de navegación ni de ventas. Si contratas PRO, ExtensionPay procesa tu correo y pago." (EN: "We do not collect browsing or sales data. If you subscribe to PRO, ExtensionPay processes your email and payment.")
