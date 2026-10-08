# App Flow - Scope

Screens are the `view-*` sections in `index.html`; `app.js` routes between them
and `nav-history.js` ties the phone's Back button to them. Client-facing pages
are `portal.html` and text/email messages.

## 1. Screen inventory
| Screen (id) | Reached from | Purpose |
|---|---|---|
| Login (`view-login`) | Start, sign-out | Email + password via Supabase Auth; shows build label |
| Job list (`view-joblist`) | Login, Back from anywhere | Search, status and technician filters, new job, menu |
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
1. Open job -> Start Inspection. Camera opens with the zone/checklist for the job type.
2. Take photos by zone; add voice notes; annotate. Everything is stored locally;
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
