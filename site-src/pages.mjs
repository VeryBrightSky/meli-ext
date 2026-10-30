// Every page of the Netio site, as data. Add a page by adding an object to
// PAGES at the bottom (see site-src/README.md). Worked-example numbers are
// computed here with the same modules the web calculator ships, so the prose
// can never drift from the math.
import "../src/fees/fee-table.js";
import "../src/fees/shipping-table.js";
import "../src/fees/calculator.js";
import "../src/fees/fee-source.js";
import "./shipping-official.js";
import "./calc-web.js";
import { SITE, calcLink, mxn, pct, storeLink } from "./site.mjs";
import { ticket, esc } from "./templates.mjs";

const WEB = globalThis.NETIO_WEB_CALC;
const SOURCE = globalThis.MST_FEE_SOURCE;
const TABLE = globalThis.MST_FEE_TABLE;
const SHIP = globalThis.NETIO_SHIPPING_OFFICIAL;
const O = SITE.official;
const CHECKED = SITE.checkedAtText;

const groups = TABLE.categoryGroups;
const g = (id) => groups.find((x) => x.id === id);
const repLabel = { verde: "verde", amarilla: "amarilla o sin reputación", naranja: "naranja o roja" };
const link = (href, text) => `<a href="${esc(href)}">${text}</a>`;
const off = (key, text) => link(O[key], text);

// Runs the calculator for an example and returns a ticket + prefilled link.
function example(inputs, { title, subtitle, caption, withholdings = true } = {}) {
  const r = WEB.compute(inputs);
  const m = (lo, hi) => (lo === hi ? mxn(lo) : `${mxn(lo)} a ${mxn(hi)}`);
  const ratePct = r.isExactRate ? pct(r.pctMin) : `${pct(r.pctMin)} a ${pct(r.pctMax)}`;
  const lines = [
    { label: "Precio de venta", value: mxn(r.priceMXN) },
    { label: "Cargo por venta", note: `${ratePct}, ${r.categoryGroup ? r.categoryGroup.label : "categoría desconocida"}`, value: `-${m(r.commissionMinMXN, r.commissionMaxMXN)}` },
    { label: "Costo fijo por unidad", note: r.fixedCostMXN > 0 ? "Clásica abajo de $299" : (r.listingTypeId === "premium" ? "Premium no paga costo fijo" : "desde $299 no aplica"), value: r.fixedCostMXN > 0 ? `-${mxn(r.fixedCostMXN)}` : "$0.00" },
    { label: "Envío que pagas tú", note: r.shippingInfo && r.shippingInfo.costMXN > 0 ? `tabla oficial ${repLabel[r.reputation]}, ${r.shippingInfo.weightLabel.toLowerCase()}` : "no ofreces envío gratis abajo de $299", value: r.shippingMXN > 0 ? `-${mxn(r.shippingMXN)}` : "$0.00" }
  ];
  if (withholdings) lines.push({ label: "Retenciones", note: r.hasRFC ? "con RFC: IVA 8% + ISR 2.5% sobre el precio sin IVA" : "sin RFC: IVA 16% + ISR 20% sobre el precio sin IVA", value: `-${mxn(r.withholdings.totalMXN)}` });
  if (r.costMXN > 0) lines.push({ label: "Lo que te costó el producto", value: `-${mxn(r.costMXN)}` });
  const netLo = withholdings ? r.netMinMXN : r.preWithholdingMinMXN;
  const netHi = withholdings ? r.netMaxMXN : r.preWithholdingMaxMXN;
  const marginLo = r.priceMXN > 0 ? Math.round((netLo / r.priceMXN) * 10000) / 100 : 0;
  const marginHi = r.priceMXN > 0 ? Math.round((netHi / r.priceMXN) * 10000) / 100 : 0;
  const cls = netHi < 0 ? "loss" : netLo < 0 ? "mixed" : "profit";
  const verdict = netHi < 0
    ? `Pierdes ${m(Math.abs(netHi), Math.abs(netLo))} en cada venta. Margen ${marginLo === marginHi ? pct(marginLo) : `${pct(marginLo)} a ${pct(marginHi)}`}.`
    : netLo < 0
      ? `Entre ${mxn(netLo)} y ${mxn(netHi)} por venta, según el porcentaje exacto de tu categoría.`
      : `Te quedan ${m(netLo, netHi)} por venta. Margen ${marginLo === marginHi ? pct(marginLo) : `${pct(marginLo)} a ${pct(marginHi)}`}.`;
  return {
    r, netLo, netHi, marginLo, marginHi, cls,
    calcHref: calcLink(inputs),
    html: ticket({
      title, subtitle, lines, verdictCls: cls, verdict,
      sum: { label: withholdings ? "Te queda después de retenciones" : "Te queda por venta", value: m(netLo, netHi) },
      caption: caption || `Cargo por venta: porcentaje estimado por grupo de categoría (fuente secundaria, Netio). Envío: ${off("envios", "tabla oficial de Mercado Envíos")} consultada el ${CHECKED}. Retenciones: ${off("retenciones", "Mercado Pago, 15 de mayo de 2026")}. Mercado Libre muestra el cargo exacto al publicar.`
    })
  };
}

const ratesTable = () => `<div class="table-scroll"><table class="fee-table"><caption>Porcentaje estimado por grupo de categoría (fuente secundaria, vigente en los datos de Netio desde el 2 de febrero de 2026). Mercado Libre ya no publica el porcentaje exacto por categoría: lo muestra al publicar.</caption>
<thead><tr><th scope="col">Grupo de categorías</th><th scope="col">Clásica</th><th scope="col">Premium</th></tr></thead>
<tbody>${groups.map((x) => `<tr><th scope="row">${esc(x.label)}</th><td>${x.classic.pctMin === x.classic.pctMax ? pct(x.classic.pctMin) : `${pct(x.classic.pctMin)} a ${pct(x.classic.pctMax)}`}</td><td>${x.premium.pctMin === x.premium.pctMax ? pct(x.premium.pctMin) : `${pct(x.premium.pctMin)} a ${pct(x.premium.pctMax)}`}</td></tr>`).join("")}
<tr><th scope="row">Rango oficial publicado (cualquier categoría)</th><td>8% a 17%</td><td>11% a 21.5%</td></tr></tbody></table></div>`;

