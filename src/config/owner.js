// Owner key: lets the owner's own browser be PRO permanently without paying.
//
// The extension contains ONLY the SHA-256 of a secret key that exists nowhere
// in this repo or in any build. Possession of the key is proven by hashing it
// and comparing. The key itself is kept in storage.local (never sync) and is
// RE-VERIFIED against the hash on every status computation, so editing a flag
// or pasting the hash into storage unlocks nothing.
//
// Loaded before gate.js in every context (service worker, content scripts,
// extension pages). Never log, send, or render the key.
"use strict";

globalThis.MST_OWNER = (() => {
  const KEY_SHA256 = "530ba2d70c129f0f80848a8b2f734a8a8060e737c3eea8b9d6338ea4323992f5";
  const STORAGE_KEY = "mst:ownerKey";
  // QA only (e2e uses a throwaway key); the release build strips the read below.
  const HASH_OVERRIDE_KEY = "mst:ownerHashOverride";

  async function sha256hex(text) {
    const data = new TextEncoder().encode(String(text));
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Compare without an early exit on the first differing character.
  function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  // `hash` is injectable so tests can use a throwaway key.
  async function matches(key, hash = KEY_SHA256) {
    if (typeof key !== "string" || key.length < 16 || key.length > 256) return false;
    try {
      return safeEqual(await sha256hex(key), String(hash).toLowerCase());
    } catch {
      return false;
    }
  }

  function expectedHash(stored) {
    let hash = KEY_SHA256;
    hash = stored?.[HASH_OVERRIDE_KEY] || hash;
    return typeof hash === "string" ? hash : KEY_SHA256;
  }

  // True only when the stored key hashes to the expected value right now.
  async function isActive() {
    try {
      const stored = await chrome.storage.local.get([STORAGE_KEY, HASH_OVERRIDE_KEY]);
      return await matches(stored[STORAGE_KEY], expectedHash(stored));
    } catch {
      return false;
    }
  }

  // Verify a typed key; on success store it (local only).
  async function activate(key) {
    try {
      const stored = await chrome.storage.local.get(HASH_OVERRIDE_KEY);
      if (!(await matches(key, expectedHash(stored)))) return false;
      await chrome.storage.local.set({ [STORAGE_KEY]: key });
      return true;
    } catch {
      return false;
    }
  }

  async function remove() {
    try {
      await chrome.storage.local.remove(STORAGE_KEY);
    } catch {
      // nothing to remove
    }
  }

  return Object.freeze({ KEY_SHA256, STORAGE_KEY, HASH_OVERRIDE_KEY, sha256hex, matches, isActive, activate, remove });
})();
