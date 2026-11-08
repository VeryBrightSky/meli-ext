// One command, one release folder: the CWS zip plus the store-listing text
// and images rendered from store/templates with the SAME version, name and
// prices the build stamped into the manifest, so they can never drift.
//
//   node scripts/release.mjs             build + render release/netio-<version>/
//   node scripts/release.mjs --publish   same, then upload + submit the zip to
//                                        the Chrome Web Store (scripts/cws-publish.mjs)
//
// What's new comes from docs/RELEASE-<version>.md:
//   "## Novedades (Chrome Web Store)"              -> {{whatsNewEs}}
//   "## What's new (Chrome Web Store, English)"    -> {{whatsNewEn}}
// The build fails if the file or either section is missing.
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publish = process.argv.includes("--publish");

function fail(msg) {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
}

// 1. Build the release zip (stamps manifest.json, strips QA overrides, zips dist/).
execFileSync(process.execPath, [join(root, "scripts/build.mjs"), "--release"], {
  stdio: "inherit",
  env: process.env
});

// 2. Branding (classic script that assigns globalThis.EXT_BRAND).
new Function(readFileSync(join(root, "src/config/branding.js"), "utf8"))();
const BRAND = globalThis.EXT_BRAND;
const version = BRAND.version;
const baseName = `${BRAND.name.toLowerCase().replaceAll(" ", "-")}-${version}`;
const zipName = `${baseName}.zip`;

// build.mjs writes a telemetry-enabled zip under release/ with another name;
// the plain dormant zip lives in the repo root.
const telemetryZip = join(root, "release", `${baseName}-telemetry.zip`);
const hasTelemetry = (process.env.NETIO_TELEMETRY_URL ?? "").trim() && (process.env.NETIO_TELEMETRY_KEY ?? "").trim();
const builtZip = hasTelemetry ? telemetryZip : join(root, zipName);
if (!existsSync(builtZip)) fail(`expected zip not found: ${builtZip}`);

// 3. Version consistency: branding, package.json, stamped manifest, dist manifest.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const distManifest = JSON.parse(readFileSync(join(root, "dist/manifest.json"), "utf8"));
for (const [where, v] of [
  ["package.json", pkg.version],
  ["manifest.json", manifest.version],
  ["dist/manifest.json", distManifest.version]
]) {
  if (v !== version) fail(`version mismatch: branding.js says ${version}, ${where} says ${v}`);
}
if (distManifest.name !== BRAND.storeName) fail(`dist manifest name is "${distManifest.name}", expected the store name`);
if (distManifest.description !== BRAND.description) fail("dist manifest description differs from BRAND.description");

// 4. What's new from docs/RELEASE-<version>.md.
const notesPath = join(root, "docs", `RELEASE-${version}.md`);
if (!existsSync(notesPath)) {
  fail(`docs/RELEASE-${version}.md is missing. Create it with the sections "## Novedades (Chrome Web Store)" and "## What's new (Chrome Web Store, English)".`);
}
const notes = readFileSync(notesPath, "utf8");
function section(heading) {
  const lines = notes.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) fail(`docs/RELEASE-${version}.md has no section "${heading}"`);
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join("\n").trim();
  if (!body) fail(`section "${heading}" in docs/RELEASE-${version}.md is empty`);
  return body;
}
const whatsNewEs = section("## Novedades (Chrome Web Store)");
const whatsNewEn = section("## What's new (Chrome Web Store, English)");

// 5. Render templates.
const outDir = join(root, "release", baseName);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "assets"), { recursive: true });

const vars = {
  version,
  storeName: BRAND.storeName,
  shortDescription: BRAND.description,
  monthly: String(BRAND.prices.monthly),
  yearly: String(BRAND.prices.yearly),
  whatsNewEs,
  whatsNewEn,
  zipName,
  extensionId: new URL(BRAND.storeUrl).pathname.split("/").filter(Boolean).pop(),
  titleChars: String([...BRAND.storeName].length),
  shortChars: String([...BRAND.description].length),
  date: new Date().toISOString().slice(0, 10),
  // Counts are filled after a first pass (they depend on the rendered text).
  descEsChars: "", descEnChars: "", whatsNewEsChars: "", whatsNewEnChars: ""
};

function render(template, values) {
  const out = template.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in values)) fail(`unknown placeholder ${m}`);
    return values[key];
  });
  const left = out.match(/\{\{\w+\}\}/g);
  if (left) fail(`unrendered placeholders: ${left.join(", ")}`);
  return out;
}

// First fenced block after a heading that starts with `headingPrefix`.
function codeBlockAfter(md, headingPrefix) {
  const idx = md.indexOf(headingPrefix);
  if (idx < 0) fail(`heading "${headingPrefix}" not found in a rendered listing`);
  const m = md.slice(idx).match(/```\n([\s\S]*?)\n```/);
  if (!m) fail(`no code block after "${headingPrefix}"`);
  return m[1];
}

const templatesDir = join(root, "store/templates");
const templateNames = readdirSync(templatesDir).filter((f) => f.endsWith(".md"));
const read = (n) => readFileSync(join(templatesDir, n), "utf8");

// Pass 1: listings, to measure the description blocks.
const es1 = render(read("listing-es.md"), { ...vars });
const en1 = render(read("listing-en.md"), { ...vars });
const descEs = codeBlockAfter(es1, "## Descripción larga");
const descEn = codeBlockAfter(en1, "## Long description");
const count = (s) => [...s].length;
const fmt = (n) => n.toLocaleString("en-US");
vars.descEsChars = fmt(count(descEs));
vars.descEnChars = fmt(count(descEn));
vars.whatsNewEsChars = fmt(count(whatsNewEs));
vars.whatsNewEnChars = fmt(count(whatsNewEn));

