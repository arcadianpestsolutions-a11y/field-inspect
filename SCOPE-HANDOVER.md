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
**Current build:** v91 · **283 tests passing**

---

## Stack and hard constraints

| | |
|---|---|
| Front end | Vanilla JS, **zero build step**, plain `<script src>` tags |
| Offline | IndexedDB (`field-inspect-db`), DB_VERSION **8** |
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
  PowerShell `HttpListener` (`.claude/launch.json`, port 8787).
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

`app.js` (job list, job view, camera) · `report.js` (the report editor —
**4,108 lines, the largest piece of structural debt**) · `scheduler.js` ·
`swms-ui.js` · `leads-ui.js` · `business-ui.js` · `assets-ui.js` ·
`invoice-ui.js` · `reminders-ui.js` · `client-link.js` · `qr-scan.js`

### Client-facing (outside the app)

`portal.html` + `portal-config.js` — a standalone page. No Scope code, no
database client, no key. It can only call the `client-portal` Edge Function.

---

## Edge Functions

All require a signed-in user's bearer token **except** the two noted.

| Function | Notes |
|---|---|
| `analyze-inspection` | AI drafting from photos |
| `send-report-email` | PDF arrives as base64 from the browser |
| `send-client-message` | Booking confirmation, day-before reminder, report ready, due reminder. SMS + email. |
| `send-due-reminders` | Annual re-inspection sweep |
| `calendar-feed` | **JWT verification OFF.** Token in query = credential. |
| `client-portal` | **JWT verification OFF.** Token in query = credential. |
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
   Every new table needs an explicit grant.
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

---

## Outstanding

**Waiting on the operator (not code):**
- ~~Run migrations 024-028~~ — applied 1 Oct 2026 via `supabase db query --linked`
- Set `CLICKSEND_USERNAME` / `CLICKSEND_API_KEY` in Supabase secrets — until
  then day-before reminders go by email instead of SMS
- Verify the sending domain at Resend
- Business details (ABN, address, website) are blank and **print on reports**

**Known open issues:**
- `send-due-reminders` has **no org filter** — the last known tenancy leak
- Business name is hardcoded in several Edge Functions
- STOP replies land in the SMS provider's inbox, not in Scope
- No signup or invites; a second user or business cannot be added
- `report.js` at 4,108 lines

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
