# App Flow - Scope

Screens are the `view-*` sections in `index.html`; `app.js` routes between them
and `nav-history.js` ties the phone's Back button to them. Client-facing pages
are `portal.html` and text/email messages.

## 1. Screen inventory
| Screen (id) | Reached from | Purpose |
|---|---|---|
| Login (`view-login`) | Start, sign-out | Email + password via Supabase Auth; shows build label |
| Home (`view-joblist`) | Login, Back from anywhere, or the Today / Jobs tabs of the bottom bar | Two tabs. **Today** (default): today's jobs in time order with Start, Call, Directions, drive time between jobs, anything still owed from earlier days, tomorrow at a glance. **All jobs**: search, status and technician filters, new job. Choice is remembered |
| Job (`view-job`) | Job list | Photo gallery, start/finish inspection, voice, status, links to report/invoice |
| Report chooser (`view-report-btn`) | Job | Which document type this job produces |
| Report (`view-report`) | Job | Section list, AI draft, pre-flight, finalise |
| Report section (`view-report-section`) | Report | One section's fields, autosaved |
| Invoice (`view-invoice`) | Job | Line items, totals, send to Xero |
| Clients / Client | Menu | Client records and their job history |
| Leads / Lead | Menu | Pipeline and follow-ups |
| Scheduler (`view-scheduler`) | Menu | Diary, availability, booking assistant |
| Assets / Property / Stickers | Menu | Station register, QR stickers |
| SWMS list / SWMS / section | Job or menu | Safe Work Method Statement |
| Business (`view-business`) | Menu | Business details; period figures |
| Archive (`view-archive`) | Menu | Saved reports, backup status and export |

## 2. Core flow: a job from call to paid
```
Enquiry -> Lead (optional) -> Job created -> Booked in diary
   -> Booking confirmation (email/SMS) -> Day-before reminder (SMS)
   -> Inspection (capture) -> Report (draft, edit, pre-flight, sign)
   -> Finalise -> Email PDF / client link -> Invoice -> Xero
   -> Completed -> Re-inspection reminder (annual) -> new recurring job
```

### 2.1 Create a job
1. Job list -> New. Enter client name, phone, email (or pick a client), address
   (autocomplete suggests AU/NZ results), job type, optional schedule and recurrence.
2. Save writes to IndexedDB at once; sync follows. On save with a new time, a
   booking confirmation is requested server-side. A refusal (opted out, no
   email, invalid) is shown as plain text and the job is still saved.

### 2.2 Inspect
1. Open job -> Start Inspection. The inspection screen opens on one instruction: photograph the front of the property (landscape; it becomes the report cover). **Since v129 every photo is taken with the phone's own camera app**: **Take photo** opens it (proper focus, flash, zoom, low light), the technician shoots and taps the tick, and the photo comes back to the step on screen and shows where a viewfinder used to be. **Gallery** brings in photos already on the phone. Scope asks for no camera permission. Each photo is kept at most 2048 px on its long side (photo-prep.js), the right way up.
   For a **timber pest inspection** (v118) the screen then says "Front photo saved. Next: Meter Box" and walks the property one step at a time, in walking order:
   - **Outside:** meter box (durable notice), slab edge, weep holes, air con unit, hot water system, water tanks / downpipes, garden beds against walls, external timbers, trees and stumps, sheds and stored items.
   - **Subfloor:** "Is there a subfloor?" **Yes, going under**: entry, piers and ant capping, damp / ventilation. **Yes, but I can't get in**: one photo of why. **No, it's a slab**: no subfloor photos.
   - **Roof void:** "Is there a roof void?" **Yes, going in**: entry, roof timbers. **Yes, but I can't get in**: one photo of why. **No roof void**: nothing.
   - The answers go into the report (v119): a slab sets Floor Type to Concrete Slab and Subfloor drainage to Not applicable; a subfloor turns a blank or slab Floor Type into Timber Floor (a type already chosen is left alone); "can't get in" sets Restricted Access to Yes and adds "Subfloor: could not be accessed at the time of inspection." (or the roof void line) to Restricted Access Details. Changing an answer takes back exactly the line it wrote, never anything typed. All logged in the audit trail; a finalized report is not changed.
   - **Inside, no photos:** tick what blocked the view (furniture against walls, built-in fixtures, floor coverings, belongings against walls or in cupboards; all ticked to start), plus anything typed. Saved into Areas We Were Unable to Inspect. Photograph inside only for damage or damp.
   - **Done:** says so and points at Generate Form.
   Each step says what to capture. "Not here, skip" moves on; after a photo it becomes "Next". Back goes back, the chips along the bottom jump to any step, and a zone can still be typed by hand. Every photo flashes and buzzes. Where the walk is up to is remembered on that phone, per job. Other job types keep the chip checklist.
