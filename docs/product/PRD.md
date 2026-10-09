# Product Requirements Document - Scope

## 1. Summary
Scope is an offline-first mobile web app that lets a one-person (growing to a
small team) pest-control business run a job from first call to paid invoice:
book it, inspect the property with photos and voice notes, produce the legally
required compliance document, send it to the client, invoice it, and remind the
client when the next inspection is due.

It exists because the paperwork is the bottleneck. A termite inspection is
worthless until a defensible, correctly worded report exists, and the work is
done in subfloors and roof voids with no signal.

## 2. Users
| User | Needs | Notes |
|---|---|---|
| **Technician/owner** (primary; today one person) | Capture fast with gloves on, never lose work, get a finished report without retyping | Not a developer; wants plain-English explanations |
| **Admin** | Business details, team, invoices, Xero, reminders | Role in `user_roles` |
| **Technician (staff)** | See and edit own jobs | Cannot delete jobs; limited edit rights |
| **Client** (no account) | Receive confirmation and reminders, read the report, accept a quote, ask to stop texts | Single link per job, or a text/email |
| **Reviewer/insurer/regulator** | Read a report that stands up | Reads the printed/PDF output |

## 3. Problems and goals
1. Produce compliant documents (timber pest inspection, termite action plan,
   termite certificate, termite monitoring record, general pest service record,
   SWMS) from a phone, offline.
2. Never lose field work: local-first storage, resumable sync, backups.
3. Make AI useful without making it a liability: it *offers* suggestions the
   technician confirms; it never asserts findings.
4. Keep the diary honest: refuse slots that cannot be driven to.
5. Contact clients correctly and respectfully: right channel, right time, honour
   STOP, never message the wrong person.
6. Replace a per-seat commercial tool (Formitize-class) with something fitted to
   this business.

### Non-goals (for now)
Multi-business SaaS, public signup, online payments (Stripe), 2FA/SSO, Zapier,
native app-store apps.

## 4. Functional requirements
Priority: **M** must, **S** should, **C** could.

### 4.1 Jobs and clients
| ID | Requirement | P | Status |
|---|---|---|---|
| J1 | Create/edit/delete a job with client contact, address (autocomplete, AU/NZ), notes, job type, schedule | M | Built |
| J2 | Status flow: New -> Inspection In Progress -> Report Review -> Completed | M | Built |
| J3 | Recurring plan: re-inspection every N months, next job auto-created | M | Built |
| J4 | Client records reused across jobs; history shown | S | Built |
| J5 | Assign a job to a technician; filter by technician | S | Built |
| J6 | Leads pipeline (new -> quoted -> won/lost, follow-ups, convert to job) | S | Built |

### 4.2 Capture
| ID | Requirement | P | Status |
|---|---|---|---|
| C1 | Photo capture by zone/room, with checklists per job type | M | Built |
| C2 | Voice notes attached to captures; feed the AI draft | S | Built |
| C3 | Start/finish inspection with continuous capture and live preview | S | Built |
| C4 | Annotate and zoom photos; bulk select, move, delete | S | Built |
| C5 | Photos upload to private storage when online; queued offline | M | Built |
| C6 | QR stickers for stations/assets; scan to open | S | Built |

### 4.3 Reports
| ID | Requirement | P | Status |
|---|---|---|---|
| R1 | Document types: Timber Pest Inspection, Termite Action Plan, Termite Certificate, Termite Monitoring, General Pest Service Record | M | Built |
| R2 | Schema-driven forms with conditional fields, products table, sketch/mud-map, signature | M | Built |
| R3 | Pre-flight gate: a report cannot be finalised until legally required fields exist | M | Built |
| R4 | Wording rule: the "no live termites found" framing is mandatory and protected | M | Built |
| R5 | Audit trail and schema version stamped on each report | M | Built |
| R6 | Print/PDF export; email PDF to client; delivery status check | M | Built |
| R7 | AI draft from photos; accuracy tally; declining records a graded wrong answer | S | Built |
| R8 | SWMS document per job (separate store; accompanies the report) | S | Built |
| R9 | Station register derived from reports (a view, never a second store) | S | Built |

