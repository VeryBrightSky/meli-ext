# Netio: ficha de Chrome Web Store (español, es-419)

Versión del paquete: {{version}}. El título lo toma el paquete (manifest `name`, lo estampa `npm run build:release`):
`{{storeName}}` ({{titleChars}} caracteres). No se captura en la ficha.

## Descripción corta (máximo 132 caracteres)

En Chrome Web Store la descripción corta es el campo `description` del manifest y es de solo lectura en el panel. El paquete v{{version}} trae esta ({{shortChars}} caracteres, incluye "comisiones", "ganancias" y "Mercado Libre"):

```
{{shortDescription}}
```

Propuesta para una versión futura (118 caracteres; cambiar `description` en `src/config/branding.js` y volver a compilar, no se puede editar en el panel y no se cambia en {{version}}):

```
Calcula comisiones, envío y retenciones de Mercado Libre y ve tu ganancia real en cada publicación. PRO gratis 7 días.
```

## Descripción larga (pegar tal cual, sin Markdown)

```
Netio te muestra cuánto te queda de verdad por cada venta en Mercado Libre México, dentro de la misma publicación.
Comisión, costo fijo, envío con las tablas oficiales, retenciones 2026 y tu ganancia neta, sin hojas de cálculo.

Tu prueba PRO de 7 días empieza cuando guardas tu primer costo. Sin correo, sin tarjeta, sin cuenta. Así los 7 días se usan calculando ganancias reales, no se gastan solos.

GRATIS, SIEMPRE
• Comisión estimada por categoría (Clásica y Premium) y costo fijo por unidad
• Envío estimado con las tablas oficiales de Mercado Envíos según tu reputación (verde o MercadoLíder, amarilla o sin reputación, naranja o roja) y la banda de precio ($299, $499 y $999). La bonificación por reputación ya viene incluida en la tabla
• Mercado Envíos Full y peso del paquete para afinar el envío; si escribes tu costo de envío, ese manda
• Retenciones 2026 actualizadas (IVA 8% / ISR 2.5%) para vendedores con RFC
• Ganancia y margen por venta, y el precio mínimo para no perder
• Aviso en rojo cuando una publicación te hace perder dinero
• Guarda tu costo con un toque: chips de costo sugerido en la tarjeta
• Vista previa del Radar en los resultados de búsqueda: cuántos productos dejan ganancia, con el envío ya descontado
• Tablero de Ganancias con tus primeros productos
• Copiar el resumen o mandárselo a otro vendedor por WhatsApp
• Español por defecto; inglés disponible desde las opciones

PRO (${{monthly}} MXN al mes o ${{yearly}} MXN al año)
• Precio objetivo: a qué precio publicar para ganar el margen que quieres
• Costo máximo: cuánto puedes pagar por una unidad para ganar tu margen al precio actual de la publicación
• Publicidad: escribe tu % de Mercado Ads por producto y se descuenta de la ganancia, del margen y de todos los precios calculados
• Punto dulce: te avisa cuando subir unos pesos el precio te deja más dinero (menos costo fijo)
• Calculadora de meses sin intereses: tu ganancia real por plazo, con tu propia tasa
• Comparación Clásica vs Premium lado a lado
• Probar precios sin tocar tu publicación
• Radar de Rentabilidad: cada resultado de búsqueda en verde, amarillo o rojo según tu costo. Donde ya guardaste el costo, el tipo, la categoría o el peso de una publicación, el Radar usa tus datos; para el resto usa el costo supuesto que configures. Filtro de solo rentables y exportar a CSV con el costo usado en cada fila
• Tablero de Ganancias completo: todos tus productos ordenados por ganancia, con los que pierden arriba, ventas al mes y ganancia mensual, exportable a CSV
• Historial local de precios de las publicaciones que visitas

CÓMO FUNCIONA
1. Instala Netio y abre cualquier publicación de mercadolibre.com.mx.
2. Escribe el costo de tu producto o toca un chip de costo. Netio detecta el precio y la categoría de la página.
3. Ve tu ganancia, tu margen y el desglose completo. Al guardar tu primer costo empieza tu prueba PRO de 7 días y el producto aparece en tu Tablero.

PRIVACIDAD
No necesitas cuenta para usar Netio. No recopilamos datos de navegación ni de ventas. Si contratas PRO, ExtensionPay procesa tu correo y pago. Tus costos, tus productos y el historial de precios de las publicaciones que abres se guardan solo en tu navegador, nunca en un servidor, y solo en páginas de publicaciones (nunca en el carrito ni en el pago); puedes borrarlos desde "Borrar datos guardados" en las opciones. La prueba de 7 días es local: sin correo, sin tarjeta y sin conexión. No hay analítica ni rastreo. Política completa: https://netiox.netlify.app/privacidad.html

PRECISIÓN
Las tablas de comisiones salen de guías públicas para vendedores y las de envío de las páginas de ayuda de Mercado Libre (no de una API), así que las cifras son estimaciones; la fecha de consulta aparece en cada tarjeta. El porcentaje exacto depende de tu categoría y tu cuenta, y el envío puede variar con el peso volumétrico. Confirma tus retenciones con tu contador.

Esta extensión no está afiliada a Mercado Libre ni a Mercado Pago. Mercado Libre, Mercado Envíos y Mercado Pago son marcas de sus respectivos dueños.

Sitio: https://netiox.netlify.app
Calculadora web gratuita: https://netiox.netlify.app/calculadora/
Soporte: https://netiox.netlify.app/soporte.html o vitowebpro@gmail.com
```

Conteo: ver `UPLOAD-STEPS.md` (sección "Conteos"); el máximo es 16,000 caracteres.

## Campos del formulario

| Campo | Valor |
| --- | --- |
| Categoría | Shopping (Compras) |
| Idioma | Español (Latinoamérica) como principal; inglés como secundario con `listing-en.md` |
| Página principal | https://netiox.netlify.app/ |
| URL de soporte | https://netiox.netlify.app/soporte.html |
| Política de privacidad | https://netiox.netlify.app/privacidad.html |
| Correo de contacto | vitowebpro@gmail.com |

## Novedades (notas de la versión; la Chrome Web Store no tiene este campo, úsalo en la landing o en el correo de lanzamiento)

```
{{whatsNewEs}}
```

## Notas

- No incluir reseñas, cifras de usuarios ni ahorros: no hay datos verificables.
- No proponer otro nombre: el título viene del paquete.
- Sin guiones largos en el texto; las viñetas con "•" se ven bien en la ficha.
- La prueba PRO nunca se describe como si empezara en la instalación: empieza al guardar el primer costo.
