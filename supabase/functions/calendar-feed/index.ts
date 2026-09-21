// Serves Field Inspect's booked jobs as a live iCalendar (.ics) feed —
// standard enough that Google Calendar, Outlook and Apple Calendar can all
// subscribe to the URL directly, with no knowledge of Field Inspect at all.
//
// DELIBERATELY NOT BEHIND SUPABASE AUTH. Every other function in this
// project requires a signed-in user's bearer token (see analyze-inspection,
// send-report-email) — this one cannot, because a calendar app subscribing
// to a URL has no way to log in. The token in the query string IS the
// credential instead: unguessable, and revocable by regenerating it (see
// calendar-feed.js). This means:
//
//   THIS FUNCTION MUST HAVE "Enforce JWT Verification" TURNED OFF in its
//   Settings tab in the Supabase dashboard after deploying. Every other
//   function in this project needs that switch ON. Leaving it on here
//   makes every calendar app's request bounce with 401 before this code
//   ever runs, and the failure gives no clue why — it will look like the
//   feed is simply broken.
//
// Required secrets (already set for the other functions in this project):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// service_role: the request carries no Supabase session at all, so RLS has
// nothing to check against — this is the only way the function can read the
// token row or the jobs table.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function textResponse(body: string, status = 200, contentType = 'text/plain; charset=utf-8') {
  return new Response(body, { status, headers: { 'Content-Type': contentType } });
}

// RFC 5545 TEXT escaping. Job names and addresses routinely contain commas
// ("12 Smith St, Camden South") and occasionally semicolons or line breaks
// in notes — any of those, unescaped, corrupts the calendar's structure
// rather than just looking wrong, so every text value goes through this.
function escapeText(value: string): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545 requires CRLF line endings and folds any line over 75 octets by
// breaking it and indenting the continuation with a single space. Google
// Calendar and Apple Calendar are strict readers — an unfolded long
// DESCRIPTION line is a real way for this to silently fail to parse.
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  let result = '';
  let chunk = '';
  let chunkBytes = 0;
  for (const ch of line) {
    const chLen = new TextEncoder().encode(ch).length;
    if (chunkBytes + chLen > 74) {
      result += (result ? '\r\n ' : '') + chunk;
      chunk = '';
      chunkBytes = 0;
    }
    chunk += ch;
    chunkBytes += chLen;
  }
  if (chunk) result += (result ? '\r\n ' : '') + chunk;
  return result;
}

function icsDate(epochMs: number): string {
  // Epoch milliseconds are already an absolute instant — no timezone or DST
  // conversion needed. Formatting straight to UTC ("Z") means the feed is
  // correct everywhere it's read, regardless of what timezone this function
  // happens to run in.
  return new Date(epochMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

const JOB_TYPE_LABELS: Record<string, string> = {
  termite: 'Termite Inspection',
  pest_treatment: 'Pest Treatment',
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  if (!token) return textResponse('Missing ?token= — copy the full link from Field Inspect’s calendar feed panel.', 400);

  const { data: feed, error: feedError } = await admin
    .from('calendar_feed')
    .select('token')
    .eq('id', 'default')
    .maybeSingle();

  if (feedError) {
    console.error(feedError);
    return textResponse('Calendar feed is not set up yet (run supabase-migration-010-calendar-feed.sql).', 500);
  }
  if (!feed || feed.token !== token) {
    return textResponse('Invalid or revoked calendar feed link. Generate a new one in Field Inspect.', 403);
  }

  // A year each way is generous for a pest-control diary and keeps the feed
  // small — no calendar app needs a decade of history to show "what's on
  // this week", and an unbounded feed only gets slower to refresh over time.
  const windowMs = 366 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const { data: jobs, error: jobsError } = await admin
    .from('jobs')
    .select('id, name, job_type, address, notes, client_phone, status, scheduled_at, scheduled_duration_mins, updated_at')
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', now - windowMs)
    .lte('scheduled_at', now + windowMs);

  if (jobsError) {
    console.error(jobsError);
    return textResponse('Could not read the job diary.', 500);
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Field Inspect//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    // A descriptive name — shows up as the calendar's display name in most
    // apps that support subscribed calendars (Google, Apple).
    'X-WR-CALNAME:Field Inspect Bookings',
    'X-WR-TIMEZONE:UTC',
  ];

  for (const job of jobs || []) {
    const start = job.scheduled_at as number;
    const durationMins = (job.scheduled_duration_mins as number) || 60;
    const end = start + durationMins * 60000;
    const typeLabel = JOB_TYPE_LABELS[job.job_type as string] || 'Job';
    const summaryParts = [job.name, typeLabel].filter(Boolean);
    const descriptionParts = [
      job.status ? `Status: ${job.status}` : '',
      job.client_phone ? `Phone: ${job.client_phone}` : '',
      job.notes ? `Notes: ${job.notes}` : '',
    ].filter(Boolean);

    lines.push('BEGIN:VEVENT');
    // A stable UID tied to the job id — not to this feed generation — so a
    // calendar app updates the existing event in place when a job is moved
    // or renamed, instead of creating a duplicate on every refresh.
    lines.push(foldLine(`UID:${job.id}@field-inspect.arcadianpestsolutions`));
    lines.push(foldLine(`DTSTAMP:${icsDate(job.updated_at || now)}`));
    lines.push(foldLine(`DTSTART:${icsDate(start)}`));
    lines.push(foldLine(`DTEND:${icsDate(end)}`));
    lines.push(foldLine(`SUMMARY:${escapeText(summaryParts.join(' — '))}`));
    if (job.address) lines.push(foldLine(`LOCATION:${escapeText(job.address as string)}`));
    if (descriptionParts.length) lines.push(foldLine(`DESCRIPTION:${escapeText(descriptionParts.join('\\n'))}`));
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // CRLF throughout — RFC 5545 requires it, and readers that tolerate bare
  // LF are the exception, not something to rely on.
  return textResponse(lines.join('\r\n') + '\r\n', 200, 'text/calendar; charset=utf-8');
});
