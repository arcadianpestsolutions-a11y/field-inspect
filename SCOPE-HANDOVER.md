# Scope — project handover

Context for an assistant with no history of this project. Written to be pasted
into a fresh chat.

**No credentials are in this document.** Keys live in `supabase-config.js`
(publishable key only — safe in public source) and in Supabase's own secrets
store. Never paste a `service_role` key anywhere.

---

## What it is

A field-inspection app for **Arcadian Pest Solutions**, a one-person pest
control business in Camden South, NSW, Australia. The operator is Tal — a
pest technician, not a developer. Explanations should be plain; he has said
"make this simpler like talking to a child" about setup steps.

It produces the compliance documents a pest inspection legally requires, from
a phone, in a subfloor, with no signal.

**Live:** `https://arcadianpestsolutions-a11y.github.io/field-inspect/`
**Current build:** v116 · **499 tests passing** (as of 8 Oct 2026)

**Read next:** `README.md` (run, test, deploy), `docs/ARCHITECTURE.md`,
`docs/AUDIT.md` (findings and honest debt), and `docs/product/` (PRD, TRD, app
flow, design brief, schema, implementation plan). This handover is the
plain-English orientation; those are the detail.

---

## Stack and hard constraints

| | |
|---|---|
| Front end | Vanilla JS, **zero build step**, plain `<script src>` tags |
| Offline | IndexedDB (`field-inspect-db`), DB_VERSION **9** |
| Shell | Service worker, cache-first, versioned by `CACHE_NAME` in `sw.js` |
| Back end | Supabase — Postgres, Auth, Storage, Edge Functions (Deno) |
| Hosting | GitHub Pages |
| Tests | `tests/run-tests.html` — a browser page, no framework |

**Constraints that are not negotiable:**

- **No build step.** No npm, no bundler, no TypeScript in the front end.
  New code is a new `.js` file added to `index.html` *and* to `sw.js`'s
  `APP_SHELL` *and* (if testable) to `tests/run-tests.html`.
- **The machine has no Node and no Python.** The `python` on PATH is the
  Microsoft Store stub. A local server for the test suite runs via a
  PowerShell `HttpListener` (`.claude/launch.json` entry `scope-local`, port 8787).
  Supabase CLI is `.tools\supabase.exe`. **Never run `supabase db dump
  --dry-run`: it prints a temporary database password.**
- **Two working directories.** Edits happen in `C:\Users\Tal\Desktop\CLaude`;
  the git repo that deploys is `C:\Users\Tal\Desktop\deployed-reference`.
  Shipping = copy changed files across, commit, push.
- **Bump both version markers together.** `CACHE_NAME` in `sw.js` and
  `APP_VERSION` in `version.js`. They drive the build label on the login
  screen; a mismatch defeats the point of it.
- **Never rename** `field-inspect-db` or the `/field-inspect/` Pages path.

---

## File map

### Pure logic modules (no DOM, no DB, injectable clock — all tested directly)

| File | What it owns |
|---|---|
| `availability.js` | Free appointment slots. Working hours, travel feasibility, service radius, lead time. Two policies: `advisory` (internal) and `strict` (client-facing). |
| `routing.js` | A better order to drive a day in. Exact for ≤8 stops, nearest-neighbour + 2-opt above. |
| `reporting.js` | Business figures. AU financial year (1 Jul–30 Jun). |
| `assets.js` | The station register, **derived from reports** rather than stored separately. |
| `pipeline.js` | Lead stages and follow-up timing. Speed-to-lead in *working* hours. |
| `invoicing.js` | Money. GST computed per line (Xero rounds per line too). |
| `report-schema.js` | The schema contract + `ReportSchemaUtils` (field/section visibility, validation, defaults). |

### Shared infrastructure

| File | What it owns |
|---|---|
| `form-render.js` | Turns a schema section into controls. Used by reports, SWMS and leads. Host supplies `customFields` and a `decorateRow` hook. |
| `camera.js` | Opening a camera, and failing with a cause. Shared by the inspection screen and the QR scanner. |
| `db.js` | IndexedDB. All stores, all CRUD, tombstones. |
| `sync.js` | Two-way sync with Postgres + Storage. Paged reads (`max_rows = 1000`). |
| `org.js` | Business identity and the signing technician. Never guesses — falls back to empty. |

