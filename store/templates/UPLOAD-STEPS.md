# Netio v{{version}}: Chrome Web Store upload steps

Files in this folder: `README.txt` (Spanish summary of what goes where), `listing-es.md`, `listing-en.md`, `privacy-tab.md`, `assets/screenshot-1.png` to `assets/screenshot-5.png` (1280x800), `assets/promo-tile-440x280.png`.
With CWS API credentials in `.cws.env` (see `store/SETUP-CWS-API.md`), `npm run release:publish` uploads the zip and submits it for review, so steps B and G below happen automatically; the listing text, images and Privacy tab are still pasted by hand.
The package to upload is `{{zipName}}`, built with `npm run release` (the release build stamps the store name into the manifest and renders this folder). Do not upload a dev build: its manifest name is "Netio (dev)".

## Before running `npm run release`

- Fee and shipping tables current (`src/fees/fee-table.js` and `src/fees/shipping-table.js` meta dates).
- `npm test`, the e2e smoke (`npm run test:e2e`) and `npm run test:site` green.
- Manual pass: 3 product pages + 2 search pages, no console errors.
- Privacy policy URL live: https://netiox.netlify.app/privacidad.html
- After the release command: `git checkout manifest.json` (the build stamps the store name into it). The zip must contain only `manifest.json`, `src/` and `_locales/` (no `tests/` or `scripts/`), say version {{version}}, carry `override = false` in `src/pro/gate.js` and an empty telemetry url.

## A. Open the item

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the developer account that owns Netio.
2. Click the **Netio** item in the list (item id `{{extensionId}}`). You land on the item's dashboard.

## B. Upload the package

3. In the left menu click **Package**.
4. Click **Upload new package** (top right).
5. Choose `{{zipName}}` and wait for "Package uploaded". The page should now show version {{version}} and the name `{{storeName}}`. If it shows "Netio (dev)", you uploaded the wrong zip: rebuild with `npm run release` and upload again.

## C. Store listing tab (Spanish first)

6. In the left menu click **Store listing**.
7. At the top of the page, open the **language** dropdown and select **Spanish (Latin America)**. If it is not there yet, click **Add language**, pick **Spanish (Latin America)** and, when asked, set it as the **default language**.
8. **Title**: read-only; it comes from the package. Leave it.
9. **Summary from package**: read-only. Leave it.
10. **Description**: paste the long description block from `listing-es.md` (plain text, no Markdown). It says the 7-day PRO trial starts when the seller saves the first cost; never paste the older install-time trial wording from earlier versions.
11. **Category**: choose **Shopping**.
12. **Language**: confirm it reads Spanish (Latin America).
13. **Store icon**: keep the existing 128x128 icon (it is also inside the package). Only replace it if the dashboard flags it.
14. **Screenshots**: click **Upload** under "Screenshots" and add `screenshot-1.png`, `screenshot-2.png`, `screenshot-3.png`, `screenshot-4.png`, `screenshot-5.png` in that order (each is 1280x800, PNG, no transparency). Drag to reorder if needed: 1 should be first.
15. **Small promo tile**: click **Upload** under "Small promo tile (440x280)" and add `promo-tile-440x280.png`.
16. **Marquee promo tile (1400x560)**: optional, skip.
17. **Official URL**: in the dropdown pick the verified site `netiox.netlify.app` if it is listed. If it is not verified yet, skip this field (it only affects the "official site" badge).
18. **Homepage URL**: `https://netiox.netlify.app/`
19. **Support URL**: `https://netiox.netlify.app/soporte.html`
20. **What's new**: the Chrome Web Store dashboard has no such field for extensions. The "Novedades" block in `listing-es.md` is for the release notes and the landing page, not for the dashboard.
21. Click **Save draft** (top right).

## D. Store listing tab (English, secondary)

22. Still in **Store listing**, open the language dropdown and click **Add language**. Pick **English**.
23. **Description**: paste the long description block from `listing-en.md`. (The "What's new" block in that file is for release notes, not for the dashboard.)
24. Screenshots and promo tile: the English listing can reuse the same images. If the form shows empty image slots for English, upload the same five screenshots and the promo tile again.
25. Click **Save draft**.