// Pass 2: everything, with counts.
const rendered = {};
for (const name of templateNames) rendered[name] = render(read(name), vars);

// 6. Validation.
const LIMITS = { description: 16000, short: 132, title: 75 };
const problems = [];
if (count(descEs) > LIMITS.description) problems.push(`ES description is ${count(descEs)} chars (limit ${LIMITS.description})`);
if (count(descEn) > LIMITS.description) problems.push(`EN description is ${count(descEn)} chars (limit ${LIMITS.description})`);
if (count(BRAND.description) > LIMITS.short) problems.push(`short description is ${count(BRAND.description)} chars (limit ${LIMITS.short})`);
if (count(BRAND.storeName) > LIMITS.title) problems.push(`store name is ${count(BRAND.storeName)} chars (limit ${LIMITS.title})`);
for (const [name, text] of Object.entries(rendered)) {
  if (text.includes("—")) problems.push(`${name} contains an em dash`);
  if (!text.includes(version)) problems.push(`${name} never mentions version ${version}`);
  const stale = text.match(/\b1\.\d+\.\d+\b/g)?.filter((v) => v !== version) ?? [];
  if (stale.length) problems.push(`${name} mentions other versions: ${[...new Set(stale)].join(", ")}`);
}
for (const [label, text] of [["whatsNewEs", whatsNewEs], ["whatsNewEn", whatsNewEn], ["storeName", BRAND.storeName], ["description", BRAND.description]]) {
  if (text.includes("—")) problems.push(`${label} contains an em dash`);
}
const trialEs = "empieza cuando guardas tu primer costo";
const trialEn = "starts when you save your first cost";
if (!descEs.includes(trialEs)) problems.push(`ES description lacks "${trialEs}"`);
if (!descEn.includes(trialEn)) problems.push(`EN description lacks "${trialEn}"`);
if (problems.length) {
  for (const p of problems) console.error(`FATAL: ${p}`);
  process.exit(1);
}

// 7. Write the folder.
for (const [name, text] of Object.entries(rendered)) writeFileSync(join(outDir, name), text);
cpSync(builtZip, join(outDir, zipName));
for (const f of readdirSync(join(root, "store/assets"))) {
  cpSync(join(root, "store/assets", f), join(outDir, "assets", f));
}

const readme = `Netio ${version}: carpeta de release para la Chrome Web Store
Generada el ${vars.date} por "npm run release". Todo sale del mismo build: ${zipName} y estos textos llevan la misma versión, nombre y precios.

QUÉ VA DÓNDE EN EL PANEL (https://chrome.google.com/webstore/devconsole, item ${vars.extensionId})

1. Package > Upload new package: ${zipName}.
   Automático con "npm run release:publish" cuando existe .cws.env (ver store/SETUP-CWS-API.md). Sin credenciales, súbelo a mano.

2. Store listing (idioma: Español Latinoamérica):
   - Título: NO se escribe. Lo toma del zip (manifest name): "${BRAND.storeName}".
   - Descripción corta: NO se escribe. También viene del zip (manifest description): "${BRAND.description}".
   - Descripción: pega el bloque de "Descripción larga" de listing-es.md, tal cual, sin Markdown.
   - Categoría: Shopping. Página principal, soporte y correo: tabla "Campos del formulario" de listing-es.md.
   - Capturas: assets/screenshot-1.png a assets/screenshot-5.png, en ese orden (1280x800).
   - Mosaico promocional pequeño (440x280): assets/promo-tile-440x280.png.
   - Novedades ("What's new"): la Chrome Web Store NO tiene ese campo. El bloque "Novedades" de listing-es.md es para las notas de la versión, la landing o el correo de lanzamiento.

3. Store listing > Add language > English: pega el bloque "Long description" de listing-en.md. Las imágenes se pueden repetir.

4. Privacy: pega los textos de privacy-tab.md (propósito único, justificación de cada permiso, "No remote code", casillas de datos: solo "Personally identifiable information" y "Financial and payment information", las tres certificaciones). La URL de la política va en Account.

5. Distribution: Free, Public, regiones: México. Luego "Submit for review".
   Con "npm run release:publish" el envío a revisión también es automático después de subir el zip.

Pasos detallados y en orden: UPLOAD-STEPS.md.

CONTEOS
- Título: ${vars.titleChars} / 75
- Descripción corta: ${vars.shortChars} / 132
- Descripción larga ES: ${vars.descEsChars} / 16,000
- Descripción larga EN: ${vars.descEnChars} / 16,000
- Novedades ES: ${vars.whatsNewEsChars}, EN: ${vars.whatsNewEnChars}
- Guiones largos: 0 en todos los archivos.
`;
if (readme.includes("—")) fail("README.txt contains an em dash");
writeFileSync(join(outDir, "README.txt"), readme);

console.log(`\nrelease/${baseName}/ ready:`);
for (const f of readdirSync(outDir)) console.log(`  ${f}`);
console.log(`\ncounts: title ${vars.titleChars}/75, short ${vars.shortChars}/132, description ES ${vars.descEsChars}/16,000, EN ${vars.descEnChars}/16,000, what's new ES ${vars.whatsNewEsChars}, EN ${vars.whatsNewEnChars}, em dashes 0`);

// 8. Optional: upload + submit through the Chrome Web Store API.
if (publish) {
  const { publishZip } = await import(pathToFileURL(join(root, "scripts/cws-publish.mjs")).href);
  try {
    await publishZip(join(outDir, zipName));
  } catch (err) {
    fail(`Chrome Web Store publish: ${err.message}`);
  }
} else {
  console.log(`\nzip upload: manual (run "npm run release:publish" with .cws.env to upload and submit automatically)`);
}
console.log(`\nreminder: git checkout manifest.json (the build stamped the store name into it)`);
