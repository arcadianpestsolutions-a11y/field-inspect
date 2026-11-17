-- Migration 046: chasing customers who are due, and offboarding the ones who
-- are gone.
--
-- jobs.follow_up: the chase on the property this job leaves due (next_due_at).
--   { log: [{ at, outcome, note }], snoozedUntil, stoppedAt, stoppedReason }
--   One jsonb column rather than five, because it is written and read as one
--   thing by followups.js and nothing on the server queries inside it except
--   send-client-message, which only asks "has the chase been stopped?".
--
-- clients.archived_at / archived_reason: an offboarded customer. Kept, never
--   deleted (their reports are compliance documents), hidden from the client
--   list and the follow-ups, and their due reminders stop. Bringing them back
--   clears both.
--
-- No new grants are needed: columns inherit the table's (migrations 016, 029).

alter table public.jobs add column if not exists follow_up jsonb;
alter table public.jobs drop constraint if exists jobs_follow_up_size;
alter table public.jobs add constraint jobs_follow_up_size check (follow_up is null or pg_column_size(follow_up) <= 20000);

alter table public.clients add column if not exists archived_at bigint;
alter table public.clients add column if not exists archived_reason text;
alter table public.clients drop constraint if exists clients_archived_reason_len;
alter table public.clients add constraint clients_archived_reason_len check (archived_reason is null or char_length(archived_reason) <= 500);
