// Renderers for the page types that are not plain articles: hubs, the
// calculator and the two homepages. Articles use templates.renderArticle.
import { SITE, storeLink, mxn, pct } from "./site.mjs";
import { renderArticle, renderShell, breadcrumbs, faqHtml, ctaHtml, relatedHtml, installButton, esc, ticket } from "./templates.mjs";
import { shippingTable, ratesTable, fixedText } from "./pages.mjs";

const TABLE = globalThis.MST_FEE_TABLE;
const SHIP = globalThis.NETIO_SHIPPING_OFFICIAL;
const O = SITE.official;
const CHECKED = SITE.checkedAtText;

export function renderPage(page, pages) {
  switch (page.type) {
    case "guide": case "howto": case "compare": return renderArticle(page, pages);
    case "hub": return renderHub(page, pages);
    case "calculator": return renderCalculator(page, pages);
    case "home": return page.lang === "en" ? renderHomeEn(page, pages) : renderHomeEs(page, pages);
    default: throw new Error(`unknown page type ${page.type} for ${page.path}`);
  }
}

// ---------------------------------------------------------------- hub
function renderHub(page, pages) {
  const items = pages.filter((p) => p.type === page.hubOf);
  const main = `  <main id="contenido" class="article">
    <div class="wrap">
      ${breadcrumbs(page)}
      <h1>${esc(page.h1)}</h1>
      <p class="answer">${page.answer}</p>
      <ul class="hub-list">${items.map((p) => `<li><a href="${p.path}"><b>${esc(p.h1)}</b><span>${esc(p.description)}</span></a></li>`).join("")}</ul>
      <p>Todas las cuentas de estas páginas se pueden abrir y cambiar en la <a href="/calculadora/">calculadora gratis</a>.</p>
      ${ctaHtml(page.utmSource)}
    </div>
  </main>`;
  return renderShell(page, pages, main);
}

