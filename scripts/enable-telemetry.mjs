// One command to produce the telemetry-enabled release:
//   node scripts/enable-telemetry.mjs <supabase-url> <anon-key>
// Builds the release zip with the backend baked in (NETIO_TELEMETRY_URL/KEY),
// and assembles a release/ folder (gitignored) with everything to publish:
//   release/netio-<version>.zip            upload to the Chrome Web Store
//   release/landing/                       upload to your landing host
//                                          (adios.html configured, telemetry privacidad.html)
//   release/PRIVACY.md                     telemetry privacy policy (markdown)
//   release/store-listing-privacy.md       text for the store listing + Privacy tab
// The tracked repo files stay in their default dormant / no-collection state.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const CONFIG_LINE = 'window.NETIO_TELEMETRY = { url: "", key: "" }; // NETIO_TELEMETRY_CONFIG';

export function validate(url, key) {
  const u = String(url ?? "").trim().replace(/\/+$/, "");
  const k = String(key ?? "").trim();
  if (!/^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(u)) throw new Error("URL must be an https origin like https://abcd.supabase.co");
  if (k.length < 20 || /[\s"'<>]/.test(k)) throw new Error("anon key looks wrong (copy the whole 'anon public' key)");
  if (/service_role/i.test(k)) throw new Error("that looks like a service_role key. NEVER use it here; use the anon public key");
  try {
    const payload = JSON.parse(Buffer.from(k.split(".")[1] ?? "", "base64url").toString("utf8"));
    if (payload.role && payload.role !== "anon") throw new Error(`key role is "${payload.role}", expected "anon"`);
  } catch (err) {
    if (/role/.test(String(err.message))) throw err; // non-JWT (new publishable keys) are fine
  }
  return { url: u, key: k };
}

export function applyAdiosConfig(html, url, key) {
  if (!html.includes(CONFIG_LINE)) throw new Error("adios.html config line not found");
  return html.replace(CONFIG_LINE, () => `window.NETIO_TELEMETRY = ${JSON.stringify({ url, key })};`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { url, key } = validate(process.argv[2], process.argv[3]);
    const env = { ...process.env, NETIO_TELEMETRY_URL: url, NETIO_TELEMETRY_KEY: key };
    console.log("building the release zip with analytics enabled ...");
    execFileSync("npm", ["run", "build:release"], { cwd: root, env, stdio: "inherit" });

    const brand = (() => {
      new Function(readFileSync(join(root, "src/config/branding.js"), "utf8"))();
      return globalThis.EXT_BRAND;
    })();
    const zipName = `${brand.name.toLowerCase()}-${brand.version}-telemetry.zip`;
    const baked = readFileSync(join(root, "dist/src/config/telemetry-config.js"), "utf8");
    if (!baked.includes(url)) throw new Error("the built extension does not contain the backend URL");

    // The build already wrote release/<name>-telemetry.zip (never the root zip).
    const out = join(root, "release");
    if (!existsSync(join(out, zipName))) throw new Error(`${zipName} was not produced`);
    for (const f of ["landing", "PRIVACY.md", "store-listing-privacy.md"]) rmSync(join(out, f), { recursive: true, force: true });
    cpSync(join(root, "landing"), join(out, "landing"), { recursive: true });
    writeFileSync(
      join(out, "landing/adios.html"),
      applyAdiosConfig(readFileSync(join(root, "landing/adios.html"), "utf8"), url, key)
    );
    cpSync(join(root, "docs/privacy-telemetry/privacidad.html"), join(out, "landing/privacidad.html"));
    cpSync(join(root, "docs/privacy-telemetry/PRIVACY.md"), join(out, "PRIVACY.md"));
    cpSync(join(root, "docs/privacy-telemetry/store-listing-privacy.md"), join(out, "store-listing-privacy.md"));

    // Put the working tree's dist/ back to the plain dev build.
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "ignore" });

    console.log(`
DONE. Everything to publish is in ${out}

1. Upload release/landing/ to ${brand.landingUrl} (adios.html and privacidad.html must be live
   BEFORE you submit: the store reviews the privacy policy URL).
2. Upload release/${zipName} to the Chrome Web Store.
3. Chrome Web Store dashboard > Privacy practices:
     - tick "User activity". Do NOT tick "Website content" or "Web history".
     - keep your existing declarations: Personally identifiable information
       (email, ExtensionPay) and Payments.
     - privacy policy URL: ${brand.landingUrl}/privacidad.html
     - paste the disclosure text from release/store-listing-privacy.md
     - certify: not sold, not used for unrelated purposes, not used for credit.
4. Update the store description privacy paragraph (text in release/store-listing-privacy.md).
5. REQUIRED, or the "we delete events older than 400 days" promise is false: schedule the
   cleanup in Supabase. Dashboard > Database > Extensions > enable "pg_cron", then in the SQL
   editor run:
     select cron.schedule('netio-cleanup', '17 3 * * 0', $$select public.netio_cleanup()$$);
   and confirm with: select jobname, schedule from cron.job;
6. Open tools/analytics/index.html in your browser and enter the URL, anon key and admin secret.
`);
  } catch (err) {
    console.error(`enable-telemetry failed: ${err.message}`);
    process.exit(1);
  }
}
