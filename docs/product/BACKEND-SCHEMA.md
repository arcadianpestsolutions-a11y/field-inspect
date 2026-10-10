# Backend Schema - Scope

Source of truth: `supabase-schema.sql` then `supabase-migration-002 ... 033`,
applied in order to the live project (all applied as of 8 Oct 2026). This file is
a reader's map. If it disagrees with the SQL, the SQL wins.

## 1. Conventions
* Primary keys are client-generated text ids (so offline creation works), except
  `organisations` (uuid), `user_roles` (auth uid) and `client_access` (token).
* Timestamps from the app are **epoch milliseconds in `bigint`** (`created_at`,
  `updated_at`). A few server-side tables use `timestamptz`.
* `updated_at` orders saves; sync merges field by field and uses it only to
  pick a winner when the same field was changed on two devices (section 6).
* Almost every table carries `org_id uuid references organisations(id)`. Tables
  created before multi-tenancy got it added in migration 022; `org_id` defaults
  to `public.my_org_id()` so the app cannot choose it.
* Money is stored in cents inside `line_items` JSON or `*_cents` columns.
* Unknown columns are stripped by sync, so **an unrun migration looks like data
  quietly not saving.** Always verify migrations took effect.
* PostgREST returns at most 1000 rows (`max_rows` in `config.toml`); all reads page.

## 2. Entity overview
```
organisations 1─* user_roles
organisations 1─* clients 1─* jobs 1─1 reports
                              jobs 1─* captures ──(bytes)──> Storage: inspection-media
                              jobs 1─* invoices ──> Xero (external)
                              jobs 1─* swms
                              jobs 1─* client_access (portal links)
                              jobs 1─* client_acceptances
                              jobs 1─* client_messages (send log)
leads ──converted_job_id──> jobs
comms_opt_outs (by phone number, per org)      sms_inbound (replies)
deletions (tombstones)   client_errors   calendar_feed   xero_connections
```

## 3. Tables
### organisations
`id`, `name`, `trading_name`, `abn`, `licence_number`, `phone`, `email`,
`address`, `website`, `created_at`, `updated_at`. Seeded for the first business by
migration 022. Printed on reports and used in messages. Admins may UPDATE.

### user_roles
`user_id` (PK, auth.users), `email`, `role` (`admin` | `technician`), `org_id`,
`display_name`, `licence_number`, `phone`, `address`, timestamps. Read by the
team; written only by migrations/admin SQL (no signup yet).

### jobs
`id`, `name`, `address`, `address_lat/lng`, `notes`, `client_phone`,
`client_email`, `client_id`, `status` (`new | in_progress | review | completed`),
`inspection_date/time`, `weather`, `inspection_started_at/ended_at`,
`job_type` (`termite | pest_treatment`), `preferred_document_type`,
`scheduled_at`, `scheduled_duration_mins`, `assigned_to` (email),
`recurrence_months`, `next_due_at`, `recurring_from_id`,
`reinspection_interval_months`, `reminder_sent_for_due_at`,
`comms_opt_out`, `confirmation_sent_for_at`, `day_before_sent_for_at`,
`created_by`, timestamps, `org_id`.
The three `*_sent_for_*` columns are the idempotency stamps that stop a message
being sent twice for the same appointment time.

### reports (one per job)
`job_id` (PK, FK jobs, cascade), `sections jsonb` (all field values by section),
`ai_draft jsonb`, `document_type`, `finalized_at`, `audit_log jsonb`,
`schema_version`, `acceptance_requested_at`, `email_provider_id`, `emailed_at`,
`email_status`, `updated_by`, `updated_at`, `org_id`.

### captures
`id`, `job_id` (cascade), `zone`, `type` (`photo | memo`), `note`,
`suggested_zone`, `photo_path`, `audio_path` (object paths in the bucket),
timestamps, `created_by`, `org_id`.

### invoices
`id`, `job_id` (cascade), `number`, `issue_date`, `due_date`, `client_name`,
`client_email`, `property_address`, `reference`, `line_items jsonb`,
`gst_registered`, `status` (`draft | sent | paid`), `xero_invoice_id`,
`xero_status`, email-tracking columns, timestamps, `created_by`, `org_id`.

### swms
`id`, `job_id` (set null on delete), `title`, `site_address`, `sections jsonb`,
`signed_at`, `review_due_at`, `schema_version`, `created_by`, timestamps, `org_id`.

### leads
`id`, contact fields, `address(+lat/lng)`, `job_type`, `source`, `notes`,
`stage`, `stage_changed_at`, `last_contacted_at`, `last_follow_up_at`,
`follow_up_count`, `snoozed_until`, `quoted_cents`, `lost_reason`,
`converted_job_id`, `created_by`, timestamps, `org_id`.

### clients
`id`, `name`, `phone`, `email`, `address`, `notes`, `created_by`, timestamps, `org_id`.

### client_access (portal links)
`token` (PK, unguessable), `job_id`, `expires_at`, `revoked_at`, `last_seen_at`,
`view_count`, `created_by`, timestamps, `org_id`.

### client_acceptances
`id`, `job_id`, `token`, `document_type`, `report_finalized_at`, `accepted_name`,
`signature` (data URL; **never returned to the portal**), `accepted_at`,
`presented jsonb`, `ip`, `user_agent`, `applied_to_report_at`, `superseded_at`,
timestamps, `org_id`.

