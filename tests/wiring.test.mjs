// Manifest wiring guard. The content scripts share state through globals
// (globalThis.MST_* / EXT_*), assigned by one file and read by later ones.
// If a provider file is missing from manifest content_scripts.js — or listed
// after a file that consumes it — the global is undefined at runtime and the
// whole content script throws on load (this is exactly how v1.3.0's safe.js
// regression shipped). These tests assert every consumed global is provided
// by a file loaded earlier in the same content-script entry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

// The content-script entry that runs on Mercado Libre (not the extpay one).
const entry = manifest.content_scripts.find((cs) =>
  cs.matches.some((m) => m.includes("mercadolibre.com.mx"))
);

const GLOBAL_RE = /globalThis\.(MST_[A-Z0-9_]+|EXT_[A-Z0-9_]+)/g;

// Split each global reference in a file into { provides, consumes }. A ref
// immediately followed by `=` (and not `==`/`=>`) is an assignment (provider).
function analyze(source) {
  const provides = new Set();
  const consumes = new Set();
  for (const m of source.matchAll(GLOBAL_RE)) {
    const name = m[1];
    const after = source.slice(m.index + m[0].length).match(/^\s*(=(?![=>]))?/);
    if (after && after[1]) provides.add(name);
    else consumes.add(name);
  }
  return { provides, consumes };
}

test("manifest entry for Mercado Libre exists with a js list", () => {
  assert.ok(entry, "no content_scripts entry matches mercadolibre.com.mx");
  assert.ok(Array.isArray(entry.js) && entry.js.length > 0, "entry has no js files");
});

test("every consumed global is provided by an earlier file in the manifest", () => {
  const providedSoFar = new Set();
  const problems = [];
  for (const rel of entry.js) {
    const src = readFileSync(join(root, rel), "utf8");
    const { provides, consumes } = analyze(src);
    for (const name of consumes) {
      if (!providedSoFar.has(name) && !provides.has(name)) {
        problems.push(`${rel} reads globalThis.${name} but no earlier manifest file provides it`);
      }
    }
    for (const name of provides) providedSoFar.add(name);
  }
  assert.deepEqual(problems, [], `wiring gaps:\n  ${problems.join("\n  ")}`);
});

test("safe.js is wired (its MST_SAFE is consumed by the content scripts)", () => {
  // Regression pin for the v1.3.0 blocker: safe.js provides MST_SAFE and
  // content.js/quickview.js consume it, so it must be in the js list.
  assert.ok(entry.js.includes("src/content/safe.js"), "src/content/safe.js missing from manifest");
});