// Official shipping table for one reputation (all six price bands) up to a weight.
function shippingTable(rep, maxRows = 13) {
  const t = SHIP.tables[rep];
  return `<div class="table-scroll"><table class="fee-table ship-table">
<thead><tr><th scope="col">Peso</th>${SHIP.bandLabels.map((b) => `<th scope="col">${esc(b)}</th>`).join("")}</tr></thead>
<tbody>${t.rows.slice(0, maxRows).map((row, i) => `<tr><th scope="row">${esc(SHIP.weightLabels[i])}</th>${row.map((v) => `<td>${mxn(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
<p class="small table-note">${esc(t.label)}: lo que paga el vendedor por envío, MXN, ${t.discountPct > 0 ? `ya con el ${t.discountPct}% de descuento` : "sin descuento"}. ${link(t.url, "Tabla oficial")}, consultada el ${CHECKED}. Desliza la tabla para ver todos los tramos de precio.</p>`;
}

const fixedTiers = TABLE.fixedCost.tiers; // [{maxPriceExclusive, amountMXN}]
const fixedText = `${mxn(fixedTiers[0].amountMXN)} abajo de $${fixedTiers[0].maxPriceExclusive}, ${mxn(fixedTiers[1].amountMXN)} de $${fixedTiers[0].maxPriceExclusive} a $${(fixedTiers[1].maxPriceExclusive - 0.01).toFixed(2)}, ${mxn(fixedTiers[2].amountMXN)} de $${fixedTiers[1].maxPriceExclusive} a $${(fixedTiers[2].maxPriceExclusive - 0.01).toFixed(2)} y $0 desde $299`;

const bc = {
  guias: { name: "Guías", path: "/guias/" },
  como: { name: "Cómo", path: "/como/" },
  comparar: { name: "Comparar", path: "/comparar/" }
};

// =====================================================================
// GUÍAS
// =====================================================================
const ex1 = example({ priceMXN: 499, costMXN: 250, categoryGroupId: "home-general", listingTypeId: "classic", reputation: "verde", weightKg: 1, offersFree: false, hasRFC: true },
  { title: "Plancha de ropa a $499", subtitle: "Clásica, Hogar" });

const guiaCuantoCobra = {
  type: "guide", path: "/guias/cuanto-cobra-mercado-libre-por-vender-2026/",
  title: "¿Cuánto cobra Mercado Libre por vender en 2026? Cargos reales en México",
  description: "Cuánto cobra Mercado Libre por vender en México en 2026: cargo por venta de 8% a 21.5%, costo fijo abajo de $299, envío por peso y reputación, y retenciones de ISR e IVA. Con ejemplo en pesos.",
  h1: "Cuánto cobra Mercado Libre por vender en 2026",
  navLabel: "Cuánto cobra Mercado Libre por vender",
  answer: "Mercado Libre México cobra un cargo por venta de entre 8% y 21.5% del precio según la categoría y el tipo de publicación, más un costo fijo por unidad si el producto cuesta menos de $299 en Clásica, más el envío cuando es gratis para el comprador. Encima, desde 2026 te retienen ISR e IVA. Publicar no cuesta nada.",
  breadcrumb: [bc.guias, { name: "Cuánto cobra Mercado Libre por vender", path: "/guias/cuanto-cobra-mercado-libre-por-vender-2026/" }],
  related: ["/guias/comisiones-mercado-libre-por-categoria/", "/como/calcular-tu-ganancia-real-en-mercado-libre/"],
  body: `
<h2>Los cuatro cargos que salen de cada venta</h2>
<p>Cuando alguien te compra, el dinero que llega a tu cuenta de Mercado Pago ya viene sin estos descuentos. Conviene verlos por separado porque cada uno se comporta distinto: uno es un porcentaje, otro es una cantidad fija, otro depende del peso y el último es un adelanto de impuestos.</p>
<h3>1. Cargo por venta (la comisión)</h3>
<p>Es el porcentaje que Mercado Libre se queda de cada venta. La ${off("cargoVenta", "página oficial de costos")} dice hoy que pagas "entre 8% y 20.5% según la categoría de tu producto y el tipo de publicación", y en su tabla muestra Clásica "entre 8% y 17%" y Premium "entre 11% y 21.5%". El porcentaje exacto de tu categoría solo se ve al publicar, con tu cuenta abierta. Como referencia, en Tecnología la Clásica suele estar en ${pct(g("tech").classic.pctMin)} y en Hogar, moda y deportes en ${pct(g("home-general").classic.pctMin)} (fuente secundaria; ver la ${link("/guias/comisiones-mercado-libre-por-categoria/", "tabla por categoría")}).</p>
<h3>2. Costo fijo por unidad (solo productos baratos)</h3>
<p>Si vendes en Clásica abajo de $299, se suma una cantidad fija por cada unidad vendida: ${fixedText}. Premium no lo paga. Mercado Libre confirma en su ${off("costosNota", "nota para vendedores")} que el costo fijo solo aplica abajo de $299; los montos exactos por tramo salen de fuentes secundarias y Mercado Libre te muestra el tuyo al publicar. Es el cargo que más duele en productos de $50 a $150: en una venta de $89, los $25 son el 28% del precio.</p>
<h3>3. Envío</h3>
<p>Desde $299 el envío es gratis para el comprador de forma obligatoria y lo pagas tú, con descuento según tu reputación: 50% en verde, 40% en amarilla o sin reputación, 0% en naranja o roja. Abajo de $299 ofrecer envío gratis es opcional. Las tarifas dependen del peso (el mayor entre el físico y el volumétrico) y del precio. Por ejemplo, un paquete de hasta 300 g en un producto de $299 a $498.99 le cuesta ${mxn(SHIP.tables.verde.rows[0][3])} a un vendedor verde y ${mxn(SHIP.tables.naranja.rows[0][3])} a uno naranja. Toda la tabla está en la ${link("/guias/costo-de-envio-mercado-libre-vendedor/", "guía de costos de envío")}.</p>
<h3>4. Retenciones de ISR e IVA</h3>
<p>No son un cobro de Mercado Libre, sino impuestos que la plataforma retiene y entrega al SAT por ti. Desde el 1 de enero de 2026, con RFC registrado te retienen 2.5% de ISR y 8% de IVA; sin RFC, 16% de IVA y 20% de ISR (${off("retenciones", "Mercado Pago, mayo de 2026")}). Son acreditables en tu declaración, pero reducen lo que te depositan. Detalle en la ${link("/guias/retenciones-isr-iva-mercado-libre-vendedores/", "guía de retenciones")}.</p>
<h2>Lo que no cuesta</h2>
<ul>
<li>Publicar es gratis. Pagas solo cuando se concreta la venta.</li>
<li>Las publicaciones gratuitas existen (60 días, baja exposición, sin meses sin intereses), con límites: hasta 10 publicaciones con una unidad de stock, y 5 ventas al año en productos nuevos o 20 en usados.</li>
<li>El precio mínimo para publicar es $35.</li>
</ul>
<h2>Cómo se suma todo</h2>
<p>El orden importa poco, pero el total sí: en un producto de $499 en Clásica, con reputación verde y un paquete de 1 kg, entre cargo por venta, envío y retenciones se van ${mxn(ex1.r.commissionMinMXN + ex1.r.shippingMXN + ex1.r.withholdings.totalMXN)}, el ${Math.round(((ex1.r.commissionMinMXN + ex1.r.shippingMXN + ex1.r.withholdings.totalMXN) / 499) * 1000) / 10}% del precio. Si el producto te costó $250, te quedan ${mxn(ex1.netLo)}.</p>`,
  example: {
    title: "Ejemplo: cuánto cobra Mercado Libre en una venta de $499",
    intro: "Supuestos: categoría Hogar, moda y deportes (15% estimado en Clásica), reputación verde, paquete de hasta 1 kg, RFC registrado, producto comprado en $250. Desde $299 el envío gratis es obligatorio y el costo fijo desaparece.",
    ticket: ex1.html, calcHref: ex1.calcHref,
    notes: `<p>El envío de ${mxn(ex1.r.shippingMXN)} sale de la ${off("envioVerde", "tabla oficial para reputación verde")} (1 kg, precio de $499 a $998.99). Las retenciones se calculan sobre ${mxn(ex1.r.withholdings.baseMXN)}, que es el precio sin IVA.</p><p>Si el mismo producto lo vendiera un vendedor con reputación naranja, el envío subiría a ${mxn(SHIP.tables.naranja.rows[2][4])} y la ganancia bajaría a ${mxn(ex1.netLo - (SHIP.tables.naranja.rows[2][4] - ex1.r.shippingMXN))}.</p>`
  },
  faq: [
    { q: "¿Qué porcentaje cobra Mercado Libre por vender en México?", a: `Entre 8% y 21.5% del precio según la categoría y el tipo de publicación, según la ${off("cargoVenta", "página oficial")}. Clásica va de 8% a 17% y Premium de 11% a 21.5%. El porcentaje exacto de tu categoría aparece al momento de publicar.` },
    { q: "¿Mercado Libre cobra por publicar?", a: "No. Crear la publicación no tiene costo y solo pagas cuando concretas una venta. Lo que sí cambia es la exposición: las publicaciones gratuitas duran 60 días, tienen baja exposición y no ofrecen meses sin intereses." },
    { q: "¿Qué es el costo fijo por unidad?", a: `Una cantidad fija que se suma al cargo por venta en productos de menos de $299 publicados en Clásica: ${fixedText}. Premium no lo paga. Mercado Libre te muestra el monto exacto al publicar.` },
    { q: "¿Cuánto cobra Mercado Libre de envío al vendedor?", a: `Depende del peso, del precio y de tu reputación. Un paquete de hasta 300 g en un producto de $299 a $498.99 cuesta ${mxn(SHIP.tables.verde.rows[0][3])} con reputación verde, ${mxn(SHIP.tables.amarilla.rows[0][3])} con amarilla y ${mxn(SHIP.tables.naranja.rows[0][3])} con naranja o roja, según las tablas oficiales.` },
    { q: "¿Cuánto me queda si vendo algo de $500 en Mercado Libre?", a: `Con 15% de cargo por venta, reputación verde, 1 kg y RFC registrado, de $499 te quedan ${mxn(ex1.r.preWithholdingMinMXN + ex1.r.costMXN)} antes de descontar el costo del producto y ${mxn(ex1.r.preWithholdingMinMXN + ex1.r.costMXN - ex1.r.withholdings.totalMXN)} después de retenciones. Cambia el precio y la categoría en la ${link("/calculadora/", "calculadora")} para ver tu caso.` },
    { q: "¿Las retenciones de ISR e IVA son un cobro de Mercado Libre?", a: "No. Son impuestos que la plataforma retiene por obligación fiscal y entrega al SAT a tu nombre. Con RFC registrado son 2.5% de ISR y 8% de IVA; sin RFC, 16% de IVA y 20% de ISR. Puedes acreditarlas en tu declaración." },
    { q: "¿Cómo sé el cargo exacto de mi producto?", a: "Al publicar, Mercado Libre muestra el cargo por venta de esa categoría. También puedes usar el simulador de costos oficial en Mi cuenta, Publicaciones, Simular costos. Netio te da la estimación sin salir de la publicación y marca en rojo cuando pierdes." }
  ]
};

// ---------------------------------------------------------------------
const ex2 = example({ priceMXN: 800, costMXN: 350, categoryGroupId: "tools", listingTypeId: "premium", reputation: "amarilla", weightKg: 2, offersFree: false, hasRFC: true },
  { title: "Taladro a $800", subtitle: "Premium, Herramientas" });
const ex2c = WEB.compute({ priceMXN: 800, costMXN: 350, categoryGroupId: "tools", listingTypeId: "classic", reputation: "amarilla", weightKg: 2, offersFree: false, hasRFC: true });

const guiaComisiones = {
  type: "guide", path: "/guias/comisiones-mercado-libre-por-categoria/",
  title: "Comisiones de Mercado Libre por categoría en México (tabla estimada 2026)",
  description: "Tabla de comisiones de Mercado Libre por categoría en México: Tecnología 10%, Vehículos 12%, Herramientas 13.5%, Belleza 14%, Hogar y moda 15% en Clásica, y de 12.5% a 19.5% en Premium. Porcentajes estimados, el exacto lo muestra Mercado Libre al publicar.",
  h1: "Comisiones de Mercado Libre por categoría",
  navLabel: "Comisiones por categoría",
  answer: `La comisión de Mercado Libre México va de 8% a 17% en publicaciones Clásicas y de 11% a 21.5% en Premium, según la categoría. Como referencia, Tecnología paga cerca de ${pct(g("tech").classic.pctMin)} en Clásica y Hogar, moda y deportes cerca de ${pct(g("home-general").classic.pctMin)}. Mercado Libre ya no publica la tabla completa: el porcentaje exacto aparece al publicar.`,
  breadcrumb: [bc.guias, { name: "Comisiones por categoría", path: "/guias/comisiones-mercado-libre-por-categoria/" }],
  related: ["/guias/publicacion-clasica-vs-premium-mercado-libre/", "/guias/cuanto-cobra-mercado-libre-por-vender-2026/"],
  body: `
<h2>Tabla de comisiones por grupo de categoría</h2>
<p>Estos son los porcentajes que usa Netio para estimar el cargo por venta. Vienen de transcripciones de terceros (ProfitOS, Tiendanube y Upseller, cotejadas en junio de 2026), no de una tabla oficial, porque Mercado Libre retiró la tabla por categoría y hoy pide "consultar porcentaje exacto" al publicar. Por eso en Netio están marcados con confianza "secundaria".</p>
${ratesTable()}
<p>La última fila es lo único que Mercado Libre publica hoy en su ${off("cargoVenta", "página de costos")} (consultada el ${CHECKED}). Si tu categoría no encaja en ningún grupo, usa ese rango y revisa el cargo exacto en la publicación.</p>
<h2>Qué categorías entran en cada grupo</h2>
<ul>
${groups.map((x) => `<li><b>${esc(x.label)}</b> (${pct(x.classic.pctMin)} Clásica): ${esc(x.aliases.slice(0, 8).join(", "))}.</li>`).join("\n")}
</ul>
<p>Netio detecta el grupo leyendo la ruta de categorías de la publicación. Si no reconoce la categoría, muestra el rango oficial completo y la ganancia como un rango, en lugar de inventar un número.</p>
<h2>La comisión no es el único porcentaje que cambia por categoría</h2>
<p>El costo fijo por unidad (abajo de $299 en Clásica) también "depende del tipo de publicación y la categoría", según la ${off("costosNota", "nota oficial de costos")}. En los datos de Netio los tramos son ${fixedText}, iguales para todos los grupos, porque las fuentes públicas no distinguen por categoría. Si tu panel muestra otro monto, ese es el bueno.</p>
<h2>Por qué una diferencia de 3 puntos pesa más de lo que parece</h2>
<p>En un producto de $800 en Herramientas, pasar de Clásica (${pct(g("tools").classic.pctMin)}) a Premium (${pct(g("tools").premium.pctMin)}) cuesta ${mxn(ex2.r.commissionMinMXN - ex2c.commissionMinMXN)} más por venta. Si tu margen era de ${mxn(ex2c.netMinMXN)}, se vuelve ${mxn(ex2.netLo)}: el ${Math.round(((ex2c.netMinMXN - ex2.netLo) / ex2c.netMinMXN) * 100)}% de tu ganancia por 4.5 puntos de comisión. Premium lo compensa con meses sin intereses y más exposición, pero eso solo conviene si vendes más unidades. Lo trabajamos en ${link("/guias/publicacion-clasica-vs-premium-mercado-libre/", "Clásica vs Premium")}.</p>`,
  example: {
    title: "Ejemplo: comisión de Herramientas en Premium",
    intro: `Supuestos: grupo Herramientas (${pct(g("tools").premium.pctMin)} estimado en Premium, ${pct(g("tools").classic.pctMin)} en Clásica), reputación amarilla, paquete de 2 kg, RFC registrado, costo del producto $350.`,
    ticket: ex2.html, calcHref: ex2.calcHref,
    notes: `<p>El mismo taladro en Clásica pagaría ${mxn(ex2c.commissionMinMXN)} de cargo por venta y dejaría ${mxn(ex2c.netMinMXN)}. El envío de ${mxn(ex2.r.shippingMXN)} viene de la ${off("envioAmarilla", "tabla oficial para reputación amarilla")} (2 kg, $499 a $998.99) y no cambia entre Clásica y Premium.</p>`
  },
  faq: [
    { q: "¿Cuál es la comisión de Mercado Libre en Tecnología?", a: `Cerca de ${pct(g("tech").classic.pctMin)} en Clásica y de ${pct(g("tech").premium.pctMin)} a ${pct(g("tech").premium.pctMax)} en Premium, según las fuentes secundarias que usa Netio. Celulares, computación, consolas, audio y cámaras entran en este grupo. Confirma el exacto al publicar.` },
    { q: "¿Cuánto cobra Mercado Libre en ropa y calzado?", a: `Ropa, calzado y moda están en el grupo de Hogar, moda y deportes: ${pct(g("home-general").classic.pctMin)} estimado en Clásica y ${pct(g("home-general").premium.pctMin)} en Premium. Es el grupo con la comisión más alta de la tabla.` },
    { q: "¿Por qué Mercado Libre no muestra la tabla de comisiones por categoría?", a: `Su ${off("cargoVenta", "página de costos")} solo publica rangos (8% a 17% en Clásica, 11% a 21.5% en Premium) y un botón de "consultar porcentaje exacto" que requiere iniciar sesión. Por eso cualquier tabla por categoría que veas en internet, incluida esta, es una transcripción de terceros.` },
    { q: "¿La comisión se cobra sobre el precio con o sin IVA?", a: "Sobre el precio de venta que ve el comprador, que ya incluye IVA. Las retenciones de ISR e IVA, en cambio, se calculan sobre el precio sin IVA. Son dos bases distintas y conviene no mezclarlas." },
    { q: "¿La comisión incluye el envío?", a: "No. El cargo por venta es un porcentaje; el envío es un monto aparte que depende del peso, el precio y tu reputación, y solo lo pagas tú cuando el envío es gratis para el comprador (obligatorio desde $299, opcional abajo)." },
    { q: "¿Cómo veo mi porcentaje exacto?", a: "Al crear o editar la publicación, Mercado Libre muestra el cargo por venta de esa categoría junto al precio. También lo tienes en el simulador de costos oficial. Netio usa la estimación por grupo y te avisa que es estimada." }
  ]
};

// ---------------------------------------------------------------------
const exShip = { verde: null, amarilla: null, naranja: null };
for (const rep of ["verde", "amarilla", "naranja"]) {
  exShip[rep] = example({ priceMXN: 350, costMXN: 140, categoryGroupId: "tech", listingTypeId: "classic", reputation: rep, weightKg: 0.5, offersFree: false, hasRFC: true },
    { title: "Audífonos a $350", subtitle: `Clásica, Tecnología, reputación ${repLabel[rep]}` });
}
const exShipSmall = example({ priceMXN: 199, costMXN: 80, categoryGroupId: "home-general", listingTypeId: "classic", reputation: "verde", weightKg: 0.3, offersFree: true, hasRFC: true },
  { title: "Gorra a $199 con envío gratis opcional", subtitle: "Clásica, Moda, verde" });

const guiaEnvio = {
  type: "guide", path: "/guias/costo-de-envio-mercado-libre-vendedor/",
  title: "Costo de envío en Mercado Libre para el vendedor: tablas oficiales 2026",
  description: "Cuánto paga el vendedor por envío en Mercado Libre México: tablas oficiales por reputación verde, amarilla y naranja, por peso y precio. Envío gratis obligatorio desde $299, opcional abajo. Peso volumétrico explicado.",
  h1: "Costo de envío en Mercado Libre para el vendedor",
  navLabel: "Costo de envío para el vendedor",
  answer: `Si tu producto cuesta $299 o más, el envío es gratis para el comprador y lo pagas tú según peso, precio y reputación: un paquete de hasta 300 g cuesta ${mxn(SHIP.tables.verde.rows[0][3])} con reputación verde, ${mxn(SHIP.tables.amarilla.rows[0][3])} con amarilla y ${mxn(SHIP.tables.naranja.rows[0][3])} con naranja. Abajo de $299, ofrecer envío gratis es opcional; si no lo ofreces, el comprador paga el envío.`,
  breadcrumb: [bc.guias, { name: "Costo de envío para el vendedor", path: "/guias/costo-de-envio-mercado-libre-vendedor/" }],
  related: ["/como/bajar-costos-de-envio-mercado-libre/", "/guias/mercado-libre-full-costos-cuando-conviene/"],
  body: `
<h2>Las reglas, según la página oficial</h2>
<p>La ${off("envios", "página de costos de envío de Mercado Libre")} (consultada el ${CHECKED}) establece cuatro cosas:</p>
<ol>
<li>El costo de envío se calcula con el mayor entre el peso físico y el peso volumétrico del paquete, y con el precio del producto.</li>
<li>Desde $299 el envío gratis es obligatorio (desde $499 en Supermercado). Abajo de $299 es opcional, y si lo ofreces pagas la tarifa de "envío gratis".</li>
<li>Hay descuento por reputación: 50% para verde y MercadoLíder, 40% para amarilla o sin reputación, nada para naranja o roja. Los valores de las tablas ya incluyen ese descuento.</li>
<li>Los precios se agrupan en seis tramos: $0 a $98.99, $99 a $198.99, $199 a $298.99, $299 a $498.99, $499 a $998.99 y desde $999.</li>
</ol>
<p>Un detalle que sorprende: la columna de "envío gratis opcional" para productos de menos de $299 es, en las tres tablas oficiales, la misma que la columna de $299 a $498.99. Es decir, regalar el envío en un producto de $199 te cuesta lo mismo que en uno de $350.</p>
<h2>Tabla para reputación verde o MercadoLíder</h2>
${shippingTable("verde")}
<h2>Tabla para reputación amarilla o sin reputación</h2>
${shippingTable("amarilla")}
<h2>Tabla para reputación naranja o roja</h2>
${shippingTable("naranja")}
<p>Las tres tablas oficiales llegan hasta más de 350 kg; aquí mostramos hasta 30 kg, que cubre casi todo lo que se vende por Mercado Envíos. La ${link("/calculadora/", "calculadora")} tiene las tablas completas.</p>
<h2>Peso volumétrico: por qué una almohada paga como si fuera de 3 kg</h2>
<p>Mercado Libre cobra por el mayor entre el peso real y el volumétrico. El volumétrico se calcula con las dimensiones de la caja, así que un paquete grande y ligero (almohadas, lámparas, juguetes en caja) cae en un tramo más caro que su peso en la báscula. Antes de publicar, mide la caja que realmente vas a usar y revisa en qué tramo cae en tu panel de envíos; ese tramo es el que aplica en la tabla, no el peso del producto solo.</p>
<h2>Cómo cambia la ganancia por reputación en el mismo producto</h2>
<p>Unos audífonos de $350 en Tecnología (10% estimado), paquete de 500 g, costo $140, RFC registrado:</p>
<ul>
<li>Reputación verde: envío ${mxn(exShip.verde.r.shippingMXN)}, te quedan ${mxn(exShip.verde.netLo)}.</li>
<li>Reputación amarilla: envío ${mxn(exShip.amarilla.r.shippingMXN)}, te quedan ${mxn(exShip.amarilla.netLo)}.</li>
<li>Reputación naranja o roja: envío ${mxn(exShip.naranja.r.shippingMXN)}, te quedan ${mxn(exShip.naranja.netLo)}.</li>
</ul>
<p>La diferencia entre verde y naranja es de ${mxn(exShip.naranja.r.shippingMXN - exShip.verde.r.shippingMXN)} por venta, solo por el color de la reputación. En 100 ventas al mes son ${mxn((exShip.naranja.r.shippingMXN - exShip.verde.r.shippingMXN) * 100)}.</p>`,
  example: {
    title: "Ejemplo: un vendedor verde envía audífonos de $350",
    intro: "Supuestos: Tecnología (10% estimado en Clásica), reputación verde, paquete de 300 g a 500 g, precio de $299 a $498.99 (envío gratis obligatorio), RFC registrado, costo $140.",
    ticket: exShip.verde.html, calcHref: exShip.verde.calcHref,
    notes: `<p>El envío de ${mxn(exShip.verde.r.shippingMXN)} es la celda "300 g a 500 g" por "$299 a $498.99" de la ${off("envioVerde", "tabla oficial verde")}. No hay costo fijo porque el precio es de $299 o más.</p><p>Para comparar: una gorra de $199 (300 g, Moda) con envío gratis opcional paga ${mxn(exShipSmall.r.shippingMXN)} de envío más ${mxn(exShipSmall.r.fixedCostMXN)} de costo fijo, y deja ${mxn(exShipSmall.netLo)} si costó $80. ${link(exShipSmall.calcHref, "Ver esa cuenta")}.</p>`
  },
  faq: [
    { q: "¿Quién paga el envío en Mercado Libre, el vendedor o el comprador?", a: "Desde $299 el envío es gratis para el comprador y lo paga el vendedor con descuento por reputación. Abajo de $299 lo paga el comprador, salvo que el vendedor decida ofrecer envío gratis, y entonces lo paga el vendedor con la tarifa de envío gratis." },
    { q: "¿Cuánto cuesta el envío gratis para el vendedor?", a: `Depende del peso, el precio y la reputación. Para un paquete de hasta 300 g y precio de $299 a $498.99: ${mxn(SHIP.tables.verde.rows[0][3])} en verde, ${mxn(SHIP.tables.amarilla.rows[0][3])} en amarilla y ${mxn(SHIP.tables.naranja.rows[0][3])} en naranja o roja. Para 1 a 2 kg: ${mxn(SHIP.tables.verde.rows[3][3])}, ${mxn(SHIP.tables.amarilla.rows[3][3])} y ${mxn(SHIP.tables.naranja.rows[3][3])}.` },
    { q: "¿El descuento por reputación ya está incluido en la tabla?", a: "Sí. Las tres tablas oficiales dicen que sus valores ya incluyen la bonificación: 50% en verde, 40% en amarilla, 0% en naranja. No restes el descuento otra vez; los números de esta página son lo que pagas." },
    { q: "¿Qué pasa si vendo abajo de $299 y no ofrezco envío gratis?", a: "El comprador paga el envío al comprar y a ti no te descuentan nada por ese concepto. Sigues pagando el cargo por venta y, en Clásica, el costo fijo por unidad." },
    { q: "¿Qué es el peso volumétrico?", a: "Un peso calculado con las dimensiones de la caja, no con la báscula. Mercado Libre usa el mayor de los dos. Un producto ligero en una caja grande paga como un producto pesado, así que la caja que elijas cambia tu costo de envío." },
    { q: "¿El envío cuesta lo mismo si el comprador paga el envío?", a: "La página oficial dice que el costo de envío aplica a todas las ventas, aunque el comprador pague el envío; en ese caso lo que el comprador paga cubre el costo. Lo que tú absorbes como vendedor es la tarifa de envío gratis, cuando el envío es gratis." },
    { q: "¿Los envíos de Full tienen otra tarifa?", a: `Full tiene su propia estructura de costos (almacenamiento, colecta, retiro) además del cargo por venta y el envío. Lo explicamos en ${link("/guias/mercado-libre-full-costos-cuando-conviene/", "la guía de Full")}.` }
  ]
};

// ---------------------------------------------------------------------
const exFull = example({ priceMXN: 599, costMXN: 260, categoryGroupId: "beauty-health", listingTypeId: "classic", reputation: "verde", weightKg: 0.5, offersFree: false, hasRFC: true },
  { title: "Crema facial a $599", subtitle: "Clásica, Belleza, envío por Mercado Envíos" });
const fullSvc = globalThis.MST_SHIPPING.fullServiceCost(0.5, 199);

const guiaFull = {
  type: "guide", path: "/guias/mercado-libre-full-costos-cuando-conviene/",
  title: "Mercado Libre Full: qué costos tiene y cuándo conviene (2026)",
  description: "Costos de Mercado Libre Full en México: almacenamiento diario por unidad, cargo por stock antiguo, cargo por sobrepasar espacio, colecta y retiro, más el cargo por venta y el envío normales. Cuándo conviene y cuándo no.",
  h1: "Mercado Libre Full: costos y cuándo conviene",
  navLabel: "Full: costos y cuándo conviene",
  answer: "Full es el programa en el que Mercado Libre guarda tu stock en su bodega y hace el envío. Pagas el cargo por venta y el envío de siempre, más un costo de almacenamiento diario por unidad según su tamaño, un cargo por stock antiguo, un cargo si sobrepasas tu espacio, y la colecta y el retiro del stock. Conviene cuando vendes volumen constante de productos chicos.",
  breadcrumb: [bc.guias, { name: "Full: costos y cuándo conviene", path: "/guias/mercado-libre-full-costos-cuando-conviene/" }],
  related: ["/guias/costo-de-envio-mercado-libre-vendedor/", "/como/bajar-costos-de-envio-mercado-libre/"],
  body: `
<h2>Qué cobra Full, según las páginas oficiales</h2>
<p>La ${off("full", "página oficial de costos por operar en Full")} y su ${off("full2", "página de ayuda complementaria")} (consultadas el ${CHECKED}) listan estos conceptos. Los montos exactos están en subpáginas y en tu panel, cambian por tamaño del producto y por periodo, así que no los copiamos aquí: revisa el tuyo en esas páginas antes de decidir.</p>
<ul>
<li><b>Costo por almacenamiento diario</b> por cada unidad, según el tamaño del producto. Se cobra por los días que la unidad está en la bodega.</li>
<li><b>Cargo por stock antiguo</b>: unidades que llevan demasiado tiempo sin venderse pagan extra.</li>
<li><b>Cargo por sobrepasar el espacio</b> que te asignaron.</li>
<li><b>Colecta o envío de stock</b> hacia la bodega, y <b>retiro o descarte</b> cuando sacas producto.</li>
<li>Y lo de siempre: el <b>cargo por venta</b> de tu categoría y el <b>costo de envío</b> por peso y precio.</li>
</ul>
<h2>Productos de menos de $299 en Full</h2>
<p>Según los datos de Netio (fuente secundaria, abril de 2026), los vendedores Full que venden productos de menos de $299 pagan un "costo por servicio Full" variable por peso y tramo de precio en lugar del costo fijo por unidad. Por ejemplo, un producto de $199 de 500 g pagaría ${mxn(fullSvc)} según esa tabla. No pudimos verificar esa tabla en las páginas oficiales el ${CHECKED}, así que tómala como estimada y confirma el monto en tu panel.</p>
<h2>Cuándo conviene Full</h2>
<p>No hay una regla oficial, pero la estructura de costos deja claro a quién favorece:</p>
<ul>
<li><b>Conviene</b> cuando el producto es chico y rota rápido: pagas pocos días de almacenamiento por unidad, evitas el cargo por stock antiguo y el envío sale desde la bodega sin que tú empaques.</li>
<li><b>Conviene</b> cuando tu tiempo de empaque y las idas a la paquetería ya te cuestan más que el almacenamiento.</li>
<li><b>No conviene</b> con productos grandes o voluminosos (el almacenamiento diario se cobra por tamaño), ni con productos de venta lenta (el stock antiguo se cobra aparte).</li>
<li><b>No conviene</b> si tu margen por venta ya es chico: Full agrega costos, no los quita. Primero revisa que la publicación gane dinero con el envío normal.</li>
</ul>
<h2>Cómo hacer la cuenta</h2>
<p>Haz dos columnas con el mismo producto. En la primera, la venta con Mercado Envíos normal: cargo por venta, envío por peso y reputación, retenciones y tu costo. En la segunda, lo mismo más el almacenamiento diario multiplicado por los días promedio que tarda en venderse cada unidad, más la colecta prorrateada por unidad. Si la segunda columna deja más dinero (o el mismo con menos trabajo), Full te sirve. Netio te da la primera columna en cada publicación; el almacenamiento tendrás que tomarlo de tu panel.</p>`,
  example: {
    title: "Ejemplo: la parte de la cuenta que sí conocemos",
    intro: "Supuestos: crema facial de $599 en Belleza y salud (14% estimado en Clásica), reputación verde, paquete de 500 g, RFC registrado, costo $260. Esta es la venta con envío normal; para Full suma a esto el almacenamiento diario y la colecta de tu panel, que no publicamos porque no están en las páginas que pudimos verificar.",
    ticket: exFull.html, calcHref: exFull.calcHref,
    notes: `<p>Con envío normal te quedan ${mxn(exFull.netLo)}. Si el almacenamiento y la colecta en Full te costaran, por ejemplo, el equivalente a $40 por unidad vendida (cifra hipotética para ilustrar, no oficial), la ganancia bajaría a ${mxn(exFull.netLo - 40)} y tendrías que decidir si el tiempo que ahorras vale esos $40. Consulta tus montos en la ${off("full", "página oficial de Full")}.</p>`
  },
  faq: [
    { q: "¿Cuánto cuesta el almacenamiento en Mercado Libre Full?", a: `Se cobra un costo por almacenamiento diario por unidad, según el tamaño del producto. Los montos están en las subpáginas de la ${off("full", "página oficial de Full")} y en tu panel, y cambian por tamaño y periodo, así que no los reproducimos aquí.` },
    { q: "¿En Full sigo pagando el cargo por venta y el envío?", a: "Sí. Full agrega costos de almacenamiento, stock antiguo, espacio, colecta y retiro, pero el cargo por venta de tu categoría y el costo de envío por peso y precio siguen aplicando." },
    { q: "¿Qué es el cargo por stock antiguo?", a: "Un cargo extra por las unidades que llevan demasiado tiempo en la bodega sin venderse. Es la razón principal por la que Full no conviene para productos de rotación lenta." },
    { q: "¿Full cobra el costo fijo por unidad en productos baratos?", a: `Según los datos de Netio (fuente secundaria), desde abril de 2026 los productos de menos de $299 en Full pagan un costo por servicio variable por peso y precio en lugar del costo fijo, por ejemplo ${mxn(fullSvc)} para 500 g a $199. No pudimos verificarlo en las páginas oficiales; confírmalo en tu panel.` },
    { q: "¿Cuándo conviene entrar a Full?", a: "Cuando vendes volumen constante de productos chicos que rotan rápido y el tiempo de empacar y enviar ya te cuesta más que el almacenamiento. Con productos grandes, de venta lenta o de margen chico, los costos de Full suelen comerse la ganancia." },
    { q: "¿Netio calcula los costos de Full?", a: "Netio estima el cargo por venta, el envío por peso y reputación, el costo por servicio Full en productos de menos de $299 (estimado) y las retenciones. El almacenamiento diario y la colecta dependen de tu panel y los tienes que sumar tú." }
  ]
};

// ---------------------------------------------------------------------
const exCl = example({ priceMXN: 249, costMXN: 110, categoryGroupId: "tech", listingTypeId: "classic", reputation: "verde", weightKg: 0.3, offersFree: false, hasRFC: true }, { title: "Cargador a $249, Clásica", subtitle: "Tecnología, 10%, costo fijo $37" });
const exPr = example({ priceMXN: 249, costMXN: 110, categoryGroupId: "tech", listingTypeId: "premium", reputation: "verde", weightKg: 0.3, offersFree: false, hasRFC: true }, { title: "Cargador a $249, Premium", subtitle: "Tecnología, 12.5% a 14.5%, sin costo fijo" });
const exCl2 = WEB.compute({ priceMXN: 1200, costMXN: 600, categoryGroupId: "tech", listingTypeId: "classic", reputation: "verde", weightKg: 1, offersFree: false, hasRFC: true });
const exPr2 = WEB.compute({ priceMXN: 1200, costMXN: 600, categoryGroupId: "tech", listingTypeId: "premium", reputation: "verde", weightKg: 1, offersFree: false, hasRFC: true });

const guiaClasicaPremium = {
  type: "guide", path: "/guias/publicacion-clasica-vs-premium-mercado-libre/",
  title: "Publicación Clásica vs Premium en Mercado Libre: cuál conviene (con cuentas)",
  description: "Clásica cobra de 8% a 17% y Premium de 11% a 21.5%, pero Premium ofrece meses sin intereses hasta 18 meses y no paga costo fijo abajo de $299. Cuándo conviene cada una, con ejemplo en pesos y punto de equilibrio.",
  h1: "Publicación Clásica vs Premium en Mercado Libre",
  navLabel: "Clásica vs Premium",
  answer: "La publicación Clásica cobra entre 8% y 17% de cargo por venta y no ofrece meses sin intereses. La Premium cobra entre 11% y 21.5%, ofrece hasta 18 meses sin intereses y, según los datos de Netio, no paga el costo fijo por unidad en productos de menos de $299. Premium conviene cuando el comprador necesita financiar o cuando el producto es barato en Clásica.",
  breadcrumb: [bc.guias, { name: "Clásica vs Premium", path: "/guias/publicacion-clasica-vs-premium-mercado-libre/" }],
  related: ["/guias/comisiones-mercado-libre-por-categoria/", "/como/poner-precio-a-un-producto-en-mercado-libre/"],
  body: `
<h2>Las diferencias, una por una</h2>
<div class="table-scroll"><table class="fee-table"><caption>Lo que publica la ${off("cargoVenta", "página oficial de costos")} al ${CHECKED}, más lo que Netio toma de fuentes secundarias (marcado).</caption>
<thead><tr><th scope="col">Concepto</th><th scope="col">Clásica</th><th scope="col">Premium</th></tr></thead>
<tbody>
<tr><th scope="row">Cargo por venta</th><td>Entre 8% y 17%</td><td>Entre 11% y 21.5%</td></tr>
<tr><th scope="row">Meses sin intereses</th><td>No aplica</td><td>Hasta 18 meses</td></tr>
<tr><th scope="row">Costo fijo por unidad abajo de $299 (fuente secundaria)</th><td>${fixedText}</td><td>No aplica</td></tr>
<tr><th scope="row">Exposición</th><td>Alta</td><td>Máxima</td></tr>
<tr><th scope="row">Costo de publicar</th><td>Gratis</td><td>Gratis</td></tr>
</tbody></table></div>
<p>En los grupos de categoría que usa Netio la diferencia de comisión entre Clásica y Premium es de ${pct(g("tech").premium.pctMin - g("tech").classic.pctMin)} a ${pct(g("tools").premium.pctMin - g("tools").classic.pctMin)} puntos: Tecnología ${pct(g("tech").classic.pctMin)} contra ${pct(g("tech").premium.pctMin)} a ${pct(g("tech").premium.pctMax)}, Hogar y moda ${pct(g("home-general").classic.pctMin)} contra ${pct(g("home-general").premium.pctMin)}, Herramientas ${pct(g("tools").classic.pctMin)} contra ${pct(g("tools").premium.pctMin)}.</p>
<h2>El caso donde Premium sale más barata: productos de menos de $299</h2>
<p>Como Premium no paga el costo fijo por unidad (según Tiendanube y Upseller, verificado en junio de 2026 en los datos de Netio), en productos baratos el costo fijo de Clásica puede pesar más que los puntos extra de comisión de Premium. En un cargador de $249 en Tecnología: Clásica paga ${mxn(exCl.r.commissionMinMXN)} de comisión más ${mxn(exCl.r.fixedCostMXN)} de costo fijo, ${mxn(exCl.r.commissionMinMXN + exCl.r.fixedCostMXN)} en total. Premium paga entre ${mxn(exPr.r.commissionMinMXN)} y ${mxn(exPr.r.commissionMaxMXN)} y nada de costo fijo. Premium gana por ${mxn(exCl.r.commissionMinMXN + exCl.r.fixedCostMXN - exPr.r.commissionMaxMXN)} a ${mxn(exCl.r.commissionMinMXN + exCl.r.fixedCostMXN - exPr.r.commissionMinMXN)} por venta, y encima ofrece meses sin intereses.</p>
<h2>Punto de equilibrio: a qué precio deja de convenir Premium</h2>
<p>Desde $299 el costo fijo desaparece y Premium solo trae su comisión más alta. En Tecnología, con 10% contra 12.5% a 14.5%, cada $100 de precio cuestan entre $2.50 y $4.50 más en Premium. En un producto de $1,200 son ${mxn(exPr2.commissionMinMXN - exCl2.commissionMinMXN)} a ${mxn(exPr2.commissionMaxMXN - exCl2.commissionMinMXN)} por venta. A ese precio, Premium solo conviene si los meses sin intereses te traen ventas que no tendrías sin ellos, y recuerda que los MSI tienen un costo adicional para el vendedor que depende de tu cuenta de Mercado Pago (Netio PRO lo calcula con tu porcentaje).</p>
<p>Regla práctica con los datos de Netio: abajo de $299, Premium casi siempre deja más dinero por venta. De $299 en adelante, Clásica deja más por venta y Premium solo gana si vendes más unidades gracias a la exposición o al financiamiento.</p>`,
  example: {
    title: "Ejemplo: el mismo cargador de $249 en Clásica y en Premium",
    intro: "Supuestos: Tecnología (10% Clásica, 12.5% a 14.5% Premium, estimados), reputación verde, paquete de hasta 300 g, sin envío gratis (el comprador lo paga), RFC registrado, costo $110.",
    ticket: exCl.html + exPr.html, calcHref: exPr.calcHref,
    notes: `<p>Clásica deja ${mxn(exCl.netLo)}; Premium deja entre ${mxn(exPr.netLo)} y ${mxn(exPr.netHi)}. La diferencia la hace el costo fijo de ${mxn(exCl.r.fixedCostMXN)} que Clásica paga en este tramo de precio. Abre el ejemplo en la calculadora y sube el precio a $299 para ver cómo se invierte.</p>`
  },
  faq: [
    { q: "¿Qué diferencia hay entre publicación Clásica y Premium?", a: "La Premium cobra un cargo por venta más alto (11% a 21.5% contra 8% a 17%), ofrece meses sin intereses hasta 18 meses y tiene la exposición máxima. Según los datos de Netio, además no paga el costo fijo por unidad abajo de $299." },
    { q: "¿Cuánto cobra Mercado Libre por una publicación Premium?", a: `Entre 11% y 21.5% del precio según la categoría, de acuerdo con la ${off("cargoVenta", "página oficial")}. Como referencia por grupo: Tecnología ${pct(g("tech").premium.pctMin)} a ${pct(g("tech").premium.pctMax)}, Herramientas ${pct(g("tools").premium.pctMin)}, Hogar y moda ${pct(g("home-general").premium.pctMin)} (fuente secundaria).` },
    { q: "¿La publicación Premium paga costo fijo?", a: "Según las fuentes secundarias que usa Netio (Tiendanube y Upseller, junio de 2026), no: el costo fijo por unidad abajo de $299 es solo de Clásica. Mercado Libre te muestra el cargo exacto al publicar; si tu panel muestra costo fijo en Premium, ese dato manda." },
    { q: "¿Conviene Premium para productos baratos?", a: `Casi siempre sí, por el costo fijo. En un producto de $249 en Tecnología, Premium deja entre ${mxn(exPr.netLo - exCl.netLo)} y ${mxn(exPr.netHi - exCl.netLo)} más por venta que Clásica, porque evita los ${mxn(exCl.r.fixedCostMXN)} de costo fijo.` },
    { q: "¿Puedo cambiar una publicación de Clásica a Premium?", a: "Sí, el tipo de publicación se edita desde tu publicación en Mercado Libre. Antes de cambiar, haz la cuenta a tu precio: desde $299 Premium cuesta más por venta y solo compensa si vendes más unidades." },
    { q: "¿Los meses sin intereses tienen costo para el vendedor?", a: "Sí. Además del cargo por venta, ofrecer meses sin intereses tiene un porcentaje adicional que depende de tu cuenta de Mercado Pago y del plazo. Mercado Libre no publica una tabla general; Netio PRO te deja escribir tu porcentaje y ver la ganancia por plazo." }
  ]
};

// ---------------------------------------------------------------------
const exRet = example({ priceMXN: 1160, costMXN: 500, categoryGroupId: "home-general", listingTypeId: "classic", reputation: "verde", weightKg: 2, offersFree: false, hasRFC: true }, { title: "Juego de sábanas a $1,160, con RFC", subtitle: "Base sin IVA: $1,000" });
const exRetNo = example({ priceMXN: 1160, costMXN: 500, categoryGroupId: "home-general", listingTypeId: "classic", reputation: "verde", weightKg: 2, offersFree: false, hasRFC: false }, { title: "El mismo producto, sin RFC", subtitle: "Base sin IVA: $1,000" });

const guiaRetenciones = {
  type: "guide", path: "/guias/retenciones-isr-iva-mercado-libre-vendedores/",
  title: "Retenciones de ISR e IVA en Mercado Libre 2026: cuánto te quitan con y sin RFC",
  description: "Desde el 1 de enero de 2026 Mercado Libre retiene 2.5% de ISR y 8% de IVA a vendedores con RFC, y 16% de IVA y 20% de ISR sin RFC. Son acreditables. Ejemplo con $1,000 sin IVA y qué cambia al registrar tu RFC.",
  h1: "Retenciones de ISR e IVA en Mercado Libre para vendedores",
  navLabel: "Retenciones de ISR e IVA",
  answer: `Desde el 1 de enero de 2026, Mercado Libre retiene a los vendedores con RFC registrado 2.5% de ISR (antes 1%) y 8% de IVA, la mitad del 16%. Sin RFC te retienen el 16% completo de IVA y 20% de ISR. Se calculan sobre el precio sin IVA, van al SAT a tu nombre y son acreditables.`,
  breadcrumb: [bc.guias, { name: "Retenciones de ISR e IVA", path: "/guias/retenciones-isr-iva-mercado-libre-vendedores/" }],
  related: ["/guias/cuanto-cobra-mercado-libre-por-vender-2026/", "/como/calcular-tu-ganancia-real-en-mercado-libre/"],
  body: `
<h2>Las tasas de 2026</h2>
<div class="table-scroll"><table class="fee-table"><caption>Retenciones por venta en plataformas digitales desde el 1 de enero de 2026, según el ${off("retenciones", "blog oficial de Mercado Pago del 15 de mayo de 2026")} (consultado el ${CHECKED}).</caption>
<thead><tr><th scope="col">Situación</th><th scope="col">ISR retenido</th><th scope="col">IVA retenido</th></tr></thead>
<tbody>
<tr><th scope="row">Persona física con RFC registrado</th><td>2.5% (antes 1%)</td><td>8% (la mitad del 16%)</td></tr>
<tr><th scope="row">Persona moral con RFC registrado</th><td>2.5%</td><td>8% (50% del IVA)</td></tr>
<tr><th scope="row">Sin RFC válido registrado</th><td>20%</td><td>16% (el IVA completo)</td></tr>
<tr><th scope="row">Cobro a cuenta bancaria en el extranjero</th><td>según tu caso</td><td>16% (el IVA completo)</td></tr>
</tbody></table></div>
<p>La base legal es la Ley de Ingresos de la Federación 2026 (publicada en el DOF el 7 de noviembre de 2025) para el 2.5% de ISR, y el artículo 18-J de la Ley del IVA para la retención de IVA. Mercado Libre también lo explica en su nota de ayuda sobre retenciones para vendedores.</p>
<h2>Sobre qué base se calculan</h2>
<p>Sobre el precio sin IVA. Si vendes algo en $1,160, el IVA incluido es $160 y la base es $1,000: te retienen $25 de ISR y $80 de IVA con RFC, o $200 de ISR y $160 de IVA sin RFC. Mercado Pago describe el ISR como un porcentaje del "ingreso bruto"; la guía del SAT lo aplica al ingreso antes de IVA, que es como lo calcula Netio. Si tu contador usa otra base, su número manda: la diferencia es pequeña con RFC y grande sin RFC.</p>
<h2>No es un impuesto extra, es un adelanto</h2>
<p>Lo retenido se entera al SAT como pago provisional a tu nombre. Al presentar tu declaración lo acreditas contra el ISR y el IVA que te toque pagar; si te retuvieron de más, se compensa o se pide en devolución. Mercado Libre emite el certificado de retenciones que necesitas para acreditarlo. Lo que sí es real es el efecto en tu flujo: el dinero llega después de restar la retención, y en productos de margen chico puede ser la diferencia entre ganar y perder en el mes.</p>
<h2>Por qué registrar tu RFC es lo primero que conviene hacer</h2>
<p>Sin RFC la retención total es del 36% de la base (20% ISR más 16% IVA), contra 10.5% con RFC (2.5% más 8%). En una venta de $1,160 son ${mxn(exRetNo.r.withholdings.totalMXN)} contra ${mxn(exRet.r.withholdings.totalMXN)}: ${mxn(exRetNo.r.withholdings.totalMXN - exRet.r.withholdings.totalMXN)} de diferencia que, aunque sea acreditable, no ves hasta tu declaración. El registro del RFC se hace desde la configuración fiscal de tu cuenta de Mercado Libre y Mercado Pago.</p>`,
  example: {
    title: "Ejemplo: la misma venta de $1,160 con RFC y sin RFC",
    intro: "Supuestos: Hogar, moda y deportes (15% estimado en Clásica), reputación verde, paquete de 1 a 2 kg, costo $500. El precio de $1,160 se eligió para que la base sin IVA sea exactamente $1,000 y las retenciones se lean de un vistazo.",
    ticket: exRet.html + exRetNo.html, calcHref: exRet.calcHref,
    notes: `<p>Con RFC: ISR ${mxn(exRet.r.withholdings.isrMXN)} e IVA ${mxn(exRet.r.withholdings.ivaMXN)}, te quedan ${mxn(exRet.netLo)}. Sin RFC: ISR ${mxn(exRetNo.r.withholdings.isrMXN)} e IVA ${mxn(exRetNo.r.withholdings.ivaMXN)}, te quedan ${mxn(exRetNo.netLo)}. El cargo por venta y el envío son iguales en los dos casos. Marca "verificar con tu contador": la base del ISR puede variar según tu régimen.</p>`
  },
  faq: [
    { q: "¿Cuánto retiene Mercado Libre de ISR en 2026?", a: `2.5% para vendedores con RFC registrado, según el ${off("retenciones", "blog oficial de Mercado Pago")}. Hasta 2025 era 1%. Sin RFC válido registrado, la retención de ISR sube a 20%.` },
    { q: "¿Cuánto retiene Mercado Libre de IVA?", a: "8% con RFC registrado, que es la mitad del IVA de 16%. Sin RFC, o si cobras en una cuenta bancaria en el extranjero, te retienen el 16% completo." },
    { q: "¿Las retenciones se calculan sobre el precio con IVA?", a: "Sobre el precio sin IVA. En una venta de $1,160 la base es $1,000 (el IVA incluido son $160). Netio y esta guía usan esa base; Mercado Pago habla de ingreso bruto, así que confirma con tu contador cómo aplica en tu régimen." },
    { q: "¿Puedo recuperar lo que me retienen?", a: "Sí. Son pagos provisionales a tu nombre: se acreditan en tu declaración contra el ISR y el IVA a cargo, y el excedente se compensa o se solicita en devolución. Mercado Libre emite el certificado de retenciones para que lo acredites." },
    { q: "¿Qué pasa si no registro mi RFC en Mercado Libre?", a: `Te retienen 20% de ISR y 16% de IVA sobre la base sin IVA, 36% en total, contra 10.5% con RFC. En una venta de $1,160 son ${mxn(exRetNo.r.withholdings.totalMXN - exRet.r.withholdings.totalMXN)} más retenidos por venta.` },
    { q: "¿Netio calcula las retenciones?", a: "Sí, en el plan gratis. La tarjeta muestra la retención de IVA e ISR de cada publicación (con RFC: 8% y 2.5% sobre el precio sin IVA) y las resta de tu ganancia, para que el número que ves sea el que te depositan." },
    { q: "¿Desde cuándo aplican estas tasas?", a: "Desde el 1 de enero de 2026, con la Ley de Ingresos de la Federación 2026. El cambio principal fue el ISR, que pasó de 1% a 2.5% para quienes tienen RFC registrado." }
  ]
};

// =====================================================================
// CÓMO (HowTo)
// =====================================================================
const exHow1 = example({ priceMXN: 450, costMXN: 180, categoryGroupId: "beauty-health", listingTypeId: "classic", reputation: "verde", weightKg: 0.5, offersFree: false, hasRFC: true }, { title: "Secadora de cabello a $450", subtitle: "Clásica, Belleza y salud" });

const comoGanancia = {
  type: "howto", path: "/como/calcular-tu-ganancia-real-en-mercado-libre/", utmSource: "como",
  title: "Cómo calcular tu ganancia real en Mercado Libre (paso a paso, 2026)",
  description: "Cómo calcular la ganancia real de una venta en Mercado Libre México en 6 pasos: precio, cargo por venta, costo fijo, envío por peso y reputación, retenciones de ISR e IVA y costo del producto. Con ejemplo de $450.",
  h1: "Cómo calcular tu ganancia real en Mercado Libre",
  navLabel: "Calcular tu ganancia real",
  answer: "Tu ganancia real por venta en Mercado Libre es el precio menos cinco cosas: el cargo por venta de tu categoría, el costo fijo por unidad si vendes abajo de $299 en Clásica, el envío que pagas tú según peso y reputación, las retenciones de ISR e IVA, y lo que te costó el producto. Lo que queda, dividido entre el precio, es tu margen.",
  breadcrumb: [bc.como, { name: "Calcular tu ganancia real", path: "/como/calcular-tu-ganancia-real-en-mercado-libre/" }],
  related: ["/como/saber-que-publicaciones-te-hacen-perder-dinero/", "/guias/cuanto-cobra-mercado-libre-por-vender-2026/"],
  totalTime: "PT5M",
  body: `<p>La mayoría de los vendedores calcula "precio menos comisión menos costo" y se queda corto por tres conceptos: el costo fijo, el envío y las retenciones. Con productos de menos de $300 esos tres pueden sumar más que la comisión. Aquí va el orden completo, con un ejemplo que puedes abrir en la calculadora al final.</p>`,
  steps: [
    { name: "Anota el precio al que vendes", text: `<p>El precio que ve el comprador, con IVA incluido. Todo lo demás se calcula a partir de él. Si el precio está abajo de $35, Mercado Libre no deja publicar.</p>` },
    { name: "Resta el cargo por venta", text: `<p>Multiplica el precio por el porcentaje de tu categoría. Si no lo tienes a la mano, usa la referencia por grupo: Tecnología ${pct(g("tech").classic.pctMin)}, Vehículos e industria ${pct(g("vehicles-industry").classic.pctMin)}, Herramientas ${pct(g("tools").classic.pctMin)}, Belleza y salud ${pct(g("beauty-health").classic.pctMin)}, Hogar, moda y deportes ${pct(g("home-general").classic.pctMin)} en Clásica (fuente secundaria). El exacto lo muestra Mercado Libre al publicar.</p>` },
    { name: "Resta el costo fijo por unidad, si aplica", text: `<p>Solo en Clásica y solo abajo de $299: ${fixedText}. Desde $299 es cero, y Premium no lo paga según los datos de Netio.</p>` },
    { name: "Resta el envío que pagas tú", text: `<p>Desde $299 el envío gratis es obligatorio y lo pagas tú. Busca tu celda en la tabla oficial según reputación, peso (el mayor entre físico y volumétrico) y tramo de precio: por ejemplo, verde, 500 g, $299 a $498.99 son ${mxn(SHIP.tables.verde.rows[1][3])}. Abajo de $299, solo si ofreces envío gratis; si no, pon $0. Las tres tablas están en la ${link("/guias/costo-de-envio-mercado-libre-vendedor/", "guía de envíos")}.</p>` },
    { name: "Resta las retenciones de ISR e IVA", text: `<p>Divide el precio entre 1.16 para sacar la base sin IVA. Con RFC registrado, resta 2.5% de ISR y 8% de IVA de esa base. Sin RFC, 20% y 16%. Son acreditables, pero no te las depositan.</p>` },
    { name: "Resta lo que te costó el producto y saca el margen", text: `<p>Incluye lo que pagaste por la pieza y, si quieres ser estricto, el empaque. Lo que queda es tu ganancia por venta. Divídela entre el precio y multiplica por 100: ese es tu margen. Si sale negativo, estás pagando por vender. Netio te hace estos seis pasos en cada publicación y marca el resultado en verde o en rojo.</p>` }
  ],
  example: {
    title: "Ejemplo: los seis pasos con una secadora de $450",
    intro: "Supuestos: Belleza y salud (14% estimado en Clásica), reputación verde, paquete de 300 g a 500 g, RFC registrado, costo $180. Desde $299 no hay costo fijo y el envío gratis es obligatorio.",
    ticket: exHow1.html, calcHref: exHow1.calcHref,
    notes: `<p>Paso 2: $450 por 14% = ${mxn(exHow1.r.commissionMinMXN)}. Paso 3: $0 porque el precio pasa de $299. Paso 4: ${mxn(exHow1.r.shippingMXN)} de la ${off("envioVerde", "tabla verde")}. Paso 5: base ${mxn(exHow1.r.withholdings.baseMXN)}, ISR ${mxn(exHow1.r.withholdings.isrMXN)} más IVA ${mxn(exHow1.r.withholdings.ivaMXN)}. Paso 6: ${mxn(exHow1.r.preWithholdingMinMXN)} antes de retenciones, ${mxn(exHow1.netLo)} después, margen ${pct(exHow1.marginLo)}.</p>`
  },
  faq: [
    { q: "¿Cómo se calcula la ganancia en Mercado Libre?", a: "Precio menos cargo por venta, menos costo fijo (Clásica abajo de $299), menos envío que pagas tú, menos retenciones de ISR e IVA, menos el costo del producto. Divide el resultado entre el precio para tener el margen." },
    { q: "¿Qué margen es bueno en Mercado Libre?", a: "No hay una cifra oficial y depende de tu rotación y tus gastos fuera de la plataforma. Lo que sí es seguro es que un margen negativo o de un dígito no cubre devoluciones ni publicidad; conviene conocer tu número exacto antes de fijarte una meta." },
    { q: "¿La comisión se resta antes o después del envío?", a: "Da igual el orden porque todo se resta del mismo precio, pero conviene calcular cada concepto sobre su base correcta: la comisión sobre el precio con IVA, las retenciones sobre el precio sin IVA, y el envío como monto fijo de tabla." },
    { q: "¿Tengo que contar las retenciones como gasto?", a: "No son un gasto, son un adelanto de impuestos acreditable. Pero sí reducen lo que te depositan, así que para saber cuánto dinero llega a tu cuenta por venta conviene restarlas, y luego recuperarlas en tu declaración." },
    { q: "¿Dónde veo el cargo exacto de mi publicación?", a: "En la publicación misma al crearla o editarla, y en el simulador de costos oficial (Mi cuenta, Publicaciones, Simular costos). Netio te muestra la estimación por grupo de categoría sin salir de la página." },
    { q: "¿Netio hace este cálculo solo?", a: "Sí. Lee el precio y la categoría de la publicación, estima el cargo por venta, el costo fijo, el envío por peso y reputación y las retenciones, y con tu costo te da la ganancia y el margen. Es gratis y funciona en cada publicación y cada búsqueda." }
  ]
};

// ---------------------------------------------------------------------
const exP280 = example({ priceMXN: 280, costMXN: 120, categoryGroupId: "tech", listingTypeId: "classic", reputation: "verde", weightKg: 0.3, offersFree: true, hasRFC: true }, { title: "Mouse a $280 con envío gratis", subtitle: "Clásica, Tecnología, costo fijo $37" });
const exP299 = example({ priceMXN: 299, costMXN: 120, categoryGroupId: "tech", listingTypeId: "classic", reputation: "verde", weightKg: 0.3, offersFree: false, hasRFC: true }, { title: "Mouse a $299", subtitle: "Clásica, Tecnología, sin costo fijo" });
const exP280n = WEB.compute({ priceMXN: 280, costMXN: 120, categoryGroupId: "tech", listingTypeId: "classic", reputation: "verde", weightKg: 0.3, offersFree: false, hasRFC: true });
// Target price for a 20% margin on the mouse (cost 120, verde 0.3 kg, 10%).
const target20 = globalThis.MST_CALC.solveTargetPrice({
  costMXN: 120, shippingMXN: SHIP.tables.verde.rows[0][3], marginPct: 20, ratePct: 10,
  fixedCostFn: SOURCE.fixedCostFnFor({ listingTypeId: "classic" }), thresholds: SOURCE.getFixedCostThresholds(), minPriceMXN: SOURCE.minPriceMXN
});

const comoPrecio = {
  type: "howto", path: "/como/poner-precio-a-un-producto-en-mercado-libre/", utmSource: "como",
  title: "Cómo poner precio a un producto en Mercado Libre para ganar lo que quieres",
  description: "Cómo poner precio en Mercado Libre México partiendo del margen que quieres: cargo por venta, costo fijo, envío y retenciones hacia atrás. Por qué $299 es un precio especial (envío gratis obligatorio, costo fijo desaparece) y cómo evitar los escalones de $99 y $149.",
  h1: "Cómo poner precio a un producto en Mercado Libre",
  navLabel: "Poner precio a un producto",
  answer: "Para poner precio en Mercado Libre, parte del margen que quieres y calcula hacia atrás: precio = (costo + envío + costo fijo) entre (1 menos el porcentaje de cargo por venta menos tu margen). Revisa después en qué tramo cae el precio, porque en $99, $149 y $299 cambian el costo fijo y el envío, y a veces subir unos pesos deja más dinero.",
  breadcrumb: [bc.como, { name: "Poner precio a un producto", path: "/como/poner-precio-a-un-producto-en-mercado-libre/" }],
  related: ["/guias/publicacion-clasica-vs-premium-mercado-libre/", "/como/calcular-tu-ganancia-real-en-mercado-libre/"],
  totalTime: "PT10M",
  body: `<p>El error más común es poner el precio mirando a la competencia y revisar la ganancia después. Funciona al revés: primero decide cuánto quieres ganar por venta, calcula el precio que lo logra, y luego compara con la competencia para ver si ese precio es vendible. Si no lo es, el problema está en el costo o en el producto, no en el precio.</p>`,
  steps: [
    { name: "Decide el margen que quieres", text: `<p>Un porcentaje del precio de venta, por ejemplo 20%. Este número es tuyo: tiene que cubrir devoluciones, publicidad y tu tiempo. No es el margen sobre el costo.</p>` },
    { name: "Junta los costos que no dependen del precio", text: `<p>Tu costo del producto, el envío que vas a pagar (de la ${link("/guias/costo-de-envio-mercado-libre-vendedor/", "tabla oficial")}, según peso y reputación) y, si el precio va a quedar abajo de $299 en Clásica, el costo fijo por unidad (${fixedText}).</p>` },
    { name: "Calcula el precio hacia atrás", text: `<p>Precio = (costo + envío + costo fijo) entre (1 menos cargo por venta menos margen). Ejemplo: costo $120, envío ${mxn(SHIP.tables.verde.rows[0][3])} (verde, 300 g), Tecnología al 10%, margen 20%: (120 + ${SHIP.tables.verde.rows[0][3]} + costo fijo) entre 0.70. Como el costo fijo depende del precio que sale, hay que probar: con $37 de costo fijo el precio da ${mxn((120 + SHIP.tables.verde.rows[0][3] + 37) / 0.7)}, pero a ese precio ya no hay costo fijo; sin costo fijo da ${mxn((120 + SHIP.tables.verde.rows[0][3]) / 0.7)}, pero a ese precio sí lo hay. Cuando la fórmula oscila así alrededor de un escalón, el precio correcto es el escalón mismo: ${mxn(target20)}. Netio PRO hace esta iteración por ti ("precio objetivo").</p>` },
    { name: "Revisa en qué tramo cayó el precio", text: `<p>Hay tres escalones donde el cargo cambia de golpe: en $99 el costo fijo sube de $25 a $30; en $149 sube a $37; en $299 desaparece y el envío gratis se vuelve obligatorio. Un precio de $148 paga $30 de costo fijo; uno de $149 paga $37. Si tu precio quedó unos pesos abajo de un escalón que baja el cargo ($299), súbelo y compara.</p>` },
    { name: "Compara con el precio justo arriba de $299", text: `<p>Es el caso que más dinero cambia. Un mouse a $280 con envío gratis opcional paga ${mxn(exP280.r.fixedCostMXN)} de costo fijo y ${mxn(exP280.r.shippingMXN)} de envío, y deja ${mxn(exP280.netLo)}. A $299 el costo fijo es $0, el envío es el mismo ${mxn(exP299.r.shippingMXN)} (obligatorio), y deja ${mxn(exP299.netLo)}: ${mxn(exP299.netLo - exP280.netLo)} más por venta cobrando $19 más. Si a $280 no ofreces envío gratis, dejas ${mxn(globalThis.MST_CALC.round2(exP280n.netMinMXN))} pero el comprador paga el envío y eso suele bajar la conversión.</p>` },
    { name: "Confirma el número en la publicación", text: `<p>Al escribir el precio en Mercado Libre, revisa el cargo por venta exacto que te muestra y ajusta. Después, mira la competencia: si tu precio objetivo es más alto que el mercado, baja el margen con los ojos abiertos o cambia de producto. Netio muestra la ganancia en cada publicación de la competencia si escribes tu costo, así ves de inmediato si a su precio tú ganarías.</p>` }
  ],
  example: {
    title: "Ejemplo: el mismo mouse a $280 y a $299",
    intro: "Supuestos: Tecnología (10% estimado en Clásica), reputación verde, paquete de hasta 300 g, RFC registrado, costo $120. A $280 el vendedor ofrece envío gratis opcional; a $299 es obligatorio.",
    ticket: exP280.html + exP299.html, calcHref: exP299.calcHref,
    notes: `<p>Para un margen del 20% con estos datos, el precio objetivo que da la fórmula es ${mxn(target20)}. Abre la calculadora y prueba $298.99, $299 y $320 para ver el escalón.</p>`
  },
  faq: [
    { q: "¿Cómo calcular el precio de venta en Mercado Libre?", a: "Suma tu costo, el envío que pagarás y el costo fijo si aplica, y divide entre (1 menos el porcentaje de cargo por venta menos el margen que quieres). Luego revisa si el precio cayó cerca de $99, $149 o $299, donde cambian los cargos." },
    { q: "¿Por qué $299 es un precio importante en Mercado Libre?", a: `Porque ahí pasan dos cosas: el costo fijo por unidad de Clásica desaparece (abajo era ${mxn(fixedTiers[2].amountMXN)}) y el envío gratis se vuelve obligatorio. Para un producto que ya ofrecía envío gratis, pasar de $280 a $299 deja ${mxn(exP299.netLo - exP280.netLo)} más por venta en el ejemplo de esta página.` },
    { q: "¿Conviene vender abajo de $99 en Mercado Libre?", a: `Es el tramo más castigado: en Clásica pagas ${mxn(fixedTiers[0].amountMXN)} de costo fijo por unidad más el cargo por venta. En un producto de $89 al 10% son ${mxn(8.9 + 25)} de cargos, el ${Math.round((33.9 / 89) * 100)}% del precio, antes de envío y retenciones. Solo funciona con costos muy bajos o con Premium.` },
    { q: "¿Qué es el precio objetivo de Netio?", a: "Una función de Netio PRO: escribes el margen que quieres y Netio calcula el precio que lo logra con el cargo por venta, el costo fijo del tramo correcto y el envío. También detecta cuando subir unos pesos (por ejemplo a $299) te deja más dinero." },
    { q: "¿El margen se calcula sobre el precio o sobre el costo?", a: "En esta guía y en Netio, sobre el precio de venta: ganancia entre precio. Un margen del 20% sobre $299 son $59.80. Si lo calculas sobre el costo obtienes otro número; elige uno y úsalo siempre igual." },
    { q: "¿Subir el precio siempre deja más dinero?", a: "Por venta sí, salvo cuando cruzas $299 sin haber ofrecido envío gratis antes: ahí empiezas a pagar el envío tú. Por volumen no necesariamente, porque un precio más alto puede vender menos. Por eso conviene conocer el escalón y probar." }
  ]
};

// ---------------------------------------------------------------------
const exLoss = example({ priceMXN: 120, costMXN: 60, categoryGroupId: "home-general", listingTypeId: "classic", reputation: "verde", weightKg: 0.3, offersFree: true, hasRFC: true }, { title: "Calcetines a $120 con envío gratis", subtitle: "Clásica, Moda, verde" });
const exLossNoFree = WEB.compute({ priceMXN: 120, costMXN: 60, categoryGroupId: "home-general", listingTypeId: "classic", reputation: "verde", weightKg: 0.3, offersFree: false, hasRFC: true });

const comoPerder = {
  type: "howto", path: "/como/saber-que-publicaciones-te-hacen-perder-dinero/", utmSource: "como",
  title: "Cómo saber qué publicaciones te hacen perder dinero en Mercado Libre",
  description: "Cómo detectar las publicaciones que pierden dinero en Mercado Libre México: revisa el costo fijo abajo de $299, el envío gratis en productos baratos, la reputación y las retenciones. Ejemplo de unos calcetines de $120 que pierden en cada venta.",
  h1: "Cómo saber qué publicaciones te hacen perder dinero",
  navLabel: "Saber qué publicaciones pierden dinero",
  answer: "Una publicación pierde dinero cuando el precio no alcanza para cubrir cargo por venta, costo fijo, envío, retenciones y el costo del producto. Las sospechosas son casi siempre las mismas: productos de menos de $299 con envío gratis, productos ligeros pero voluminosos, y cualquier cosa vendida con reputación naranja. La forma de saberlo es hacer la cuenta completa, publicación por publicación.",
  breadcrumb: [bc.como, { name: "Saber qué publicaciones pierden dinero", path: "/como/saber-que-publicaciones-te-hacen-perder-dinero/" }],
  related: ["/como/calcular-tu-ganancia-real-en-mercado-libre/", "/como/bajar-costos-de-envio-mercado-libre/"],
  totalTime: "PT15M",
  body: `<p>Lo traicionero de una publicación que pierde es que se ve bien: vende seguido, tiene buenas preguntas, aparece arriba. El dinero que falta no aparece en ningún reporte de Mercado Libre como "pérdida"; se ve como un estado de cuenta de Mercado Pago más chico de lo que esperabas. Este proceso sirve para encontrarlas antes de que pase otro mes.</p>`,
  steps: [
    { name: "Haz una lista de tus publicaciones con su costo", text: `<p>Precio actual, costo del producto, peso del paquete y tipo de publicación. Si vendes 30 productos, son 30 renglones. Netio PRO lo arma solo en el Tablero de Ganancias con los productos que has visitado; en el plan gratis lo haces una por una en la tarjeta.</p>` },
    { name: "Marca las de menos de $299", text: `<p>Ahí viven casi todas las pérdidas, por el costo fijo por unidad en Clásica (${fixedText}) y porque, si ofreces envío gratis, pagas la tarifa completa sin descuento por precio. Revisa primero las de menos de $150: el costo fijo de ${mxn(fixedTiers[2].amountMXN)} es más de la cuarta parte del precio.</p>` },
    { name: "Revisa el envío real de cada una", text: `<p>Toma tu reputación y el peso del paquete (el mayor entre físico y volumétrico) y busca la celda en la tabla oficial. Una publicación de 300 g que ofrece envío gratis a menos de $299 paga ${mxn(SHIP.tables.verde.rows[0][3])} en verde o ${mxn(SHIP.tables.naranja.rows[0][3])} en naranja. Si el envío cuesta más que tu margen bruto, ya encontraste una.</p>` },
    { name: "Resta las retenciones", text: `<p>Con RFC, 10.5% del precio sin IVA (2.5% de ISR y 8% de IVA). Es dinero acreditable, pero si tu margen era del 8%, acabas de pasar a negativo en flujo. Sin RFC es 36%, y a esa tasa casi cualquier producto de margen bajo pierde.</p>` },
    { name: "Saca el número y ordena de peor a mejor", text: `<p>Ganancia = precio menos cargo por venta menos costo fijo menos envío menos retenciones menos costo. Las que salen negativas van arriba. Para cada una decide: subir el precio (sobre todo si está cerca de $299), quitar el envío gratis, cambiar a Premium si está abajo de $299, o pausarla. Netio marca en rojo cada publicación que pierde y, en PRO, el Radar colorea los resultados de búsqueda y el Tablero ordena tus productos con las pérdidas arriba.</p>` }
  ],
  example: {
    title: "Ejemplo: unos calcetines de $120 que pierden en cada venta",
    intro: "Supuestos: Hogar, moda y deportes (15% estimado en Clásica), reputación verde, paquete de hasta 300 g, envío gratis ofrecido por el vendedor, RFC registrado, costo $60.",
    ticket: exLoss.html, calcHref: exLoss.calcHref,
    notes: `<p>Antes de retenciones ya pierde ${mxn(Math.abs(exLoss.r.preWithholdingMinMXN))}; después, ${mxn(Math.abs(exLoss.netLo))}. Sin envío gratis (el comprador paga el envío) la misma publicación deja ${mxn(globalThis.MST_CALC.round2(exLossNoFree.netMinMXN))}. Esa es la decisión que la salva: quitar el envío gratis o subir el precio hasta que el envío quepa.</p>`
  },
  faq: [
    { q: "¿Por qué pierdo dinero en Mercado Libre si vendo mucho?", a: "Porque vender mucho multiplica la pérdida por venta. Las causas típicas son el costo fijo en productos de menos de $299, el envío gratis en productos baratos o voluminosos, una reputación naranja que duplica el envío, y no contar las retenciones en el flujo." },
    { q: "¿Cómo sé si una publicación es rentable?", a: "Haz la cuenta completa: precio menos cargo por venta, costo fijo, envío, retenciones y costo del producto. Si el resultado es positivo y cubre devoluciones y publicidad, es rentable. Netio te muestra el número en verde o rojo sobre cada publicación." },
    { q: "¿El envío gratis me hace perder dinero?", a: `Puede. Abajo de $299 lo pagas completo con la tarifa de envío gratis, que para 300 g es ${mxn(SHIP.tables.verde.rows[0][3])} en verde. En el ejemplo de esta página, unos calcetines de $120 pierden ${mxn(Math.abs(exLoss.netLo))} con envío gratis y ganan ${mxn(globalThis.MST_CALC.round2(exLossNoFree.netMinMXN))} sin él.` },
    { q: "¿Qué hago con una publicación que pierde?", a: "Cuatro salidas: subir el precio (revisa si queda cerca de $299, donde el costo fijo desaparece), quitar el envío gratis si está abajo de $299, cambiarla a Premium si está abajo de $299 para evitar el costo fijo, o pausarla y buscar un producto con margen." },
    { q: "¿Netio avisa cuando una publicación pierde?", a: "Sí, en el plan gratis: la tarjeta se pone en rojo y dice cuánto pierdes por venta. En PRO, el Radar de Rentabilidad colorea cada resultado de búsqueda y el Tablero de Ganancias ordena todos tus productos con los que pierden arriba." },
    { q: "¿Las devoluciones cuentan en esta cuenta?", a: "No están en la fórmula porque dependen de tu tasa de devolución. Por eso un margen apenas positivo también es una señal de alerta: una devolución cada diez ventas puede convertirlo en pérdida." }
  ]
};

// ---------------------------------------------------------------------
const exW05 = WEB.compute({ priceMXN: 350, costMXN: 150, categoryGroupId: "home-general", listingTypeId: "classic", reputation: "amarilla", weightKg: 0.5, offersFree: false, hasRFC: true });
const exW03 = example({ priceMXN: 350, costMXN: 150, categoryGroupId: "home-general", listingTypeId: "classic", reputation: "amarilla", weightKg: 0.3, offersFree: false, hasRFC: true }, { title: "Playera a $350, empaque de 280 g", subtitle: "Clásica, Moda, reputación amarilla" });
const exW03v = WEB.compute({ priceMXN: 350, costMXN: 150, categoryGroupId: "home-general", listingTypeId: "classic", reputation: "verde", weightKg: 0.3, offersFree: false, hasRFC: true });

const comoEnvio = {
  type: "howto", path: "/como/bajar-costos-de-envio-mercado-libre/", utmSource: "como",
  title: "Cómo bajar tus costos de envío en Mercado Libre como vendedor",
  description: "Cuatro formas de pagar menos envío en Mercado Libre México, con las tablas oficiales: subir la reputación a verde (50% de descuento), bajar el peso volumétrico con un empaque más chico, decidir con cuidado el envío gratis abajo de $299 y evaluar Full para productos chicos.",
  h1: "Cómo bajar tus costos de envío en Mercado Libre",
  navLabel: "Bajar costos de envío",
  answer: "El costo de envío que pagas en Mercado Libre depende de tres cosas que puedes mover: tu reputación (verde paga la mitad que naranja), el tramo de peso del paquete (incluido el volumétrico) y si ofreces envío gratis abajo de $299. Una playera de 350 g en vez de 280 g, o una reputación amarilla en vez de verde, cambian el costo en cada venta.",
  breadcrumb: [bc.como, { name: "Bajar costos de envío", path: "/como/bajar-costos-de-envio-mercado-libre/" }],
  related: ["/guias/costo-de-envio-mercado-libre-vendedor/", "/guias/mercado-libre-full-costos-cuando-conviene/"],
  totalTime: "PT20M",
  body: `<p>Todo lo que sigue sale de las reglas de la ${off("envios", "página oficial de envíos")}: el costo se calcula con el mayor entre peso físico y volumétrico, con el precio, y con un descuento por reputación que ya viene incluido en las tablas. No hay trucos; hay tres variables y una decisión.</p>`,
  steps: [
    { name: "Lleva tu reputación a verde", text: `<p>Es la palanca más grande. Las tablas oficiales traen 50% de descuento para verde y MercadoLíder, 40% para amarilla o sin reputación y nada para naranja o roja. Para un paquete de hasta 300 g a precio de $299 a $498.99: ${mxn(SHIP.tables.verde.rows[0][3])} en verde, ${mxn(SHIP.tables.amarilla.rows[0][3])} en amarilla, ${mxn(SHIP.tables.naranja.rows[0][3])} en naranja. La reputación se gana con ventas sin reclamos, sin cancelaciones y con envíos a tiempo; cada venta mal atendida te cuesta en todas las siguientes.</p>` },
    { name: "Baja el tramo de peso con el empaque", text: `<p>Los tramos son hasta 300 g, 300 g a 500 g, 500 g a 1 kg, 1 a 2 kg y así en adelante, y cuentan el mayor entre el peso real y el volumétrico. Pesa el paquete terminado, no el producto. Si una playera con bolsa y caja pesa 320 g, cae en el tramo de 500 g y en amarilla paga ${mxn(SHIP.tables.amarilla.rows[1][3])} en vez de ${mxn(SHIP.tables.amarilla.rows[0][3])}. Con una bolsa en lugar de caja, 280 g, y pagas ${mxn(SHIP.tables.amarilla.rows[0][3])}: ${mxn(SHIP.tables.amarilla.rows[1][3] - SHIP.tables.amarilla.rows[0][3])} menos por venta. Para productos ligeros y grandes, el volumétrico manda: una caja más ajustada baja el tramo aunque el peso no cambie.</p>` },
    { name: "Decide el envío gratis abajo de $299 con números", text: `<p>Abajo de $299 ofrecer envío gratis es opcional y cuesta lo mismo que en el tramo de $299 a $498.99 (la columna de "envío gratis opcional" es idéntica en las tres tablas oficiales). Si tu margen bruto en un producto de $199 no llega a ${mxn(SHIP.tables.verde.rows[0][3])} (verde, 300 g), el envío gratis lo convierte en pérdida. Alternativas: no ofrecerlo y dejar que el comprador pague el envío, o subir el precio a $299, donde además el costo fijo desaparece.</p>` },
    { name: "Evalúa Full solo para productos chicos de rotación rápida", text: `<p>Full no baja el cargo por venta ni la tarifa de envío; cambia el empaque y la logística por un costo de almacenamiento diario por unidad, más colecta y retiro. Para productos chicos que se venden rápido puede salir a cuenta por el tiempo que ahorras; para productos grandes o lentos, no. Los conceptos están en la ${link("/guias/mercado-libre-full-costos-cuando-conviene/", "guía de Full")} y los montos en tu panel.</p>` }
  ],
  example: {
    title: "Ejemplo: una playera de $350 con reputación amarilla, en empaque de 280 g",
    intro: "Supuestos: Hogar, moda y deportes (15% estimado en Clásica), reputación amarilla, precio de $299 a $498.99 (envío gratis obligatorio), RFC registrado, costo $150. El empaque pesa 280 g, tramo de hasta 300 g.",
    ticket: exW03.html, calcHref: exW03.calcHref,
    notes: `<p>Con el mismo producto en caja de 320 g el envío sube a ${mxn(exW05.shippingMXN)} y la ganancia baja a ${mxn(exW05.netMinMXN)}. Con reputación verde y empaque de 280 g el envío baja a ${mxn(exW03v.shippingMXN)} y la ganancia sube a ${mxn(exW03v.netMinMXN)}. Entre el peor caso (amarilla, 320 g) y el mejor (verde, 280 g) hay ${mxn(exW03v.netMinMXN - exW05.netMinMXN)} por venta, sin tocar el precio.</p>`
  },
  faq: [
    { q: "¿Cómo pagar menos envío en Mercado Libre?", a: "Sube tu reputación a verde (50% de descuento en la tabla oficial), empaca en el tramo de peso más bajo posible contando el volumétrico, y ofrece envío gratis abajo de $299 solo si el margen lo aguanta. Full ayuda con la logística, no con la tarifa." },
    { q: "¿Cuánto descuento da la reputación verde en envíos?", a: `50%, ya incluido en la tabla oficial; amarilla tiene 40% y naranja o roja nada. En un paquete de 1 a 2 kg a precio de $299 a $498.99: ${mxn(SHIP.tables.verde.rows[3][3])} en verde contra ${mxn(SHIP.tables.naranja.rows[3][3])} en naranja.` },
    { q: "¿El peso volumétrico se puede bajar?", a: "Sí, con una caja o bolsa más ajustada al producto. Mercado Libre cobra el mayor entre el peso físico y el volumétrico, así que en productos ligeros el tamaño del empaque es lo que decide el tramo." },
    { q: "¿Conviene ofrecer envío gratis abajo de $299?", a: `Solo si el margen cubre la tarifa, que es la misma que en el tramo de $299 a $498.99: ${mxn(SHIP.tables.verde.rows[0][3])} para 300 g en verde. En productos de $100 a $200 suele ser mejor no ofrecerlo o subir el precio a $299.` },
    { q: "¿Full reduce el costo de envío?", a: "No reduce la tarifa de envío ni el cargo por venta. Cambia el trabajo de empacar y enviar por un costo de almacenamiento diario, colecta y retiro. Solo conviene en productos chicos que rotan rápido." },
    { q: "¿Netio me dice cuánto pago de envío?", a: "Netio estima el envío por peso y reputación en cada publicación y lo resta de tu ganancia. Para confirmar el monto exacto de tu cuenta, usa el simulador de costos oficial o tu panel de envíos." }
  ]
};

// =====================================================================
// COMPARAR
// =====================================================================
const cmpTable = (rows, cols) => `<div class="table-scroll"><table class="fee-table cmp"><thead><tr><th scope="col"></th>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr><th scope="row">${esc(r[0])}</th>${r.slice(1).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

const exExcel = example({ priceMXN: 419, costMXN: 190, categoryGroupId: "vehicles-industry", listingTypeId: "classic", reputation: "verde", weightKg: 1, offersFree: false, hasRFC: true }, { title: "Tapete para auto a $419", subtitle: "Clásica, Accesorios para vehículos" });

const cmpExcel = {
  type: "compare", path: "/comparar/netio-vs-excel/", utmSource: "comparar",
  title: "Netio vs Excel para calcular ganancias en Mercado Libre: cuándo cada uno",
  description: "Comparación honesta entre Netio (extensión de Chrome) y una hoja de Excel para calcular la ganancia en Mercado Libre México: qué hace cada uno, qué se desactualiza, qué cuesta y en qué casos conviene seguir con la hoja.",
  h1: "Netio vs Excel para calcular tu ganancia en Mercado Libre",
  navLabel: "Netio vs Excel",
  answer: "Excel sirve para cualquier cuenta y es gratis, pero tienes que copiar precio y categoría de cada publicación, mantener las tablas de cargos y envíos al día y recordar los escalones de $99, $149 y $299. Netio hace la misma cuenta sobre la publicación que estás viendo, con tablas con fecha, y en el plan gratis cubre comisión, costo fijo, envío, retenciones y ganancia neta.",
  breadcrumb: [bc.comparar, { name: "Netio vs Excel", path: "/comparar/netio-vs-excel/" }],
  related: ["/comparar/netio-vs-simulador-de-costos-mercado-libre/", "/como/calcular-tu-ganancia-real-en-mercado-libre/"],
  body: `
<h2>Lo que hace cada uno</h2>
${cmpTable([
    ["Dónde se hace la cuenta", "En tu hoja, copiando datos de cada publicación", "Debajo del precio de la publicación y en cada resultado de búsqueda"],
    ["Cargo por venta", "El porcentaje que tú escribas", "Estimado por grupo de categoría, con etiqueta de fuente y fecha"],
    ["Costo fijo por unidad y escalones ($99, $149, $299)", "Fórmulas que tú mantienes", "Automático según el precio, Clásica o Premium"],
    ["Envío por peso y reputación", "Tabla que tú copias y actualizas", "Estimado por peso y reputación; puedes escribir tu monto"],
    ["Retenciones ISR e IVA 2026", "Si te acordaste de actualizar las tasas", "8% IVA y 2.5% ISR con RFC, en el plan gratis"],
    ["Aviso cuando pierdes", "Formato condicional, si lo armas", "Tarjeta en rojo con la pérdida por venta"],
    ["Precio objetivo para un margen", "Buscar objetivo o fórmula con iteración manual", "PRO: escribe el margen y da el precio, respetando escalones"],
    ["Todos tus productos en una vista", "Sí, es su fuerte", "PRO: Tablero de Ganancias y Radar en búsquedas, con CSV"],
    ["Comparar con la competencia", "Copiar cada precio a mano", "Escribe tu costo y ves la ganancia en cualquier publicación"],
    ["Precio", "Gratis (o tu licencia de Office)", `Gratis; PRO ${mxn(SITE.pro.monthlyMXN)} al mes o ${mxn(SITE.pro.yearlyMXN)} al año, con 7 días de prueba sin tarjeta`],
    ["Exactitud", "La de tus fórmulas y tus tablas", "Estimación; el cargo exacto lo muestra Mercado Libre al publicar"]
  ], ["Excel u hoja de cálculo", "Netio"])}
<h2>Cuándo seguir con Excel</h2>
<ul>
<li>Si vendes pocos productos y cambias precios una vez al mes: una hoja bien hecha te sirve y no necesitas nada más.</li>
<li>Si ya tienes tu cargo exacto por categoría copiado del panel: tu hoja será más precisa que la estimación por grupo de Netio.</li>
<li>Si necesitas cruzar ventas, inventario y gastos fuera de Mercado Libre: Netio no es un ERP.</li>
</ul>
<h2>Cuándo Netio te ahorra la hoja</h2>
<ul>
<li>Cuando revisas precios de la competencia y quieres saber, en el momento, si a ese precio tú ganarías.</li>
<li>Cuando tienes decenas de publicaciones y no sabes cuáles pierden: el Tablero las ordena con las pérdidas arriba.</li>
<li>Cuando cambian las tasas (como el ISR en enero de 2026) y no quieres descubrirlo en el estado de cuenta.</li>
<li>Cuando tu problema es el escalón de $299 o el costo fijo: Netio detecta cuándo subir el precio deja más dinero.</li>
</ul>
<p>Los dos pueden convivir: muchos vendedores usan Netio para decidir sobre la marcha y exportan el CSV del Radar a su hoja para el cierre del mes.</p>`,
  example: {
    title: "Ejemplo: la cuenta que harías en Excel, hecha por Netio",
    intro: "Supuestos: Accesorios para vehículos (12% estimado en Clásica), reputación verde, paquete de 500 g a 1 kg, RFC registrado, costo $190. Para hacerla en Excel necesitas seis celdas de entrada y conocer la celda correcta de la tabla de envíos.",
    ticket: exExcel.html, calcHref: exExcel.calcHref,
    notes: `<p>En Excel escribirías: =419*0.12 para la comisión, 0 de costo fijo porque pasa de $299, ${SHIP.tables.verde.rows[2][3]} de la tabla verde (1 kg, $299 a $498.99), =419/1.16*0.105 para retenciones, y 190 de costo. Resultado: ${mxn(exExcel.netLo)}. Lo que no hace Excel solo es avisarte cuando la tabla de envíos cambia o cuando pones el precio en $298.</p>`
  },
  faq: [
    { q: "¿Hay una plantilla de Excel para calcular ganancias en Mercado Libre?", a: "Hay muchas en internet y la mayoría están desactualizadas en algo: el ISR de 2026 (2.5%), los tramos del costo fijo o las tablas de envío. Si usas una, revisa que tenga fecha y compara una venta real con tu estado de cuenta de Mercado Pago." },
    { q: "¿Netio reemplaza a Excel?", a: "Para la cuenta por publicación, sí. Para llevar inventario, gastos fuera de Mercado Libre y cierres mensuales, no. Netio PRO exporta CSV del Radar para que sigas usando tu hoja en lo que la hoja hace bien." },
    { q: "¿Qué es más exacto, Excel o Netio?", a: "Depende de los datos. Si en Excel pusiste el cargo exacto de tu categoría copiado del panel, tu hoja gana. Netio usa un porcentaje estimado por grupo y lo dice; su ventaja es que las tablas de envío, el costo fijo y las retenciones vienen con fecha y se aplican solas." },
    { q: "¿Netio es gratis?", a: `Sí. Comisión, costo fijo, envío, retenciones, ganancia neta y aviso de pérdida son gratis para siempre. PRO (${mxn(SITE.pro.monthlyMXN)} al mes o ${mxn(SITE.pro.yearlyMXN)} al año) agrega precio objetivo, comparación Clásica vs Premium, meses sin intereses, Radar en búsquedas, Tablero y CSV. Al instalar tienes PRO 7 días sin tarjeta.` },
    { q: "¿Puedo exportar los datos de Netio a Excel?", a: "En PRO, el Radar de Rentabilidad exporta a CSV los resultados de búsqueda con su ganancia estimada, y el CSV se abre en Excel o Google Sheets." },
    { q: "¿Netio guarda mis costos en algún servidor?", a: "No. Tus costos y productos se guardan en tu navegador; Netio no tiene servidores. Es la misma privacidad que un archivo de Excel en tu computadora." }
  ]
};

// ---------------------------------------------------------------------
const exSim = example({ priceMXN: 659, costMXN: 300, categoryGroupId: "tech", listingTypeId: "classic", reputation: "verde", weightKg: 0.5, offersFree: false, hasRFC: true }, { title: "Bocina a $659", subtitle: "Clásica, Tecnología" });

const cmpSimulador = {
  type: "compare", path: "/comparar/netio-vs-simulador-de-costos-mercado-libre/", utmSource: "comparar",
  title: "Netio vs el simulador de costos de Mercado Libre: exacto vs en cada publicación",
  description: "El simulador de costos oficial de Mercado Libre es gratis y exacto para tu cuenta. Netio es una estimación, pero la muestra en cada publicación y cada búsqueda sin salir de la página, con tu costo y tu ganancia. Cuándo usar cada uno.",
  h1: "Netio vs el simulador de costos de Mercado Libre",
  navLabel: "Netio vs simulador oficial",
  answer: "El simulador de costos de Mercado Libre (Mi cuenta, Publicaciones, Simular costos) es gratis y da el cargo exacto de tu cuenta para una publicación a la vez. Netio da una estimación, no el exacto, pero la pone debajo del precio de cada publicación y en cada resultado de búsqueda, resta tu costo y te dice si ganas o pierdes sin salir de la página. Úsalos juntos.",
  breadcrumb: [bc.comparar, { name: "Netio vs simulador oficial", path: "/comparar/netio-vs-simulador-de-costos-mercado-libre/" }],
  related: ["/comparar/netio-vs-excel/", "/guias/cuanto-cobra-mercado-libre-por-vender-2026/"],
  body: `
<h2>Empecemos por lo que el simulador hace mejor</h2>
<p>El ${off("simulador", "simulador de costos oficial")} usa el cargo por venta real de tu categoría y tu cuenta, no una estimación. Si necesitas el número exacto para una publicación concreta, ese es el lugar, y es gratis. Netio no tiene acceso a tu cuenta ni a una API de Mercado Libre: estima el cargo por grupo de categoría a partir de fuentes públicas y lo dice en cada tarjeta.</p>
<h2>Lo que hace cada uno</h2>
${cmpTable([
    ["Cargo por venta", "Exacto para tu cuenta", "Estimado por grupo de categoría, con fuente y fecha"],
    ["Dónde lo ves", "En una página aparte, una publicación a la vez", "Debajo del precio de cada publicación y en cada resultado de búsqueda"],
    ["Publicaciones de otros vendedores", "No", "Sí: escribe tu costo y ves si a ese precio ganarías"],
    ["Tu costo del producto y tu ganancia", "No lo pide", "Sí, con margen y aviso en rojo si pierdes"],
    ["Envío por peso y reputación", "Según tu cuenta", "Estimado por peso y reputación; editable"],
    ["Retenciones ISR e IVA", "No las muestra como parte de la cuenta", "Sí, con RFC: 8% IVA y 2.5% ISR"],
    ["Precio objetivo para un margen", "No", "PRO"],
    ["Clásica vs Premium lado a lado", "Simulando dos veces", "PRO, en la misma tarjeta"],
    ["Varias publicaciones a la vez", "No", "PRO: Radar en búsquedas y Tablero de Ganancias"],
    ["Precio", "Gratis", `Gratis; PRO ${mxn(SITE.pro.monthlyMXN)} al mes o ${mxn(SITE.pro.yearlyMXN)} al año`],
    ["Quién lo hace", "Mercado Libre", "Un equipo independiente, sin relación con Mercado Libre"]
  ], ["Simulador oficial", "Netio"])}
<h2>Cómo usarlos juntos</h2>
<ol>
<li>Mientras buscas producto o revisas competencia, deja que Netio te diga en qué rango queda la ganancia. Es rápido y no requiere abrir nada.</li>
<li>Cuando vayas a publicar o a cambiar un precio importante, confirma el cargo exacto en el simulador o en la propia pantalla de publicación.</li>
<li>Si el exacto difiere de la estimación de Netio, escribe el porcentaje real en la tarjeta: Netio lo guarda para esa categoría.</li>
</ol>
<p>Dicho sin rodeos: si solo publicas tres productos y nunca miras a la competencia, el simulador te basta. Netio existe para el vendedor que mira veinte publicaciones al día y quiere el número en cada una.</p>`,
  example: {
    title: "Ejemplo: lo que Netio muestra sobre una bocina de $659",
    intro: "Supuestos: Tecnología (10% estimado en Clásica), reputación verde, paquete de 300 g a 500 g, RFC registrado, costo $300. El simulador oficial te daría el cargo por venta exacto de tu cuenta; Netio usa el 10% estimado y lo marca.",
    ticket: exSim.html, calcHref: exSim.calcHref,
    notes: `<p>Si el simulador muestra, por decir, un cargo distinto al 10%, cada punto porcentual mueve la ganancia ${mxn(6.59)} en este producto. Por eso Netio deja escribir el porcentaje exacto y lo recuerda.</p>`
  },
  faq: [
    { q: "¿Dónde está el simulador de costos de Mercado Libre?", a: `En tu cuenta de vendedor: Mi cuenta, Publicaciones, Simular costos. Mercado Libre lo explica en su ${off("simulador", "nota oficial")}. Es gratis y usa los cargos reales de tu cuenta.` },
    { q: "¿Netio es más exacto que el simulador?", a: "No. El simulador es exacto para tu cuenta; Netio estima el cargo por grupo de categoría a partir de fuentes públicas y lo señala. La ventaja de Netio es dónde y cuándo muestra el número, no su exactitud." },
    { q: "¿Por qué los números de Netio no coinciden con el simulador?", a: "Porque Netio usa un porcentaje estimado por grupo y una tabla de envío por peso y reputación, y el simulador usa los valores reales de tu cuenta. Si ves diferencia, escribe en la tarjeta de Netio el porcentaje y el envío reales y la cuenta se ajusta." },
    { q: "¿El simulador muestra mi ganancia?", a: "Muestra los costos de Mercado Libre para una publicación. No pide tu costo del producto ni calcula tu margen; esa resta la tienes que hacer tú. Netio sí la hace, con tu costo guardado en tu navegador." },
    { q: "¿Puedo usar el simulador en publicaciones de la competencia?", a: "No, el simulador trabaja sobre tus propias publicaciones. Netio muestra la estimación sobre cualquier publicación de Mercado Libre México, incluidas las de otros vendedores, para que compares precios con la cuenta hecha." },
    { q: "¿Netio usa la API de Mercado Libre?", a: "No. Netio no está afiliado a Mercado Libre ni usa su API; lee la página que tienes abierta en tu navegador y aplica tablas públicas con fecha. Por eso los números son estimaciones." }
  ]
};

// ---------------------------------------------------------------------
const exMR = example({ priceMXN: 229, costMXN: 90, categoryGroupId: "home-general", listingTypeId: "classic", reputation: "verde", weightKg: 0.3, offersFree: false, hasRFC: true }, { title: "Taza a $229", subtitle: "Clásica, Hogar, sin envío gratis" });
const NV = '<span class="nv">No pudimos verificar</span>';

const cmpMargenReal = {
  type: "compare", path: "/comparar/netio-vs-margen-real/", utmSource: "comparar",
  title: "Netio vs Margen Real: dos extensiones de Chrome para vendedores de Mercado Libre México",
  description: "Comparación de Netio con Margen Real, otra extensión de Chrome para calcular la ganancia en Mercado Libre México. Lo que pudimos verificar de cada una al 30 de octubre de 2026 y lo que no, sin inventar funciones ni precios.",
  h1: "Netio vs Margen Real",
  navLabel: "Netio vs Margen Real",
  answer: "Margen Real es una extensión de Chrome que se presenta como calculadora de ganancia para vendedores de Mercado Libre México. Al 30 de octubre de 2026 no pudimos abrir su ficha en Chrome Web Store, así que no confirmamos su precio ni sus funciones. De Netio sí: es gratis, muestra comisión, costo fijo, envío, retenciones y ganancia en cada publicación, con PRO opcional.",
  breadcrumb: [bc.comparar, { name: "Netio vs Margen Real", path: "/comparar/netio-vs-margen-real/" }],
  related: ["/comparar/netio-vs-simulador-de-costos-mercado-libre/", "/comparar/netio-vs-excel/"],
  body: `
<h2>Qué pudimos verificar y qué no</h2>
<p>Esta página se escribió el ${CHECKED}. De Margen Real solo encontramos el nombre completo de su ficha en Chrome Web Store ("Margen Real: Calculadora de ganancia para vendedores de Mercado Libre México") en resultados de búsqueda; la ficha misma no se pudo abrir desde nuestra conexión, así que todo lo que no está en esa frase lo marcamos como no verificado. No vamos a adivinar su precio ni sus funciones. Si usas Margen Real y algo de abajo está mal, ${link("/soporte.html", "escríbenos")} y lo corregimos.</p>
${cmpTable([
    ["Qué es", "Extensión de Chrome para vendedores de Mercado Libre México", "Extensión de Chrome que se describe como calculadora de ganancia para vendedores de Mercado Libre México"],
    ["Precio", `Gratis; PRO ${mxn(SITE.pro.monthlyMXN)} al mes o ${mxn(SITE.pro.yearlyMXN)} al año, 7 días de prueba sin tarjeta`, NV],
    ["Cargo por venta por categoría", "Estimado por grupo, con fuente y fecha en la tarjeta", NV],
    ["Costo fijo por unidad abajo de $299", "Sí, por tramo, Clásica", NV],
    ["Envío por peso y reputación", "Sí, estimado y editable", NV],
    ["Retenciones ISR e IVA 2026", "Sí, 8% IVA y 2.5% ISR con RFC", NV],
    ["Aviso en rojo cuando pierdes", "Sí, gratis", NV],
    ["Resultados de búsqueda", "Vista previa gratis; Radar completo en PRO", NV],
    ["Precio objetivo, Clásica vs Premium, MSI, Tablero, CSV", "PRO", NV],
    ["Dónde se guardan tus datos", "En tu navegador, sin servidores ni cuenta", NV],
    ["Afiliación con Mercado Libre", "Ninguna", NV]
  ], ["Netio", "Margen Real"])}
<h2>Otra extensión que sí pudimos leer: "Calculadora MercadoLibre"</h2>
<p>En la búsqueda de "calculadora de ganancias mercado libre" aparece otra extensión, "Calculadora MercadoLibre" (Chrome Web Store, id cnlfiljlompofbkogpaepajdighbofaa). Su ficha, leída el ${CHECKED}, dice que está basada en Mercado Libre México, que separa resultados con y sin RFC, y que aplica 16% de IVA más 1% de ISR. Su última actualización marcada es del 7 de agosto de 2021 (versión 0.0.1.0), muestra 1,000 usuarios y calificación de 5.0 con 4 reseñas. No muestra precio. El dato que importa para ti: el 1% de ISR dejó de ser la tasa en enero de 2026 (hoy es 2.5% con RFC), así que una calculadora sin actualizar desde 2021 te da la retención equivocada.</p>
<h2>Cómo elegir, aunque no podamos comparar punto por punto</h2>
<ul>
<li>Pide la fecha de las tablas. Un cargo por venta o una tabla de envíos sin fecha no se puede confiar; las tarifas cambiaron en 2026.</li>
<li>Pide que muestre el costo fijo y el envío por separado. Si una calculadora solo aplica un porcentaje, en productos de menos de $299 se equivoca por decenas de pesos.</li>
<li>Pide que diga que es estimación. Ninguna extensión tiene el cargo exacto de tu cuenta; el que lo afirme te está vendiendo algo.</li>
<li>Pide saber dónde quedan tus costos. Netio los guarda en tu navegador; de Margen Real no lo sabemos.</li>
</ul>`,
  example: {
    title: "Ejemplo: lo que Netio muestra en una taza de $229",
    intro: "Supuestos: Hogar, moda y deportes (15% estimado en Clásica), reputación verde, paquete de hasta 300 g, sin envío gratis (el comprador lo paga), RFC registrado, costo $90. No sabemos qué mostraría Margen Real con estos datos.",
    ticket: exMR.html, calcHref: exMR.calcHref,
    notes: `<p>El costo fijo de ${mxn(exMR.r.fixedCostMXN)} es lo que una calculadora de "solo porcentaje" se salta. En esta taza es el ${Math.round((exMR.r.fixedCostMXN / 229) * 1000) / 10}% del precio.</p>`
  },
  faq: [
    { q: "¿Qué es Margen Real?", a: "Según el título de su ficha en Chrome Web Store, una extensión de Chrome descrita como calculadora de ganancia para vendedores de Mercado Libre México. No pudimos abrir la ficha el 30 de octubre de 2026, así que no confirmamos sus funciones ni su precio." },
    { q: "¿Margen Real es gratis?", a: "No lo pudimos verificar. Netio sí es gratis en sus funciones básicas (comisión, costo fijo, envío, retenciones, ganancia y aviso de pérdida) y cobra PRO opcional." },
    { q: "¿Cuál es mejor, Netio o Margen Real?", a: "No podemos afirmarlo sin haber probado Margen Real. Lo que sí podemos decir es qué revisar en cualquiera: fecha de las tablas, costo fijo y envío por separado, retenciones 2026, y dónde guarda tus costos." },
    { q: "¿Netio tiene algo que ver con Margen Real o con Mercado Libre?", a: "No. Netio es independiente, no está afiliado a Mercado Libre y no tiene relación con Margen Real ni con sus desarrolladores." },
    { q: "¿Hay otras extensiones de calculadora para Mercado Libre México?", a: "Sí. Una que pudimos leer es \"Calculadora MercadoLibre\", con última actualización en agosto de 2021 y una tasa de ISR del 1% que ya no aplica desde 2026. Revisa siempre la fecha de actualización antes de confiar en la cuenta." },
    { q: "¿Puedo usar Netio y Margen Real al mismo tiempo?", a: "Técnicamente dos extensiones pueden convivir en Chrome, pero si las dos inyectan tarjetas en la misma página pueden estorbarse. Si pruebas las dos, compara los números con una venta real de tu estado de cuenta de Mercado Pago." }
  ]
};

// =====================================================================
// HUB PAGES (/guias/, /como/, /comparar/)
// =====================================================================
function hub({ path, title, description, h1, answer, type, breadcrumbName, utmSource }) {
  return {
    type: "hub", hubOf: type, path, title, description, h1, answer, utmSource, navLabel: breadcrumbName,
    breadcrumb: [{ name: breadcrumbName, path }],
    related: ["/calculadora/"], faq: []
  };
}
const hubGuias = hub({ path: "/guias/", type: "guide", breadcrumbName: "Guías", utmSource: "guias",
  title: "Guías de costos de Mercado Libre México 2026: comisiones, envíos, Full y retenciones",
  description: "Guías con cifras de las páginas oficiales de Mercado Libre México: cuánto cobra por vender, comisión por categoría, costo de envío para el vendedor, Full, Clásica vs Premium y retenciones de ISR e IVA.",
  h1: "Guías de costos de Mercado Libre",
  answer: "Seis guías sobre lo que Mercado Libre México cobra por vender, con cifras tomadas de las páginas oficiales el 30 de octubre de 2026 y un ejemplo en pesos en cada una. Cuando un dato viene de fuentes secundarias, como el porcentaje por categoría o los tramos del costo fijo, lo decimos." });
const hubComo = hub({ path: "/como/", type: "howto", breadcrumbName: "Cómo", utmSource: "como",
  title: "Cómo calcular ganancias, poner precios y bajar costos en Mercado Libre: guías paso a paso",
  description: "Guías paso a paso para vendedores de Mercado Libre México: calcular la ganancia real, poner precio partiendo del margen, encontrar publicaciones que pierden dinero y bajar el costo de envío.",
  h1: "Cómo hacer las cuentas de tu tienda en Mercado Libre",
  answer: "Cuatro procesos paso a paso con las tablas oficiales de 2026: cómo calcular tu ganancia real por venta, cómo poner precio partiendo del margen que quieres, cómo encontrar las publicaciones que te hacen perder dinero y cómo pagar menos envío. Cada uno con ejemplo que puedes abrir en la calculadora." });
const hubComparar = hub({ path: "/comparar/", type: "compare", breadcrumbName: "Comparar", utmSource: "comparar",
  title: "Netio comparado con Excel, el simulador oficial y otras extensiones",
  description: "Comparaciones honestas de Netio con las alternativas para calcular ganancias en Mercado Libre México: una hoja de Excel, el simulador de costos oficial y la extensión Margen Real.",
  h1: "Netio comparado con las alternativas",
  answer: "Tres comparaciones sin maquillaje: Netio contra una hoja de Excel, contra el simulador de costos oficial de Mercado Libre (que es exacto y gratis) y contra la extensión Margen Real. En cada una decimos qué hace mejor la alternativa y cuándo no necesitas Netio." });

// =====================================================================
// CALCULADORA
// =====================================================================
const calcFaq = [
  { q: "¿Esta calculadora de comisiones de Mercado Libre es exacta?", a: `Es una estimación. El cargo por venta usa porcentajes por grupo de categoría de fuentes secundarias; el envío usa las tablas oficiales consultadas el ${CHECKED}; las retenciones usan las tasas de 2026. El número exacto de tu cuenta lo da el simulador de costos oficial en Mi cuenta, Publicaciones, Simular costos.` },
  { q: "¿Qué porcentaje de comisión usa la calculadora?", a: `Por grupo: Tecnología ${pct(g("tech").classic.pctMin)}, Accesorios para vehículos ${pct(g("vehicles-industry").classic.pctMin)}, Herramientas ${pct(g("tools").classic.pctMin)}, Belleza y salud ${pct(g("beauty-health").classic.pctMin)}, Hogar, moda y deportes ${pct(g("home-general").classic.pctMin)} en Clásica, y de ${pct(g("tech").premium.pctMin)} a ${pct(g("home-general").premium.pctMin)} en Premium. Si eliges "No sé / otra", usa el rango completo (${pct(TABLE.defaults.classic.pctMin)} a ${pct(TABLE.defaults.classic.pctMax)} Clásica, ${pct(TABLE.defaults.premium.pctMin)} a ${pct(TABLE.defaults.premium.pctMax)} Premium) y muestra la ganancia como rango.` },
  { q: "¿De dónde sale el costo de envío?", a: `De las tres tablas oficiales de Mercado Envíos por reputación (verde, amarilla, naranja), cruzando el tramo de peso con el tramo de precio. Desde $299 el envío gratis es obligatorio. Abajo de $299 solo se cobra si marcas que ofreces envío gratis; la tarifa es la columna de "envío gratis opcional", que es igual a la de $299 a $498.99.` },
  { q: "¿Por qué el costo fijo desaparece a $299?", a: `Porque Mercado Libre solo cobra el costo fijo por unidad en productos de menos de $299. Abajo, en Clásica, son ${fixedText}. Premium no lo paga según los datos de Netio. Por eso a veces subir el precio a $299 deja más dinero.` },
  { q: "¿Cómo se calculan las retenciones?", a: "Sobre el precio sin IVA (precio entre 1.16). Con RFC registrado: 8% de IVA y 2.5% de ISR. Sin RFC: 16% de IVA y 20% de ISR. Son acreditables en tu declaración, pero reducen lo que te depositan, así que la calculadora las muestra y las resta." },
  { q: "¿Qué peso pongo si mi producto es ligero pero la caja es grande?", a: "El tramo que te cobra Mercado Libre es el mayor entre el peso real y el volumétrico (según las dimensiones de la caja). Revisa en tu panel de envíos en qué tramo cae tu paquete y elige ese tramo aquí." },
  { q: "¿La calculadora guarda mis datos?", a: "No. Todo se calcula en tu navegador; esta página no tiene servidores, cookies ni analítica. Los valores quedan en la dirección de la página para que puedas compartir el enlace, y nada más." },
  { q: "¿Qué diferencia hay entre esta calculadora y la extensión Netio?", a: "La misma cuenta, pero la extensión la hace sola sobre cada publicación y cada búsqueda de Mercado Libre, con el precio y la categoría leídos de la página, y recuerda tus costos. Es gratis; PRO agrega precio objetivo, Clásica vs Premium, MSI, Radar en búsquedas y Tablero." }
];

const calcPage = {
  type: "calculator", path: "/calculadora/", utmSource: "calculadora",
  title: "Calculadora de comisiones y ganancias de Mercado Libre México 2026 (gratis)",
  description: "Calculadora gratis de comisiones de Mercado Libre México: cargo por venta por categoría, costo fijo abajo de $299, envío por peso y reputación con las tablas oficiales, retenciones de ISR e IVA y tu ganancia neta por venta.",
  h1: "Calculadora de comisiones y ganancias de Mercado Libre",
  navLabel: "Calculadora",
  answer: "Escribe tu precio y tu costo y la calculadora te dice cuánto te queda por venta en Mercado Libre México después del cargo por venta, el costo fijo por unidad, el envío según tu reputación y el peso, y las retenciones de ISR e IVA de 2026. Las tablas de envío son las oficiales del 30 de octubre de 2026; el porcentaje de comisión es estimado por categoría.",
  breadcrumb: [{ name: "Calculadora", path: "/calculadora/" }],
  related: ["/guias/cuanto-cobra-mercado-libre-por-vender-2026/", "/como/calcular-tu-ganancia-real-en-mercado-libre/"],
  faq: calcFaq
};

// =====================================================================
// HOME (es + en): the hero ticket numbers are checked against the modules.
// =====================================================================
const home149 = WEB.compute({ priceMXN: 149, costMXN: 55, categoryGroupId: "tech", listingTypeId: "classic", reputation: "verde", weightKg: 0.3, offersFree: true, hasRFC: true });
const home299 = WEB.compute({ priceMXN: 299, costMXN: 55, categoryGroupId: "tech", listingTypeId: "classic", reputation: "verde", weightKg: 0.3, offersFree: false, hasRFC: true });
if (home149.commissionMinMXN !== 14.9 || home149.fixedCostMXN !== 37 || home149.shippingMXN !== 52.4 || home149.preWithholdingMinMXN !== -10.3) {
  throw new Error("Homepage $149 example no longer matches the extension math: " + JSON.stringify(home149));
}
const h299net = home299.preWithholdingMinMXN; // before withholdings, like the $149 ticket
const h299margin = Math.round((h299net / 299) * 1000) / 10;
const h149margin = Math.round((home149.preWithholdingMinMXN / 149) * 1000) / 10;

const homeFaq = [
  { q: "¿Netio está afiliado a Mercado Libre?", a: "No. Netio es una herramienta independiente y no tiene ninguna relación con Mercado Libre. No usa una API de Mercado Libre: las tarifas salen de guías públicas para vendedores y de las páginas oficiales de ayuda, así que las cifras son estimaciones." },
  { q: "¿Dónde se guardan mis datos?", a: "En tu navegador. Tus costos y productos nunca salen de tu computadora y Netio no tiene servidores propios. Lo único que sale es el pago de PRO, que procesan ExtensionPay y Stripe, y solo si decides pagar." },
  { q: "¿Necesito RFC para usar Netio?", a: "No. Netio no te pide RFC ni cuenta de ningún tipo. Si tienes RFC registrado en Mercado Libre, Netio también te muestra las retenciones 2026 (IVA 8% e ISR 2.5%). Confirma con tu contador cómo aplican en tu caso." },
  { q: "¿En qué navegadores funciona?", a: "En Chrome de escritorio (Windows, Mac y Linux), incluidas las Chromebook. También debería funcionar en navegadores de escritorio basados en Chromium, como Edge o Brave, aunque lo probamos sobre todo en Chrome. No funciona en celulares, ni en Firefox o Safari." },
  { q: "¿Cómo funciona la prueba de PRO?", a: "Al instalar Netio tienes PRO completo por 7 días. No pide correo ni tarjeta, y la prueba corre en tu propio navegador. Cuando termina, sigues con el plan gratis y tus costos guardados." },
  { q: "¿Cuánto cuesta PRO y cómo lo cancelo?", a: `PRO cuesta ${mxn(SITE.pro.monthlyMXN)} MXN al mes o ${mxn(SITE.pro.yearlyMXN)} MXN al año. Para cancelar, abre las opciones de Netio y toca "Administrar suscripción / pagar". Ahí puedes cancelar cuando quieras. Más detalles en ${link("/soporte.html", "Soporte")}.` },
  { q: "¿Las cifras son exactas?", a: "Son estimaciones. El porcentaje exacto depende de tu categoría y de tu cuenta, y la fecha de las tarifas aparece en cada tarjeta. Úsalas para decidir con mejor información, no como cifra contable." }
];

const homeEs = {
  type: "home", path: "/", lang: "es-MX", utmSource: "landing",
  alternate: { es: "/", en: "/en/" },
  title: "Netio: extensión para vendedores de Mercado Libre México con ganancia real por venta",
  ogTitle: "Netio: la extensión para vendedores de Mercado Libre que muestra cuánto ganas de verdad",
  description: "Extensión para vendedores de Mercado Libre México: comisión, costo fijo, envío, retenciones y ganancia neta debajo del precio de cada publicación. Gratis en Chrome, con PRO opcional.",
  h1: "La extensión para vendedores de Mercado Libre que te dice cuánto ganas de verdad",
  answer: "Netio es una extensión gratis de Chrome para vendedores de Mercado Libre México. Debajo del precio de cada publicación muestra la comisión, el costo fijo, el envío, las retenciones de 2026 y lo que te queda por venta con tu costo. Si pierdes, lo ves en rojo antes de publicar.",
  breadcrumb: [], faq: homeFaq, related: [],
  ticket149: home149, ticket299: home299, h299net, h299margin, h149margin
};

const homeEn = {
  type: "home", path: "/en/", lang: "en", utmSource: "landing",
  alternate: { es: "/", en: "/en/" },
  title: "Netio: Chrome extension for Mercado Libre Mexico sellers with real profit per sale",
  ogTitle: "Netio: the extension for Mercado Libre sellers that shows what you really earn",
  ogAlt: "Netio: profit calculator for Mercado Libre Mexico sellers",
  description: "Chrome extension for Mercado Libre Mexico sellers: commission, fixed fee, shipping, withholdings and net profit under the price of every listing. Free on Chrome, optional PRO.",
  h1: "The extension for Mercado Libre sellers that tells you what you really earn",
  answer: "Netio is a free Chrome extension for Mercado Libre Mexico sellers. Under the price of every listing it shows the commission, the fixed fee, shipping, the 2026 withholdings and what you keep per sale after your cost. If you lose money, you see it in red before you list.",
  breadcrumb: [], related: [],
  faq: [
    { q: "Is Netio affiliated with Mercado Libre?", a: "No. Netio is an independent tool and has no relationship with Mercado Libre. It does not use a Mercado Libre API: the rates come from public seller guides and official help pages, so the figures are estimates." },
    { q: "Where is my data stored?", a: "In your browser. Your costs and products never leave your computer and Netio has no servers of its own. The only thing that goes out is the PRO payment, handled by ExtensionPay and Stripe, and only if you choose to pay." },
    { q: "Do I need an RFC to use Netio?", a: "No. Netio does not ask for an RFC or any kind of account. If you have an RFC registered with Mercado Libre, Netio also shows the 2026 withholdings (8% IVA and 2.5% ISR). Confirm with your accountant how they apply to you." },
    { q: "Which browsers does it work in?", a: "In desktop Chrome (Windows, Mac and Linux), including Chromebook. It should also work in desktop Chromium-based browsers such as Edge or Brave, though we mostly test on Chrome. It does not work on phones, or in Firefox or Safari." },
    { q: "How does the PRO trial work?", a: "When you install Netio you get full PRO for 7 days. It asks for no email or card, and the trial runs in your own browser. When it ends, you keep the free plan and your saved costs." },
    { q: "How much is PRO and how do I cancel?", a: `PRO costs ${mxn(SITE.pro.monthlyMXN)} MXN per month or ${mxn(SITE.pro.yearlyMXN)} MXN per year. To cancel, open Netio's options and tap "Manage subscription / pay". You can cancel there at any time. More details on the ${link("/soporte.html#en", "Support page")}.` },
    { q: "Are the numbers exact?", a: "They are estimates. The exact percentage depends on your category and account, and the date of the rates appears on every card. Use them to decide with better information, not as an accounting figure." }
  ],
  ticket149: home149, ticket299: home299, h299net, h299margin, h149margin
};

export const PAGES = [
  homeEs, homeEn, calcPage,
  hubGuias, guiaCuantoCobra, guiaComisiones, guiaEnvio, guiaFull, guiaClasicaPremium, guiaRetenciones,
  hubComo, comoGanancia, comoPrecio, comoPerder, comoEnvio,
  hubComparar, cmpExcel, cmpSimulador, cmpMargenReal
];

// Pages that already exist as hand-written HTML in landing/ and only get the
// shared header/footer injected by the build (content untouched).
export const LEGACY = [
  { file: "privacidad.html", lang: "es-MX" },
  { file: "soporte.html", lang: "es-MX" },
  { file: "gracias.html", lang: "es-MX", noindex: true },
  { file: "404.html", lang: "es-MX", noindex: true },
  { file: "adios.html", lang: "es-MX", noindex: true, footerOnly: true }
];

export { example, shippingTable, ratesTable, fixedText };
