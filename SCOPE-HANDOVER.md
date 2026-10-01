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
**Current build:** v96 · **329 tests passing**

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
| `report-audit.js` | The pure rules of the audit trail (summarise a value, are two answers the same, diff a section) and the AI kept-versus-corrected totals. Came out of `report.js` in v95. |
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
**4,182 lines, the largest piece of structural debt**) · `scheduler.js` ·
`swms-ui.js` · `leads-ui.js` · `business-ui.js` · `assets-ui.js` ·
`team-ui.js` (admin only, behind More) · `password-ui.js` (choosing a password
after an emailed link) · `invoice-ui.js` · `reminders-ui.js` · `client-link.js` · `qr-scan.js`

### Shared with the Edge Functions (`supabase/functions/_shared/`)

Plain ES modules with no dependencies, imported by Deno in the functions and by
`tests/run-tests.js` with a dynamic `import()` — so they need the suite served
over http, not opened from disk.

| File | What it owns |
|---|---|
| `reminder-sms.js` | The words of the day-before SMS, the GSM-7 cost rules, AU mobile normalisation. |
| `org.js` | Which business a signed-in user belongs to, its name, and HTML-safe sign-offs. Every function that runs on `service_role` should start here. |
| `sms-optout.js` | What counts as a STOP reply, parsing the provider's payload, marking jobs by phone number. |
| `team.js` | Who may be invited, whether an existing login may be attached, whether someone may be removed. |

### Client-facing (outside the app)

`portal.html` + `portal-config.js` — a standalone page. No Scope code, no
database client, no key. It can only call the `client-portal` Edge Function.

---

## Edge Functions

All require a signed-in user's bearer token **except** the three noted (`calendar-feed`, `client-portal`, `sms-inbound`).

| Function | Notes |
|---|---|
| `analyze-inspection` | AI drafting from photos |
| `send-report-email` | PDF arrives as base64 from the browser |
| `send-client-message` | Booking confirmation, day-before reminder, report ready, due reminder. SMS + email. |
| `send-due-reminders` | Annual re-inspection sweep |
| `calendar-feed` | **JWT verification OFF.** Token in query = credential. |
| `client-portal` | **JWT verification OFF.** Token in query = credential. |
| `schedule-agent` | Tool-using assistant over the diary |
| `invite-user` | Admin only. Adds a person to the **caller's** business (emailed invite, or created with a temporary password) or removes one (detach + ban). |
| `sms-inbound` | **JWT verification OFF** (set in `config.toml`). `SMS_INBOUND_TOKEN` in the query is the credential. Receives replies from the SMS provider and records STOP. |
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

**Invite-only.** A business's admin adds its people; nobody signs themselves
up, and public signup is off in `config.toml`. Several functions only check
that the caller is signed in, so with signup open a stranger's login can spend
the AI credit and send email from the business's domain. A new person is always
attached to the *caller's* business, never one named in the request.

**A STOP follows the person, not the job.** It is stored per business against
the phone number (`sms_opt_outs`, migration 030) and also flags that client's
existing jobs. `send-client-message` checks the list on every send, so a job
booked after the reply is still suppressed. `CANCEL`/`END`/`QUIT` opt out only
as the whole message, because "cancel tomorrow" is an appointment.

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
- **Run migration 030** (`sms_opt_outs`, `record_sms_opt_out`). Until it runs,
  STOP replies cannot be recorded; `send-client-message` treats the missing
  table as an empty list and logs a warning rather than refusing to send.
- **Deploy** `sms-inbound` and `invite-user` (new), and redeploy
  `send-client-message`, `send-due-reminders`, `send-report-email` and
  `schedule-agent` (changed). All import `_shared/`, so deploy with the CLI
  rather than pasting into the dashboard.
- Set `SMS_INBOUND_TOKEN` in Supabase secrets, then add a ClickSend inbound
  rule pointing at `.../functions/v1/sms-inbound?token=<it>`. Text STOP from
  your own phone and check `public.sms_opt_outs` **before** trusting it. The
  function reads `from` and `body`/`message`; confirm that matches what
  ClickSend's rule actually posts — this has not been run against ClickSend.
- **Turn off "Allow new users to sign up" in the hosted project's Authentication
  settings.** `config.toml` now says off, but it configures the local stack and
  `supabase config push`, not the live project by itself.
- Set `CLICKSEND_USERNAME` / `CLICKSEND_API_KEY` in Supabase secrets — until
  then day-before reminders go by email instead of SMS
- Verify the sending domain at Resend
- Business details (ABN, address, website) are blank and **print on reports**

**Known open issues:**
- The team screens exist (v96) but have **not been used against a real
  Supabase project**: Team (More → Team, admin only) lists people and calls
  `invite-user`; a set-your-password screen appears for anyone who arrives from
  an invitation or reset link; the login screen has "Forgot your password?".
  Two things have to be right in the hosted project for the emailed paths to
  work: the app's address (`https://arcadianpestsolutions-a11y.github.io/field-inspect/`)
  must be in Authentication → URL Configuration (site URL / redirect URLs), and
  the project must be able to send email. Set the `APP_URL` secret to the same
  address so invitations land on the app. Detection of an invitation link
  assumes `type=invite` or `type=recovery` arrives in the URL; if a link ever
  signs somebody in without showing the screen, that assumption is the first
  thing to check. Creating the person with a temporary password avoids all of it.
- A second *business* still cannot be created from anywhere. `invite-user` adds
  people to an existing one. Who creates a business, and how, is undecided.
- Business name still has a hardcoded default (`'Arcadian Pest Solutions'`) in
  `client-portal` and `send-client-message`, read from `BUSINESS_NAME` when set.
  The other three functions now read the organisation row.
- Other replies to a reminder ("can't make it tomorrow") still land only in the
  SMS provider's inbox. STOP is handled; conversation is not.
- A STOP is never reversed by `START`. Re-subscribing a client is a manual edit.
- `report.js` is 4,182 lines. The audit rules are out (v95); the next
  candidates are the PDF building (`buildReportBodyHtml` and friends) and the
  station/product list renderers.

**Not built:** quote → accept → pay online (Stripe), 2FA/SSO, Zapier.

**The largest unknown: the app has never been used on a real inspection.**
Every claim above is a claim until it survives a day in a subfloor. The Edge
Function changes in this round were syntax-checked and their pure logic is
under test, but none has been deployed or run against Supabase or ClickSend.

---

## Comparison to the commercial alternative

Formitize (AU, ~$29.99/user/month ex GST plus add-ons) is the realistic
competitor. It is ahead on: client portal maturity, quote-accept-pay, sales
pipeline, Zapier/Mailchimp/QuickBooks, ISO 27001, and having support staff.

Scope is genuinely ahead on three narrow things: the documents are encoded as
*logic* rather than form-builder output; AI drafting from photos with measured
accuracy; and availability that refuses slots that cannot physically be driven
to. It is better at being *this* business's app. It is not a product.
