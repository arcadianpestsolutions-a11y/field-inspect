# Implementation Plan - Scope

State at build v106 (8 Oct 2026). Order follows the owner's stated priority:
**trustworthy AI first, then no lost work, then client-facing gaps.** Sizes are
rough working effort, S under a day, M one to three days, L a week or more.

## 1. Where we are
| Area | State |
|---|---|
| Core field workflow (jobs, capture, reports, invoices) | Built, 406 automated tests passing |
| Client messaging (email, SMS, STOP) | Built; **needs the owner's secrets to go live** |
| Client portal and quote acceptance | Built |
| Backups | Script and runbook built; **not yet run or restore-tested** |
| Reviewer docs and audit | Done (v106) |
| Real-world use | **Never used on a real inspection** |

## 2. Phase 0 - Owner actions (no code; unblocks everything else)
| # | Task | Owner | Result |
|---|---|---|---|
| 0.1 | Install PostgreSQL 17+ command line tools; run `tools/backup-scope.ps1 -Check`, then a full backup | Tal | First real backup |
| 0.2 | Practise one restore into a throwaway project | Tal | Backup proven, not assumed |
| 0.3 | Set `CLICKSEND_USERNAME` / `CLICKSEND_API_KEY` | Tal | SMS reminders live |
| 0.4 | Set `SMS_INBOUND_TOKEN`; add the ClickSend inbound rule pointing at `sms-inbound?k=...` (currently answers 503 until set) | Tal | STOP replies recorded |
| 0.5 | Verify the sending domain at Resend | Tal and IT | Emails reach clients |
| 0.6 | Phone checks: v102 Back button, v105 backup share sheet; retry "add a job" | Tal | Confirms field fixes |
| 0.7 | Decide photo protection: Supabase Pro vs weekly script | Tal | Closes PRD decision 1 |
| 0.8 | Register "Arcadian Pest Solutions" under the Pty Ltd ABN | Tal | Legal name matches reports |

## 3. Phase 1 - Prove it in the field (highest value)
Goal: one full real inspection day, using the app as the only record.
| # | Task | Size |
|---|---|---|
| 1.1 | Pre-flight checklist for the day: backup taken, phone charged, app updated to latest version label | S |
| 1.2 | Shadow day: also keep paper notes; compare afterwards | - |
| 1.3 | Log every friction point (use the in-app error log copy) | S |
| 1.4 | Triage into fix-now (data loss, wrong wording) / soon / later | S |
Exit: a finalised, defensible report produced on site, offline, with no retyping.

## 4. Phase 2 - Trustworthy AI
| # | Task | Size |
|---|---|---|
| 2.1 | Keep structural-damage suggestions explicitly "unverified"; never auto-fill findings | S |
| 2.2 | Build a graded test set of real (consented, anonymised) photos; re-measure accuracy per category each time the model or prompt changes | M |
| 2.3 | Show the accuracy tally to the user per category, not one number | S |
| 2.4 | Pin model ids and prompt versions in `analyze-inspection`; record them on the report audit trail | S |
Exit: published accuracy per category; no category presented as reliable that is not.

## 5. Phase 3 - No lost work
| # | Task | Size |
|---|---|---|
| 3.1 | Automate the weekly backup (Windows Task Scheduler running the script; password prompt design needed) | M |
| 3.2 | In-app restore from the JSON export, with a dry-run summary ("this will add 12 jobs, change 3") | L |
| 3.3 | Conflict visibility: when a newer remote copy overwrites a local edit, keep the loser in the audit trail | M |
| 3.4 | Photo upload queue visibility ("14 photos waiting") | S |
| 3.5 | Decide and implement Supabase Pro or off-site photo copy | S |
Exit: a tested, documented restore; no silent overwrites.

## 6. Phase 4 - Client-facing gaps
| # | Task | Size |
|---|---|---|
| 4.1 | Confirm reminder end-to-end with Tal's own phone as the only recipient (never real clients) | S |
| 4.2 | Optional outbound allow-list `SMS_ALLOWED_NUMBERS` for test periods | S |
| 4.3 | Re-check that no Edge Function hard-codes the business name (none found by search on 8 Oct 2026; the older handover said some did) | S |
| 4.4 | Quote -> accept -> pay online (Stripe) | L |
| 4.5 | Branded client portal (logo, colours from `organisations`) | M |
| 4.6 | Unsubscribe link in email as well as SMS STOP | S |

## 7. Phase 5 - Engineering health (what a reviewer will weigh)
| # | Task | Size |
|---|---|---|
| 5.1 | Move to a single git repository (remove the two-folder copy step) | M |
| 5.2 | Shared `common.js`: consolidate `toast`, `askConfirm`, `el`, `fmtDate`, `pad`, `uid`, `money` | M |
| 5.3 | Split `report.js` (form renderer, print view) and `app.js` | L |
| 5.4 | Pin `@supabase/supabase-js` import version in every function | S |
| 5.5 | Add a linter and a CI job that runs the browser suite headless | M |
| 5.6 | Content-Security-Policy via `<meta>`; first remove `document.write` and inline `onclick` from print windows | M |
| 5.7 | Checksums for vendored libraries; full licence texts | S |
| 5.8 | Decide whether to keep or remove the gap at migration 023 (document it) | S |
Exit: new contributor can clone, run, test and release from the README alone.

## 8. Phase 6 - Growth (only if opening to other businesses)
Signup and invites, 2FA/SSO, per-business branding and settings, billing,
support tooling, tenant-isolation test suite run in CI, data-processing terms and
privacy policy, SLA and monitoring. Changes the risk profile completely; treat as a
separate project with its own PRD.

## 9. Standing release checklist
1. Change made; test written first or alongside; confirm it fails with the fix reverted.
2. Suite run twice back to back, all green.
3. Bump `CACHE_NAME` and `APP_VERSION` together.
4. Copy to the deploy repository (do not carry CRLF noise), commit, push.
5. Confirm live by polling `version.js`.
6. SQL: run, then verify privileges; Functions: deploy, then probe unauthenticated.
7. No live sends, sweeps or dry-runs against real client data, ever.
8. Update docs if behaviour changed (`docs/`, header blocks, this plan).

## 10. Risks to the plan
| Risk | Effect | Response |
|---|---|---|
| Phase 1 finds a data-loss bug | Reorders everything | Stop feature work until fixed |
| Secrets not set | Reminders silently fall back to email | Phase 0 first; the app states the fallback |
| Single maintainer unavailable | No one can release | Phase 5 docs and CI; keep runbooks current |
| Free plan limits | Outage or data loss | Pro decision (0.7), backups (3.1) |
| Scope creep into SaaS | Never ships | Hold Phase 6 behind an explicit owner decision |