Note: the short description (132 characters) is the manifest `description` and is read-only in the dashboard. The package already carries the Spanish one. The English short description in `listing-en.md` is for reference only.

## E. Privacy tab

26. In the left menu click **Privacy**.
27. **Single purpose**: paste the single purpose text from `privacy-tab.md`.
28. **Permission justification**: for each permission listed (`storage`, host permission `extensionpay.com`, and the mercadolibre.com.mx content-script hosts if shown), paste the matching justification from `privacy-tab.md`.
29. **Are you using remote code?**: select **No, I am not using remote code**.
30. **Data usage**: tick **Personally identifiable information** and **Financial and payment information** only (see the table in `privacy-tab.md`). Leave every other box unticked.
31. Tick the three certification checkboxes at the bottom (no sale to third parties, no unrelated use, no creditworthiness use).
32. **Privacy policy URL** (this field is on the **Account** page, left menu, under "Privacy policy"): `https://netiox.netlify.app/privacidad.html`. Save that page too.
33. Back on **Privacy**, click **Save draft**.

## F. Distribution tab

34. In the left menu click **Distribution**.
35. **Payments**: leave **Free** (PRO is sold through ExtensionPay, not Chrome Web Store payments).
36. **Visibility**: **Public**.
37. **Distribution regions**: uncheck **All regions**, then tick only **Mexico**. (Optional: also tick United States if you want cross-border sellers; the default recommendation is Mexico only.) Reason: most early installs were ChromeOS devices outside Mexico that never converted and dragged the install/uninstall and rating signals.
38. Click **Save draft**.

## G. Submit

39. Click **Submit for review** (top right). A dialog may ask whether to publish automatically after review: tick **Publish automatically after it has passed review** unless you want to press Publish yourself later.
40. Confirm. The item status changes to **Pending review**. Review usually takes from a few hours to a few days; you get an email when it is published or rejected.
41. After publication, open https://chromewebstore.google.com/detail/netio/{{extensionId}} in a private window and check: Spanish text, five screenshots, promo tile, version {{version}}.

## Screenshot contents (if they ever need re-capturing: 1280x800, PNG, no alpha, Spanish UI, no personal data, no Mercado Libre logos)

1. Product page (around $827): card with commission, shipping estimate from the official table, net payout and profit margin filled in.
2. Product page: target price, max cost and break-even rows visible (cost and margin set).
3. Search results (category browse): several strips with Radar verdicts and the bar with the cost-basis line.
4. Search results: one strip expanded showing the breakdown.
5. Options page: toggles, defaults, language.
Optional sixth: low-price item (under $299) showing the fixed-charge row and the "Ofrezco envío gratis" toggle. The promo tile is `assets/promo-tile-440x280.png`.

## If review rejects the item

- "Purple potassium" / permission warnings: paste the exact justification text again in **Privacy**; make sure `storage` and `extensionpay.com` are both justified.
- Trademark complaints: the description already states the extension is not affiliated with Mercado Libre; do not add Mercado Libre logos to the screenshots or the tile.
- Screenshot errors: each image must be exactly 1280x800, PNG without alpha; the ones in this folder already are.

## Counts (computed by `scripts/release.mjs` on {{date}} from the rendered files in this folder)

| Text | Characters | Limit |
| --- | --- | --- |
| Title (manifest name, read-only) | {{titleChars}} | 75 |
| Short description (manifest `description`, read-only) | {{shortChars}} | 132 |
| Long description ES (`listing-es.md`) | {{descEsChars}} | 16,000 |
| Long description EN (`listing-en.md`) | {{descEnChars}} | 16,000 |
| What's new ES | {{whatsNewEsChars}} | none published; keep it short |
| What's new EN | {{whatsNewEnChars}} | none published; keep it short |

Zero em dashes in every file of this folder. Before pasting, re-check: the trial copy must say "empieza cuando guardas tu primer costo" / "starts when you save your first cost"; the older install-time wording is wrong for {{version}}.
