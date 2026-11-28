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
// base64 png/jpeg/webp data URL. The print window uses document.write; its
// Print button is wired with addEventListener, because the window inherits
// the app's CSP and an inline onclick is refused.
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

  // v183: the consent the client gives in the pre-inspection agreement
  // (supabase/functions/_shared/agreement.js, 'Photos, video and your
  // information'), repeated in the report's terms. A test keeps them equal.
  const PHOTO_CONSENT_TEXT = "The Inspection Provider takes photographs (and, where it helps, video) of the Property during the Inspection. Photographs, the Report and the Client's details are stored securely and kept for at least three years, and are not shared outside the Inspection Provider except as the law requires or the Client asks. Software, including artificial intelligence, may read the photographs to help draft the Report; a licensed technician checks and approves every finding before the Report is issued.";

  // v153: two versions of clauses 1 and 2, one per Standard. The rest is shared.
  const TERMS_3660_HEAD = `
    <p><strong>1. Nature of the Inspection.</strong> This Report does not conclusively determine that the Property is free of termites or damage caused by termites. The Inspection undertaken was a Non-Invasive, visual termite inspection of the Property carried out in accordance with AS 3660.2-2017 (Termite management — In and around existing buildings and structures — Guidelines). Use of and reliance upon this Report is solely at the reader's own risk, and only the Client (not any third party) may rely on it.</p>
    <p><strong>2. Scope and exclusions.</strong> This Inspection is for subterranean termites, evidence of their activity or damage, and conditions that make termite attack more likely. Borers of seasoned timber, wood decay fungi and dampwood termites are outside the scope of AS 3660.2-2017; where they were seen they are noted in this Report as additional findings, as a courtesy. A full timber pest inspection in accordance with AS 4349.3-2010 is available on request. Drywood termites and mould are also outside scope; where evidence of them or of any other pest is observed, it is noted (duty to warn) and a specific inspection by a suitably qualified provider is recommended.</p>`;

  const FIXED_TERMS_HTML = `
    <p><strong>1. Nature of the Inspection.</strong> This Report does not conclusively determine that the Property is free of timber pests or damage caused by timber pests. The Inspection undertaken was a Non-Invasive, visual Inspection of the Property carried out in accordance with AS 4349.3-2010 (Inspection of buildings — Timber pest inspections), using the inspection methodology of AS 3660.2-2017 where it applies to termite management in and around existing buildings. Use of and reliance upon this Report is solely at the reader's own risk, and only the Client (not any third party) may rely on it.</p>
    <p><strong>2. Scope and exclusions.</strong> This Inspection covers the four timber pest categories within the scope of AS 4349.3-2010: subterranean termites, dampwood termites, borers of seasoned timber, and wood decay fungi. Drywood termites and mould are outside the scope of that Standard. Where evidence of drywood termites or any other pest outside scope is observed, it is noted in the Report as a courtesy (duty to warn), and a specific inspection by a suitably qualified provider is recommended.</p>
    <p><strong>2a. Non-invasive limitation.</strong> No part of the Inspection involved cutting into, dismantling, or removing any part of the building, its linings, coverings or insulation, and furniture and stored articles were not moved. Timber pest activity and damage may be concealed behind or within any of these and remain undetectable by a non-invasive inspection.</p>
    <p><strong>3. Records retention.</strong> Records of this Inspection, including photographs and this Report, are retained by the Inspection Provider for a minimum of three (3) years in accordance with AS 3660.2-2017.</p>
    <p><strong>4. Australian Consumer Law.</strong> Nothing in this Report or these Terms excludes, restricts or modifies any guarantee, warranty, term or condition implied or imposed by the Australian Consumer Law (or any other applicable law) that cannot lawfully be excluded. Where permitted, the Inspection Provider's liability is limited, at its option, to resupply of the Inspection or Report, or payment of the cost of resupply.</p>
    <p><strong>5. Limitations.</strong> The Inspection did not include areas that were inaccessible, obstructed, restricted, or deemed unsafe at the time of Inspection (see "Areas We Were Unable to Inspect"). Non-detectable Termite activity and damage may be present at the Property despite this Inspection.</p>
    <p class="fine-print"><strong>6. Photographs, records and software.</strong> ${PHOTO_CONSENT_TEXT}</p>
    <p class="empty-hint">This wording reflects common industry practice and the AS 3660.2-2017 records-retention requirement, but it is not legal advice — have a solicitor review the final terms before relying on them commercially.</p>
  `;

  // v9: the three documents that follow an inspection used to print the
  // inspection's terms ("This Inspection was non-invasive…") on a certificate
  // or a quote. Each now prints what AS 3660.2 says about that document.
  const TERMS_ACTION_PLAN = `
    <p><strong>1. Nature of this plan.</strong> This Termite Management Plan is prepared in accordance with Section 4 of AS 3660.2-2017. It sets out the proposed actions, their expected outcome and the risks involved so that the Client and the Provider share an understanding of the process. It does not replace the inspection report it is based on.</p>
    <p><strong>2. Colony control.</strong> Where termites are active, action to eliminate the colony is taken first. Colony control (including dusting, foaming and baiting) does not provide any ongoing or residual protection against other colonies, now or in future, and other termites may use the existing galleries to resume attack (AS 3660.2-2017 clause 5.5.1).</p>
    <p><strong>3. No guarantee against future attack.</strong> A termite management system is designed to impede concealed termite entry; termites may still build around it. Regular inspection at not more than 12-month intervals remains necessary, and the warranty depends on it.</p>`;
  const TERMS_CERTIFICATE = `
    <p><strong>1. Certificate of Installation.</strong> This Certificate of Installation is issued in accordance with AS 3660.2-2017 (clauses 5.8 and 5.9). It is to be retained by the building owner or their agent. A copy is retained by the Provider for a minimum of ten (10) years.</p>
    <p><strong>2. Further applications.</strong> A separate certificate is issued for each application of termiticide made more than one calendar month after the last.</p>
    <p><strong>3. Maintenance and inspection.</strong> The system will only remain effective if it is maintained and inspected as stated in this certificate. Disturbing the treated zone, building over or against it, or bridging the inspection zone may allow concealed termite entry.</p>`;
  const TERMS_MONITORING = `
    <p><strong>1. Monitoring.</strong> Termite baits and monitoring stations are inspected at intervals not exceeding three months, and more often while termites are feeding (AS 3660.2-2017 clauses 5.2.2 and 5.5.1.3.3). Undetected feeding between visits may increase the risk to the structure.</p>
    <p><strong>2. Colony status.</strong> The absence of termites from a station is not, on its own, proof that a colony has been destroyed (clause 5.5.1.4). Baiting does not provide residual protection against other colonies.</p>
    <p><strong>3. Annual inspection.</strong> A full inspection of the building at not more than 12-month intervals is still required.</p>`;
  // A plan or a certificate can be written under AS 3660.1 (new building
  // work) instead: the form asks which. The first clauses above say the
  // document follows AS 3660.2 and cite its clauses, which would be wrong on
  // those. These say what the document is and cite nothing; the certificate
  // also loses AS 3660.2's rule about repeat applications and the ten-year
  // figure, which is AS 3660.2 clause 5.9's. Three clauses each, because the
  // consumer law clause that follows them is numbered 4.
  const TERMS_ACTION_PLAN_NEW_BUILD = `
    <p><strong>1. Nature of this plan.</strong> This Termite Management Plan sets out the proposed actions, their expected outcome and the risks involved so that the Client and the Provider share an understanding of the process. It does not replace the inspection report it is based on.</p>`
    + TERMS_ACTION_PLAN.slice(TERMS_ACTION_PLAN.indexOf('\n    <p><strong>2.'));
  const TERMS_CERTIFICATE_NEW_BUILD = `
    <p><strong>1. Certificate of Installation.</strong> This Certificate of Installation records the termite management system installed at the Property under AS 3660.1-2014.</p>
    <p><strong>2. Keeping this certificate.</strong> It is to be retained by the building owner or their agent. A copy is retained by the Provider.</p>
    <p><strong>3. Maintenance and inspection.</strong> The system will only remain effective if it is maintained and inspected as stated in this certificate. Disturbing the treated zone, building over or against it, or bridging the inspection zone may allow concealed termite entry.</p>`;
  const isNewBuild = (standard) => /^AS 3660\.1/.test(String(standard || ''));
  const TERMS_BY_DOCUMENT = {
    termite_action_plan: TERMS_ACTION_PLAN,
    termite_certificate: TERMS_CERTIFICATE,
    termite_monitoring: TERMS_MONITORING,
    termite_service_record: TERMS_MONITORING,
  };

  // The terms for an inspection report, in the Standard it is written to.
  function termsHtmlFor(report) {
    let docTerms = TERMS_BY_DOCUMENT[report && report.documentType];
    if (docTerms) {
      const answers = (report && report.sections) || {};
      if (report.documentType === 'termite_action_plan' && isNewBuild((answers.basis || {}).standardApplied)) docTerms = TERMS_ACTION_PLAN_NEW_BUILD;
      if (report.documentType === 'termite_certificate' && isNewBuild((answers.installation || {}).standardApplied)) docTerms = TERMS_CERTIFICATE_NEW_BUILD;
      // Consumer law and the legal-review note are the same for every document.
      const acl = FIXED_TERMS_HTML.slice(FIXED_TERMS_HTML.indexOf('<p><strong>4.'), FIXED_TERMS_HTML.indexOf('<p><strong>5.'));
      const note = FIXED_TERMS_HTML.slice(FIXED_TERMS_HTML.indexOf('<p class="empty-hint">'));
      return docTerms + '\n    ' + acl + note;
    }
    const U = window.ReportSchemaUtils;
    const std = U && U.inspectionStandard ? U.inspectionStandard(report) : null;
    if (!std || std.code === 'as4349') return FIXED_TERMS_HTML;
    // Clauses 2a onward are the same for both.
    const rest = FIXED_TERMS_HTML.slice(FIXED_TERMS_HTML.indexOf('<p><strong>2a.'));
    return TERMS_3660_HEAD + '\n    ' + rest;
  }

  const FIXED_TERMS_HTML_PEST = `
    <p><strong>1. Nature of the treatment.</strong> This treatment was carried out using registered pest control products in accordance with label directions and relevant state/territory pesticide legislation. Pest treatments reduce pest activity but do not guarantee total elimination or prevent future reinfestation — ongoing monitoring and, where recommended, follow-up treatment may be required.</p>
    <p><strong>2. Chemical use records.</strong> Details of the product(s), batch number(s), and application method used are recorded in this report and retained by the Service Provider for a minimum of three (3) years, as required for pesticide use record-keeping.</p>
    <p><strong>3. Re-entry and withholding.</strong> The Client must observe the re-entry period and any withholding period noted in this report before returning to treated areas or allowing pets/children access, and must comply with any safety directions on the product label.</p>
    <p><strong>4. Australian Consumer Law.</strong> Nothing in this report or these Terms excludes, restricts or modifies any guarantee, warranty, term or condition implied or imposed by the Australian Consumer Law (or any other applicable law) that cannot lawfully be excluded. Where permitted, the Service Provider's liability is limited, at its option, to resupply of the service, or payment of the cost of resupply.</p>
    <p><strong>5. Limitations.</strong> Treatment was limited to the areas accessible and treated as noted in this report. Areas that were inaccessible, obstructed, or outside the agreed scope of work were not treated.</p>
    <p class="empty-hint">This wording reflects common industry practice, but it is not legal advice — have a solicitor review the final terms before relying on them commercially.</p>
  `;

  // `since` (v177): the schema version a question, a section or a walk item
  // arrived in. A report signed before then never had it on screen, so it is
  // left out of that report's print instead of showing as a dash or as "Not
  // recorded". A report that is not signed yet is always printed against
  // today's questions, because those are the ones it will be signed against.
  const isBlank = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  function predatesFor(report) {
    const signedUnder = report && report.finalizedAt ? (Number(report.schemaVersion) || 0) : Infinity;
    return (thing) => !!(thing && thing.since) && signedUnder < thing.since;
  }

  function fmtVal(v) {
    if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
    if (v === undefined || v === null || v === '') return '—';
    return String(v);
  }

  const REPORT_PDF_STYLE = `
    body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:0;padding:24px;}
    h1{color:#c0552a;} h2{margin:0;color:#fff;}
    .brand{font-weight:bold;font-size:20px;color:#c0552a;margin-bottom:4px;}
    .brand-logo{display:block;max-height:72px;max-width:260px;margin-bottom:8px;}
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
    .limits-box{border:2px solid #c0552a;border-radius:6px;padding:8px 14px;margin:10px 0;font-size:13px;}
    .limits-head{font-weight:bold;font-size:15px;color:#c0552a;margin-bottom:4px;}
    .limits-box ul{margin:4px 0 6px 18px;padding:0;}
    .fine-print{font-size:10px;color:#555;line-height:1.35;}
    .ai-note{font-size:11px;color:#444;border-left:3px solid #999;padding:4px 10px;margin-top:10px;}
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
    // v153: a regular inspection is written to AS 3660.2; a pre-purchase one
    // to AS 4349.3, with 3660.2's methods (ReportSchemaUtils.inspectionStandard).
    const U = window.ReportSchemaUtils;
    const std = !isPestTreatment && U && U.inspectionStandard ? U.inspectionStandard(report) : null;
    const standardLine = isPestTreatment
      ? 'Chemical Application Record'
      : (std ? std.coverLine : 'In Accordance with AS 3660.2-2017');
    // The business's own logo above its name (v166). For a subcontractor this
    // is the host's: the report goes out under the business the client hired.
    const logo = window.Org && window.Org.logo ? HtmlSafe.imageSrc(window.Org.logo()) : '';
    let html = `${logo ? `<img class="brand-logo" src="${logo}" alt="">` : ''}<div class="brand">${escapeHtml((window.Org && window.Org.businessName()) || "")}</div>
      <h1>${escapeHtml(reportTitleFor(job && job.jobType, report))}</h1>
      <p>${standardLine}<br>${escapeHtml(job ? job.address : '')}</p>`;

    // Same running number as the on-screen list: a printed report must not
    // number its sections 1-8 then 11 because two were never needed.
    let printNumber = 0;
    const predates = predatesFor(report);
    for (const section of visibleSchema(schemaFor(job && job.jobType, report), report)) {
      const values = report.sections[section.id] || {};
      // A whole section newer than the signature, with nothing in it.
      if (predates(section) && !Object.keys(values).some((k) => !isBlank(values[k]))) continue;
      printNumber++;
      html += `<div class="section"><div class="section-head" style="background:${section.color}"><h2>${printNumber}. ${escapeHtml(section.title)}</h2></div>`;

      if (section.id === 'summary') {
        html += isPestTreatment
          ? `<p>See Pest Identification, Treatment Details, Chemicals / Products Used and Recommendations & Follow-Up sections for full detail.</p>`
          : `<p>See Findings & Observations, Areas We Were Unable to Inspect and Conducive Conditions sections for full detail.</p>`;
        html += limitationsHtml(job, report);
      } else if (section.id === 'terms') {
        html += isPestTreatment ? FIXED_TERMS_HTML_PEST : termsHtmlFor(report);
      } else if (section.fixed) {
        for (const field of section.fields) {
          let val = values[field.id] !== undefined ? values[field.id] : field.default;
          // The inspection type follows the Standard unless one was stored.
          if (values[field.id] === undefined && field.id === 'inspectionType' && std) val = std.typeLine;
          if (!val) continue;
          html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="field-value">${escapeHtml(val)}</div></div>`;
        }
      } else {
        for (const field of section.fields) {
          if (!isFieldVisible(field, values)) continue;
          const val = values[field.id];
          if (field.type === 'sketchData') continue; // marker data, not printable
          if (predates(field) && isBlank(val)) continue; // never asked on this report
          if (field.type === 'photos') {
            const photos = val || [];
            if (!photos.length) {
              // A mandatory photo that could not be taken: say so, and why.
              const utils = window.ReportSchemaUtils;
              const why = utils && utils.photoRequiredNow && utils.photoRequiredNow(field, values) ? utils.noPhotoReason(field, values) : '';
              if (why) html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="field-value">No photograph was taken: ${escapeHtml(why)}</div></div>`;
              continue;
            }
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
            let shown = val;
            // A fixed line nobody stored (v153): its wording, and for the
            // inspection type the wording of the Standard the report is to.
            if (field.type === 'static' && !field.orgField && (shown === undefined || shown === null || shown === '')) {
              shown = field.id === 'inspectionType' && std ? std.typeLine : field.default;
            }
            html += `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="field-value">${escapeHtml(fmtVal(shown))}</div></div>`;
          }
        }
      }
      // v183: beside the signature, how the report was made, when software helped.
      if (section.id === 'inspector' && window.ReportAssurance) {
        const ai = window.ReportAssurance.aiDisclosure(report);
        if (ai) html += `<p class="ai-note">${escapeHtml(ai)}</p>`;
      }
      html += `</div>`;
      // v146: straight after what could NOT be inspected, what was.
      if (section.id === 'access' && !isPestTreatment) html += buildWalkHtml(job, report);
    }
    html += buildAmendmentsAppendixHtml(report);
    return html;
  }

  // v183: what a visual inspection cannot see, then this job's blocked areas
  // (report-assurance.js). On every inspection report, near the top.
  function limitationsHtml(job, report) {
    const n = window.ReportAssurance && window.ReportAssurance.limitationsNotice(report, job);
    if (!n) return '';
    let h = `<div class="limits-box"><div class="limits-head">What this inspection could not see</div><p>${escapeHtml(n.general)}</p>`;
    if (n.areas.length) {
      h += `<p><strong>At this property, these were blocked or out of reach:</strong></p><ul>`;
      for (const a of n.areas) h += `<li>${escapeHtml(a)}</li>`;
      h += `</ul><p>Full details and how to get access are under Areas We Were Unable to Inspect.</p>`;
    } else {
      h += `<p>${escapeHtml(n.none)}</p>`;
    }
    return h + `</div>`;
  }

  // "What we inspected" (v146, agreed with Tal on 15 Nov 2026): the walk
  // (photo-walk.js) set out area by area, every spot with its result, so a
  // report with little to find still shows the work that was done. Built
  // only from what the technician recorded on the walk. Nothing here is
  // inferred: a spot nobody dealt with is listed as not recorded, never as
  // clear. Prints nothing for a report that had no walk.
  const WALK_METHODS = {
    outside: 'Visual inspection of accessible areas; sounding of accessible timbers.',
    subfloor: 'Visual inspection by torchlight; sounding of accessible timbers.',
    roof: 'Visual inspection by torchlight; sounding of accessible timbers.',
    inside: 'Visual inspection; sounding of skirtings, architraves and door frames; moisture meter readings to wet areas.',
  };
  const WALK_NOT_THERE = {
    subfloor: 'No subfloor: the building is on a concrete slab.',
    roof: 'No roof void.',
  };
  const WALK_BLOCKED = {
    subfloor: 'The subfloor could not be accessed at the time of inspection. See Areas We Were Unable to Inspect.',
    roof: 'The roof void could not be accessed at the time of inspection. See Areas We Were Unable to Inspect.',
  };

  function walkTime(ms) {
    try {
      return new Date(ms).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function buildWalkHtml(job, report) {
    const walk = report && report.sections ? report.sections.walkthrough : null;
    if (!walk || !window.PhotoWalk || !window.PhotoChecklists || !job || job.jobType !== 'termite') return '';
    const items = window.PhotoChecklists.forJob(job, null, report.documentType).filter((i) => i.id !== 'frontElevation');
    if (!window.PhotoWalk.isGuided(items)) return '';
    const results = walk.results || {};
    const skipped = new Set(walk.skipped || []);
    const answers = walk.answers || {};
    if (!Object.keys(results).length && !skipped.size && !Object.keys(answers).length) return '';
    const kinds = (window.WalkRollup && window.WalkRollup.KINDS) || [];
    const kindLabel = (id) => { const k = kinds.find((x) => x.id === id); return k ? k.label.toLowerCase() : id; };
    // An item added to the walk after this report was signed, and so never
    // dealt with on it, is left out rather than printed as "Not recorded".
    const predates = predatesFor(report);
    const onThisWalk = (i) => !(predates(i) && !results[i.id] && !skipped.has(i.id));

    // An Issue (or a found notice) with no photograph says why (v151).
    function noPhotoText(r) { return r && r.noPhoto ? ' No photograph was taken: ' + r.noPhoto : ''; }

    function resultText(item) {
      const r = results[item.id];
      // An OK prints the item's standard sentence (photo-checklists.js OK_TEXT).
      if (r && r.r === 'ok') return (item.okLabel ? item.okLabel + '.' : (item.okText || 'Inspected. No issue seen.')) + noPhotoText(r);
      if (r && r.r === 'issue') {
        const what = (r.kinds || []).map(kindLabel).join(', ');
        // A labelled answer (the meter box's "No notice") prints as it is; an
        // ordinary Issue prints its standard sentence (v156), then what kind
        // and the typed note.
        if (item.issueLabel) return item.issueLabel + (r.note ? '. ' + r.note : '.') + noPhotoText(r);
        const head = item.issueText || 'An issue was found.';
        return head + (what ? ' Type: ' + what + '.' : '') + (r.note ? ' ' + r.note : '') + noPhotoText(r);
      }
      if (r && r.r === 'nophoto') return 'Inspected. No photograph could be taken: ' + r.note;
      if (skipped.has(item.id)) return 'Not present at this property.';
      return 'Not recorded.';
    }

    let html = `<div class="section"><div class="section-head" style="background:#0f766e"><h2>What We Inspected</h2></div>`;
    html += `<p>Each area of the property, with every item checked and what was seen. Issues are photographed; the photographs are in the sections that follow.</p>`;
    for (const area of window.PhotoWalk.AREAS) {
      const mine = items.filter((i) => i.area === area.id && !i.hidden && onThisWalk(i));
      if (!mine.length) continue;
      html += `<div class="field"><div class="field-label">${escapeHtml(area.title)}</div>`;
      const answer = answers[area.id];
      if (area.ask && answer === 'no') {
        html += `<div class="field-value">${escapeHtml(WALK_NOT_THERE[area.id] || 'Not present.')}</div></div>`;
        continue;
      }
      if (area.ask && answer === 'blocked') {
        html += `<div class="field-value">${escapeHtml(WALK_BLOCKED[area.id] || 'Could not be accessed.')}</div></div>`;
        continue;
      }
      const times = mine.map((i) => results[i.id] && results[i.id].at).filter(Boolean);
      const when = times.length ? walkTime(Math.max(...times)) : '';
      html += `<div class="field-value">${escapeHtml(WALK_METHODS[area.id] || '')}${when ? ' Completed at ' + escapeHtml(when) + '.' : ''}</div>`;
      html += `<table class="product-pdf-table"><thead><tr><th>Item</th><th>Result</th></tr></thead><tbody>`;
      for (const item of mine) {
        html += `<tr><td>${escapeHtml(item.label)}</td><td>${escapeHtml(resultText(item))}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }
    html += `</div>`;
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

  // The client layout (report-client.js) takes over a document once it is
  // switched on for it. Until then, and for every document it does not set
  // out yet, this file prints it as it always has.
  const clientLayoutFor = (job, report) => !!(window.ReportClient && window.ReportClient.isLive && window.ReportClient.isLive(job, report));

  function openPrintWindow(job, report) {
    if (clientLayoutFor(job, report)) return window.ReportClient.open(job, report);
    const printWin = window.open('', '_blank');
    if (!printWin) { toast('Allow pop-ups to export the PDF'); return; }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(reportTitleFor(job && job.jobType, report))}</title>
      <style>${REPORT_PDF_STYLE}</style></head><body>
      <p><button type="button" class="no-print" data-print>Print / Save as PDF</button></p>
      ${buildReportBodyHtml(job, report)}
      </body></html>`;

    printWin.document.write(html);
    printWin.document.close();
    // Wired from here (v188): the window inherits the app's CSP, which
    // refuses an onclick="" attribute, so the button did nothing.
    const btn = printWin.document.querySelector('[data-print]');
    if (btn) btn.addEventListener('click', () => printWin.print());
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
    if (clientLayoutFor(job, report)) return window.ReportClient.generatePdfBlob(job, report);
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
    buildWalkHtml,
    buildAmendmentsAppendixHtml,
    openPrintWindow,
    generatePdfBlob: generateReportPdfBlob,
    STYLE: REPORT_PDF_STYLE,
    FIXED_TERMS_HTML,
    PHOTO_CONSENT_TEXT,
    limitationsHtml,
    FIXED_TERMS_HTML_PEST,
    termsHtmlFor,
  };
})();
