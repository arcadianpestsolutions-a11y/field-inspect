// Chemical register: every pesticide application Scope has recorded, across
// every job, for a date range, as a list, a spreadsheet and a printable page.
//
// WHY THIS EXISTS. NSW Pesticides Regulation 2017: each application recorded
// within 48 hours and kept for 3 years. Every treatment report already holds
// its own record (products, rate, quantity, area, times, wind, applicator).
// What a business could not do was answer "show me every application between
// these dates" without opening jobs one at a time, which is the question an
// EPA officer, an insurer or a buyer's due diligence actually asks.
//
// WHERE THE ROWS COME FROM. Any report, of any document type, that has a
// product list with a product in it. Found by walking the answers rather than
// naming sections, so a new document type with a product list joins the
// register without anyone remembering to add it here. The one exception is
// a PROPOSAL: an action plan's "products proposed" were never applied, and a
// register that lists them would be a false record.
//
// ONE ROW PER PRODUCT, not per job. The regulation is per application, and a
// spreadsheet with one product per row is the one that can be sorted and
// totalled. The job-level answers (times, address, wind) repeat on each row.
//
// KEPT FOR 3 YEARS. A signed report with an applied product cannot be deleted
// for 3 years from its service date: see retainedUntil, used by Delete job.
(() => {
  'use strict';

  const RETENTION_YEARS = 3;

  // Field ids that hold products which were NOT applied.
  const NOT_APPLIED = new Set(['productsProposed']);

  const str = (v) => (v == null ? '' : Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v)).trim();

  // 'YYYY-MM-DD' at local midnight, or NaN.
  function dayMs(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN;
  }
  function isoDay(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Every applied product list in a report, as [fieldId, rows].
  function appliedProductLists(report) {
    const out = [];
    const sections = (report && report.sections) || {};
    for (const values of Object.values(sections)) {
      if (!values || typeof values !== 'object') continue;
      for (const [fieldId, val] of Object.entries(values)) {
        if (NOT_APPLIED.has(fieldId) || !Array.isArray(val)) continue;
        const rows = val.filter((p) => p && typeof p === 'object' && str(p.productName));
        if (rows.length) out.push([fieldId, rows]);
      }
    }
    return out;
  }

  // When the work was done: the service date on the report, else the day it
  // was signed, else the job's booking. Null when there is nothing to go on.
  function serviceDayMs(report, job) {
    const cd = (report && report.sections && report.sections.clientDetails) || {};
    const fromForm = dayMs(cd.inspectionDate);
    if (Number.isFinite(fromForm)) return fromForm;
    const fallback = (report && report.finalizedAt) || (job && job.scheduledAt) || (report && report.updatedAt);
    if (!fallback) return null;
    const d = new Date(fallback);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  const DOC_TITLES = {
    general_pest: 'General pest treatment',
    termite_certificate: 'Termite system installation',
    termite_monitoring: 'Termite monitoring visit',
    termite_service_record: 'Termite monitoring visit',
    termite_action_plan: 'Termite action plan',
    timber_pest_inspection: 'Termite inspection',
  };

  // Rows for one report. Pure.
  function rowsForReport(report, job, provider) {
    const lists = appliedProductLists(report);
    if (!lists.length) return [];
    const s = report.sections || {};
    const cd = s.clientDetails || {};
    const insp = s.inspector || {};
    const safety = s.safety || {};
    const pestId = s.pestIdentification || {};
    const treat = s.treatmentDetails || s.installation || {};
    const prov = provider || {};
    const day = serviceDayMs(report, job);
    const docType = report.documentType || (job && job.jobType === 'pest_treatment' ? 'general_pest' : '');
    const termite = /^termite/.test(docType);
    const pests = str(pestId.targetPests) || (termite ? 'Termites' : '');
    const outdoor = str(safety.appliedOutdoorsWithSpray);
    const owner = [str(cd.clientName), str(cd.clientPhone), str(cd.clientEmail), str(cd.clientAddress)].filter(Boolean).join(' · ');

    const rows = [];
    for (const [fieldId, products] of lists) {
      for (const p of products) {
        rows.push({
          jobId: report.jobId,
          dayMs: day,
          date: day == null ? '' : isoDay(day),
          startTime: str(cd.inspectionTime),
          finishTime: str(cd.applicationFinishTime),
          propertyAddress: str(cd.propertyAddress) || str(job && job.address),
          ownerDetails: owner || str(job && job.name),
          occupierDetails: str(cd.occupierDetails),
          documentType: DOC_TITLES[docType] || 'Treatment',
          stationBait: fieldId === 'stationBaitProduct',
          situation: [pests, fieldId === 'stationBaitProduct' ? 'Rodent bait stations' : ''].filter(Boolean).join('; '),
          productName: str(p.productName),
          activeConstituent: str(p.activeConstituent),
          areaApplied: str(p.areaApplied) || str(treat.areasTreated),
          concentrateUsed: str(p.concentrateUsed),
          dilutionRate: str(p.dilutionRate),
          totalApplied: str(p.totalMixApplied),
          batchNumber: str(p.batchNumber),
          equipment: str(treat.equipmentUsed),
          weather: str(cd.weather),
          outdoorSpray: outdoor,
          windSpeed: outdoor === 'Yes' ? str(safety.windSpeed) : '',
          windDirection: outdoor === 'Yes' ? str(safety.windDirection) : '',
          temperature: outdoor === 'Yes' ? str(safety.temperature) : '',
          windChanges: outdoor === 'Yes' ? str(safety.windChanges) : '',
          applicatorName: str(insp.inspectorName),
          applicatorLicence: str(insp.inspectorLicence),
          applicatorContact: [str(insp.inspectorPhone) || str(prov.providerPhone), str(insp.inspectorAddress) || str(prov.providerAddress)]
            .filter(Boolean).join(' · '),
          signed: !!report.finalizedAt,
          signedAt: report.finalizedAt || null,
        });
      }
    }
    return rows;
  }

  // The register for a range. `from`/`to` are ms, inclusive. Rows with no
  // date at all are kept only for an unbounded range: they cannot be placed
  // in a period, and leaving them out of "all time" would hide them.
  function build({ reports, jobs, from, to, provider }) {
    const jobById = new Map((jobs || []).map((j) => [j.id, j]));
    const lo = typeof from === 'number' ? from : 0;
    const hi = typeof to === 'number' ? to : Number.MAX_SAFE_INTEGER;
    const unbounded = lo <= 0 && hi >= Number.MAX_SAFE_INTEGER;
    const rows = [];
    for (const r of reports || []) {
      if (!r || !r.jobId) continue;
      for (const row of rowsForReport(r, jobById.get(r.jobId), provider)) {
        if (row.dayMs == null ? unbounded : (row.dayMs >= lo && row.dayMs <= hi)) rows.push(row);
      }
    }
    // Oldest first, as a register is read; same day by start time.
    rows.sort((a, b) => ((a.dayMs || 0) - (b.dayMs || 0))
      || a.startTime.localeCompare(b.startTime)
      || a.propertyAddress.localeCompare(b.propertyAddress));
    return rows;
  }

  function summarise(rows) {
    const jobs = new Set(rows.map((r) => r.jobId));
    const unsignedJobs = new Set(rows.filter((r) => !r.signed).map((r) => r.jobId));
    const missing = rows.filter((r) => !r.totalApplied || !r.areaApplied || !r.applicatorLicence || !r.date).length;
    return { applications: rows.length, jobs: jobs.size, unsignedJobs: unsignedJobs.size, incomplete: missing };
  }

  // ---------- Spreadsheet ----------
  const COLUMNS = [
    ['Date', 'date'], ['Start', 'startTime'], ['Finish', 'finishTime'],
    ['Property address', 'propertyAddress'], ['Owner / client', 'ownerDetails'], ['Occupier', 'occupierDetails'],
    ['Work', 'documentType'], ['Situation of use (target)', 'situation'],
    ['Product', 'productName'], ['Active constituent', 'activeConstituent'],
    ['Area applied', 'areaApplied'], ['Concentrate used', 'concentrateUsed'], ['Dilution rate', 'dilutionRate'],
    ['Total applied', 'totalApplied'], ['Batch', 'batchNumber'], ['Equipment', 'equipment'],
    ['Weather', 'weather'], ['Outdoor spray', 'outdoorSpray'], ['Wind speed (km/h)', 'windSpeed'],
    ['Wind direction', 'windDirection'], ['Temperature (C)', 'temperature'], ['Wind changes', 'windChanges'],
    ['Applicator', 'applicatorName'], ['Licence', 'applicatorLicence'], ['Applicator contact', 'applicatorContact'],
    ['Signed', 'signedText'],
  ];

  // A leading = + - @ would be run as a formula by Excel; quote it as text.
  // Same rule as the invoice export in business-ui.js.
  function cell(v) {
    const s = String(v == null ? '' : v);
    const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
    return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  }
  function signedText(r) {
    return r.signed ? 'Signed ' + isoDay(r.signedAt) : 'NOT SIGNED';
  }
  function toCsv(rows) {
    const head = COLUMNS.map((c) => c[0]);
    const body = rows.map((r) => COLUMNS.map(([, k]) => cell(k === 'signedText' ? signedText(r) : r[k])).join(','));
    return [head.map(cell).join(',')].concat(body).join('\r\n');
  }

  // ---------- Retention ----------
  // When a report may be deleted, or null if it holds no applied-chemical
  // record that the law says to keep. Unsigned drafts are not held: a draft
  // is not yet a record, and a job created by mistake must stay deletable.
  function retainedUntil(report, job) {
    if (!report || !report.finalizedAt || !appliedProductLists(report).length) return null;
    const day = serviceDayMs(report, job);
    const d = new Date(day == null ? report.finalizedAt : day);
    return new Date(d.getFullYear() + RETENTION_YEARS, d.getMonth(), d.getDate()).getTime();
  }
  function isRetained(report, job, nowMs) {
    const until = retainedUntil(report, job);
    return until != null && (typeof nowMs === 'number' ? nowMs : Date.now()) < until;
  }

  window.ChemRegister = {
    RETENTION_YEARS, COLUMNS, build, rowsForReport, appliedProductLists, summarise, toCsv,
    retainedUntil, isRetained, isoDay, dayMs,
  };
})();
