// Analytics backend (Supabase REST). Empty = telemetry is DORMANT: the
// extension never makes an analytics request and shows no analytics UI.
// scripts/build.mjs replaces the dist copy of this file from the env vars
// NETIO_TELEMETRY_URL and NETIO_TELEMETRY_KEY (the anon key; it is public by
// design and only allows INSERT). This tracked default must stay empty.
"use strict";

globalThis.MST_TELEMETRY_CONFIG = Object.freeze({ url: "", key: "" });
