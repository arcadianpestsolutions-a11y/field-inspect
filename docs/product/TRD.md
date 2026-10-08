# Technical Requirements Document - Scope

See also `../ARCHITECTURE.md` (script map) and `../AUDIT.md` (findings, debt).

## 1. Platform and stack
| Layer | Choice | Constraint |
|---|---|---|
| Front end | Vanilla JS (IIFEs, `window.X` globals), HTML, one CSS file | **No build step.** No npm, bundler or TypeScript in the front end |
| Local data | IndexedDB `field-inspect-db`, DB_VERSION 9 | Never rename the DB or the `/field-inspect/` Pages path |
| Offline | Service worker, cache-first app shell, versioned `CACHE_NAME` | Must equal `APP_VERSION`; precache uses `cache: 'reload'` |
| Hosting | GitHub Pages (static) | Cannot set response headers (affects CSP) |
| Back end | Supabase: Postgres 17, Auth, Storage (`inspection-media`, private), Edge Functions (Deno) | Free plan today |
| Third parties | Anthropic and OpenAI (AI), Resend (email), ClickSend (SMS), Xero (accounting), OpenStreetMap Nominatim (addresses) | Keys are Edge Function secrets, set by the owner only |
| Vendored libs | supabase-js, html2pdf (jsPDF, html2canvas), jsQR, qrcodejs | See `THIRD-PARTY-NOTICES.md` |

## 2. Architectural requirements
| ID | Requirement |
|---|---|
| A1 | Every write goes to IndexedDB first; sync is background, resumable, and failure never blocks the user |
| A2 | Sync: last-write-wins on `updatedAt`; deletes are tombstones; reads paged below 1000 rows (PostgREST cap); a failed page throws |
| A3 | Multi-tenancy by the database: `org_id` defaults to `my_org_id()`; RLS on every table; null fails closed |
| A4 | `service_role` bypasses RLS, so each Edge Function filters by org itself, and its table grants are the minimum it uses (migration 033) |
| A5 | Every new table needs an explicit GRANT and a named, idempotent policy (drop before create) |
| A6 | Anything that contacts a client is decided server-side from a job id; the caller never names the recipient |
| A7 | One report per job (`reports` keyed by `job_id`); SWMS is a separate store |
| A8 | Derived data is a view, never a second store (station register) |
| A9 | Pure logic modules (invoicing, availability, routing, reporting, assets, clients, pipeline) have no DOM or DB access and take an injectable clock |
| A10 | Dates: never step by `86400000` ms (DST); never `Date.parse` a bare ISO date (UTC); use local-date helpers |
| A11 | Demo (`?demo=1`) and test (`?test=1`) modes use separate databases and perform no network writes or client contact |

## 3. Security requirements
| ID | Requirement | Status |
|---|---|---|
| S1 | Only the publishable key in client code; no secret in any commit | Verified across 104 commits |
| S2 | All untrusted text escaped via `HtmlSafe.escape`; stored images via `imageSrc`; class names via `token` | Done v106 |
| S3 | Token/secret-in-URL functions (`client-portal`, `calendar-feed`, `sms-inbound`) run with JWT verification OFF, recorded in `config.toml`, with tokens unguessable and revocable | Done |
| S4 | Opt-outs are by phone number and survive new jobs; sending fails closed if the list cannot be read | Done |
| S5 | A client portal link exposes one job's report only; signature images are never returned | Done |
| S6 | Content-Security-Policy | **Not done** (print windows need rework first) |
| S7 | 2FA for staff | **Not done** |
| S8 | Pin the server-side supabase-js import version | **Not done** |
| S9 | Real client data is never used in tests; test fixtures are invented | Done v106 |

## 4. Non-functional targets
| Area | Target |
|---|---|
| Offline | Full capture, report editing and finalising with no signal; sync on reconnect |
| Start-up | App shell from cache; usable offline from cold start |
| Capacity (current) | Hundreds of jobs, tens of thousands of photos; database about 13 MB, storage about 31 MB today |
| Devices | iOS Safari / installed PWA and Android Chrome. Native `confirm`/`prompt` do not render on iOS home-screen apps, so all questions use `Dialog` |
| Back button | One sentinel history entry; Back closes dialogs and steps up the screen stack rather than leaving the app |
| Accessibility | Tap targets suitable for gloves; text legible in sunlight (see design brief) |
| Reliability | Zero silent failures: an unchecked query error is a defect. Failure text never implies lost work |
| Observability | `ErrorLog` captures uncaught and tagged caught failures locally and uploads to `client_errors`, deduplicated |
| Recovery | Backup at most 7 days old; restore procedure tested at least once (not yet done) |
| Privacy | Client data only to the business, the client, and listed processors; opt-out honoured within one send cycle |

## 5. Testing requirements
* Browser suite `tests/run-tests.html`: 422 tests, no framework, about 70 s, own
  IndexedDB. **Two clean back-to-back runs before any release.**
* Use `waitFor(predicate)`, never fixed waits. Tests must not depend on today's date.
* New behaviour needs a test that fails when the fix is reverted.
* Source-assertion tests guard cross-file contracts (registration in three
  places, version match, last-script rule, server error handling).
* `tests/chaos.js` and `chaos-scenarios.js`: random tapper and 14 out-of-order
  scenarios; demo mode only.
* Never test against live client data. No live sends, sweeps or dry-runs.
* Not present: CI, linting, coverage measurement, end-to-end tests on real devices.

## 6. Release and operations
1. Edit in the working folder; run the suite twice.
2. Bump `CACHE_NAME` (sw.js) and `APP_VERSION` (version.js).
3. Copy to the deploy repository, commit, push; confirm live by polling `version.js`.
4. New SQL: run in the SQL editor (with grants); verify with `has_table_privilege`.
5. Deploy changed functions with the CLI; add `--no-verify-jwt` for the four token-auth functions.
6. Probe a deployed function unauthenticated: 401 means deployed, 404 means not.
7. Weekly: `tools/backup-scope.ps1` (see `../BACKUP-RUNBOOK.md`).

## 7. Known technical debt
Listed with reasoning in `../AUDIT.md`: two very large files, duplicated
helpers, two-folder workflow, no linter/CI, no CSP, unpinned server import,
no in-app restore.

## 8. Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Missing migration or GRANT fails quietly | High (happened 4 times) | Privilege audit method in migration 033; check errors on every query |
| Stale mixed builds after deploy | Medium | `cache: 'reload'`, version label on login screen |
| Total data loss (free plan) | Low, severe | Weekly backup script; Pro plan decision |
| Messaging the wrong client | Low, severe | Server-side recipient, halt-on-unrecorded-send, no live testing |
| AI presents a wrong finding | Medium | Suggest-only, confirm gates, accuracy tally |
| Single maintainer, unproven in the field | High | Reviewer-ready docs; first real inspection day |