2. Take photos by zone; annotate. Save to phone (an open photo, or several via Select) copies photos into the phone gallery. (Voice notes were removed in v131; old ones still play.) Everything is stored locally;
   upload to private storage happens when online.
3. Finish Inspection stamps start/end times. Status moves to Inspection In Progress.

### 2.3 Report
1. View Report -> choose document type (default from job type; preferred type remembered).
2. Optional AI Draft: photos (and narration) go to `analyze-inspection`; results
   appear as suggestions with reasons. Accept, edit or decline; declining is recorded.
3. Work through sections; each autosaves as a draft. Site fields derive from the address.
4. Pre-flight check lists exactly what blocks finalising (e.g. a required field,
   the protected "no live termites found" wording, signature).
5. Sign, finalise. The report stores an audit trail and schema version.
6. Output: print/PDF; email PDF (Resend) with later "did they receive it" check;
   or generate a client link.

### 2.4 Invoice
Invoice from the job: line items, GST on/off, number, due date. Send draft to
Xero (if connected); status read back..

### 2.5 Reminders
* Day-before: a banner after 14:00 says "N clients booked tomorrow haven't had a
  reminder yet". Tap the bell icon (Tomorrow's reminders) -> Preview shows who would get one and who needs
  a phone call -> Send (confirm with the exact number). If the server cannot record
  a sent message it stops and tells the technician why; the banner stays.
* Annual due reminders use the same preview-then-confirm path.

## 3. Client flows (no account)
| Trigger | What the client sees | Rules |
|---|---|---|
| Booking confirmation | Email or text with date and business details | Once per appointment time |
| Day-before reminder | SMS ending "Reply STOP to opt out" (email fallback only when no valid mobile) | Landlines never texted |
| Reply STOP | Nothing further is ever sent to that number | Recorded by phone number, any job |
| Other reply | Stored for a person to read | Never auto-answered |
| Report link | `portal.html?t=<token>`: report, quote, accept form | Expiring, revocable, one job |
| Accept quote | Type name, draw signature, submit | Records name, time, IP, user agent; superseded if report changes |

## 4. Error and edge flows
| Situation | Behaviour |
|---|---|
| No signal | Everything works; sync banner says work is safe on the device |
| Sync permission failure | Message names what to fix and states work is not lost |
| Login expired | Job saved; message tells the user to log out and in |
| Function not deployed | "Automated email is not switched on yet"; job saved |
| Photo upload fails | Retained locally and retried |
| Back button | Closes an open dialog first, then steps up one screen; never exits unexpectedly |
| Stale open tab | Can hang IndexedDB for the origin; close idle tabs |
| Two devices edit one record | Later `updatedAt` wins; the earlier edit is lost |
| Backup older than 7 days | Archive screen says so; export offered (iOS share sheet) |

## 5. Roles
| Action | Admin | Technician |
|---|---|---|
| Read all jobs and reports in the business | Yes | Yes |
| Create jobs | Yes | Yes |
| Edit a job | Any | Own (and assigned) |
| Delete a job | Yes | No |
| Edit business details, Xero, team | Yes | No |

## 6. Demo and test modes
`?demo=1` opens a separate local database with sample data and no network or
client contact; it is the only mode for manual exploration and for the chaos
tester. `?test=1` is used by the test suite.

## 7. Bottom tab bar (v109)
Five tabs on the main screens: **Today**, **Jobs** (all jobs), **Diary** (scheduler), **Enquiries**
(leads) and **More** (opens the sheet: Clients, Safety statements, Station register, Business
figures, Saved reports). The lit tab shows where you are; More stays lit on every screen it opens.
The Today tab shows how many of today's jobs are not yet done. The bar is hidden on screens you
drill into (a job, report, invoice, one enquiry, one client) and while the keyboard is up. The
old header icons are hidden; the bar presses them, so each screen opens exactly as before.

## 8. The job screen, top to bottom (v110)
1. Re-inspection prompt (only when one is due)
2. **Status card**: status, then the next step: Start Inspection, or Open Report (the main button while in review), then Invoice and Client link. The document is one line ("Document: ... Change"); Change opens the other choices.
3. Client link panel (opens from its button)
4. **Client card**: phone (Call), email, address (Directions), notes, Edit details
5. **Messages and plan**: automated-messages switch and the standing plan (settings, read rarely)
6. Photos

## 9. The report screen (v110)
Progress card first ("5 of 11 sections done", bar, and Continue: the next section that still needs work), then the section list, audit trail, pre-flight check, and a Finalize button that stays at the bottom of the screen while the list scrolls.

