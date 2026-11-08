// Writes the calculator comparison CSV: web calculator vs extension path vs
// official expectation, for every case in calculator.test.mjs.
//   node tests/site/calculator-csv.mjs <out.csv>
import fs from "node:fs";
import { CASES, extensionResult } from "./calculator.test.mjs";

const WEB = globalThis.NETIO_WEB_CALC;
const outPath = process.argv[2] || "calculator-tests.csv";
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const num = (n) => (n === null || n === undefined ? "n/d" : String(n));
const range = (a, b) => (a === b ? num(a) : `${num(a)} a ${num(b)}`);

const rows = [["case", "inputs", "web_calculator_result", "extension_result", "official_expected", "match_web_vs_official", "match_web_vs_extension", "note"]];
for (const c of CASES) {
  const w = WEB.compute(c.in);
  const e = extensionResult(c.in);
  const x = c.exp;
  const inputs = `precio ${c.in.priceMXN}; costo ${c.in.costMXN}; cat ${c.in.categoryGroupId ?? "otra"}; ${c.in.listingTypeId}; rep ${c.in.reputation}; ${c.in.weightKg} kg; gratis ${c.in.offersFree ? "si" : "no"}; RFC ${c.in.hasRFC ? "si" : "no"}`;
  const webR = `comision ${range(w.commissionMinMXN, w.commissionMaxMXN)}; fijo ${w.fixedCostMXN}; envio ${w.shippingMXN}; retenciones ${w.withholdings.totalMXN}; neto ${range(w.netMinMXN, w.netMaxMXN)}; margen ${range(w.marginMinPct, w.marginMaxPct)}%`;
  const extR = `comision ${range(e.commissionMinMXN, e.commissionMaxMXN)}; fijo ${e.fixedCostMXN}; envio ${num(e.shippingMXN)}; retenciones ${e.withholdingsMXN}; neto ${range(e.netMinMXN, e.netMaxMXN)}`;
  const offR = `comision ${range(x.comMin ?? x.com, x.comMax ?? x.com)}; fijo ${x.fixed}; envio ${x.ship}; retenciones ${x.ret}; neto ${range(x.netMin ?? x.net, x.netMax ?? x.net)}; margen ${range(x.marginMin ?? x.margin, x.marginMax ?? x.margin)}%`;
  const matchOff = w.shippingMXN === x.ship && w.netMinMXN === (x.netMin ?? x.net) && w.netMaxMXN === (x.netMax ?? x.net) && w.withholdings.totalMXN === x.ret;
  const matchExt = e.shippingMXN === w.shippingMXN && e.netMinMXN === w.netMinMXN;
  let note = c.note;
  if (!matchExt) {
    if (e.shippingMXN === null) note += " | extension: weight outside its table (null); web uses the official row";
    else note += ` | extension shipping ${e.shippingMXN} vs official ${w.shippingMXN}`;
  }
  rows.push([c.id, inputs, webR, extR, offR, matchOff ? "yes" : "NO", matchExt ? "yes" : "NO", note]);
}
fs.writeFileSync(outPath, rows.map((r) => r.map(q).join(",")).join("\n") + "\n");
const mismatches = rows.slice(1).filter((r) => r[6] === "NO").length;
const offFail = rows.slice(1).filter((r) => r[5] === "NO").length;
console.log(`${outPath}: ${rows.length - 1} cases, ${offFail} differ from official, ${mismatches} differ from the extension`);