### Schemas (the actual compliance documents)

`report-schema.js` (timber pest inspection, AS 4349.3) ·
`pest-treatment-schema.js` · `termite-management-schemas.js` (action plan,
certificate of installation, monitoring) · `swms-schema.js` (WHS Reg 2017 NSW)

### Screens

`app.js` (job list, job view, camera; ~2,600 lines) · `report.js` (the report
editor — **~4,400 lines, the largest piece of structural debt**) · `scheduler.js`
· `swms-ui.js` · `leads-ui.js` · `business-ui.js` · `assets-ui.js` ·
`invoice-ui.js` · `reminders-ui.js` · `reminder-nudge.js` (14:00 banner) ·
`backup.js` (export + stale-backup notice) · `client-link.js` · `qr-scan.js` ·
`nav-history.js` (phone Back button; must stay the last script)

Also: `html-safe.js` (the one HTML-escaping implementation: `escape`,
`imageSrc`, `token`), `error-log.js` (local + uploaded error log). Both `app.js`
and `report.js` open with a table of contents.

### Tests and tools

`tests/run-tests.html` (499 tests), `tests/chaos.js` + `chaos-scenarios.js`
(random-tapper; **demo mode only**), `tools/backup-scope.ps1` (weekly backup;
run with `-Check` first), `docs/BACKUP-RUNBOOK.md`.

### Client-facing (outside the app)

`portal.html` + `portal-config.js` — a standalone page. No Scope code, no
database client, no key. It can only call the `client-portal` Edge Function.

---

## Edge Functions

All require a signed-in user's bearer token **except** the three noted (JWT
verification OFF is recorded in `supabase/config.toml`).

| Function | Notes |
|---|---|
| `analyze-inspection` | AI drafting from photos |
| `send-report-email` | PDF arrives as base64 from the browser |
| `send-client-message` | Booking confirmation, day-before reminder, report ready, due reminder. SMS + email. The caller sends a job id only; the recipient is read from the job. A live sweep **halts** if a send cannot be recorded (prevents duplicate texts). |
| `send-due-reminders` | **Retired** — answers 410. `send-client-message` `{"sweep":"due_reminder"}` replaced it (it had no org filter). |
| `calendar-feed` | **JWT verification OFF.** Token in query = credential. |
| `client-portal` | **JWT verification OFF.** Token in query = credential. |
| `sms-inbound` | **JWT verification OFF.** Secret `?k=` (`SMS_INBOUND_TOKEN`) = credential. Records STOP by phone number. Answers 503 until the secret is set. |
| `schedule-agent` | Tool-using assistant over the diary |
| `check-email-status`, `xero` | |

---

## Decisions worth not re-litigating

**Multi-tenancy is enforced by the database, not the app.** Every table has
`org_id` with `DEFAULT public.my_org_id()`. The app cannot choose which
business a row belongs to. Null fails closed. `service_role` bypasses RLS
entirely, so every Edge Function must filter by org *itself*.

**The reports store is keyed by `jobId`** — one report per job. This is why a
SWMS is **not** a report document type: it accompanies a job rather than
replacing its report, so it has its own store.

**The station register is a view, not a second store.** A separate asset table
written to by the report would mean two records of the same station kept in
step by hope, and the day they disagree is the day the warranty evidence stops
being evidence.

**The client portal is one link per job, not an account.** Expiring, revocable,
and the blast radius of a leak is one report the client already had.

**AI offers rather than asserts.** Fields carry `confirmBeforeUse`; the model's
answer is shown as a suggestion with its reason, and declining records a graded
wrong answer. Measured over five blind trials: excellent on insects (29/29),
unreliable on damage. Do not present AI output as findings.

**"No live termites found"** is required phrasing for legal protection. Never
write that live termites *were* found without that framing being handled.

---

## Verification discipline

- **Two clean back-to-back runs** of the suite before shipping. One is not proof.
- Use `waitFor(predicate)`, never a fixed `wait(ms)`.
- Tests must not depend on the date they run. Hard-coded fixture dates live in
  2031, out of reach of anything relative.

---

## Traps that have each cost real time

1. **Stale mixed builds.** `cache.addAll()` goes through the HTTP cache, so a
   browser holding yesterday's `app.js` copied it into the *new* version's
   cache permanently. Fixed in v80 with `cache: 'reload'`. If something
   unrelated breaks after a deploy, suspect this and check
   `window.APP_VERSION` — not what git says.
