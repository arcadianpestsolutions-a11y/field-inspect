# Code audit - findings, fixes, and what is still open

Audit of 8 Oct 2026 (build v106; round 2 below, v107). Method: read-only scripts over the whole
repository plus comparison of the **live** database catalogue with what the code
actually does. Nothing here was assumed from the migrations.

## Scope and numbers
~49 app JS files (≈21,900 lines), 4 test files (≈10,000 lines, 422 tests, all
passing), 11 Edge Function folders, 33 SQL migrations, 1 stylesheet, 4 vendored
libraries. No `package.json`, linter, formatter or CI (see Known debt).

## Checked and clean
* **Secrets**: scanned every file in all 104 commits. None found. The only key in
  client code is the public `sb_publishable_` key, which is designed to be public.
* **Row-level security** is enabled on all 19 public tables.
* **No TODO/FIXME** markers; no UTC-vs-local date misuse remaining.
* **No business-specific values in application code**; the business's own details
  live in the database (`organisations`, seeded by migration 022 on purpose).

## Fixed in this audit
| # | Finding | Fix |
|---|---|---|
| 1 | **Business details could not be saved by anyone.** Migration 022 wrote an admin-write policy but granted only SELECT, so every Save failed with 42501. | Migration 033 grants UPDATE; proven before/after by role impersonation in a rolled-back transaction. |
| 2 | Client portal never showed invoices (service role lacked SELECT; error unchecked). | Grant + the query now logs on error. |
| 3 | Xero token storage lacked grants (connect would appear to work, then "not connected"). | Grant; load/save/disconnect now **throw** on a database error. |
| 4 | `service_role` (which bypasses RLS) held rights nothing used (delete/update on several tables, TRUNCATE etc.). | Revoked in 033; verification query returns 19/19 `ok`. |
| 5 | **Possible duplicate client texts**: if the "sent" stamp failed after an SMS went out, the next sweep would send again. | `markSentAndLog` reports the failure; the sweep halts, says why, and the app shows it without dismissing the banner. |
| 6 | Eleven server queries dropped their `error` and carried on. | Each now logs or throws; `send-client-message` refuses to continue if it cannot read the caller's business. |
| 7 | Nine private copies of `escapeHtml`; three used a DOM round-trip that does **not** escape quotes (unsafe in attributes, e.g. `<option value="…">`, `data-technician`). | One implementation, `html-safe.js` (`HtmlSafe.escape`), used everywhere. |
| 8 | Signature/sketch data URLs were interpolated raw into the printed report's `<img src>`. | `HtmlSafe.imageSrc` accepts only base64 png/jpeg/webp. |
| 9 | Job status from synced data was used raw as a CSS class. | `HtmlSafe.token`. |
| 10 | Two dead functions (`shutterFeedback`, `getCurrentUserEmail`). | Deleted. |
| 11 | Real business phone/ABN/email/name/address were used as test fixtures in a public repo. | Replaced with invented values. |
Every behavioural fix has a test (suite groups "HtmlSafe", "Audit:", "Comms: a halted sweep…").

## Round 2 (v107): exploratory testing and UI review
Found by random-tapping the demo app (~2,400 steps), probing by hand, and reading
the screens. Each has a test that fails on the old code (13 do, confirmed by running
the suite against v106) and passes now. Full UI findings: `docs/UI-REVIEW.md`.
| # | Finding | Fix |
|---|---|---|
| 12 | A report, invoice or photo could be saved for a job that had been **deleted** (a late autosave or camera frame), leaving orphans that sync would push at a job the server no longer has | `DB.assertJobAlive` refuses the write with a plain message |
| 13 | A failed photo or voice-note save was **silent** (no message, no record) | Try/catch with "That photo was NOT saved..." (storage full is named) and an error-log entry |
| 14 | The browser was never asked to protect the app's data from eviction while a photo exists only on the phone | `navigator.storage.persist()` requested at start |
| 15 | A job's name, phone, email and address **could not be edited** after creation | `job-details.js`: Edit form, Call, Email, Directions |
| 16 | A double tap on Create Job made two jobs and two clients; same for new enquiry, client and safety statement | One-at-a-time guard on each |
| 17 | "New enquiry" and "New client" saved a blank record immediately; backing out left it; an enquiry with no name could become a blank job | Blank records removed on Back; convert refuses without a name |
| 18 | Jobs with no name rendered as an empty card; a leftover search could hide every job with no way back; no phone search | Falls back to address; "Show all jobs"; search matches phone digits |
| 19 | No length limits or phone/email keyboards on several fields | `maxlength`, `inputmode`, `autocapitalize` |
| 20 | Titles cut to ~12 characters by wide capitals; dangling separators; floating button over content | CSS fixes |

Not found this round: no crash, no unreachable control, no sideways scroll at 320 px,
and no console error in ~2,400 random steps after the fixes.

## Known debt (stated plainly, not hidden)
1. **Two giant closures**: `app.js` (~2,600 lines) and `report.js` (~4,400). Each
   has a table of contents in its header. Splitting the form renderer and print
   view out of `report.js` is the obvious first refactor.
2. **Duplicated helpers**: `toast` (12 copies), `askConfirm` (11), `el` (12),
   `fmtDate` (6), `pad` (7), `uid` (4), `money` (2), `plural` (2). Each is tiny
   and behaves the same; consolidating them into a shared module is mechanical.
   `window.technicianDisplayName` is defined in both `app.js` and `report.js`.
3. **No build tooling**: no package.json, linter, formatter, type checking, or CI.
   Tests are a browser page run by hand (plus a demo-only random tapper).
4. **Two-folder workflow**: development happens in one folder and is copied into
   the git checkout that deploys. It works but a single repository would be safer.
5. **No Content-Security-Policy.** GitHub Pages cannot set headers; a `<meta>` CSP
   is possible but the print windows use `document.write` and an inline
   `onclick="window.print()"`, which would need reworking first.
6. **Edge functions import `@supabase/supabase-js@2` from esm.sh unpinned.** A
   breaking release would affect the next deploy. Pin a version.
7. **No in-app restore.** Export exists (`Backup`), and `tools/backup-scope.ps1`
   backs up the whole project; restoring is a documented manual procedure
   (`docs/BACKUP-RUNBOOK.md`). Free Supabase plan has no automatic backups.
8. **No 2FA** for staff accounts; no self-service signup/invite flow.
9. **Cross-device concurrency** is last-write-wins on `updatedAt`; two people
   editing the same record offline will lose one edit (by design, documented).
10. Vendored libraries are not checksum-verified (see THIRD-PARTY-NOTICES.md).

## What to leave out when sending the code
`.tools/` (Supabase CLI binary), `ai-trial/`, `.claude/`, `MenOfWarClone/`,
`mow3-sounds/` and any `Scope-Backups` folder. They are not part of Scope.
