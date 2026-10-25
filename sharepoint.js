// Copies client files to the business's SharePoint site (sharepoint-files
// Edge Function, migration 038): one folder per client, the finalised
// report, invoices and job photos.
//
// QUIET BY DESIGN. Copying happens in the background after a report is
// finalised or an invoice emailed. Until SharePoint is set up (the server
// answers configured:false) nothing is said at all; once it is, a failure is
// written to the error log rather than put in front of somebody standing in
// a driveway. The Business details screen shows the state and can copy every
// finalised job in one go.
//
// EXPOSES: window.SharePoint { status, copyJob, copyInvoice, copyAll }
(() => {
  'use strict';

  const FN = 'sharepoint-files';
  const usable = () => !!(window.supabaseClient && !window.IS_TEST && !window.IS_DEMO);
  let statusCache = null;

  async function call(body) {
    const { data, error } = await window.supabaseClient.functions.invoke(FN, { body });
    if (error) {
      // A function that is not deployed yet, or a 4xx/5xx: the body has the reason.
      let message = error.message || String(error);
      try { const b = await error.context.json(); if (b && b.message) message = b.message; } catch (e) { /* keep */ }
      throw new Error(message);
    }
    return data || {};
  }

  async function status({ fresh = false } = {}) {
    if (!usable()) return { configured: false };
    if (statusCache && !fresh) return statusCache;
    try { statusCache = await call({ action: 'status' }); } catch (e) { statusCache = { configured: false, error: e.message }; }
    return statusCache;
  }

  // Copies a job's report and photos, calling again while the server says
  // there are more (it copies a batch per call to stay inside its time limit).
  async function copyJob(jobId) {
    if (!usable() || !jobId) return { configured: false };
    let total = 0;
    let last = {};
    for (let round = 0; round < 6; round++) {
      last = await call({ action: 'copy-job', jobId });
      if (!last.configured) return last;
      total += last.copied || 0;
      if (!last.remaining) break;
    }
    return { ...last, copied: total };
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  async function copyInvoice(invoice, pdfBlob) {
    if (!usable() || !invoice || !pdfBlob) return { configured: false };
    return call({
      action: 'copy-invoice',
      jobId: invoice.jobId,
      invoiceId: invoice.id,
      number: invoice.number,
      issuedAt: invoice.issueDate || invoice.createdAt,
      version: String(invoice.updatedAt || ''),
      pdfBase64: await blobToBase64(pdfBlob),
    });
  }

  // Every job with a finalised report. Sequential, one job at a time, with a
  // progress callback: a backlog of a few hundred photos takes minutes.
  async function copyAll(onProgress) {
    const reports = await DB.getAllReports();
    const jobIds = reports.filter((r) => r.finalizedAt).map((r) => r.jobId);
    let copied = 0;
    let failed = 0;
    for (let i = 0; i < jobIds.length; i++) {
      try {
        const r = await copyJob(jobIds[i]);
        if (!r.configured) return { configured: false, copied, failed };
        copied += r.copied || 0;
      } catch (e) {
        failed++;
        if (window.ErrorLog) window.ErrorLog.note(e, 'sharepoint: copy a job');
      }
      if (onProgress) onProgress(i + 1, jobIds.length, copied);
    }
    return { configured: true, jobs: jobIds.length, copied, failed };
  }

  // Background copy that never interrupts anyone.
  function quietly(promise, where) {
    promise.catch((e) => { if (window.ErrorLog) window.ErrorLog.note(e, where); });
  }

  window.SharePoint = {
    status, copyJob, copyInvoice, copyAll,
    copyJobQuietly: (jobId) => quietly(copyJob(jobId), 'sharepoint: copy after finalise'),
    copyInvoiceQuietly: (inv, blob) => quietly(copyInvoice(inv, blob), 'sharepoint: copy invoice'),
  };
})();
