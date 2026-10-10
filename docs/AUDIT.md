# Code audit - findings, fixes, and what is still open

Audit of 8 Oct 2026 (build v106; round 2 below, v107). Method: read-only scripts over the whole
repository plus comparison of the **live** database catalogue with what the code
actually does. Nothing here was assumed from the migrations.

## Scope and numbers
~49 app JS files (≈21,900 lines), 4 test files (≈10,300 lines, 513 tests, all
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
| 21 | Start Inspection could act on the **wrong job**, or none: the camera permission prompt can take seconds, and after Back (or opening another job) the code read the job from "whichever is open now" | Remembers the job the tap was for; if the person has left it, lets the camera go and does nothing |
| 22 | Deleting a job (or photos) was instant and final, here and in the cloud, with no in-app restore | A ten-second **Undo**: the item vanishes from every screen at once but nothing is deleted until the time is up, so closing the app mid-window loses nothing (`undo-delete.js`) |
| 23 | Absurd invoice amounts (quantity 1e300 x price 1e300) made totals thousands of pixels wide and stretched the screen sideways | Quantity capped at 100,000 and unit price at $1,000,000, in the input and again in the arithmetic; money text wraps |
| 24 | Job screen and list printed the day the record was **created** next to the address, which reads like the appointment | "Booked Sun, 11 Oct, 8am" when booked, "Added 9 Oct 2026" when not (`Today.dateLine`); the list shows just the address for a booked job because its badge already says when |
| 25 | The browser/status-bar colour was navy; the app is near-black green | `theme-color` and the manifest colours now match the app background (a test keeps them equal) |
| 26 | Plan and Reassign wrote to "whichever job is open when the question closes"; leaving the job meanwhile threw errors or pulled you back into it | Each remembers the job the tap was for; the screen is redrawn only if you are still on it |
| 27 | Asking the database for a job, report or update with no id threw an IndexedDB error | Answers "nothing"; opening or saving a report with no job id is refused in plain words |
| 28 | The Undo bar sat on top of Finalize, Save and "+ New enquiry" for its ten seconds | It only shows on the job list and the job, steps aside on other screens (the delete keeps waiting), and sits above the "+ New Job" button |
| 29 | Contrast had never been measured. Measured on every main screen: dark had near-misses (status badges and due dates at 4.1-4.3:1) | Dim text and the red lifted slightly; `tests/contrast.js` now fails the suite if any text on any main screen, in either theme, drops under WCAG AA |
| 30 | The sync bar said "Signed in as ... Synced 3:15 PM" and nothing about photos still only on the phone; "Sync now" gave no sign it was working; a first sync on a new phone showed "No jobs yet" | `sync-state.js`: one honest state (dot + sentence), a count of photos not uploaded, a spinning disabled "Sync now", placeholder cards during the first sync, pull-to-sync, an upload marker on each unsent photo |
| 31 | Deleting an enquiry, client or safety statement was instant and final | The same ten-second Undo as jobs and photos, shown on that list; a client's jobs are only unlinked once the delete really happens |
| 32 | The Export file could not be read back by anything | Archive screen: "Restore from a backup file" (`restore.js`). Shows what it will add or update first, never deletes, never replaces a newer copy, leaves deliberate deletes deleted, keeps original timestamps so a sync cannot be fooled |
| 33 | Two people editing the same record offline: whichever device synced last replaced the whole record, so the other person's edit vanished without a word, even if they had changed a different field | `sync-merge.js`: each device remembers the last copy both sides agreed on (`syncBase` store, DB v10) and merges field by field against it. Different fields: both kept. Photo lists and the audit trail: combined. Same field changed on both: the later save wins and the other value is listed under More > Saved reports, "Changes that clashed" (`sync-conflicts.js`) |
| 34 | On a narrow phone a long toast message wrapped into a ball half the screen wide | The toast sizes to its text, up to the screen width, with a rounded box instead of a pill |

Not found this round: no crash, no unreachable control, no sideways scroll at 320 px,

Seen once in random testing and **not reproduced** in later runs (recorded so they are not forgotten): (a) the invoice screen measured 22,982 px wide in one run, probably the absurd-amounts bug above; (b) two screens (job and report section) visible at once after tapping Discard and Back in the same instant. If either returns on a real phone, start from the chaos tool's `lastActions` for that finding.
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
7. **In-app restore exists (v116) but only for the Export file.** It adds and updates records and never deletes; photos are not in that file. A whole-project restore (database + photos) is still the manual procedure in `docs/BACKUP-RUNBOOK.md`. Free Supabase plan has no automatic backups.
8. **No 2FA** for staff accounts; no self-service signup/invite flow.
9. **Cross-device concurrency** is merged field by field since v117. When two
   people change the *same* field before syncing, the later save still wins;
   the other value is not lost silently but listed under "Changes that clashed"
   for a person to put back by hand. Photos (captures) are still whole-record,
   later-wins. Not yet tried with two real phones.
10. Vendored libraries are not checksum-verified (see THIRD-PARTY-NOTICES.md).

## What to leave out when sending the code
`.tools/` (Supabase CLI binary), `ai-trial/`, `.claude/`, `MenOfWarClone/`,
`mow3-sounds/` and any `Scope-Backups` folder. They are not part of Scope.
