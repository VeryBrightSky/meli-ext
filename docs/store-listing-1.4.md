# Chrome Web Store listing — v1.4 (paste into the dashboard)

Title (manifest name, set by the build): `Netio: Calculadora de Comisiones y Ganancias Mercado Libre México`

## Descripción corta (≤132)

`Ve tu ganancia real en cada publicación: comisión, costo fijo, envío, Full y retenciones 2026 (IVA 8%, ISR 2.5%). PRO gratis 7 días.`

## Descripción larga — Español

¿Vendes en Mercado Libre México y no sabes cuánto te queda de verdad? Netio
te lo muestra dentro de cada publicación: comisión, costo fijo, envío,
retenciones 2026 y tu ganancia neta, sin hojas de cálculo.

**Al instalar tienes PRO completo gratis 7 días.** Sin correo, sin tarjeta.

**Gratis, siempre:**
- Comisión estimada por categoría (Clásica y Premium) y costo fijo
- Tu costo de envío, Mercado Envíos Full y subsidio por reputación
- Retenciones 2026 actualizadas (IVA 8% / ISR 2.5%) con RFC
- Ganancia y margen por venta, precio mínimo para no perder
- Aviso en rojo cuando una publicación te hace perder dinero
- Resumen de neto en cada resultado de búsqueda

**PRO ($89 MXN al mes o $699 al año):**
- Precio objetivo: a qué precio publicar para ganar el margen que quieres
- Calculadora de meses sin intereses: tu ganancia real por plazo
- Comparación Clásica vs Premium lado a lado
- Radar de Rentabilidad: cada resultado de búsqueda en verde, amarillo o rojo
  según tu costo, filtro de solo rentables y exportar a CSV
- Tablero de Ganancias: todos tus productos ordenados por ganancia, con los
  que pierden arriba
- Probar precios sin tocar tu publicación

**Privacidad:** no necesitas cuenta para usar Netio. Tus costos y productos
nunca salen de tu navegador. La prueba de 7 días es local: sin correo, sin
tarjeta y sin conexión. Los pagos de PRO los procesa ExtensionPay con Stripe
y solo te piden tu correo si pagas.

Las tablas de tarifas salen de guías públicas para vendedores (no de una API
de Mercado Libre), así que las cifras son estimaciones (la fecha de las
tarifas aparece en cada tarjeta). El porcentaje exacto depende de tu
categoría y cuenta. Esta extensión no está afiliada a Mercado Libre.

## Long description — English

Selling on Mercado Libre Mexico? Netio shows what you actually keep, right on
every listing: commission, fixed fee, shipping, 2026 withholdings and your net
profit, no spreadsheets.

**PRO is free for 7 days on install.** No email, no card.

**Free, forever:** estimated commission by category (Clásica & Premium) and
fixed fee; your shipping, Mercado Envíos Full and reputation subsidy; 2026
withholdings (IVA 8% / ISR 2.5%); profit and margin per sale, break-even
price; a red alert when a listing loses money; net summary on every search
result.

**PRO ($89 MXN/mo or $699/yr):** target price for the margin you want;
interest-free installments (MSI) calculator with your real profit per term;
Clásica vs Premium side by side; Profitability Radar on search pages (green,
yellow, red by your cost, profitable-only filter, CSV export); Profit
Dashboard ranking all your products with loss-makers on top; what-if pricing.

**Privacy:** no account needed to use Netio. Your costs and products never
leave your browser. The 7-day trial is local: no email, no card, no network
call. PRO payments are processed by ExtensionPay via Stripe, which only asks
for your email if you pay.

**Accuracy:** fee tables come from public seller guides (not a Mercado Libre
API), so every figure is an estimate; the date of the rates is shown on each
card. Exact rates depend on your category and account. Not affiliated with
Mercado Libre.

## Distribution setting (important)

Developer Dashboard → Distribution → Visibility: Public, but restrict
**regions to Mexico** (plus United States if you want cross-border sellers).
72% of current installs are ChromeOS outside Mexico and will never convert;
they also drag the install/uninstall and rating signals.

## What to say in "What's new"

`v1.4.3: arreglos de exportación CSV (las pérdidas ya salen como números),
la tarjeta sigue los cambios de precio de la página, mejor lectura de montos
y textos más claros.`

Anterior (v1.4):
`v1.4: PRO gratis 7 días al instalar. Aviso en rojo cuando pierdes dinero,
precio objetivo y Radar de Rentabilidad visibles en cada publicación y
búsqueda, Tablero con vista previa gratis, calculadora de MSI.`

## Privacy practices tab (must match the policy)

- Personally identifiable information: **Yes, email**, collected only by the
  payment processor (ExtensionPay) when the user pays. Not sold, not used for
  anything else. The 7-day trial is local: no email, no card. A random payment
  ID is created only if the user opens checkout or logs in; subscription
  status is then checked when the user uses Mercado Libre pages or starts
  Chrome.
- Chrome sync: some preferences sync across the user's own Chrome profiles.
- Financial/payment information: handled by Stripe via ExtensionPay; Netio
  never sees card data.
- Website content / browsing: **No** (pages are read locally to compute fees;
  nothing is transmitted).
