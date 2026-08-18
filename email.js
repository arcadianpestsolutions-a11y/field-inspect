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

  // Emails a finalized report's PDF to a client. pdfBlob is expected from
  // ReportUI.generatePdfBlob(jobId). Throws on failure — callers show
  // whatever went wrong rather than assuming success.
  async function sendReportEmail({ recipientEmail, recipientName, jobName, jobType, pdfBlob }) {
    const pdfBase64 = await blobToBase64(pdfBlob);
    const { data, error } = await supabaseClient.functions.invoke('send-report-email', {
      body: { recipientEmail, recipientName, jobName, jobType, pdfBase64 },
    });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  window.EmailService = { sendReportEmail };
})();