## 10. Undo after delete (v111)
Deleting a job, a photo, or a selection of photos hides it everywhere at once and shows a bar: "<name> deleted  [Undo]" for ten seconds. Undo brings it back untouched. If the time runs out, the delete really happens (phone and cloud). Starting another delete finishes the first. Closing the app inside the ten seconds deletes nothing. Since v115 the same applies to deleting an enquiry, a client or a safety statement, with the bar shown on that list. (Invoices have no delete button.) Deleting a client only unlinks its jobs once the delete really happens.

## 11. Screen brightness (v113)
More has a "Screen" choice: **Auto** (follows the phone's light/dark setting), **Light** or **Dark**. Dark is the default. The choice is remembered on the phone and applied before the first paint, so it never flashes the wrong colour. The header strip stays dark in both so the phone's own clock and battery stay readable.

## 12. Sync and waiting states (v114)
Signed in, the home screen shows one status line: a dot and a sentence.
| Dot | Sentence (examples) |
|---|---|
| Green | All backed up, 4 min ago |
| Pulsing green | Syncing. 2 photos to upload |
| Amber | Synced 4 min ago. 3 photos still to upload |
| Hollow | Offline. 3 photos saved on this phone and will upload when you are back online |
| Red | Could not sync. Your work is safe on this phone and it will try again (with the reason underneath) |
**Sync now** spins and is disabled while a sync runs. **Pull the home list down** (at the top) to sync; it does nothing when signed out or offline. In a job, the photo count line says "saved on this device . N not uploaded yet" (or "and backed up"), and each photo not yet uploaded carries an amber up-arrow marker. While the very first sync is still fetching and nothing is on the phone yet, the job list and Today show grey placeholder cards instead of "No jobs yet" or "Nothing is booked".

## 13. Restore from a backup file (v116)
More > Saved reports > **Restore from a backup file**, under Export All Data (shown to whoever can export). Choose the `.json` file Export made. The app reads it and shows what it would do before changing anything, for example "It will add 3 jobs that are not on this phone." Then **Restore** or **Cancel**.
- It adds records missing from the phone and updates any that are older here than in the file. It never deletes and never replaces a newer copy.
- Anything deleted on purpose after the backup was made stays deleted.
- Records keep their original timestamps; when signed in, a sync then sends the restored ones to the cloud.
- Photos are not in the file and are not touched. Running it twice changes nothing the second time.
- A file that is not a Scope backup, or is from a newer version of the app, is refused before anything is written.

## 14. Two people editing the same thing offline (v117)
Nothing to tap; it happens during sync.
- If you changed the phone number and a colleague changed the notes on the same job while both of you were offline, both changes are kept once you both sync.
- Photos added to the same report on two phones are all kept. The audit trail keeps every entry from both.
- If you both changed the *same* field, the later save is kept. A message says how many changes clashed, and More > Saved reports shows a **Changes that clashed** card: which record, which field, the value kept and the value that lost, for example `Smith House: phone number. Kept "0400 111 111" (from this phone); the other change was "0400 222 222".` If the other one was right, open the record and put it back. **Clear this list** empties the card.
- The first time a phone opens this version it upgrades its database. If Scope is open in another tab or window, a message asks you to close the others.

## 15. Inspection agreement signed before the visit (v120)
Section 3 of the timber pest inspection report (About Our Agreement) can now be signed by the client from home.
1. **Booking.** New job, Timber Pest Inspection, with the client's email and a booked time. **"Email the inspection agreement for the client to sign before the visit"** is ticked by default. Save: the client's link is made, asking for the agreement, and the booking confirmation email carries a **Read and sign the agreement** button. The day-before email carries it too, until it is signed.
2. **The client** opens the link, reads what the inspection covers and what it cannot (scope to AS 4349.3, what is not covered, non-invasive, areas that cannot be reached, access on the day, who may rely on the report, Australian Consumer Law), plus any access limitations already written in section 3, types their name, signs with a finger, and taps **I agree to this inspection**. Name, signature, time, device details and the exact wording (versioned) are recorded. The public page cannot change the report.
3. **Filing.** On the next sync the phone puts the name, date and signature into section 3 by itself, with an audit-trail entry ("Inspection agreement signed by the client"), and a message says so. Opening **Client link** on the job files it straight away and shows "Jane Smith signed the inspection agreement on 14 Oct 2026. It is on the report."
- A signature already taken on the day is never replaced. A finalized report is not changed.
- Already booked, or no email at the time? **Client link** on the job has **"Ask the client to sign the inspection agreement on this page"**; copy the link and send it yourself.
- Only for a timber pest inspection: never for a monitoring visit, certificate, action plan or general pest job.

## 16. Referral register and $50 credit (v121)
More > **Referrals**. The rule, as on the screen: $50 off their next service for every person a client refers, once that person has paid for their first job.
1. **Recording one.** An enquiry whose "How they found you" is **Referral** shows **Who referred them** (your clients). Choose one and the referral is on the register. Or tap **+ Record a referral** on the register and pick who made it and who they referred (an enquiry or a client). Nobody can refer themselves, and nobody is on the register twice.
2. **Waiting for payment.** The referral is pending until the referred person's first invoice is paid: paid in Xero, or **Mark as paid** on the invoice for money received outside Xero. After each sync Scope asks Xero which sent invoices are now paid (at most every half hour), so this happens by itself. A message says "Margaret Chen earned a $50 referral credit: Tom Okafor has paid."
3. **The credit.** The next invoice made for the referrer starts with a line "Referral credit: thank you for referring Tom Okafor", $50.00 off including GST (-$45.45 + -$4.55 GST). An invoice already drafted for them shows **Take $50 off this invoice** instead. Removing the line puts the $50 back to owed, so it is never lost and never given twice. Once an invoice is in Xero, emailed or paid, nothing is added to it.
4. **The register** shows how many are waiting, what is owed and what has been credited, and each referral's status. **Cancel this referral** asks why and keeps it on the register, marked cancelled: referrals are never deleted. The register is in the Export backup file.

## 17. SOP library (v122)
More > **SOP library**. Standard operating procedures kept the way ISO 9001 (clause 7.5, control of documented information) expects. Scope does not certify anybody; an accredited certification body does. This is the record that makes an audit straightforward.
- **The list** puts what needs attention first: reviews overdue or due within 30 days, drafts, and approved procedures with changes waiting. Then approved, then retired. Search by code, title, category or owner. The print button gives the **register** (code, title, status, version, approved by and when, next review, owner, who signed the current version) for an auditor.
- **Starter drafts**: seven procedures written from how Scope works (timber pest inspection, pesticide handling and spills, roof void and subfloor safety, reports and privacy, complaints and corrective action, document control, moisture meter and equipment checks). They arrive as drafts: read, change what does not match how you work, approve. Nothing counts until approved.
- **Writing and revising**: **+ New SOP**, or **Revise** on an approved one. Edits are always a draft; the approved version stays in force until the draft is approved, and a new version must say what changed. Text format: `## ` heading, `1. ` numbered step, `- ` bullet.
- **Approving** (admins; anyone in demo or when not signed in): becomes version N, with who and when, and the next review date (6, 12 or 24 months). Every approved version is kept word for word in the history and can be printed, marked SUPERSEDED.
- **Reviewed: no changes needed** records the review and moves the next review on.
- **I have read this**: each person signs once per version; a new version needs signing again. The list shows who has signed the version in force.
- **Retire** asks why and keeps the procedure and its history. Nothing in the library can be deleted.
- **Print / save as PDF** gives a controlled-copy header (version, approval, owner, next review) and says printed copies are uncontrolled.
- The library is in the Export backup file.

## 18. Which AI, and how often it is right (v123)
- Every AI answer now carries the model and the prompt version that produced it. The report keeps each pass, and its audit trail shows "AI suggestions prepared: 12 suggestions from claude-sonnet-5 (draft-report@2026-10-13). Nothing changes until a person accepts it."
- More > Saved reports: the accuracy box gives the overall figure, then each report section worst first, e.g. "Findings & Observations: 2 of 7 kept (29%) · check these closely". A section under 70% kept is flagged; one with fewer than 5 answers says "not enough to judge yet". It ends with which model and prompt the figures were measured on.
- The model is changed in one place (`AI_MODEL` in analyze-inspection) and only after measuring the new one against real graded photos. Change a prompt, change its date in `PROMPT_VERSIONS`.

## 19. Test mode for client messages (v124)
For a test period, set either or both secrets in Supabase (Edge Functions > Secrets), comma-separated:
- `SMS_ALLOWED_NUMBERS`, e.g. `0400 111 222` (your own mobile)
- `EMAIL_ALLOWED_ADDRESSES`, e.g. `you@example.com`

While set, booking confirmations, day-before reminders, report-ready and due reminders, and reports or invoices emailed by hand, go only to those. Anybody else gets nothing; the app says "Not sent: test mode is on, and this client is not on the test list", and the job is not marked as sent, so it goes out normally once the secret is removed. A list with nothing valid in it blocks everything. Delete the secrets to go back to normal.
