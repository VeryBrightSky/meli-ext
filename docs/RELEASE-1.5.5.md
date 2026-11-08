# Netio 1.5.5: notas de la versión

Texto para "Novedades" de la Chrome Web Store (primer bloque) y registro interno de lo que cambió (segundo bloque).

## Novedades (Chrome Web Store)

- Envío con tablas oficiales. El costo de envío estimado sale de las tablas publicadas por Mercado Libre según tu reputación (verde/MercadoLíder, amarilla o sin reputación, naranja/roja), con las bandas de precio $299, $499 y $999. La bonificación por reputación ya viene incluida en la tabla; no se descuenta nada encima.
- La prueba PRO de 7 días empieza cuando guardas tu primer costo, no al instalar. Así los 7 días se usan calculando ganancias reales.
- El Radar de rentabilidad en las búsquedas ahora descuenta el envío igual que la calculadora y, para las publicaciones donde ya guardaste datos en la tarjeta, usa tu costo (etiqueta "tu costo"), tu tipo de publicación, tu categoría y tu peso. Para el resto sigue usando el costo supuesto que configures (60% por defecto), el tipo que se detecta en el resultado, la categoría de la búsqueda y el peso mínimo (0.3 kg); la barra lo dice cuando hay mezcla de ambos. El CSV incluye el costo usado en cada fila y si fue tu costo o el supuesto.
- Publicidad: escribe tu % de Mercado Ads por producto y se descuenta de la ganancia, del margen y de todos los precios calculados (PRO).
- Costo máximo: cuánto puedes pagar por una unidad para ganar tu margen al precio actual de la publicación (PRO).
- Idioma: español por defecto; inglés disponible desde las opciones.
- Privacidad: el historial de precios de las publicaciones que abres se guarda solo en tu navegador, nunca en un servidor, y solo en páginas de publicaciones (nunca en el carrito ni en el pago). Puedes borrarlo desde "Borrar datos guardados".

## Detalle interno

### Envío

- `src/fees/shipping-table.js` carga las tres tablas oficiales (ayuda/40538, 40545, 40547, consultadas el 2026-10-30) y las reglas de envío gratis (ayuda/costos-envios-gratis_3287).
- Un costo de envío escrito a mano siempre gana sobre la estimación. La estimación se lee en el precio evaluado: la calculadora inversa (precio para ganar X%) la evalúa en el precio que devuelve, no en el precio de la página.
- Tarjeta, tablero y tiras de búsqueda usan la misma fuente (`MST_DASH.resolveShipping`): valor de opciones, si no el último valor escrito en la tarjeta, si no la estimación oficial donde aplica envío (desde $299, o abajo si ofreces envío gratis).

### Prueba PRO (esquema 2)

- `mst:trialStartedAt` se escribe en el mismo `storage.set` que el primer costo, y se refleja en `storage.sync`. El service worker estampa `mst:trialSchema = 2` al instalar o actualizar.
- Migración desde 1.5.4 o anterior: una instalación con costo guardado y sin sello de inicio recibe `trialStartedAt = installedAt` (su ventana corría desde la instalación). Una instalación 1.5.4 a media prueba SIN costo guardado pasa a "pendiente" hasta que guarde uno: no se le regalan días, pero tampoco se le quita nada que haya usado.
- No hay inicio automático al día 30: sin costo guardado la tarjeta sigue siendo la gratuita y el banner dice cuándo empieza la prueba.

### Radar en búsquedas

- Cada tira paga el mismo envío que la tarjeta para esa publicación.
- Los valores guardados por publicación (`mst:cost:<id>`, `mst:ads:<id>` solo PRO, `mst:type:<id>`, `mst:catpick:<id>`, `mst:weight:<id>`) de todos los resultados nuevos se leen en una sola lectura de `storage.local` por pasada. El id del resultado se normaliza igual que en la tarjeta y solo con formas de publicación (`/p/MLM…`, `/up/MLMU…`, `/MLM-123-…` al inicio de la ruta, `pdp_filters=item_id:`); un enlace de categoría (`/c/MLM1648`) no produce id.
- Con datos guardados, la tira calcula con el tipo, la categoría y el peso de la tarjeta, y con costo guardado su ganancia y margen son los de la tarjeta ("tu costo"). Sin ellos usa el tipo detectado en el resultado, la categoría de la búsqueda, 0.3 kg y el costo supuesto. Lo que la tira NO toma: el tipo de publicación predeterminado de opciones (solo el guardado por publicación o el detectado en el resultado); ahí la tira y la tarjeta pueden diferir.
- La barra PRO dice "Costo supuesto X% salvo donde ya guardaste tu costo" cuando al menos una tira de la página usa un costo guardado; si ninguna lo usa, el texto de siempre.
- El CSV (PRO) agrega las columnas "Costo (MXN)" y "Base del costo" ("tu costo" o "supuesto X%") antes de la ganancia y el margen, así cada fila dice de qué costo salió su ganancia.

### Tarjeta

- Publicidad (% del precio) por producto, PRO: se resta del neto, de la ganancia y de cada precio calculado. En la tarjeta gratuita un % guardado no se aplica y una línea lo dice: "Publicidad (X%) solo se aplica con PRO".
- Costo máximo para ganar X% al precio de la página (PRO), también sin costo guardado.
- Un solo precio propuesto por tarjeta: si el margen actual ya cumple el objetivo, la fila en negrita dice "Ya ganas X% a este precio" y la línea PRO es la única que propone un precio (más alto). Nunca se propone un precio menor al actual con menor margen.
- Fila de retenciones más corta ("Retenciones con RFC (IVA 8% + ISR 2.5%)") con la aclaración "Sin RFC te retienen más" en una línea pequeña debajo, para que el valor quede en una sola línea en columnas de 340 px.

### Idioma

- `mst:lang` en `storage.sync`: `es_419` por defecto sin importar el idioma del navegador; `en` desde el selector de opciones. El dinero se muestra siempre con "$", nunca "MX$".

### Privacidad

- Historial de precios local (`mst:hist:<id>`, con índice y tope de publicaciones) solo para URLs de publicación; nunca carrito, pago ni páginas de ayuda. Sin servidores. "Borrar datos guardados" en opciones lo elimina junto con costos y ventas; las claves de ExtensionPay y el sello de instalación se conservan.
