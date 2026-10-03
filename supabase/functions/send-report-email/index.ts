// Emails a finalized inspection report (as a PDF attachment) to a client,
// via Resend. API key stays server-side as an Edge Function secret, same
// as analyze-inspection's Anthropic/OpenAI keys — never in client code.
//
// Required secrets (supabase secrets set ...):
//   RESEND_API_KEY       — from resend.com dashboard
//   RESEND_FROM_ADDRESS  — e.g. "Arcadian Pest Solutions <reports@arcadianpestsolutions.com.au>"
//     Must be on a domain verified with Resend (Domains -> Add Domain, add
//     the DNS records they give you). Resend's default onboarding@resend.dev
//     sender only delivers to the account owner's own email, not real
//     clients — so this step is required before real sends will work, not
//     optional polish.
//
// Every request must carry a valid signed-in user's auth token (checked
// below), same gating as analyze-inspection — this costs real money and
// sends real email per call.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { escapeHtml, loadBusiness, orgIdForUser } from '../_shared/business.js';

// Who the email is signed as comes from the signed-in user's own business
// record, not from a name typed into this file. These secrets are only a
// fallback for a field the record leaves blank — see _shared/business.js.
const BUSINESS_ENV = {
  BUSINESS_NAME: Deno.env.get('BUSINESS_NAME') || '',
  BUSINESS_REPLY_TO: Deno.env.get('BUSINESS_REPLY_TO') || '',
};
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const RESEND_FROM_ADDRESS = Deno.env.get('RESEND_FROM_ADDRESS') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

// A non-null assertion checks nothing at runtime — it only quiets the
// compiler. Reading these as "string or empty" and naming what is missing
// turns an unset secret from a null dereference deep inside the send into a
// sentence saying which secret to set. RESEND_API_KEY and RESEND_FROM_ADDRESS
// were both unset on this project for months, and this function reported it
// as an opaque failure every time.
function missingSecrets(): string[] {
  return Object.entries({ RESEND_API_KEY, RESEND_FROM_ADDRESS, SUPABASE_URL, SUPABASE_ANON_KEY })
    .filter(([, v]) => !v).map(([k]) => k);
}

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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const missing = missingSecrets();
  if (missing.length) {
    return json({ error: `Not configured — these secrets are not set: ${missing.join(', ')}` }, 500);
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return json({ error: 'Not authenticated' }, 401);

    // Not part of the required-secrets check on purpose: without the service
    // key this degrades to a neutral sign-off rather than refusing to send a
    // client their report over a missing business name.
    const admin = SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
    const biz = await loadBusiness(admin, await orgIdForUser(admin, user.id), BUSINESS_ENV);
    const bizHtml = escapeHtml(biz.name);

    const body = await req.json();
    const { recipientEmail, recipientName, jobName, jobType, documentKind, pdfBase64 } = body;

    if (!recipientEmail || !EMAIL_PATTERN.test(recipientEmail)) {
      return json({ error: 'A valid recipientEmail is required' }, 400);
    }
    if (!pdfBase64) return json({ error: 'pdfBase64 is required' }, 400);

    const isInvoice = documentKind === 'invoice';
    const isPestTreatment = jobType === 'pest_treatment';

    const reportLabel = isPestTreatment ? 'General Pest Treatment Report' : 'Termite Inspection Report';
    const subject = isInvoice
      ? `Tax Invoice${jobName ? ' ' + jobName : ''} — ${biz.name}`
      : `${reportLabel}${jobName ? ' — ' + jobName : ''}`;

    const html = isInvoice
      ? `
      <p>Hi${recipientName ? ' ' + recipientName : ''},</p>
      <p>Please find attached your tax invoice from ${bizHtml}.</p>
      <p>If you have any questions about this invoice, please get in touch.</p>
      <p>Kind regards,<br>${bizHtml}</p>
    `
      : `
      <p>Hi${recipientName ? ' ' + recipientName : ''},</p>
      <p>Please find attached your ${isPestTreatment ? 'pest treatment report' : 'termite inspection report'} from ${bizHtml}.</p>
      <p>If you have any questions about this report, please get in touch.</p>
      <p>Kind regards,<br>${bizHtml}</p>
    `;

    const attachmentFilename = isInvoice
      ? `${(jobName || 'invoice').replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`
      : (isPestTreatment ? 'pest-treatment-report.pdf' : 'termite-inspection-report.pdf');

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM_ADDRESS,
        to: [recipientEmail],
        // A client who replies to their report should reach a person. Without
        // this a reply went to the sending address, which on a sandbox sender
        // is a mailbox nobody reads. Omitted entirely when there is none,
        // rather than sent blank.
        ...(biz.replyTo ? { reply_to: biz.replyTo } : {}),
        subject,
        html,
        attachments: [{ filename: attachmentFilename, content: pdfBase64 }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Resend API error (${res.status}): ${errText}`);
    }

    const result = await res.json();
    return json({ success: true, id: result.id });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
