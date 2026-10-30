# Netio analytics: owner steps (private, not shipped in the extension)

What you get: anonymous funnel numbers (installs, who saw the card, who entered
a cost, who saw the paywall, who clicked buy, who paid) plus uninstall reasons,
in one page only you can open. Until step 5 the extension sends nothing.

1. **Create a Supabase project** at supabase.com (free plan is enough). Pick a
   region close to Mexico. Save the database password somewhere safe.
2. **Run the SQL.** In the project open SQL Editor, paste all of
   `tools/analytics/supabase.sql`, press Run. It is safe to run twice.
3. **Set your admin secret.** Choose a long random string (30+ characters) and
   run this in the SQL Editor, with your own secret in place:
   `update public.private_cfg set v = 'YOUR-LONG-SECRET' where k = 'admin_secret';`
   Until you do this, the report refuses to run.
4. **Copy the URL and anon key.** Project Settings > API: copy "Project URL"
   and the "anon public" key. Never use the service_role key.
5. **Build the telemetry release.** In the repo run
   `node scripts/enable-telemetry.mjs <url> <anon-key>`. It builds the zip and
   a `release/` folder, and prints the Chrome Web Store checklist.
6. **Publish.** Upload `release/landing/` to your landing site first (the
   privacy page and the uninstall page must be live), then upload
   `release/netio-1.5.0.zip` to the Chrome Web Store and fill the Privacy
   practices tab as the script printed.
7. **Open the dashboard.** Open `tools/analytics/index.html` in your browser
   (double click). Enter URL, anon key and admin secret, press Load. Tick
   "Demo" to see the layout with fake data. "Copy report" puts a plain-text
   summary on your clipboard; it contains no secrets, so you can paste it to
   Claude.

If numbers do not show up: in the extension open Options and add `?debug` to
the address. The diagnostics line shows the queue and the last send result
(an HTTP code or the error).

Things to know
- With about 50 installs a month the percentages are rough. The dashboard shows
  a warning under 100 installs. Use it to spot where people stop, not to run
  experiments.
- Anyone with the anon key can insert rows (that is how the extension works),
  but the table rejects anything outside the allowed events and cannot be read
  or changed with that key. Check Supabase log retention for IP addresses in
  Project Settings and keep the public privacy text in step with what you see.
- To delete one person's data on request:
  `delete from public.events where install_id = 'THEIR-ID';`
- Old rows: run `select public.netio_cleanup();` now and then (deletes > 400 days).
- After editing `lib.mjs` run `node tools/analytics/sync-lib.mjs` to refresh `index.html`.
