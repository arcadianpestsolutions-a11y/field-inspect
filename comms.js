// Automated client messages — the app's side of the send-client-message Edge
// Function.
//
// This module deliberately does very little. It does NOT decide whether a
// client may be emailed, it does not hold the recipient address, and it never
// sends one anywhere. It passes a job id to the server and turns whatever
// comes back into a sentence a technician can act on.
//
// That split is the point. Everything that could email the wrong person, or
// email someone who asked not to be, is decided in one place on the server
// where a stale cached build cannot reach it. See the header of
// supabase/functions/send-client-message/index.ts for why.
(() => {
  'use strict';

  // ---------- What the technician reads ----------
  // Above the configuration guards below, same as SyncMessages and
  // AIMessages: these are pure text, they depend on nothing, and the suite
  // has to assert on the exact wording with no Supabase session.

  // A refusal is not an error. The server checked, decided this message
  // should not go, and said why. Each of these tells the technician what
  // happened and what, if anything, to do about it.
  const REFUSALS = {
    'opted-out':
      'Not sent. This client has asked not to receive automated email. '
      + 'You can still phone them, or send a report yourself from the report screen.',
    'no-email-on-file':
      'Not sent. There is no email address on this job. Add one in the job '
      + 'details and it will send next time you save.',
    'email-not-valid':
      'Not sent. The email address on this job does not look like an email '
      + 'address. Check it in the job details.',
    'already-sent':
      'Already sent for this time, so nothing was sent again. Changing the '
      + 'appointment time sends a fresh confirmation.',
    'nothing-to-send-about':
      'Not sent. This job has no appointment time yet, so there is nothing to '
      + 'confirm. Schedule it first.',
    'job-not-found':
      'Not sent. This job has not reached the cloud yet. It will send once '
      + 'the job syncs.',
  };

  function refusalText(reason) {
    return REFUSALS[reason]
      || 'Not sent. The server declined to send this message and did not say why.';
  }

  // supabase-js flattens every non-2xx into the same sentence and keeps the
  // real body on error.context. Without unwrapping it, a missing deployment
  // and a bad address read identically.
  async function edgeErrorMessage(error) {
    try {
      if (error && error.context && typeof error.context.json === 'function') {
        const source = typeof error.context.clone === 'function'
          ? error.context.clone() : error.context;
        const body = await source.json();
        if (body && body.error) return String(body.error);
      }
    } catch (e) { /* not JSON — fall through */ }
    return String((error && error.message) || error || '');
  }

  function failureText(detail) {
    const text = String(detail || '');
    if (/not\s*found|404/i.test(text)) {
      return 'Automated email is not switched on yet. The send-client-message '
        + 'function has not been deployed. Nothing was lost — the job is saved.';
    }
    if (/not authenticated|401|jwt/i.test(text)) {
      return 'The job is saved. Your login has expired, so the confirmation '
        + 'email did not go out. Log out and back in, then reschedule or save '
        + 'the job again to send it.';
    }
    if (/failed to fetch|network/i.test(text)) {
      return 'No connection, so no email went out. The job is saved on this '
        + 'device and you can send the confirmation later from the job.';
    }
    return `Could not send the confirmation: ${text}. The job itself is saved.`;
  }

  window.CommsMessages = { refusalText, failureText, REFUSALS };

  // ---------- Guards ----------

  if (window.IS_TEST || window.IS_DEMO) {
    console.warn('[comms] test/demo mode — no client email is sent.');
    return;
  }
  if (!window.supabaseClient) {
    console.warn('[comms] Supabase not configured — automated email disabled.');
    return;
  }

  const client = window.supabaseClient;

  // Returns { sent, message } and never throws. A failure to email a client
  // must never be able to fail the thing the technician was actually doing,
  // which is saving a job.
  async function send(kind, jobId) {
    if (!jobId) return { sent: false, message: refusalText('job-not-found') };
    try {
      const { data, error } = await client.functions.invoke('send-client-message', {
        body: { kind, jobId },
      });
      if (error) return { sent: false, message: failureText(await edgeErrorMessage(error)) };
      if (data && data.sent) return { sent: true, message: null };
      return { sent: false, message: refusalText(data && data.reason) };
    } catch (e) {
      return { sent: false, message: failureText(e && e.message) };
    }
  }

  // A sweep with dryRun left at its default reports who WOULD be emailed and
  // sends nothing. That is the only form exposed to the app on purpose: a
  // live sweep over every client is a deliberate server-side act, not a
  // button someone can lean on.
  async function previewSweep(kind) {
    try {
      const { data, error } = await client.functions.invoke('send-client-message', {
        body: { sweep: kind },
      });
      if (error) return { ok: false, message: failureText(await edgeErrorMessage(error)) };
      return { ok: true, wouldSend: (data && data.wouldSend) || [], checked: (data && data.checked) || 0 };
    } catch (e) {
      return { ok: false, message: failureText(e && e.message) };
    }
  }

  window.CommsService = {
    sendBookingConfirmation: (jobId) => send('booking_confirmation', jobId),
    sendReportReady: (jobId) => send('report_ready', jobId),
    previewSweep,
  };
})();