### 4.4 Scheduling
| ID | Requirement | P | Status |
|---|---|---|---|
| S1 | Diary with availability that refuses slots that cannot be driven to | M | Built |
| S2 | Booking assistant (AI proposes; the person confirms) | C | Built |
| S3 | Calendar feed (.ics) for Google/Outlook/Apple | S | Built |

### 4.5 Client communication
| ID | Requirement | P | Status |
|---|---|---|---|
| M1 | Booking confirmation, day-before reminder (SMS, email fallback), report-ready, annual due reminder | M | Built; SMS awaits ClickSend keys |
| M2 | Recipient is always read server-side from the job; the caller supplies only a job id | M | Built |
| M3 | STOP handling: inbound SMS records an opt-out by phone number; all future sends suppressed | M | Built; awaits SMS_INBOUND_TOKEN and the ClickSend inbound rule |
| M4 | Sweeps are previewed, counted and confirmed before a live send | M | Built |
| M5 | A send that cannot be recorded halts the sweep (no duplicate texts) | M | Built (v106) |
| M6 | Client portal: one link per job; view report; accept quote with typed name and signature; revocable, expiring | S | Built |

### 4.6 Money
| ID | Requirement | P | Status |
|---|---|---|---|
| F1 | Invoices with line items, GST, numbering, per job | M | Built |
| F2 | Push draft invoice to Xero; status read back | S | Built; connection must be authorised |
| F3 | Business dashboard (period revenue, conversion) | C | Built |
| F4 | Online payment / quote-accept-pay | C | **Not built** |

### 4.7 Platform
| ID | Requirement | P | Status |
|---|---|---|---|
| P1 | Works offline; installs to the home screen (iOS and Android) | M | Built |
| P2 | Multi-tenant isolation enforced by the database | M | Built |
| P3 | Roles: admin, technician | M | Built |
| P4 | JSON export from the Archive screen; reminder when the last backup is over 7 days old | M | Built |
| P5 | Full-project backup (database + photos) | M | Script and runbook built; the owner must run it |
| P6 | In-app restore from the Export file (adds and updates, never deletes; deliberate deletes stay deleted) | S | Built (v116) |
| P7 | Signup/invite of further users or businesses | S | **Not built** |
| P8 | 2FA | C | **Not built** |
| P9 | Error log, uploaded to `client_errors`, readable copy for support | S | Built |

## 5. Success measures
* **Trust:** zero lost jobs/photos; zero clients messaged in error; zero duplicate texts.
* **Speed:** a standard inspection report finalised the same day with no retyping.
* **Quality:** AI accept/correct rate is tracked. Insect identification is
  reliable; structural damage is not and must stay "suggestion only".
* **Operational:** a backup less than 7 days old at all times.
* **The unproven one:** survive a full day on a real inspection. Not yet done.

## 6. Constraints and assumptions
* Windows dev machine with no Node/Python; no build step is permitted.
* Free Supabase plan: no automatic backups, and Storage is never in database backups.
* Australian context: ABN, GST, NSW timezone and DST, AU mobile number rules,
  Spam Act (opt-out), Privacy Act (client data).
* Legal phrasing around termite findings is fixed and must not be paraphrased.

## 7. Open decisions `[DECISION]`
1. Photo protection: pay for Supabase Pro vs. rely on the weekly backup script.
2. Optional allow-list for outbound SMS numbers (`SMS_ALLOWED_NUMBERS`).
3. Whether to open the product to other businesses. That needs signup, billing,
   per-business branding and support, and changes almost every non-functional target.
4. Register "Arcadian Pest Solutions" as a business name under the Pty Ltd ABN.
5. Whether to build in-app restore or keep restore as a documented manual task.