// ---------------------------------------------------------------- calculator
function renderCalculator(page, pages) {
  const groups = TABLE.categoryGroups;
  const weightOptions = SHIP.weightsMaxKg.map((kg, i) => `<option value="${kg === Infinity ? 999 : kg}"${kg === 0.3 ? " selected" : ""}>${esc(SHIP.weightLabels[i])}</option>`).join("");
  const main = `  <main id="contenido" class="article calc-page">
    <div class="wrap">
      ${breadcrumbs(page)}
      <h1>${esc(page.h1)}</h1>
      <p class="answer">${page.answer}</p>
      <p class="updated">Es una estimación. El simulador de costos oficial, en tu cuenta de vendedor (Mi cuenta, Publicaciones, Simular costos), muestra los números exactos de tu cuenta. Netio no está afiliado a Mercado Libre.</p>

      <div class="calc" id="calculadora">
        <form class="form calc-form" id="calc-form" novalidate>
          <div class="field"><label for="precio">Precio de venta <span class="hint">MXN, con IVA, el que ve el comprador</span></label><input id="precio" name="precio" type="text" inputmode="decimal" placeholder="299" value="299" autocomplete="off" /></div>
          <div class="field"><label for="costo">Lo que te costó el producto <span class="hint">MXN por unidad</span></label><input id="costo" name="costo" type="text" inputmode="decimal" placeholder="120" value="120" autocomplete="off" /></div>
          <div class="field"><label for="cat">Categoría</label><select id="cat" name="cat"><option value="">No sé / otra (rango oficial)</option>${groups.map((x) => `<option value="${x.id}"${x.id === "tech" ? " selected" : ""}>${esc(x.label)} (${pct(x.classic.pctMin)} Clásica)</option>`).join("")}</select></div>
          <div class="field"><label for="tipo">Tipo de publicación</label><select id="tipo" name="tipo"><option value="classic" selected>Clásica</option><option value="premium">Premium (meses sin intereses)</option></select></div>
          <div class="field"><label for="rep">Tu reputación</label><select id="rep" name="rep"><option value="verde" selected>Verde o MercadoLíder (50% de descuento en envío)</option><option value="amarilla">Amarilla o sin reputación (40%)</option><option value="naranja">Naranja o roja (sin descuento)</option></select></div>
          <div class="field"><label for="peso">Peso del paquete <span class="hint">el mayor entre real y volumétrico</span></label><select id="peso" name="peso">${weightOptions}</select></div>
          <div class="field check" id="gratis-row"><label><input type="checkbox" id="gratis" name="gratis" /> Ofrezco envío gratis <span class="hint">solo cuenta abajo de $299; desde $299 es obligatorio</span></label></div>
          <div class="field"><label for="rfc">RFC registrado en Mercado Libre</label><select id="rfc" name="rfc"><option value="si" selected>Sí (retienen IVA 8% + ISR 2.5%)</option><option value="no">No (retienen IVA 16% + ISR 20%)</option></select></div>
          <noscript><p class="small">Esta calculadora necesita JavaScript para hacer la cuenta. Las tablas y las reglas están más abajo en esta página.</p></noscript>
        </form>

        <figure class="ticket calc-ticket" id="calc-result" hidden>
          <div class="ticket-head"><b>Tu cuenta</b><span>estimada, MXN</span></div>
          <dl>
            <div class="row"><dt>Precio de venta</dt><dd id="r-precio">$0.00</dd></div>
            <div class="row"><dt>Cargo por venta<small id="r-com-note"></small></dt><dd id="r-com">$0.00</dd></div>
            <div class="row"><dt>Costo fijo por unidad<small id="r-fijo-note"></small></dt><dd id="r-fijo">$0.00</dd></div>
            <div class="row"><dt>Envío que pagas tú<small id="r-envio-note"></small></dt><dd id="r-envio">$0.00</dd></div>
            <div class="row"><dt>Retenciones ISR + IVA<small id="r-ret-note"></small></dt><dd id="r-ret">$0.00</dd></div>
            <div class="row"><dt>Lo que te costó el producto</dt><dd id="r-costo">$0.00</dd></div>
            <div class="row"><dt>Te queda antes de retenciones</dt><dd id="r-pre">$0.00</dd></div>
          </dl>
          <div class="sum"><span class="k">Ganancia neta por venta</span><span class="v" id="r-neto">$0.00</span></div>
          <p class="verdict" id="r-verdict"></p>
          <figcaption>Margen sobre el precio: <b id="r-margen">0%</b>. Cargo por venta estimado por categoría (Mercado Libre muestra el exacto al publicar). Costo fijo: tramos según los datos de Netio. Envío: <a href="${O.envios}">tablas oficiales</a> consultadas el ${CHECKED}. Retenciones: <a href="${O.retenciones}">Mercado Pago</a>.</figcaption>
        </figure>
      </div>

      ${ctaHtml("calculadora")}

      <section class="calc-ref">
        <h2>Cómo hace la cuenta esta calculadora</h2>
        <ol class="steps">
          <li><div><h3>Cargo por venta</h3><p>Precio por el porcentaje de tu grupo de categoría. Mercado Libre publica solo el rango (Clásica 8% a 17%, Premium 11% a 21.5%, <a href="${O.cargoVenta}">página oficial</a>); los porcentajes por grupo son de fuentes secundarias y aparecen abajo.</p></div></li>
          <li><div><h3>Costo fijo por unidad</h3><p>Solo en Clásica y solo abajo de $299: ${fixedText}. Mercado Libre confirma que aplica solo abajo de $299; los montos por tramo son de los datos de Netio (fuentes secundarias, junio de 2026).</p></div></li>
          <li><div><h3>Envío</h3><p>Celda de la tabla oficial de tu reputación, por tramo de peso y tramo de precio. Desde $299 es obligatorio. Abajo de $299 solo si marcas que ofreces envío gratis, con la columna de envío gratis opcional (igual a la de $299 a $498.99).</p></div></li>
          <li><div><h3>Retenciones</h3><p>Sobre el precio sin IVA. Con RFC: 8% de IVA y 2.5% de ISR. Sin RFC: 16% y 20%. Acreditables en tu declaración.</p></div></li>
          <li><div><h3>Ganancia y margen</h3><p>Precio menos todo lo anterior menos tu costo. El margen es la ganancia entre el precio.</p></div></li>
        </ol>

        <h2>Porcentaje de cargo por venta que usa la calculadora</h2>
        ${ratesTable()}
        <p class="small">Fuente oficial del rango: <a href="${O.cargoVenta}">${O.cargoVenta}</a>. Consultado el ${CHECKED}.</p>

        <h2>Tabla oficial de envío para reputación verde (pesos más comunes)</h2>
        ${shippingTable("verde", 7)}
        <p>Las tablas completas de las tres reputaciones, hasta más de 350 kg, están en la <a href="/guias/costo-de-envio-mercado-libre-vendedor/">guía de costos de envío</a>. Fuente: <a href="${O.envios}">${O.envios}</a>, consultado el ${CHECKED}.</p>
      </section>

      ${faqHtml(page.faq)}
      ${relatedHtml(page, pages)}
    </div>
  </main>
  <script src="/calculadora/fee-table.js" defer></script>
  <script src="/calculadora/shipping-table.js" defer></script>
  <script src="/calculadora/calculator.js" defer></script>
  <script src="/calculadora/fee-source.js" defer></script>
  <script src="/calculadora/shipping-official.js" defer></script>
  <script src="/calculadora/calc-web.js" defer></script>`;
  const ld = {
    "@context": "https://schema.org", "@type": "WebApplication", name: "Calculadora de comisiones y ganancias de Mercado Libre México",
    url: `${SITE.baseUrl}/calculadora/`, applicationCategory: "FinanceApplication", operatingSystem: "Any", browserRequirements: "Requires JavaScript",
    offers: { "@type": "Offer", price: "0", priceCurrency: "MXN" }, inLanguage: "es-MX", publisher: { "@id": `${SITE.baseUrl}/#org` }
  };
  return renderShell(page, pages, main, [ld]);
}

