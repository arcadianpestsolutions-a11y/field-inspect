// The timber pest inspection agreement, signed by the client before the visit
// (v120, migration 034).
//
//   Booking   a timber pest inspection booked with an email and a time makes
//             the client's link asking for the agreement, so the booking
//             confirmation email carries it (send-client-message reads it).
//   Signing   the client reads the scope and signs on portal.html. That only
//             ever INSERTS a row (client_acceptances, kind 'agreement'); the
//             public page cannot touch the report.
//   Filing    on the next sync, this phone, signed in, puts the signature
//             into section 3 of the report (About Our Agreement: name, date,
//             signature) and stamps the row as applied, with an audit entry.
//             Nobody has to copy anything across, and the rule from migration
//             030 still holds: what reaches the report is put there by a
//             signed-in user of the business, never by the public endpoint.
//
// Separate from client-link.js on purpose: that file is the panel on the job
// screen and does nothing without it, while booking and filing have to work
// whether or not that panel was ever opened.
//
// EXPOSES: window.ClientAgreement = { needsAgreement, requestFor, liveAgreement,
//   applyRow, applyPending, LIFETIME_DAYS }

(() => {
  'use strict';

  const LIFETIME_DAYS = 90;
  const client = () => window.supabaseClient || null;
  const { toast } = window.Common;

  // The same rule as supabase/functions/_shared/agreement.js needsAgreement,
  // in the app's own field names. A test keeps the two in step.
  function needsAgreement(job, report) {
    if (!job || job.jobType === 'pest_treatment') return false;
    if (report && report.finalizedAt) return false;
    const doc = (report && report.documentType) || job.preferredDocumentType || '';
    return doc === '' || doc === 'timber_pest_inspection';
  }

  function randomToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function liveLink(jobId) {
    const { data, error } = await client().from('client_access')
      .select('token, expires_at, acceptance_requested_at, agreement_requested_at')
      .eq('job_id', jobId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const row = (data || [])[0];
    return row && row.expires_at > Date.now() ? row : null;
  }

  // Makes sure this job's live link asks for the agreement, creating the link
  // if there is none. Returns { ok, token } or { ok: false, reason }.
  async function requestFor(jobId) {
    const c = client();
    if (!c || !jobId) return { ok: false, reason: 'signed-out' };
    const now = Date.now();
    const row = await liveLink(jobId);
    if (row) {
      if (!row.agreement_requested_at) {
        const { error } = await c.from('client_access')
          .update({ agreement_requested_at: now, updated_at: now })
          .eq('token', row.token);
        if (error) throw error;
      }
      return { ok: true, token: row.token, created: false };
    }
    const user = window.Sync && window.Sync.currentUser ? window.Sync.currentUser() : null;
    const fresh = {
      token: randomToken(),
      job_id: jobId,
      expires_at: now + LIFETIME_DAYS * 86400000,
      acceptance_requested_at: null,
      agreement_requested_at: now,
      created_by: user ? user.id : null,
      created_at: now,
      updated_at: now,
    };
    const { error } = await c.from('client_access').insert(fresh);
    if (error) throw error;
    return { ok: true, token: fresh.token, created: true };
  }

  async function liveAgreement(jobId) {
    const c = client();
    if (!c) return null;
    const { data, error } = await c.from('client_acceptances')
      .select('id, job_id, accepted_name, accepted_at, signature, applied_to_report_at')
      .eq('job_id', jobId)
      .eq('kind', 'agreement')
      .is('superseded_at', null)
      .limit(1);
    if (error) {
      // Migration 034 not run yet: there are no agreements to find.
      if (/kind|client_acceptances/i.test(String(error.message || ''))) return null;
      throw error;
    }
    return (data || [])[0] || null;
  }

  // Puts one signed agreement on its report and records that it was. Returns
  // the ReportUI result ({ ok } or { ok: false, reason }).
  async function applyRow(row) {
    if (!row || !window.ReportUI || !window.ReportUI.applyClientAgreement) return { ok: false, reason: 'not-ready' };
    const result = await window.ReportUI.applyClientAgreement(row.job_id, {
      name: row.accepted_name,
      signature: row.signature,
      at: row.accepted_at,
    });
    if (!result || !result.ok) return result || { ok: false, reason: 'failed' };
    const now = Date.now();
    const { error } = await client().from('client_acceptances')
      .update({ applied_to_report_at: now, updated_at: now })
      .eq('id', row.id);
    // The signature is on the report either way. If the stamp did not stick,
    // the next sync finds the row again, sees the report already signed and
    // leaves it alone, so this cannot sign twice.
    if (error) console.warn('[agreement] signed onto the report, but the stamp failed:', error.message || error);
    row.applied_to_report_at = now;
    return { ok: true };
  }

  let applying = false;

  // Every agreement signed since the last look, for jobs this phone has.
  // Called after each sync. Quiet when there is nothing to do.
  async function applyPending() {
    const c = client();
    if (!c || applying || window.IS_DEMO || window.IS_TEST) return 0;
    if (!(window.Sync && window.Sync.currentUser && window.Sync.currentUser())) return 0;
    applying = true;
    try {
      const { data, error } = await c.from('client_acceptances')
        .select('id, job_id, accepted_name, accepted_at, signature, applied_to_report_at')
        .eq('kind', 'agreement')
        .is('superseded_at', null)
        .is('applied_to_report_at', null)
        .order('accepted_at', { ascending: true })
        .limit(50);
      if (error) return 0;
      let filed = 0;
      for (const row of data || []) {
        const job = await DB.getJob(row.job_id).catch(() => null);
        if (!job) continue;
        try {
          const result = await applyRow(row);
          if (result && result.ok) filed += 1;
        } catch (e) {
          if (window.ErrorLog) window.ErrorLog.note(e, 'agreement: apply');
        }
      }
      if (filed) {
        toast(filed === 1
          ? 'A client signed their inspection agreement. It is on the report.'
          : `${filed} clients signed their inspection agreements. They are on the reports.`);
      }
      return filed;
    } finally {
      applying = false;
    }
  }

  window.ClientAgreement = { needsAgreement, requestFor, liveAgreement, applyRow, applyPending, LIFETIME_DAYS };
})();
