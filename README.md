# Scope (field-inspect)

Offline-first PWA for pest inspections: photos and voice notes in the field,
compliance reports (timber pest, termite certificates, SWMS), invoicing, client
messaging and a client portal. Vanilla JavaScript, **no build step**; Supabase
back end; hosted on GitHub Pages.

Start with `docs/ARCHITECTURE.md`. Findings and open debt are in `docs/AUDIT.md`.
`SCOPE-HANDOVER.md` is the plain-English handover (refreshed for v106).

## Run locally
Serve the folder over HTTP (service workers and camera need http://localhost):
`powershell -File serve.ps1` (port 8080 by default), or any static server. Open
`/?demo=1` for demo mode: separate local database, no network writes, no client
contact. **Do not exercise live mode against real client data.**

## Test
Open `/tests/run-tests.html` and press Run (or `window.runAllTests()`). 469 tests,
no framework, about 70 seconds. It uses its own `field-inspect-db-test` database.
A stale second tab on the same origin can hang IndexedDB; close idle tabs first.
`tests/chaos.js` + `chaos-scenarios.js` are a random-tapper for demo mode only;
they refuse to run otherwise.

## Conventions
* New script => register in `index.html`, `sw.js` `APP_SHELL`, and
  `tests/run-tests.html` if the suite loads it. `nav-history.js` stays last.
* Release => bump `CACHE_NAME` (sw.js) and `APP_VERSION` (version.js) together.
* Escape untrusted text with `HtmlSafe.escape`; images with `HtmlSafe.imageSrc`.
* User-facing failure text lives in pure `*Messages` objects and is tested.
* Do not edit files containing non-ASCII punctuation with perl `\x{...}` escapes
  (they double-encode UTF-8). Use the editor.
* `.ps1` files stay ASCII (Windows PowerShell 5.1).

## Deploy
Front end: copy changed files to the git checkout, commit, push (GitHub Pages
serves it). Database: run new `supabase-migration-NNN-*.sql` in the SQL editor,
including explicit GRANTs. Functions: `supabase functions deploy <name>`; add
`--no-verify-jwt` for `client-portal`, `sms-inbound`, `calendar-feed`,
`send-due-reminders`. Secrets are set by the owner in Supabase, never in code.

## Backups
See `docs/BACKUP-RUNBOOK.md` and `tools/backup-scope.ps1` (`-Check` first).

Third-party code: `THIRD-PARTY-NOTICES.md`.
