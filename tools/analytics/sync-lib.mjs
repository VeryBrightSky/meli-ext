// Builds tools/analytics/index.html from index.template.html by inlining
// lib.mjs (one source of truth) between the LIB:BEGIN / LIB:END markers.
// `export ` is dropped so the code runs as a classic inline script.
//   node tools/analytics/sync-lib.mjs          write index.html
//   node tools/analytics/sync-lib.mjs --check  exit 1 if index.html is stale
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

export function inlineLib(libSource) {
  return libSource.replace(/^export /gm, "").trimEnd();
}
export function buildPage(template, libSource) {
  const re = /\/\/ LIB:BEGIN\n[\s\S]*?\/\/ LIB:END/;
  if (!re.test(template)) throw new Error("LIB markers missing in template");
  return template.replace(re, () => `// LIB:BEGIN\n${inlineLib(libSource)}\n// LIB:END`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const page = buildPage(
    readFileSync(join(dir, "index.template.html"), "utf8"),
    readFileSync(join(dir, "lib.mjs"), "utf8")
  );
  if (process.argv.includes("--check")) {
    const cur = readFileSync(join(dir, "index.html"), "utf8");
    if (cur !== page) {
      console.error("index.html is stale: run node tools/analytics/sync-lib.mjs");
      process.exit(1);
    }
    console.log("index.html is in sync with lib.mjs");
  } else {
    writeFileSync(join(dir, "index.html"), page);
    console.log("index.html written");
  }
}
