// Client for the `send-report-email` Supabase Edge Function — emails a
// finalized report's PDF to a client. The Resend API key stays server-side
// in the Edge Function; this module only ever talks to Supabase.
//
// Mirrors ai.js/sync.js's own local-only fallback: if Supabase isn't
// configured, window.EmailService simply doesn't exist, and callers should
// check for it.
(() => {
  'use strict';

  if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_PUBLISHABLE_KEY) {
    console.warn('[email] Supabase not configured — email sending unavailable.');
    return;
  }
  // Reuses sync.js's client rather than creating a second one — see the
  // matching comment in ai.js for why (avoids Supabase's "multiple
  // GoTrueClient instances" warning / auth token refresh risk).
  if (!window.supabaseClient) {
    console.warn('[email] sync.js did not initialize a Supabase client — email sending unavailable.');
    return;
  }
  const supabaseClient = window.supabaseClient;

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // functions.invoke collapses every non-2xx into "Edge Function returned a
  // non-2xx status code" and hands the real response over on error.context.
  // Without reading it, a technician who sends a report to a bad address, or
  // whose check-email-status function is not deployed, is told an HTTP fact
  // about status codes instead of what went wrong. Same approach as
  // xero.js's invoke().
  async function failureFrom(error, fallback) {
    try {
      if (error && error.context && typeof error.context.json === 'function') {
        const body = await error.context.clone().json();
        if (body && body.error) return new Error(String(body.error));
      }
    } catch (e) { /* not JSON — use the generic message below */ }
    return new Error((error && error.message) || fallback);
  }

  // Emails a finalized report's PDF to a client. pdfBlob is expected from
  // ReportUI.generatePdfBlob(jobId). Throws on failure — callers show
  // whatever went wrong rather than assuming success.
  // documentKind distinguishes an invoice from a report so the subject line,
  // body and attachment filename read correctly for what's actually attached.
  async function sendReportEmail({ recipientEmail, recipientName, jobName, jobType, documentKind, pdfBlob }) {
    const pdfBase64 = await blobToBase64(pdfBlob);
    const { data, error } = await supabaseClient.functions.invoke('send-report-email', {
      body: { recipientEmail, recipientName, jobName, jobType, documentKind, pdfBase64 },
    });
    if (error) throw await failureFrom(error, 'Could not send the email.');
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  // "Did they actually receive it?" — reads back the current delivery
  // status of an email already sent, by the id Resend returned at send
  // time (data.id from sendReportEmail above). Checked on demand rather
  // than pushed by a webhook — see check-email-status's own header for why.
  async function checkEmailStatus(emailId) {
    if (!emailId) throw new Error('No email id to check — this was never sent, or sent before delivery tracking existed.');
    const { data, error } = await supabaseClient.functions.invoke('check-email-status', {
      body: { emailId },
    });
    if (error) throw await failureFrom(error, 'Could not check the delivery status.');
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  window.EmailService = { sendReportEmail, checkEmailStatus };
})();
