// Dependency-free build: stamps manifest.json from src/config/branding.js
// (single source of truth for naming) and packages dist/ + a CWS-ready zip.
//
//   node scripts/build.mjs            stamp manifest, copy to dist/
//   node scripts/build.mjs --release  same, but uses the release name
//                                     (no "(dev)" suffix) and zips dist/
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const release = process.argv.includes("--release");

// branding.js is a classic script that assigns globalThis.EXT_BRAND.
const brandingSource = readFileSync(join(root, "src/config/branding.js"), "utf8");
new Function(brandingSource)();
const BRAND = globalThis.EXT_BRAND;

const manifestPath = join(root, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.name = release ? BRAND.name : BRAND.manifestName;
manifest.version = BRAND.version;
manifest.description = BRAND.description;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest.json stamped: "${manifest.name}" v${manifest.version}`);

const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
cpSync(manifestPath, join(dist, "manifest.json"));
cpSync(join(root, "src"), join(dist, "src"), { recursive: true });
console.log("dist/ ready (load unpacked from repo root or dist/)");

if (release) {
  const zipPath = join(root, `${BRAND.name.toLowerCase().replaceAll(" ", "-")}-${BRAND.version}.zip`);
  rmSync(zipPath, { force: true });
  try {
    execFileSync("zip", ["-r", zipPath, "."], { cwd: dist });
    console.log(`packed ${zipPath}`);
  } catch {
    console.error("`zip` not found — install it or zip dist/ manually for CWS upload.");
    process.exitCode = 1;
  }
}

if (!existsSync(join(root, "src/assets/icons/icon128.png"))) {
  console.warn("warning: icons missing — run `npm run icons`");
}