2. **Missing `GRANT`.** `42501 permission denied` was a missing grant, not RLS.
   Every new table needs an explicit grant. This has now bitten four times; the
   last (found 8 Oct 2026) meant Business details could never be saved. Migration
   033 fixed it and trimmed `service_role` to what each function uses. Any query
   that ignores its `error` hides this, so check every one.
3. **`42710 policy already exists.`** Drop every policy by name before creating
   it. This has cost a round trip twice.
4. **Missing columns fail silently.** Sync strips unknown columns, so an unrun
   migration looks like data quietly not saving. Migrations 011–015 were
   silently never run for weeks.
5. **`max_rows = 1000`** in `supabase/config.toml`. PostgREST truncates without
   saying so. All reads are paged.
6. **DST.** Never step days by adding `86400000`. Use the `Date` constructor —
   NSW puts clocks forward in October and a ms-stepped loop drifts an hour.
7. **Bare ISO dates.** `Date.parse('2027-03-20')` is UTC and lands a Sydney
   morning on the previous day.
8. **No whole-file regex on `report.js`.** It has been damaged twice that way.
   Use exact anchors, and verify by brace depth.
9. **No perl `\x{...}` escapes in replacements** — they double-encode UTF-8
   (every em dash becomes mojibake). Use the editor; check with
   `grep -c $'\xc3\xa2' file`.
10. **Never message real clients while testing.** No live sends, sweeps or
    dry-runs against real data; use stubs and counts. End-to-end is the
    owner's job, using his own phone.
11. **A stale open browser tab can hang IndexedDB** for every tab on that origin.
    Close idle tabs before debugging a stuck test run.
12. **Secrets are set by the owner only.** Never read, print or enter an API key.

---

## Outstanding

**Waiting on the operator (not code):**
- Migrations 002–033 are all applied to the live project (033 on 8 Oct 2026).
- Set `CLICKSEND_USERNAME` / `CLICKSEND_API_KEY` in Supabase secrets — until
  then day-before reminders go by email instead of SMS
- Set `SMS_INBOUND_TOKEN` and add the ClickSend inbound rule pointing at
  `sms-inbound?k=...` so STOP replies are recorded
- Verify the sending domain at Resend (parked with his IT person)
- Check Business details (ABN, address, website) are filled in — they **print
  on reports**, and Save was broken for every admin until migration 033
- Install the PostgreSQL command-line tools, run `tools/backup-scope.ps1`, and
  practise one restore. The free plan has **no automatic backups**, and photos
  are never in database backups
- Phone checks of the v102 Back button and v105 backup share sheet
- Decide: Supabase Pro vs weekly script; optional `SMS_ALLOWED_NUMBERS` guard;
  register "Arcadian Pest Solutions" under the Pty Ltd ABN

**Known open issues:** (full list with reasoning in `docs/AUDIT.md`)
- No signup or invites; a second user or business cannot be added
- No in-app restore; no 2FA; no Content-Security-Policy
- `app.js` (~2,600 lines) and `report.js` (~4,400) are single closures;
  small helpers (`toast`, `askConfirm`, `el`, `fmtDate`...) are duplicated
- No linter, CI or `package.json`; two-folder deploy workflow
- Server-side `supabase-js` import is unpinned

Resolved since the earlier version of this document: `send-due-reminders`
org leak (function retired), hard-coded business name (none found in the
functions), STOP replies (now handled by `sms-inbound`, once its secret is set).

**Not built:** quote → accept → pay online (Stripe), 2FA/SSO, Zapier.

**The largest unknown: the app has never been used on a real inspection.**
Every claim above is a claim until it survives a day in a subfloor.

---

## Comparison to the commercial alternative

Formitize (AU, ~$29.99/user/month ex GST plus add-ons) is the realistic
competitor. It is ahead on: client portal maturity, quote-accept-pay, sales
pipeline, Zapier/Mailchimp/QuickBooks, ISO 27001, and having support staff.

Scope is genuinely ahead on three narrow things: the documents are encoded as
*logic* rather than form-builder output; AI drafting from photos with measured
accuracy; and availability that refuses slots that cannot physically be driven
to. It is better at being *this* business's app. It is not a product.
