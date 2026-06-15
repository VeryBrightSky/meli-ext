// i18n correctness + anti-regression lint.
//   - the self-hosted i18n layer resolves Spanish-first and substitutes
//   - es_419 values are real Spanish, not English copies
//   - render code never hardcodes user-facing strings (everything via T())
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(root, p), "utf8");

// Load locale-data.js + i18n.js with a chrome stub for a given UI language.
function loadI18n(uiLang) {
  const prev = globalThis.chrome;
  globalThis.chrome =
    uiLang === undefined
      ? undefined
      : { i18n: { getUILanguage: () => uiLang, getMessage: () => "" } };
  new Function(read("src/config/locale-data.js"))();
  new Function(read("src/config/i18n.js"))();
  const i18n = globalThis.MST_I18N;
  globalThis.chrome = prev;
  return i18n;
}

test("i18n is Spanish-first: only English UI gets English", () => {
  assert.equal(loadI18n("es-419").locale, "es_419");
  assert.equal(loadI18n("es").locale, "es_419");
  assert.equal(loadI18n("es-MX").locale, "es_419");
  assert.equal(loadI18n("fr").locale, "es_419"); // unknown → Spanish default
  assert.equal(loadI18n("").locale, "es_419");
  assert.equal(loadI18n(undefined).locale, "es_419"); // no chrome → Spanish
  assert.equal(loadI18n("en").locale, "en");
  assert.equal(loadI18n("en-US").locale, "en");
  assert.equal(loadI18n("en-GB").locale, "en");
});

test("i18n returns the localized string for the active locale", () => {
  const es = loadI18n("es-419");
  assert.equal(es.t("rowPrice"), "Precio de venta");
  assert.equal(es.t("rowNet"), "Recibes aprox.");
  assert.equal(es.t("rowCategory"), "Categoría");
  assert.equal(es.t("rowTargetPrice"), "Precio objetivo");
  const en = loadI18n("en");
  assert.equal(en.t("rowPrice"), "Sale price");
});

test("i18n substitutes $1/$2 and unescapes $$", () => {
  const es = loadI18n("es-419");
  assert.equal(es.applySubs("a $1 b $2", ["X", "Y"]), "a X b Y");
  assert.equal(es.applySubs("precio < $$299", []), "precio < $299");
  assert.equal(es.t("rowCommission", ["10%"]), "Comisión por venta (10%)");
  assert.equal(es.t("upsellMonthly"), "$89 MXN/mes"); // $$89 → $89
  assert.equal(es.applySubs("$1 missing", []), " missing"); // absent sub → empty
});

test("i18n falls back to the key when missing (visible, never blank/English)", () => {
  const es = loadI18n("es-419");
  assert.equal(es.t("totallyUnknownKey"), "totallyUnknownKey");
});

test("es_419 values are real Spanish, not English copies", () => {
  const es = JSON.parse(read("_locales/es_419/messages.json"));
  const en = JSON.parse(read("_locales/en/messages.json"));
  // Keys that are legitimately identical across locales (brand/loanwords).
  const SAME_OK = new Set(["typeClassic", "typePremium", "no", "proTag", "upsellTitle"]);
  const copies = Object.keys(es).filter(
    (k) => !SAME_OK.has(k) && es[k].message === en[k].message
  );
  assert.deepEqual(copies, [], `es_419 values identical to English: ${copies.join(", ")}`);
});

