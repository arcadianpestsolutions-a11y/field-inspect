// ===========================================================================
// report-print.js - the printed report and the emailed PDF (v127).
//
// Moved out of report.js, which was 4,700 lines. This is the one part of it
// that only READS a report: give it a job and its report and it returns the
// document. Nothing here changes a report or touches the screen being edited.
//
//   buildBodyHtml(job, report, trackedUrls)  the document's HTML (no <html>)
//   openPrintWindow(job, report)             Print / Save as PDF window
//   generatePdfBlob(job, report)             a real PDF Blob, for emailing
//   FIXED_TERMS_HTML, FIXED_TERMS_HTML_PEST  the terms both print and screen show
//
// report.js calls init() once with the few things it owns that this needs:
// the report title, which schema and sections apply, whether a field shows,
// object-URL tracking, and the audit-time format.
//
// SECURITY: every piece of text goes through escapeHtml; stored images
// (signature, sketch) go through HtmlSafe.imageSrc, which only accepts a
// base64 png/jpeg/webp data URL. The print window uses document.write and an
// inline onclick="window.print()", confined to that window.
//
// EXPOSES: window.ReportPrint
// ===========================================================================
(() => {
  'use strict';

  const { escapeHtml, toast } = window.Common;

  // Set by init() from report.js.
  let reportTitleFor;
  let schemaFor;
  let visibleSchema;
  let isFieldVisible;
  let trackUrl;
  let fmtAuditTime;

  function init(deps) {
    ({ reportTitleFor, schemaFor, visibleSchema, isFieldVisible, trackUrl, fmtAuditTime } = deps);
  }

  const FIXED_TERMS_HTML = `
    <p><strong>1. Nature of the Inspection.</strong> This Report does not conclusively determine that the Property is free of timber pests or damage caused by timber pests. The Inspection undertaken was a Non-Invasive, visual Inspection of the Property carried out in accordance with AS 4349.3-2010 (Inspection of buildings — Timber pest inspections), using the inspection methodology of AS 3660.2-2017 where it applies to termite management in and around existing buildings. Use of and reliance upon this Report is solely at the reader's own risk, and only the Client (not any third party) may rely on it.</p>
    <p><strong>2. Scope and exclusions.</strong> This Inspection covers the four timber pest categories within the scope of AS 4349.3-2010: subterranean termites, dampwood termites, borers of seasoned timber, and wood decay fungi. Drywood termites and mould are outside the scope of that Standard. Where evidence of drywood termites or any other pest outside scope is observed, it is noted in the Report as a courtesy (duty to warn), and a specific inspection by a suitably qualified provider is recommended.</p>
    <p><strong>2a. Non-invasive limitation.</strong> No part of the Inspection involved cutting into, dismantling, or removing any part of the building, its linings, coverings or insulation, and furniture and stored articles were not moved. Timber pest activity and damage may be concealed behind or within any of these and remain undetectable by a non-invasive inspection.</p>
    <p><strong>3. Records retention.</strong> Records of this Inspection, including photographs and this Report, are retained by the Inspection Provider for a minimum of three (3) years in accordance with AS 3660.2-2017.</p>
    <p><strong>4. Australian Consumer Law.</strong> Nothing in this Report or these Terms excludes, restricts or modifies any guarantee, warranty, term or condition implied or imposed by the Australian Consumer Law (or any other applicable law) that cannot lawfully be excluded. Where permitted, the Inspection Provider's liability is limited, at its option, to resupply of the Inspection or Report, or payment of the cost of resupply.</p>
    <p><strong>5. Limitations.</strong> The Inspection did not include areas that were inaccessible, obstructed, restricted, or deemed unsafe at the time of Inspection (see "Areas We Were Unable to Inspect"). Non-detectable Termite activity and damage may be present at the Property despite this Inspection.</p>
    <p class="empty-hint">This wording reflects common industry practice and the AS 3660.2-2017 records-retention requirement, but it is not legal advice — have a solicitor review the final terms before relying on them commercially.</p>
  `;

  const FIXED_TERMS_HTML_PEST = `
    <p><strong>1. Nature of the treatment.</strong> This treatment was carried out using registered pest control products in accordance with label directions and relevant state/territory pesticide legislation. Pest treatments reduce pest activity but do not guarantee total elimination or prevent future reinfestation — ongoing monitoring and, where recommended, follow-up treatment may be required.</p>
    <p><strong>2. Chemical use records.</strong> Details of the product(s), batch number(s), and application method used are recorded in this report and retained by the Service Provider for a minimum of three (3) years, as required for pesticide use record-keeping.</p>
    <p><strong>3. Re-entry and withholding.</strong> The Client must observe the re-entry period and any withholding period noted in this report before returning to treated areas or allowing pets/children access, and must comply with any safety directions on the product label.</p>
    <p><strong>4. Australian Consumer Law.</strong> Nothing in this report or these Terms excludes, restricts or modifies any guarantee, warranty, term or condition implied or imposed by the Australian Consumer Law (or any other applicable law) that cannot lawfully be excluded. Where permitted, the Service Provider's liability is limited, at its option, to resupply of the service, or payment of the cost of resupply.</p>
    <p><strong>5. Limitations.</strong> Treatment was limited to the areas accessible and treated as noted in this report. Areas that were inaccessible, obstructed, or outside the agreed scope of work were not treated.</p>
    <p class="empty-hint">This wording reflects common industry practice, but it is not legal advice — have a solicitor review the final terms before relying on them commercially.</p>
  `;

  function fmtVal(v) {
    if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
    if (v === undefined || v === null || v === '') return '—';
    return String(v);
  }

  const REPORT_PDF_STYLE = `
    body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:0;padding:24px;}
    h1{color:#c0552a;} h2{margin:0;color:#fff;}
    .brand{font-weight:bold;font-size:20px;color:#c0552a;margin-bottom:4px;}
    .section{margin-bottom:28px;page-break-inside:avoid;}
    .section-head{padding:8px 14px;border-radius:4px;margin-bottom:8px;}
    .field{padding:6px 0;border-bottom:1px dotted #ccc;}
    .field-label{color:#555;font-size:13px;}
    .field-value{font-size:15px;}
    .photos{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;}
    .photos img{width:140px;height:100px;object-fit:cover;border-radius:4px;}
    img.sig{max-width:280px;border:1px solid #ddd;}
    .sketch-page{page-break-before:always;}
    .amendments-page{page-break-before:always;}
    .amendments-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px;}
    .amendments-table th,.amendments-table td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top;}
    .amendments-table th{background:#f2f2f2;}
    .sketch-img{max-width:100%;border:1px solid #ddd;border-radius:4px;}
    .product-pdf-card{border:1px solid #ccc;border-radius:6px;padding:8px 12px;margin-top:8px;font-size:13px;}
    .product-pdf-title{font-weight:bold;font-size:14px;margin-bottom:4px;}
    @media print { .no-print{display:none;} }
  `;

  // Builds the report's HTML body content (no <html>/<head> wrapper) — the
  // single source of truth for both the print-preview export and the
  // PDF-for-email generation below, so they can never drift apart.
  // trackedUrls, if provided, collects any object URLs created for photos so
  // the caller can revoke them once done (the print-window path doesn't
  // bother, since closing that tab/window naturally releases them; the PDF
  // path does, since it runs in the current page's lifetime).
  function buildReportBodyHtml(job, report, trackedUrls) {
    const isPestTreatment = job && job.jobType === 'pest_treatment';
    // AS 3660.2 governs HOW an existing building is inspected; AS 4349.3
    // governs WHAT the resulting timber pest report must contain. They work
    // as a pair, and a pre-purchase report is judged against 4349.3 — citing
    // only 3660.2 left the report silent on the standard it's measured by.
    const standardLine = isPestTreatment
      ? 'Chemical Application Record'
      : 'In Accordance with AS 4349.3-2010 and AS 3660.2-2017';
    let html = `<div class="brand">${escapeHtml((window.Org && window.Org.businessName()) || "")}</div>
      <h1>${escapeHtml(reportTitleFor(job && job.jobType, report))}</h1>
      <p>${standardLine}<br>${escapeHtml(job ? job.address : '')}</p>`;

    // Same running number as the on-screen list: a printed report must not
    // number its sections 1-8 then 11 because two were never needed.
    let printNumber = 0;
    for (const section of visibleSchema(schemaFor(job && job.jobType, report), report)) {
      printNumber++;
      const values = report.sections[section.id] || {};
      html += `<div class="section"><div class="section-head" style="background:${section.color}"><h2>${printNumber}. ${escapeHtml(section.title)}</h2></div>`;

      if (section.id === 'summary') {
        html += isPestTreatment
          ? `<p>See Pest Identification, Treatment Details, Chemicals / Products Used and Recommendations & Follow-Up sections for full detail.</p>`
          : `<p>See Findings & Observations, Areas We Were Unable to Inspect and Conducive Conditions sections for full detail.</p>`;
      } else if (section.id === 'terms') {
        html += isPestTreatment ? FIXED_TERMS_HTML_PEST : FIXED_TERMS_HTML;
      } else if (section.fixed) {
        for (const field of section.fields) {
          const val = values[field.id] !== undefined ? values[field.id] : field.default;
          if (!val) continue;
          html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="field-value">${escapeHtml(val)}</div></div>`;
        }
      } else {
        for (const field of section.fields) {
          if (!isFieldVisible(field, values)) continue;
          const val = values[field.id];
          if (field.type === 'sketchData') continue; // marker data, not printable
          if (field.type === 'photos') {
            const photos = val || [];
            if (!photos.length) continue;
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="photos">`;
            for (const p of photos) {
              const url = URL.createObjectURL(p.blob);
              if (trackedUrls) trackedUrls.push(url); else trackUrl(url);
              html += `<img src="${url}">`;
            }
            html += `</div></div>`;
          } else if (field.type === 'signature') {
            if (!val) continue;
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><img class="sig" src="${HtmlSafe.imageSrc(val)}"></div>`;
          } else if (field.type === 'sketch') {
            if (!val) continue;
            html += `<div class="field sketch-page"><div class="field-label">${escapeHtml(field.label)}</div><img class="sketch-img" src="${HtmlSafe.imageSrc(val)}"></div>`;
          } else if (field.type === 'productList') {
            const products = val || [];
            if (!products.length) continue;
            // A real pesticide-use table, not a stack of cards: this is the
            // part a regulator or an insurer reads, and it should look like a
            // record rather than a form dump.
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div>`;
            html += `<table class="product-pdf-table"><thead><tr>`
              + `<th>Product</th><th>Active constituent</th><th>Applied to</th>`
              + `<th>Concentrate</th><th>Total applied</th><th>Batch</th>`
              + `</tr></thead><tbody>`;
            for (const p of products) {
              const areas = Array.isArray(p.areaApplied) ? p.areaApplied.join(', ') : (p.areaApplied || '');
              html += `<tr>`
                + `<td>${escapeHtml(p.productName || '')}</td>`
                + `<td>${escapeHtml(p.activeConstituent || '')}</td>`
                + `<td>${escapeHtml(areas)}</td>`
                + `<td>${escapeHtml(p.concentrateUsed || '—')}</td>`
                + `<td>${escapeHtml(p.totalMixApplied || '')}</td>`
                + `<td>${escapeHtml(p.batchNumber || '')}</td>`
                + `</tr>`;
            }
            html += `</tbody></table></div>`;
          } else if (field.type === 'stationList') {
            const stations = val || [];
            if (!stations.length) continue;
            const notable = stations.filter((s) => s.status && s.status !== 'No activity').length;
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div>`;
            html += `<div class="field-value">${stations.length} station${stations.length === 1 ? '' : 's'} inspected`
              + (notable ? `, ${notable} requiring attention` : ', all clear') + `.</div>`;
            html += `<table class="product-pdf-table"><thead><tr>`
              + `<th>Station</th><th>Found</th><th>Action taken</th><th>Notes</th>`
              + `</tr></thead><tbody>`;
            for (const s of stations) {
              html += `<tr>`
                + `<td>${escapeHtml(s.stationNumber || '')}</td>`
                + `<td>${escapeHtml(s.status || '')}</td>`
                + `<td>${escapeHtml(s.action || '')}</td>`
                + `<td>${escapeHtml(s.note || '')}</td>`
                + `</tr>`;
            }
            html += `</tbody></table></div>`;
          } else {
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="field-value">${escapeHtml(fmtVal(val))}</div></div>`;
          }
        }
      }
      html += `</div>`;
    }
    html += buildAmendmentsAppendixHtml(report);
    return html;
  }

  // A report that was corrected after sign-off and reissued should say so on
  // its face. If the first copy a client received said one thing and the copy
  // produced later says another, the difference belongs in the document — not
  // only in an audit log the client never sees.
  //
  // Only post-finalization amendments appear. Ordinary edits made while the
  // report was still being written are working notes, not amendments, and
  // printing them would bury the ones that matter.
  function buildAmendmentsAppendixHtml(report) {
    const amendments = ((report && report.auditLog) || []).filter((e) => e.afterFinalize && e.event === 'field-changed');
    if (!amendments.length) return '';

    const rows = amendments
      .slice()
      .sort((a, b) => a.at - b.at)
      .map((e) => `
        <tr>
          <td>${escapeHtml(fmtAuditTime(e.at))}</td>
          <td>${escapeHtml(e.sectionTitle || e.sectionId || '')}<br><strong>${escapeHtml(e.label || e.fieldId || '')}</strong></td>
          <td>${escapeHtml(e.from)} &rarr; ${escapeHtml(e.to)}</td>
          <td>${escapeHtml(e.reason || '')}</td>
          <td>${escapeHtml(e.userEmail || 'unknown')}</td>
        </tr>`)
      .join('');

    return `
      <div class="section amendments-page">
        <h2>Appendix — Amendments After Finalisation</h2>
        <p class="field-value">This report was finalised on ${escapeHtml(fmtAuditTime(report.finalizedAt))} and has been amended ${amendments.length} time${amendments.length === 1 ? '' : 's'} since. Each amendment is listed below with the reason recorded at the time.</p>
        <table class="amendments-table">
          <thead><tr><th>When</th><th>Field</th><th>Change</th><th>Reason</th><th>By</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function openPrintWindow(job, report) {
    const printWin = window.open('', '_blank');
    if (!printWin) { toast('Allow pop-ups to export the PDF'); return; }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(reportTitleFor(job && job.jobType, report))}</title>
      <style>${REPORT_PDF_STYLE}</style></head><body>
      <p><button class="no-print" onclick="window.print()">Print / Save as PDF</button></p>
      ${buildReportBodyHtml(job, report)}
      </body></html>`;

    printWin.document.write(html);
    printWin.document.close();
  }

  // Renders the report and rasterizes it into a real PDF Blob via
  // html2pdf.js (loaded in index.html) — needed for emailing, since a
  // print-preview window requires the user's own "Save as PDF" interaction
  // and produces no Blob we could ever attach to anything programmatically.
  //
  // html2canvas (which html2pdf uses internally) captures based on the
  // element's actual on-screen position — an element parked at a large
  // negative offset to "hide" it isn't in real viewport space and captures
  // blank. So this renders as a genuine full-screen overlay instead (with a
  // "Generating…" backdrop, since it's only up for well under a second) —
  // the reliable pattern for this, not a cosmetic choice.
  async function generateReportPdfBlob(job, report) {
    if (!window.html2pdf) throw new Error('PDF library not loaded');
    const trackedUrls = [];
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;overflow:auto;';
    const container = document.createElement('div');
    container.style.width = '800px';
    container.style.margin = '0 auto';
    const style = document.createElement('style');
    style.textContent = REPORT_PDF_STYLE;
    container.appendChild(style);
    const content = document.createElement('div');
    content.innerHTML = buildReportBodyHtml(job, report, trackedUrls);
    container.appendChild(content);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    try {
      // Let every <img> (photos, signature, sketch) actually finish loading
      // before rasterizing — html2canvas captures whatever's rendered at
      // that instant, so a still-loading image would just come out blank.
      const images = Array.from(container.querySelectorAll('img'));
      await Promise.all(images.map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      })));
      // One extra frame so layout/paint has genuinely settled before capture.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const blob = await window.html2pdf()
        .set({ margin: 10, filename: 'report.pdf', html2canvas: { scale: 2 }, jsPDF: { unit: 'pt', format: 'a4' } })
        .from(container)
        .outputPdf('blob');
      return blob;
    } finally {
      document.body.removeChild(overlay);
      trackedUrls.forEach((url) => URL.revokeObjectURL(url));
    }
  }

  window.ReportPrint = {
    init,
    buildBodyHtml: (job, report, trackedUrls) => buildReportBodyHtml(job, report, trackedUrls),
    buildAmendmentsAppendixHtml,
    openPrintWindow,
    generatePdfBlob: generateReportPdfBlob,
    STYLE: REPORT_PDF_STYLE,
    FIXED_TERMS_HTML,
    FIXED_TERMS_HTML_PEST,
  };
})();
