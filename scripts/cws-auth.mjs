// One-time OAuth setup for the Chrome Web Store Publish API: prints the Google
// consent URL, catches the authorization code, exchanges it for a refresh
// token and writes .cws.env (git-ignored). No dependencies.
//
//   node scripts/cws-auth.mjs                 loopback flow (http://localhost:8085)
//   node scripts/cws-auth.mjs --oob           paste-the-code flow (urn:ietf:wg:oauth:2.0:oob)
//
// Needs CWS_CLIENT_ID and CWS_CLIENT_SECRET in the environment, in an existing
// .cws.env, or typed when prompted. Desktop-app OAuth clients accept the
// loopback redirect; the OOB redirect only works for clients created before
// Google retired it, so it is the fallback (used when --oob is passed or when
// port 8085 is busy). Prerequisites: store/SETUP-CWS-API.md.
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(root, ".cws.env");
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const OOB = "urn:ietf:wg:oauth:2.0:oob";
const PORT = 8085;
const LOOPBACK = `http://localhost:${PORT}`;
const forceOob = process.argv.includes("--oob");

function readEnvFile() {
  const out = {};
  if (!existsSync(envPath)) return out;
  for (const raw of readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const rl = createInterface({ input: stdin, output: stdout });
const fileEnv = readEnvFile();
async function need(key, prompt) {
  const v = process.env[key] || fileEnv[key];
  if (v) return v;
  const typed = (await rl.question(`${prompt}: `)).trim();
  if (!typed) {
    console.error(`FATAL: ${key} is required`);
    process.exit(1);
  }
  return typed;
}

const clientId = await need("CWS_CLIENT_ID", "OAuth client ID (Desktop app)");
const clientSecret = await need("CWS_CLIENT_SECRET", "OAuth client secret");
const extensionId = process.env.CWS_EXTENSION_ID || fileEnv.CWS_EXTENSION_ID || "bjhikillfgbpblogloljjhejogfeajac";

function consentUrl(redirectUri) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent"
  }).toString();
  return u.toString();
}

// Loopback: a tiny server on 8085 catches ?code=... when Google redirects.
function waitForCodeOnLoopback() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, LOOPBACK);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.setHeader("content-type", "text/html; charset=utf-8");
      if (code) {
        res.end("<p>Listo. Ya puedes cerrar esta pestaña y volver a la terminal.</p>");
        server.close();
        resolve(code);
      } else {
        res.statusCode = 400;
        res.end(`<p>Sin código. ${error ? `Error: ${error}` : ""}</p>`);
        if (error) {
          server.close();
          reject(new Error(`Google returned error=${error}`));
        }
      }
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`\nWaiting for Google on ${LOOPBACK} ...`);
    });
  });
}

async function getCode() {
  if (!forceOob) {
    const url = consentUrl(LOOPBACK);
    console.log("\n1. Open this URL in the browser that is signed in as the Chrome Web Store publisher account:\n");
    console.log(url);
    console.log("\n2. Accept the consent screen. You will be redirected to localhost:8085 and the code is caught automatically.");
    try {
      const code = await waitForCodeOnLoopback();
      return { code, redirectUri: LOOPBACK };
    } catch (err) {
      console.warn(`\nloopback flow unavailable (${err.message}); falling back to the paste-the-code flow.`);
    }
  }
  const url = consentUrl(OOB);
  console.log("\n1. Open this URL in the browser that is signed in as the Chrome Web Store publisher account:\n");
  console.log(url);
  console.log("\n2. Accept the consent screen and copy the code Google shows you.");
  const code = (await rl.question("\nPaste the authorization code: ")).trim();
  if (!code) {
    console.error("FATAL: no code given");
    process.exit(1);
  }
  return { code, redirectUri: OOB };
}

const { code, redirectUri } = await getCode();
const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  })
});
const data = await res.json().catch(() => ({}));
rl.close();
if (!res.ok || !data.refresh_token) {
  console.error(`FATAL: token exchange failed (${res.status}): ${JSON.stringify(data)}`);
  if (data.access_token && !data.refresh_token) {
    console.error("Google returned no refresh_token: revoke the app at https://myaccount.google.com/permissions and run this again (prompt=consent is already set).");
  }
  process.exit(1);
}

writeFileSync(
  envPath,
  [
    "# Chrome Web Store Publish API credentials. Git-ignored. Do not share.",
    `CWS_CLIENT_ID=${clientId}`,
    `CWS_CLIENT_SECRET=${clientSecret}`,
    `CWS_REFRESH_TOKEN=${data.refresh_token}`,
    `CWS_EXTENSION_ID=${extensionId}`,
    ""
  ].join("\n"),
  { mode: 0o600 }
);
console.log(`\nSaved ${envPath}. Test it with: npm run release:publish`);