test("es_419 has no empty, untranslated, or English-leaking values", () => {
  const es = JSON.parse(read("_locales/es_419/messages.json"));
  const en = JSON.parse(read("_locales/en/messages.json"));
  // Brand names / loanwords intentionally identical across locales.
  const SAME_OK = new Set(["typeClassic", "typePremium", "no", "proTag", "upsellTitle"]);
  // Common English words that must never appear in Mexican-Spanish copy.
  // Word-boundary, case-insensitive. Deliberately excludes words spelled the
  // same in Spanish ("total") and Spanish homographs ("sale"), and matches as
  // whole words so loanwords inside Spanish ("Neto", "costo") don't trip it.
  const ENGLISH =
    /\b(price|profit|fee|fees|shipping|cost|costs|search|seller|margin|net|free|discount|weight|summary|category|commission|listing|withholding|withholdings|monthly|dashboard|settings|save|default|receive|unlock|target|compare|difference|history|estimate|percent)\b/i;
  const problems = [];
  for (const key of Object.keys(es)) {
    const v = es[key]?.message ?? "";
    if (v.trim() === "") problems.push(`${key}: empty`);
    if (!SAME_OK.has(key) && v === en[key]?.message) {
      problems.push(`${key}: byte-identical to English ("${v}")`);
    }
    const hit = ENGLISH.exec(v);
    if (hit) problems.push(`${key}: English word "${hit[0]}" in "${v}"`);
  }
  assert.deepEqual(problems, [], "es_419 problems found:\n" + problems.join("\n"));
});

// ---- anti-regression lint: no hardcoded user-facing strings in render code ----

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      // drop // comments not inside a string (even-quote heuristic)
      const i = line.indexOf("//");
      if (i === -1) return line;
      const before = line.slice(0, i);
      const quotes = (before.match(/["'`]/g) || []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join("\n");
}

// Inside-parens content of each `name(` call, balanced.
function callArgs(src, name) {
  const re = new RegExp("(?:\\b|\\.)" + name + "\\s*\\(", "g");
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    let depth = 0, q = null, start = m.index + m[0].length, i = start - 1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) {
        if (c === q && src[i - 1] !== "\\") q = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) { out.push(src.slice(start, i)); break; }
      }
    }
  }
  return out;
}

function splitTopArgs(s) {
  const args = [];
  let depth = 0, q = null, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === q && s[i - 1] !== "\\") q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; cur += c; continue; }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) { args.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) args.push(cur);
  return args.map((a) => a.trim());
}

// A bare "..."/'...' literal containing letters (not a T() call, template, var,
// or pure symbol) reaching a UI sink is a hardcoded string.
const ALLOW = new Set(["", "▾", "—", "…", "0", "0.00"]);
function isHardcoded(arg) {
  if (!arg) return false;
  const m = arg.match(/^(['"])((?:[^\\]|\\.)*)\1$/);
  if (!m) return false; // template / identifier / T(...) / expression
  const text = m[2];
  return /[A-Za-z]/.test(text) && !ALLOW.has(text);
}

test("no hardcoded user-facing strings in render code (use T())", () => {
  const files = [
    "src/content/card.js",
    "src/content/quickview.js",
    "src/content/upsell.js",
    "src/content/history.js",
    "src/dashboard/dashboard.js",
    "src/options/options.js"
  ];
  const violations = [];
  for (const file of files) {
    const src = stripComments(read(file));
    // el(tag, class, TEXT) — 3rd arg
    for (const call of callArgs(src, "el")) {
      const a = splitTopArgs(call);
      if (a.length >= 3 && isHardcoded(a[2])) violations.push(`${file}: el(…, ${a[2]})`);
    }
    // first-arg label sinks
    for (const fn of ["buildRow", "panelRow", "lockedRow", "row", "Option"]) {
      for (const call of callArgs(src, fn)) {
        const a = splitTopArgs(call);
        if (a.length >= 1 && isHardcoded(a[0])) violations.push(`${file}: ${fn}(${a[0]})`);
      }
    }
    // assignment sinks
    for (const m of src.matchAll(/\.(?:textContent|placeholder|title)\s*=\s*(['"][^'"]*['"])/g)) {
      if (isHardcoded(m[1])) violations.push(`${file}: assign ${m[1]}`);
    }
    // setAttribute("title"|"aria-label"|"placeholder", TEXT)
    for (const m of src.matchAll(
      /setAttribute\(\s*["'](?:title|aria-label|placeholder)["']\s*,\s*(['"][^'"]*['"])/g
    )) {
      if (isHardcoded(m[1])) violations.push(`${file}: setAttribute ${m[1]}`);
    }
  }
  assert.deepEqual(violations, [], "hardcoded UI strings found:\n" + violations.join("\n"));
});
