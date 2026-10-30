# Chrome Web Store: privacy text for the telemetry build (v1.5.0+)

## Listing description: replace the "Privacidad primero / Privacy first" paragraph with

**Privacidad primero:** sin cuentas. Tus costos y productos se guardan solo en
tu navegador. Netio envía estadísticas anónimas de uso (sin precios, URLs,
títulos ni correo) y puedes desactivarlas en las opciones.

**Privacy first:** no accounts. Your costs and products are stored only in your
browser. Netio sends anonymous usage statistics (no prices, URLs, titles or
email) and you can turn them off in the options.

## Dashboard > Privacy practices > Data usage (tick exactly this)

- Personally identifiable information: YES (email, only collected by
  ExtensionPay when the user pays; unchanged from before).
- Payments information: YES (handled entirely by ExtensionPay / Stripe; unchanged).
- User activity: YES. Disclosure text to paste in the justification:
  "Netio collects anonymous usage events (for example: card shown, a cost was
  entered, a PRO prompt was shown, buy clicked, internal error codes) tied to a
  random install ID that is not derived from the user or joined with any other
  data. It never includes URLs, prices, costs, listing titles or IDs, or email.
  It is used only to find and fix problems and improve the product, is stored
  with our database provider (Supabase), and users can turn it off in the
  extension options."
- Website content: NO.
- Web history: NO.
- Everything else: NO.

Certify all three: not sold to third parties, not used for unrelated purposes,
not used for creditworthiness or lending.

Privacy policy URL: https://netiox.netlify.app/privacidad.html (the telemetry version in
this folder, uploaded before you submit).