### client_messages (send log)
`id`, `job_id`, `kind` (`booking_confirmation | day_before | report_ready |
due_reminder`), `recipient`, `subject`, `channel` (`email | sms`), `segments`,
`sent_at`, `provider_id`, `status`, `triggered_by`.

### comms_opt_outs
`id`, `phone_e164`, `source`, `message`, `provider_message_id`, `created_at`, `org_id`.
Matched by phone number, not job, so opt-outs survive new jobs.

### sms_inbound
`id`, `from_e164`, `from_raw`, `body`, `kind` (`stop | reply`), `job_id`,
`provider_message_id`, `received_at`, `read_at`, `org_id`.

### deletions (tombstones)
`(table_name, record_id)` PK, `deleted_at`, `deleted_by`. Lets a delete on one
device propagate rather than be re-created by another.

### client_errors
`id`, `occurred_at`, `kind`, `message`, `source`, `line`, `col`, `stack`,
`app_version`, `screen`, `online`, `occurrences`, `user_id`, `user_agent`,
`received_at`, `org_id`. Written by the app (insert, ignore duplicates).

### calendar_feed / xero_connections
Single-row tables (`id = 'default'`). `calendar_feed.token` is the credential for
the .ics URL. `xero_connections` holds live OAuth tokens: RLS on, **no policy and
no grant for `authenticated`**; only `service_role` reads it.

### Storage
Bucket `inspection-media` (private). Paths: `<job_id>/...` for photos and audio,
`<job_id>/report/report.pdf` for finalised reports. Read by the team via policy;
clients get 5-minute signed URLs from `client-portal`. **Not included in any
database backup**; see `../BACKUP-RUNBOOK.md`.

## 4. Local store (IndexedDB `field-inspect-db`, version 10)
`jobs`, `captures`, `reports` (key `jobId`), `swms`, `leads`, `clients`,
`invoices`, `sectionDrafts`, `deletions`, `syncBase` (key `"table:id"`, the last
copy this phone and the cloud agreed on, photos stripped; local only, never
synced). Mirrors the server shape in camelCase.
Separate databases exist for demo and test.

## 5. Access control
* RLS enabled on all 19 public tables.
* Roles: `authenticated` (staff), `anon` (none of the tables), `service_role`
  (Edge Functions; bypasses RLS, so its grants are its only limit).
* Policies by pattern: team reads everything in its org; insert for any member;
  update own-or-admin on jobs; delete admin-only; `organisations` update admin-only.
* Helper functions: `my_org_id()`, `is_admin()` (security definer so policies can
  ask without recursing).
* **Grant matrix after migration 033** (privileges beyond SELECT/INSERT/UPDATE/
  DELETE, i.e. TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, are revoked from all three roles):

| Table | service_role may |
|---|---|
| `xero_connections` | select, insert, update, delete |
| `jobs`, `client_access` | select, update |
| `client_acceptances`, `comms_opt_outs` | select, insert |
| `calendar_feed`, `invoices`, `organisations`, `reports`, `user_roles` | select only |
| `client_messages`, `sms_inbound` | insert only |
| every other table (incl. `deletions`, `captures`, `swms`, `leads`, `clients`, `client_errors`) | nothing |

(Read from the live catalogue on 8 Oct 2026. Authoritative per-table detail: run the `has_table_privilege` verification query
at the end of migration 033, or query `information_schema.role_table_grants`.)

## 6. Sync rules
1. App writes IndexedDB, then pushes rows newer than the last sync, stripping
   columns the server does not have.
2. Pull pages through each table; a failed page throws so a half-read table is
   never treated as complete.
3. Conflicts (v117): three-way merge against the local `syncBase` copy. Only
   one side changed: take it. Both changed: merge per field; lists with ids
   merge by id; `auditLog` is the union; the same field changed on both sides
   goes to the higher `updated_at` and the other value is listed on the phone
   under "Changes that clashed". No base yet: higher `updated_at` wins.
   Captures: higher `updated_at` wins.
4. Deleting writes a `deletions` row and removes the record; other devices apply
   tombstones on pull.
5. Photos/audio upload to Storage separately and the capture row stores the path.

## 7. Migration index
| # | Adds |
|---|---|
| base | jobs, reports, captures (+ footage, later dropped) |
| 002-005 | AI draft, job type, media backup bucket, recurring jobs |
| 006 | Invoices, Xero connection |
| 007-008 | Scheduling; audit trail and schema version |
| 009 | Table grants (first GRANT incident) |
| 010-015 | Calendar feed, due reminders, interval, assignment, email tracking, document type |
| 016 | Roles and permissions |
| 017-021 | Recurring plans, tombstones, client comms, drop footage, preferred document type |
| 022 | Organisations / multi-tenancy |
| 024-026 | SMS reminders, SWMS, leads |
| 027-030 | Client portal, service-role grants, clients, client acceptance |
| 031-032 | Client error log, inbound SMS |
| 033 | Privilege audit (this release) |
(023 is not present in the repository; confirm it was intentionally skipped.)

## 8. Schema debt and risks
* Text ids and bigint ms timestamps are unusual for Postgres but required by the
  offline-first design; do not "normalise" them without a sync migration plan.
* `line_items`, `sections`, `presented` are JSON; their shape is defined by the
  front-end schema files and versioned by `schema_version`.
* `jobs.client_id` references `clients` (on delete set null); sync must push clients before jobs that point at them.
* `client_acceptances.signature` stores image data in a table; consider Storage
  if volume grows.
* Free plan: no point-in-time recovery.
