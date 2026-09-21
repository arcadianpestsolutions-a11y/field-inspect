// "Did they actually receive it?" for a report or invoice email already
// sent via send-report-email — reads the current delivery status of one
// email back from Resend by the id Resend handed back at send time.
//
// PULL, NOT PUSH — DELIBERATELY. Resend can also push status changes to a
// webhook the moment they happen, which would give real-time updates
// instead of "whenever someone taps Check status". That needs a second
// manual setup step in the Resend dashboard (registering a webhook URL,
// copying a signing secret back here) on top of everything already asked
// of Tal for calendar-feed and send-due-reminders. For a small business
// checking a handful of emails, checking on demand is a fair trade for one
// fewer manual dashboard step — this can move to a webhook later without
// changing anything about where the status is stored or shown.
//
// Required secrets (already set for send-report-email): RESEND_API_KEY
// Auth: same as every function except calendar-feed — a valid signed-in
// technician, checked the same way.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return json({ error: 'Not authenticated' }, 401);

    const body = await req.json().catch(() => ({}));
    const emailId = body.emailId;
    if (!emailId || typeof emailId !== 'string') return json({ error: 'emailId is required.' }, 400);

    const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });

    if (res.status === 404) return json({ status: 'unknown', detail: 'Resend has no record of this email id.' });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[check-email-status] Resend error:', res.status, errText);
      return json({ error: `Resend API error (${res.status}).` }, 502);
    }

    const data = await res.json();
    // Resend's read-email response carries the delivery state in
    // `last_event` (e.g. "delivered", "bounced", "opened", "complained",
    // "delivery_delayed") as of when this was written — not something this
    // code can verify without a live send to test against. If Resend's
    // field name has since changed, `raw` still carries everything Resend
    // actually returned so the real shape is visible rather than hidden
    // behind a guess that quietly returns nothing.
    return json({ status: data.last_event || 'sent', raw: data });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