// ---------------------------------------------------------------- home (es)
function renderHomeEs(page, pages) {
  const t149 = page.ticket149, t299 = page.ticket299;
  const guides = pages.filter((p) => p.type === "guide");
  const hows = pages.filter((p) => p.type === "howto");
  const main = `  <main id="contenido">
    <section class="hero">
      <div class="wrap hero-grid">
        <div>
          <p class="store"><i aria-hidden="true"></i> Ya disponible en Chrome Web Store</p>
          <h1>${esc(page.h1)}</h1>
          <p class="sub answer">${page.answer}</p>
          <div class="actions">
            ${installButton("landing")}
            <a class="btn btn-line" href="#ejemplo">Ver la cuenta completa</a>
          </div>
          <p class="fine">Sin cuenta y sin servidores: tus costos se quedan en tu navegador. Al instalar tienes PRO 7 días, sin tarjeta.</p>
        </div>
        ${ticket({
          title: "Funda para celular", subtitle: "Clásica, Tecnología",
          lines: [
            { label: "Precio de venta", value: mxn(149) },
            { label: "Comisión", note: `${pct(t149.pctMin)} de la categoría`, value: `-${mxn(t149.commissionMinMXN)}` },
            { label: "Costo fijo", note: "publicaciones de $149 a $298.99", value: `-${mxn(t149.fixedCostMXN)}` },
            { label: "Envío gratis que pagas tú", note: "hasta 300 g, reputación verde", value: `-${mxn(t149.shippingMXN)}` },
            { label: "Lo que te costó la funda", value: `-${mxn(55)}` }
          ],
          sum: { label: "Te queda por venta", value: mxn(t149.preWithholdingMinMXN) }, verdictCls: "loss",
          verdict: `Pierdes ${mxn(Math.abs(t149.preWithholdingMinMXN))} cada vez que se vende.`,
          caption: `Cifras estimadas con las tarifas que usa Netio (tablas de 2026, antes de retenciones). Tu porcentaje exacto depende de tu categoría y tu cuenta.`
        })}
      </div>
    </section>

    <section id="ejemplo">
      <div class="wrap">
        <h2>Producto de $149: así se va tu ganancia</h2>
        <div class="two">
          <p class="muted">Es el caso típico de los productos baratos. La comisión se ve chica, pero el costo fijo y el envío no dependen del precio, y en una funda de $149 pesan más que lo que te queda. Netio suma las cuatro cosas y te dice el número en rojo o en verde.</p>
          <div>
            <ul class="walk">
              <li><span>Precio al que la publicaste<small>Clásica, categoría Tecnología</small></span><span>${mxn(149)}</span></li>
              <li><span>Comisión de Mercado Libre<small>${pct(t149.pctMin)} en esta categoría</small></span><span class="loss-text">-${mxn(t149.commissionMinMXN)}</span></li>
              <li><span>Costo fijo por unidad<small>Clásica de $149 a $298.99: $37. De $99 a $148.99: $30. Menos de $99: $25</small></span><span class="loss-text">-${mxn(t149.fixedCostMXN)}</span></li>
              <li><span>Envío gratis que ofreces<small>Paquete de hasta 300 g, reputación verde, tabla oficial. Abajo de $299 lo pagas tú si lo ofreces</small></span><span class="loss-text">-${mxn(t149.shippingMXN)}</span></li>
              <li><span>Lo que pagaste por la funda</span><span class="loss-text">-${mxn(55)}</span></li>
              <li><span><b>Te queda</b></span><span class="loss-text">${mxn(t149.preWithholdingMinMXN)}</span></li>
            </ul>
            <p class="muted">Entre comisión, costo fijo y envío se van ${mxn(t149.commissionMinMXN + t149.fixedCostMXN + t149.shippingMXN)} de los $149, el ${Math.round(((t149.commissionMinMXN + t149.fixedCostMXN + t149.shippingMXN) / 149) * 100)}%, y encima pones ${mxn(Math.abs(t149.preWithholdingMinMXN))} de tu bolsa. Ahora el mismo producto a $299:</p>
          </div>
        </div>

        <div class="compare">
          ${ticket({ title: "A $149", subtitle: "como está hoy",
            lines: [
              { label: `Comisión ${pct(t149.pctMin)}`, value: `-${mxn(t149.commissionMinMXN)}` },
              { label: "Costo fijo", value: `-${mxn(t149.fixedCostMXN)}` },
              { label: "Envío (lo pagas todo)", value: `-${mxn(t149.shippingMXN)}` },
              { label: "Tu costo", value: `-${mxn(55)}` }
            ], sum: { label: "Te queda", value: mxn(t149.preWithholdingMinMXN) }, verdictCls: "loss", verdict: `Margen: ${page.h149margin}%` })}
          ${ticket({ title: "A $299", subtitle: "precio mínimo para envío gratis",
            lines: [
              { label: `Comisión ${pct(t299.pctMin)}`, value: `-${mxn(t299.commissionMinMXN)}` },
              { label: "Costo fijo", note: "desde $299 ya no aplica", value: mxn(0) },
              { label: "Envío", note: "tabla oficial verde, ya con el 50% de descuento", value: `-${mxn(t299.shippingMXN)}` },
              { label: "Tu costo", value: `-${mxn(55)}` }
            ], sum: { label: "Te queda", value: mxn(page.h299net) }, verdictCls: "profit", verdict: `Margen: ${page.h299margin}%` })}
        </div>
        <p class="small" style="margin-top:18px">No te decimos a qué precio vender ni qué vender. Te decimos qué número sale con cada precio, para que lo decidas tú con la cuenta hecha. Envío según las <a href="${O.envios}">tablas oficiales de Mercado Envíos</a> consultadas el ${CHECKED}; retenciones aparte.</p>
        <p><a class="btn btn-line" href="/calculadora/?precio=149&amp;costo=55&amp;cat=tech&amp;tipo=clasica&amp;rep=verde&amp;peso=0.3&amp;gratis=si&amp;rfc=si">Cambia los números en la calculadora</a></p>
      </div>
    </section>

    <section id="como-funciona">
      <div class="wrap">
        <h2>Cómo funciona</h2>
        <ol class="steps">
          <li><div><h3>Instala Netio desde Chrome Web Store</h3><p>Es gratis. Los primeros 7 días tienes PRO completo, sin correo y sin tarjeta.</p></div></li>
          <li><div><h3>Abre una publicación o una búsqueda en Mercado Libre México</h3><p>La tarjeta aparece debajo del precio, con la comisión, el costo fijo y el envío ya estimados. En los resultados de búsqueda ves el neto de cada producto.</p></div></li>
          <li><div><h3>Escribe lo que te costó el producto</h3><p>Netio te da tu ganancia, tu margen y el precio mínimo para no perder. Si sale en rojo, lo ves antes de publicar, no cuando llega el estado de cuenta.</p></div></li>
        </ol>
      </div>
    </section>

    <section id="recursos">
      <div class="wrap">
        <h2>Haz la cuenta sin instalar nada</h2>
        <p class="muted">La <a href="/calculadora/">calculadora gratis</a> usa las mismas tablas que la extensión: cargo por venta por categoría, costo fijo, envío oficial por reputación y peso, y retenciones de 2026. Y estas guías explican cada cargo con cifras de las páginas oficiales:</p>
        <div class="res-cols">
          <div><h3>Guías de costos</h3><ul>${guides.map((p) => `<li><a href="${p.path}">${esc(p.h1)}</a></li>`).join("")}</ul></div>
          <div><h3>Paso a paso</h3><ul>${hows.map((p) => `<li><a href="${p.path}">${esc(p.h1)}</a></li>`).join("")}</ul></div>
        </div>
      </div>
    </section>

    <section id="planes">
      <div class="wrap">
        <h2>Lo esencial es gratis. PRO es para afinar cada precio.</h2>
        <table class="plans">
          <thead>
            <tr>
              <th scope="col"><span class="sr">Función</span></th>
              <th scope="col">Gratis<small>para siempre</small></th>
              <th scope="col">PRO<small>${mxn(SITE.pro.monthlyMXN)} MXN al mes o ${mxn(SITE.pro.yearlyMXN)} al año</small></th>
            </tr>
          </thead>
          <tbody>
            <tr><th scope="row">Comisión estimada por categoría, Clásica y Premium</th><td class="y">Sí</td><td class="y">Sí</td></tr>
            <tr><th scope="row">Costo fijo de los productos baratos</th><td class="y">Sí</td><td class="y">Sí</td></tr>
            <tr><th scope="row">Tu envío, Mercado Envíos Full y descuento por reputación</th><td class="y">Sí</td><td class="y">Sí</td></tr>
            <tr><th scope="row">Retenciones 2026 (IVA 8% e ISR 2.5%)</th><td class="y">Sí</td><td class="y">Sí</td></tr>
            <tr><th scope="row">Ganancia, margen y precio mínimo para no perder</th><td class="y">Sí</td><td class="y">Sí</td></tr>
            <tr><th scope="row">Aviso en rojo cuando pierdes dinero</th><td class="y">Sí</td><td class="y">Sí</td></tr>
            <tr><th scope="row">Vista previa del Radar en búsquedas</th><td class="y">Sí</td><td class="y">Sí</td></tr>
            <tr><th scope="row">Precio objetivo para el margen que quieres</th><td class="n">No</td><td class="y">Sí</td></tr>
            <tr><th scope="row">Punto dulce: cuándo subir el precio deja más dinero</th><td class="n">No</td><td class="y">Sí</td></tr>
            <tr><th scope="row">Calculadora de meses sin intereses</th><td class="n">No</td><td class="y">Sí</td></tr>
            <tr><th scope="row">Clásica vs Premium, lado a lado</th><td class="n">No</td><td class="y">Sí</td></tr>
            <tr><th scope="row">Radar de Rentabilidad completo en búsquedas, con filtro y CSV</th><td class="n">No</td><td class="y">Sí</td></tr>
            <tr><th scope="row">Tablero de Ganancias con todos tus productos</th><td class="n">No</td><td class="y">Sí</td></tr>
          </tbody>
        </table>
        <div class="plan-note">
          <p><b>Prueba PRO 7 días sin tarjeta.</b> Empieza sola al instalar. Si no pagas, te quedas con el plan gratis y con tus costos guardados. Cancela cuando quieras desde las opciones de Netio.</p>
        </div>
        <p style="margin-top:22px">${installButton("landing", "Probar PRO gratis")}</p>
      </div>
    </section>

    <section id="privacidad">
      <div class="wrap">
        <h2>Tus números son tuyos</h2>
        <div class="quiet">
          <div><b>Sin servidores</b><p>Tus costos y productos se guardan en tu navegador. No tenemos dónde más guardarlos.</p></div>
          <div><b>Sin seguimiento</b><p>Sin cookies ni analítica. No enviamos enlaces, precios ni datos de tus publicaciones.</p></div>
          <div><b>Pago con Stripe</b><p>Si pagas PRO, ExtensionPay y Stripe procesan el cobro. Nosotros nunca vemos tu tarjeta. <a href="/privacidad.html">Política de privacidad</a>.</p></div>
        </div>
      </div>
    </section>

    ${faqHtml(page.faq).replace('class="faq-sec"', 'class="faq-sec wrap"')}

    <section id="quien">
      <div class="wrap who">
        <h2>Quién hace Netio</h2>
        <p class="muted">Netio lo hace un equipo chico, de forma independiente, que se cansó de hacer la cuenta en una hoja de cálculo cada vez que cambiaba un precio. No somos Mercado Libre y no trabajamos para ellos. Si algo no cuadra, <a href="/soporte.html">escríbenos</a> y lo revisamos.</p>
      </div>
    </section>

    <section class="close">
      <div class="wrap">
        <div>
          <h2>Revisa tu próxima publicación antes de subirla.</h2>
          <p class="muted" style="margin:0">Gratis, en Chrome Web Store. Tarda menos que abrir la hoja de cálculo.</p>
        </div>
        ${installButton("landing")}
      </div>
    </section>
  </main>`;
  return renderShell(page, pages, main);
}

