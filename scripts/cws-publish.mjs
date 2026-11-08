// Upload a zip to the Chrome Web Store and submit it for review through the
// Chrome Web Store Publish API v1.1. No dependencies (node >= 18 fetch).
//
//   node scripts/cws-publish.mjs release/netio-1.5.5/netio-1.5.5.zip
//
// Credentials, from the environment or from a git-ignored .cws.env at the
// repo root (KEY=VALUE lines; scripts/cws-auth.mjs writes it):
//   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN
//   CWS_EXTENSION_ID (default bjhikillfgbpblogloljjhejogfeajac)
//
// Exit codes: 0 uploaded and submitted; 1 configuration, upload or publish
// problem (the API responses are printed as received).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_EXTENSION_ID = "bjhikillfgbpblogloljjhejogfeajac";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function loadCredentials() {
  const env = { ...process.env };
  const file = join(root, ".cws.env");
  if (existsSync(file)) {
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in env) || !env[key]) env[key] = value;
    }
  }
  const creds = {
    clientId: env.CWS_CLIENT_ID,
    clientSecret: env.CWS_CLIENT_SECRET,
    refreshToken: env.CWS_REFRESH_TOKEN,
    extensionId: env.CWS_EXTENSION_ID || DEFAULT_EXTENSION_ID
  };
  const missing = Object.entries({
    CWS_CLIENT_ID: creds.clientId,
    CWS_CLIENT_SECRET: creds.clientSecret,
    CWS_REFRESH_TOKEN: creds.refreshToken
  }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `missing ${missing.join(", ")}. Set them in the environment or in .cws.env ` +
        `(run "node scripts/cws-auth.mjs"; see store/SETUP-CWS-API.md).`
    );
  }
  return creds;
}

export async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`token exchange failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function uploadZip(zipPath, { extensionId, accessToken }) {
  const body = readFileSync(zipPath);
  const res = await fetch(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extensionId}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "x-goog-api-version": "2",
      "content-type": "application/zip"
    },
    body
  });
  const data = await readJson(res);
  console.log(`upload ${basename(zipPath)} -> HTTP ${res.status}`);
  console.log(JSON.stringify(data, null, 2));
  if (!res.ok || data.uploadState !== "SUCCESS") {
    throw new Error(`upload did not succeed (uploadState=${data.uploadState ?? "none"})`);
  }
  return data;
}

export async function publishItem({ extensionId, accessToken, target = "default" }) {
  const res = await fetch(
    `https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish?publishTarget=${target}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-goog-api-version": "2",
        "content-length": "0"
      }
    }
  );
  const data = await readJson(res);
  console.log(`publish -> HTTP ${res.status}`);
  console.log(JSON.stringify(data, null, 2));
  const statuses = Array.isArray(data.status) ? data.status : [];
  const ok = res.ok && statuses.length > 0 && statuses.every((s) => s === "OK" || s === "ITEM_PENDING_REVIEW");
  if (!ok) {
    throw new Error(`publish not accepted (status=${statuses.join(",") || "none"})`);
  }
  return data;
}

export async function publishZip(zipPath) {
  if (!existsSync(zipPath)) throw new Error(`zip not found: ${zipPath}`);
  const creds = loadCredentials();
  console.log(`\nChrome Web Store: uploading ${basename(zipPath)} to item ${creds.extensionId}`);
  const accessToken = await getAccessToken(creds);
  await uploadZip(zipPath, { extensionId: creds.extensionId, accessToken });
  const result = await publishItem({ extensionId: creds.extensionId, accessToken });
  console.log(`submitted for review: ${result.status.join(", ")}`);
  return result;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const zip = process.argv[2];
  if (!zip) {
    console.error("usage: node scripts/cws-publish.mjs <path/to/extension.zip>");
    process.exit(1);
  }
  publishZip(zip).catch((err) => {
    console.error(`FATAL: ${err.message}`);
    process.exit(1);
  });
}
