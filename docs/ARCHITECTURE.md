# Architecture

Scope (internal folder name `field-inspect`) is an offline-first field-inspection
PWA for a pest-control business. It runs from static files on GitHub Pages and
talks to one Supabase project.

```
 Phone / browser (static files, no build)
 ┌──────────────────────────────────────────────┐
 │ index.html ── <script> tags in a fixed order │
 │ sw.js  (service worker: offline app shell)   │
 │ UI modules ──► db.js ──► IndexedDB           │
 │        └────► sync.js ──► Supabase (REST)    │
 │        └────► ai.js / comms.js / email.js /  │
 │               xero.js / client-link.js       │
 └─────────────────────┬────────────────────────┘
                       │ HTTPS (publishable key + user session)
 ┌─────────────────────▼────────────────────────┐
 │ Supabase: Postgres (+RLS), Auth, Storage,    │
 │ Edge Functions (Deno) ──► Anthropic, OpenAI, │
 │ Resend (email), ClickSend (SMS), Xero        │
 └──────────────────────────────────────────────┘
 Clients (no login): portal.html ──► client-portal function (token in URL)
 ClickSend ──► sms-inbound function (secret in URL)
 Calendar apps ──► calendar-feed function (token in URL)
```

## Principles
1. **The phone is the source of truth while working.** Everything writes to
   IndexedDB first; sync is best-effort and resumable. There is no signal under
   a house.
2. **No build step.** Plain `<script>` tags, IIFEs, `window.X` globals. Order in
   `index.html` is the dependency graph.
3. **Anything that contacts a client is decided server-side**, from a job id,
   never from an address the browser supplies (`send-client-message`).
4. **Failures are said plainly and never imply lost work.** Wording lives in pure
   `*Messages` objects so tests can assert on it.

## Adding a script (three places, always)
`index.html` (order matters; `nav-history.js` must stay last), `sw.js`
`APP_SHELL`, and, if the file is loaded standalone by the suite,
`tests/run-tests.html`. Bump `CACHE_NAME` in `sw.js` and `APP_VERSION` in
`version.js` together on every release (a test checks they match).

## Script map (load order in index.html)
| Group | Files | Role |
|---|---|---|
| Boot | `error-log.js`, `version.js`, `supabase-config.js` | Error capture, build id, publishable key |
| Safety/UI primitives | `html-safe.js`, `dialog.js`, `ios-install.js` | Escaping; in-app confirm/prompt (native ones do not render in iOS home-screen apps) |
| Data | `db.js` | IndexedDB wrapper (`DB_VERSION` 9). Stores: jobs, captures, reports, swms, leads, clients, invoices, sectionDrafts, deletions |
| Schemas (pure data) | `report-schema.js`, `pest-treatment-schema.js`, `termite-management-schemas.js`, `swms-schema.js`, `photo-checklists.js`, `pest-products.js`, `form-render.js` | What each document contains; generic renderer |
| Pure logic | `invoicing.js`, `availability.js`, `routing.js`, `reporting.js`, `assets.js`, `clients.js`, `pipeline.js` | Maths and rules with no DOM; best covered by tests |
| Device | `camera.js`, `qr-scan.js`, `geo.js`, `media.js` | Capture, scan, location, photo upload |
| Cloud | `sync.js`, `org.js`, `xero.js`, `ai.js`, `email.js`, `comms.js` | Everything that leaves the device |
| Feature UI | `today.js` (pure: builds today's plan), `today-ui.js` (the Today screen), `job-layout.js` (orders the cards on the job screen: next step, client, settings), `tabbar.js` (bottom tab bar: Today, Jobs, Diary, Enquiries, More; shown only on top-level screens), `job-details.js` (job card: Call, Directions, Edit), `reminders-ui.js`, `reminder-nudge.js`, `backup.js`, `report.js`, `invoice-ui.js`, `swms-ui.js`, `business-ui.js`, `assets-ui.js`, `leads-ui.js`, `clients-ui.js`, `client-link.js`, `scheduler.js`, `schedule-agent.js`, `calendar-feed.js` | Screens |
| Shell | `demo.js`, `app.js`, `nav-history.js` | Boot, routing, phone Back button |
| Test only | `tests/chaos.js`, `tests/chaos-scenarios.js` | Random tapper; refuses to run unless in demo mode |

## Modes
* **Live**: real Supabase session.
* **Demo** (`?demo=1`): separate IndexedDB `field-inspect-db-demo`, no network
  writes, no client contact. The only mode for manual poking.
* **Test** (`?test=1`): IndexedDB `field-inspect-db-test`, used by the suite.
`comms.js`, `sync.js` etc. do nothing in demo/test mode.

## Sync model (`sync.js`)
Last-write-wins on `updatedAt`. Deletes are tombstones (`deletions` table / store)
so a delete on one device is not undone by another. Reads are paged (PostgREST
caps at 1000 rows); a failed page throws rather than pretending a table was
fully read. Photos/files go to the private Storage bucket `inspection-media`.

## Server (Supabase)
Migrations `supabase-schema.sql` then `supabase-migration-002 … 033` (run in
order in the SQL editor; all applied to the live project as of 8 Oct 2026).
Rules learned the hard way:
* Every table needs **RLS and an explicit GRANT**. A missing GRANT fails quietly
  with 42501 "permission denied" before RLS is consulted (migrations 009, 028, 033).
* `service_role` bypasses RLS, so its grants are its only limit; migration 033
  trimmed them to what each function actually uses.

### Edge functions
| Function | Who may call | JWT setting | Purpose |
|---|---|---|---|
| `analyze-inspection` | signed-in user | on | AI draft, pest/tree id, photo sorting |
| `schedule-agent` | signed-in user | on | Booking assistant (proposals only; client executes) |
| `send-report-email` | signed-in user | on | Email a PDF report (Resend) |
| `check-email-status` | signed-in user | on | Delivery status from Resend |
| `xero` | signed-in user | on | OAuth + draft invoices; tokens only server-side |
| `send-client-message` | signed-in user, or service key (schedule) | on | Booking/report/day-before/reminder messages; recipient read from the job row |
| `client-portal` | anyone with a valid link token | **off** | Client report page and quote acceptance |
| `sms-inbound` | ClickSend, secret `?k=` | **off** | STOP handling and replies |
| `calendar-feed` | calendar apps, token | **off** | .ics feed |
| `send-due-reminders` | retired (410) | off | Kept so old schedules fail loudly |
JWT-off flags are recorded in `supabase/config.toml` so they survive redeploys.
Shared server code is in `supabase/functions/_shared/` and is unit-tested by the
browser suite (it fetches the .js files).

## Browser storage keys
`scope-last-backup`, `scope-error-log-v1`, `scope-reminder-nudge-dismissed`,
`scope.business.period`, `scope.org.v1`, `scope.me.v1`, `scope.roster.v1`,
`field-inspect-last-rates`. All reads/writes are try/catch-wrapped; the app must
work with storage blocked.

## Security model in one paragraph
Publishable key only in client code. Staff identity = Supabase Auth; business
membership = `user_roles`; data isolation = RLS keyed on org. Clients and SMS
providers authenticate by an unguessable token/secret in the URL. Untrusted text
reaches markup only through `HtmlSafe.escape`; stored images through
`HtmlSafe.imageSrc`; class names through `HtmlSafe.token`. No CSP is set (see
AUDIT.md).