// ---------------------------------------------------------------- home (en)
function renderHomeEn(page, pages) {
  const t149 = page.ticket149, t299 = page.ticket299;
  const guides = pages.filter((p) => p.type === "guide");
  const hows = pages.filter((p) => p.type === "howto");
  const main = `  <main id="contenido">
    <section class="hero">
      <div class="wrap hero-grid">
        <div>
          <p class="store"><i aria-hidden="true"></i> Now on the Chrome Web Store</p>
          <h1>${esc(page.h1)}</h1>
          <p class="sub answer">${page.answer}</p>
          <div class="actions">
            ${installButton("landing", "Add to Chrome, it's free")}
            <a class="btn btn-line" href="#ejemplo">See the full math</a>
          </div>
          <p class="fine">No account, no servers: your costs stay in your browser. You get PRO for 7 days on install, no card.</p>
        </div>
        ${ticket({
          title: "Phone case", subtitle: "Clásica, Technology",
          lines: [
            { label: "Sale price", value: mxn(149) },
            { label: "Commission", note: `${pct(t149.pctMin)} for the category`, value: `-${mxn(t149.commissionMinMXN)}` },
            { label: "Fixed fee", note: "listings from $149 to $298.99", value: `-${mxn(t149.fixedCostMXN)}` },
            { label: "Free shipping you pay", note: "up to 300 g, green reputation", value: `-${mxn(t149.shippingMXN)}` },
            { label: "What the case cost you", value: `-${mxn(55)}` }
          ],
          sum: { label: "You keep per sale", value: mxn(t149.preWithholdingMinMXN) }, verdictCls: "loss",
          verdict: `You lose ${mxn(Math.abs(t149.preWithholdingMinMXN))} every time it sells.`,
          caption: "Estimates with the rates Netio uses (2026 tables, before withholdings). Your exact percentage depends on your category and account."
        })}
      </div>
    </section>

    <section id="ejemplo">
      <div class="wrap">
        <h2>A $149 product: where your profit goes</h2>
        <div class="two">
          <p class="muted">This is the typical case for cheap products. The commission looks small, but the fixed fee and shipping do not depend on the price, and on a $149 case they weigh more than what you keep. Netio adds up all four and gives you the number in red or green.</p>
          <div>
            <ul class="walk">
              <li><span>Listed price<small>Clásica, Technology category</small></span><span>${mxn(149)}</span></li>
              <li><span>Mercado Libre commission<small>${pct(t149.pctMin)} in this category</small></span><span class="loss-text">-${mxn(t149.commissionMinMXN)}</span></li>
              <li><span>Fixed fee per unit<small>Clásica from $149 to $298.99: $37. From $99 to $148.99: $30. Under $99: $25</small></span><span class="loss-text">-${mxn(t149.fixedCostMXN)}</span></li>
              <li><span>Free shipping you offer<small>Package up to 300 g, green reputation, official table. Under $299 you pay it if you offer it</small></span><span class="loss-text">-${mxn(t149.shippingMXN)}</span></li>
              <li><span>What you paid for the case</span><span class="loss-text">-${mxn(55)}</span></li>
              <li><span><b>You keep</b></span><span class="loss-text">${mxn(t149.preWithholdingMinMXN)}</span></li>
            </ul>
            <p class="muted">Commission, fixed fee and shipping take ${mxn(t149.commissionMinMXN + t149.fixedCostMXN + t149.shippingMXN)} of the $149, ${Math.round(((t149.commissionMinMXN + t149.fixedCostMXN + t149.shippingMXN) / 149) * 100)}%, and you still put in ${mxn(Math.abs(t149.preWithholdingMinMXN))} of your own. Now the same product at $299:</p>
          </div>
        </div>
        <div class="compare">
          ${ticket({ title: "At $149", subtitle: "as it is today",
            lines: [
              { label: `Commission ${pct(t149.pctMin)}`, value: `-${mxn(t149.commissionMinMXN)}` },
              { label: "Fixed fee", value: `-${mxn(t149.fixedCostMXN)}` },
              { label: "Shipping (you pay it all)", value: `-${mxn(t149.shippingMXN)}` },
              { label: "Your cost", value: `-${mxn(55)}` }
            ], sum: { label: "You keep", value: mxn(t149.preWithholdingMinMXN) }, verdictCls: "loss", verdict: `Margin: ${page.h149margin}%` })}
          ${ticket({ title: "At $299", subtitle: "minimum price for free shipping",
            lines: [
              { label: `Commission ${pct(t299.pctMin)}`, value: `-${mxn(t299.commissionMinMXN)}` },
              { label: "Fixed fee", note: "no longer applies from $299", value: mxn(0) },
              { label: "Shipping", note: "official green table, 50% discount included", value: `-${mxn(t299.shippingMXN)}` },
              { label: "Your cost", value: `-${mxn(55)}` }
            ], sum: { label: "You keep", value: mxn(page.h299net) }, verdictCls: "profit", verdict: `Margin: ${page.h299margin}%` })}
        </div>
        <p class="small" style="margin-top:18px">We do not tell you what price to charge or what to sell. We tell you what number comes out at each price, so you decide with the math done. Shipping from the <a href="${O.envios}">official Mercado Envíos tables</a> checked on October 30, 2026; withholdings not included here.</p>
        <p><a class="btn btn-line" href="/calculadora/?precio=149&amp;costo=55&amp;cat=tech&amp;tipo=clasica&amp;rep=verde&amp;peso=0.3&amp;gratis=si&amp;rfc=si">Change the numbers in the calculator (Spanish)</a></p>
      </div>
    </section>

    <section id="como-funciona">
      <div class="wrap">
        <h2>How it works</h2>
        <ol class="steps">
          <li><div><h3>Install Netio from the Chrome Web Store</h3><p>It is free. For the first 7 days you have full PRO, no email and no card.</p></div></li>
          <li><div><h3>Open a listing or a search on Mercado Libre Mexico</h3><p>The card appears under the price, with commission, fixed fee and shipping already estimated. On search results you see the net of every product.</p></div></li>
          <li><div><h3>Type what the product cost you</h3><p>Netio gives you your profit, your margin and the minimum price to break even. If it is red, you see it before you list, not when the statement arrives.</p></div></li>
        </ol>
      </div>
    </section>

    <section id="recursos">
      <div class="wrap">
        <h2>Do the math without installing anything</h2>
        <p class="muted">The <a href="/calculadora/">free calculator</a> (Spanish) uses the same tables as the extension. These guides (Spanish) explain each fee with figures from the official pages:</p>
        <div class="res-cols">
          <div><h3>Fee guides</h3><ul>${guides.map((p) => `<li><a href="${p.path}" hreflang="es-MX" lang="es-MX">${esc(p.h1)}</a></li>`).join("")}</ul></div>
          <div><h3>Step by step</h3><ul>${hows.map((p) => `<li><a href="${p.path}" hreflang="es-MX" lang="es-MX">${esc(p.h1)}</a></li>`).join("")}</ul></div>
        </div>
      </div>
    </section>

    <section id="planes">
      <div class="wrap">
        <h2>The essentials are free. PRO is for tuning every price.</h2>
        <table class="plans">
          <thead>
            <tr>
              <th scope="col"><span class="sr">Feature</span></th>
              <th scope="col">Free<small>forever</small></th>
              <th scope="col">PRO<small>${mxn(SITE.pro.monthlyMXN)} MXN per month or ${mxn(SITE.pro.yearlyMXN)} per year</small></th>
            </tr>
          </thead>
          <tbody>
            <tr><th scope="row">Estimated commission by category, Clásica and Premium</th><td class="y">Yes</td><td class="y">Yes</td></tr>
            <tr><th scope="row">Fixed fee on cheap products</th><td class="y">Yes</td><td class="y">Yes</td></tr>
            <tr><th scope="row">Your shipping, Mercado Envíos Full and reputation discount</th><td class="y">Yes</td><td class="y">Yes</td></tr>
            <tr><th scope="row">2026 withholdings (8% IVA and 2.5% ISR)</th><td class="y">Yes</td><td class="y">Yes</td></tr>
            <tr><th scope="row">Profit, margin and break-even price</th><td class="y">Yes</td><td class="y">Yes</td></tr>
            <tr><th scope="row">Red alert when you lose money</th><td class="y">Yes</td><td class="y">Yes</td></tr>
            <tr><th scope="row">Radar preview on search results</th><td class="y">Yes</td><td class="y">Yes</td></tr>
            <tr><th scope="row">Target price for the margin you want</th><td class="n">No</td><td class="y">Yes</td></tr>
            <tr><th scope="row">Sweet spot: when raising the price leaves more money</th><td class="n">No</td><td class="y">Yes</td></tr>
            <tr><th scope="row">Interest-free installments (MSI) calculator</th><td class="n">No</td><td class="y">Yes</td></tr>
            <tr><th scope="row">Clásica vs Premium, side by side</th><td class="n">No</td><td class="y">Yes</td></tr>
            <tr><th scope="row">Full Profitability Radar on searches, with filter and CSV</th><td class="n">No</td><td class="y">Yes</td></tr>
            <tr><th scope="row">Profit Dashboard with all your products</th><td class="n">No</td><td class="y">Yes</td></tr>
          </tbody>
        </table>
        <div class="plan-note">
          <p><b>Try PRO for 7 days, no card.</b> It starts on install. If you do not pay, you keep the free plan and your saved costs. Cancel any time from Netio's options.</p>
        </div>
        <p style="margin-top:22px">${installButton("landing", "Try PRO free")}</p>
      </div>
    </section>

    <section id="privacidad">
      <div class="wrap">
        <h2>Your numbers are yours</h2>
        <div class="quiet">
          <div><b>No servers</b><p>Your costs and products are stored in your browser. We have nowhere else to keep them.</p></div>
          <div><b>No tracking</b><p>No cookies, no analytics. We do not send links, prices or data from your listings.</p></div>
          <div><b>Payment via Stripe</b><p>If you pay for PRO, ExtensionPay and Stripe process the charge. We never see your card. <a href="/privacidad.html#en">Privacy policy</a>.</p></div>
        </div>
      </div>
    </section>

    ${faqHtml(page.faq).replace('class="faq-sec"', 'class="faq-sec wrap"').replace("Preguntas frecuentes", "Frequently asked questions")}

    <section id="quien">
      <div class="wrap who">
        <h2>Who makes Netio</h2>
        <p class="muted">Netio is made by a small independent team that got tired of doing the math in a spreadsheet every time a price changed. We are not Mercado Libre and we do not work for them. If something does not add up, <a href="/soporte.html#en">write to us</a> and we will look into it.</p>
      </div>
    </section>

    <section class="close">
      <div class="wrap">
        <div>
          <h2>Check your next listing before you publish it.</h2>
          <p class="muted" style="margin:0">Free, on the Chrome Web Store. Faster than opening the spreadsheet.</p>
        </div>
        ${installButton("landing", "Add to Chrome, it's free")}
      </div>
    </section>
  </main>`;
  return renderShell(page, pages, main);
}
