// ===========================================================================
// report-client.js - the client's report (v167). A PREVIEW.
//
// The same inspection report-print.js prints, laid out for the person who paid
// for it: a cover that answers "what did you find, and what do I do now",
// then each finding with its photographs, then what was and was not
// inspected, then the detail, the agreement and the terms.
//
// NOTHING SENDS THIS YET. Export, email and the client page still use
// report-print.js. This is offered beside them on the report screen so the
// two can be compared on a real report before one replaces the other.
//
// WORDING. Every sentence about a finding is written out in full below, taken
// from the question on the form, and keeps the "found at the time of
// inspection" framing the terms rely on. Nothing is generated. An answer
// nobody gave prints nothing: this layout never states a "No" that was not
// recorded, and never prints a dash for a question that was left alone.
//
// It only READS a report. Text goes through escapeHtml; stored images
// (logo, signature, sketch) through HtmlSafe.imageSrc.
//
// EXPOSES: window.ReportClient = { supports, glance, actions, cleared,
//   conduciveFound, buildHtml, open, renderPreviewButton, fmtDate, fmtTime,
//   dueBy, SAID, STYLE }
// TESTS: tests/run-tests.js - "Client report" group.
// ===========================================================================
(() => {
  'use strict';

  const { escapeHtml, toast } = window.Common;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

  // '2026-11-12' -> '12 Nov 2026'. Anything else is returned as it was, never
  // guessed at: a date typed by hand on an old report must not be mangled.
  function fmtDate(iso) {
    const m = DATE.exec(String(iso == null ? '' : iso));
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return String(iso == null ? '' : iso);
    return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  }

  // '08:00' -> '8:00 am', '13:30' -> '1:30 pm'. '' when it is not a time.
  function fmtTime(hhmm) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm == null ? '' : hhmm));
    if (!m || Number(m[1]) > 23) return '';
    const h = Number(m[1]);
    return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
  }

  // 'November 2027' for an inspection on 2026-11-12 with '12 months'. ''
  // when either half is missing.
  function dueBy(iso, interval) {
    const m = DATE.exec(String(iso == null ? '' : iso));
    const months = parseInt(String(interval == null ? '' : interval), 10);
    if (!m || !Number.isFinite(months) || months <= 0) return '';
    const total = (Number(m[1]) * 12) + (Number(m[2]) - 1) + months;
    return `${LONG_MONTHS[total % 12]} ${Math.floor(total / 12)}`;
  }

  const str = (v) => String(v == null ? '' : v).trim();
  const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  const lower = (s) => str(s).toLowerCase();
  const joinAnd = (arr) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`);
  const sec = (report, id) => ((report && report.sections && report.sections[id]) || {});
  const where = (v) => { const l = list(v).map(lower); return l.length ? ` Where: ${joinAnd(l)}.` : ''; };

  // ---------- The sentences ----------
  // One statement for each Yes and each No, from the question the technician
  // answered. Changing any of these changes what a client is told: treat
  // them as wording, not as code.
  const SAID = {
    live: {
      yes: 'Live termites were found at the time of inspection.',
      no: 'No live termites were found at the time of inspection.',
    },
    nest: {
      yes: 'A termite nest was found at the time of inspection.',
      no: 'No termite nest was found at the time of inspection.',
    },
    workings: {
      yes: 'Evidence of termite workings or damage was found at the time of inspection.',
      no: 'No evidence of termite workings or damage was found at the time of inspection.',
    },
    borers: {
      yes: 'Evidence of borers of seasoned timber was found at the time of inspection.',
      no: 'No evidence of borers of seasoned timber was found at the time of inspection.',
    },
    decay: {
      yes: 'Evidence of fungal decay was found at the time of inspection.',
      no: 'No evidence of fungal decay was found at the time of inspection.',
    },
    leaks: {
      yes: 'Water leaks were found at the time of inspection.',
      no: 'No water leaks were found at the time of inspection.',
    },
    moisture: {
      yes: 'High moisture readings were found at the time of inspection.',
      no: 'No high moisture readings were found at the time of inspection.',
    },
    mould: {
      yes: 'Evidence of mould growth was found at the time of inspection.',
      no: 'No evidence of mould growth was found at the time of inspection.',
    },
    priorTreatment: {
      yes: 'Evidence of a previous termite treatment was located.',
      no: 'No evidence of a previous termite treatment was located.',
    },
    notice: {
      yes: 'A durable notice was found at the time of this inspection.',
      no: 'No durable notice was found at the time of this inspection.',
    },
    hazard: {
      yes: 'Timber pest damage was found that presents a major safety hazard. It must be rectified by a licensed builder.',
      no: 'No timber pest damage presenting a major safety hazard was found at the time of inspection.',
    },
  };
  const said = (key, answer) => (answer === 'Yes' ? SAID[key].yes : answer === 'No' ? SAID[key].no : '');

  // The conditions that make termite attack more likely, as found. Each is
  // { id, name, said, details, photos }: `said` is the form's own question
  // turned into a statement, `details` is what the inspector wrote.
  function conduciveFound(report) {
    const c = sec(report, 'conducive');
    const out = [];
    const add = (when, id, name, saidText, details, photos) => {
      if (when) out.push({ id, name, said: saidText, details: str(details), photos: photos || '' });
    };
    const leakAreas = list(c.waterLeakAreas).map(lower);
    add(c.waterLeaksFound === 'Yes', 'leaks', 'Water leaks', SAID.leaks.yes,
      [leakAreas.length ? `Where: ${joinAnd(leakAreas)}.` : '', str(c.waterLeakDetails)].filter(Boolean).join(' '), 'waterLeakPhotos');
    add(c.tankDrainageWorkNeeded === 'Yes', 'tank', 'Water tank overflow drainage',
      'There is a need for work to rectify water tank overflow drainage.', c.tankDetails);
    add(c.highMoistureFound === 'Yes', 'moisture', 'High moisture readings', SAID.moisture.yes,
      [str(c.moistureDetails), str(c.moistureMeterType) ? `Meter used: ${str(c.moistureMeterType)}.` : ''].filter(Boolean).join(' '), 'moisturePhotos');
    const decayAreas = list(c.fungalDecayAreas).map(lower);
    add(c.fungalDecayFound === 'Yes', 'decay', 'Fungal decay', SAID.decay.yes,
      [decayAreas.length ? `Where: ${joinAnd(decayAreas)}.` : '', str(c.fungalDecayLocation), str(c.fungalDecayComments)].filter(Boolean).join(' '), 'fungalDecayPhotos');
    add(c.mouldFound === 'Yes', 'mould', 'Mould', SAID.mould.yes, c.mouldDetails);
    add(c.siteDrainage === 'Inadequate', 'siteDrainage', 'Site drainage',
      'Site drainage appears to be generally inadequate.', c.siteDrainageDetails);
    add(c.subfloorDrainage === 'Inadequate', 'subfloorDrainage', 'Subfloor drainage',
      'Subfloor drainage appears to be generally inadequate.', c.subfloorDrainageDetails);
    add(c.ventilation === 'Inadequate', 'ventilation', 'Subfloor ventilation',
      'At the time of inspection, ventilation appeared to be inadequate.', c.ventilationDetails);
    add(c.antCappingCondition === 'Inadequate', 'antCapping', 'Termite shields (ant capping)',
      'Termite shields (ant capping) appear to be inadequate.', c.antCappingDetails);
    add(c.weepHolesClear === 'No', 'weepHoles', 'Weep holes',
      'Weep holes are not clear and visible.', c.weepHoleDetails);
    add(c.externalTimbers === 'Inadequate', 'externalTimbers', 'Structural timber exposed to the weather',
      'The fitness for purpose of visible structural timber exposed to the weather appears to be inadequate.', c.externalTimberDetails);
    add(c.slabEdgeComplies === 'No', 'slabEdge', 'Slab edge inspection zone',
      'The slab edge inspection zone does not fully comply: it is not exposed and clear all round.',
      [str(c.slabEdgeDetails), str(c.slabEdgeComments)].filter(Boolean).join(' '));
    // v177: the conditions AS 3660.2 cl 3.4.4 and 2.5.1 name. Fixed wording,
    // like the rest of this list, and part of what Tal has still to approve.
    add(c.bridgingFound === 'Yes', 'bridging', 'Structures built against the building',
      'A structure or fitting is built against the building with no clear gap, which can hide a way in for termites.',
      [list(c.bridgingItems).length ? `What: ${joinAnd(list(c.bridgingItems).map(lower))}.` : '', str(c.bridgingDetails)].filter(Boolean).join(' '));
    add(c.gardenBedsAgainstWall === 'Yes', 'gardenBeds', 'Garden beds against the walls',
      'Garden beds, mulch, raised soil or plants are built up against the building.', c.gardenBedsDetails);
    add(c.storedTimberFound === 'Yes', 'storedTimber', 'Timber and goods stored against the building',
      'Timber, firewood or other goods are stored under or against the building.', c.storedTimberDetails);
    add(c.timberInGroundFound === 'Yes', 'timberInGround', 'Timber in the ground',
      'Stumps, dead wood or timber in contact with the ground is close to the building.', c.timberInGroundDetails);
    add(c.otherConduciveFound === 'Yes', 'other', 'Other conditions',
      'Other conducive conditions were found.', c.otherConduciveDetails, 'otherConducivePhotos');
    return out;
  }

  // ---------- At a glance ----------
  // [{ id, tone: 'good' | 'warn' | 'bad', title, text }], in the order a
  // client asks them. A question nobody answered is left out.
  function glance(report) {
    const f = sec(report, 'findings');
    const c = sec(report, 'conducive');
    const a = sec(report, 'access');
    const out = [];

    if (f.liveTermitesFound === 'Yes') out.push({ id: 'live', tone: 'bad', title: 'Live termites', text: SAID.live.yes + where(f.liveTermitesAreas) });
    else if (f.liveTermitesFound === 'No') out.push({ id: 'live', tone: 'good', title: 'Live termites', text: SAID.live.no });

    if (f.nestFound === 'Yes') out.push({ id: 'nest', tone: 'bad', title: 'Termite nest', text: SAID.nest.yes });

    if (f.workingsFound === 'Yes') {
      const sev = str(f.damageSeverity);
      out.push({ id: 'workings', tone: 'bad', title: 'Termite workings or damage',
        text: SAID.workings.yes + where(f.workingsAreas) + (sev ? ` The damage appears to be ${lower(sev)}.` : '') });
    } else if (f.workingsFound === 'No') {
      out.push({ id: 'workings', tone: 'good', title: 'Termite workings or damage', text: SAID.workings.no });
    }

    if (f.majorSafetyHazard === 'Yes') out.push({ id: 'hazard', tone: 'bad', title: 'Safety hazard', text: SAID.hazard.yes });
    if (f.borersFound === 'Yes') out.push({ id: 'borers', tone: 'warn', title: 'Borers', text: SAID.borers.yes + where(f.borerAreas) });

    const conds = conduciveFound(report);
    if (conds.length) {
      out.push({ id: 'conducive', tone: 'warn', title: 'Conditions that attract termites',
        text: `${conds.length} found: ${joinAnd(conds.map((x) => lower(x.name)))}.` });
    } else if (c.waterLeaksFound === 'No' && c.highMoistureFound === 'No' && c.fungalDecayFound === 'No') {
      out.push({ id: 'conducive', tone: 'good', title: 'Conditions that attract termites',
        text: 'No water leaks, high moisture readings or fungal decay were found at the time of inspection.' });
    }

    if (a.hinderedObstructions === 'Yes' || a.restrictedAccess === 'Yes') {
      const areas = list(a.hinderedAreas).map(lower);
      out.push({ id: 'access', tone: 'warn', title: 'Areas we could not inspect',
        text: `Parts of the property could not be fully inspected${areas.length ? `: ${joinAnd(areas)}` : ''}. Timber pests may be present in areas that could not be inspected.` });
    } else if (a.hinderedObstructions === 'No' && a.restrictedAccess === 'No') {
      out.push({ id: 'access', tone: 'good', title: 'Areas we could not inspect', text: 'No obstructions or restricted areas were recorded at the time of inspection.' });
    }

    const status = str(f.managementSystemStatus);
    if (status) {
      out.push({ id: 'protection', tone: /^Adequate/.test(status) ? 'good' : 'warn', title: 'Termite protection in place',
        text: `${status}.${said('notice', f.durableNoticeFound) ? ` ${said('notice', f.durableNoticeFound)}` : ''}` });
    }

    const risk = str(f.susceptibility).toUpperCase();
    if (risk) {
      out.push({ id: 'risk', tone: risk === 'LOW' ? 'good' : risk === 'HIGH' ? 'bad' : 'warn', title: 'Risk of termite attack',
        text: `In our opinion, the susceptibility of this property to termites is ${risk.charAt(0)}${risk.slice(1).toLowerCase()}.` });
    }
    return out;
  }

  // ---------- What to do now ----------
  // Only what the inspector recorded, most urgent first. Their own comment
  // follows the fixed sentence, in their words.
  function actions(report) {
    const f = sec(report, 'findings');
    const a = sec(report, 'access');
    const c = sec(report, 'clientDetails');
    const out = [];
    const withNote = (sentence, note) => (str(note) ? `${sentence} ${str(note)}` : sentence);
    if (f.majorSafetyHazard === 'Yes') out.push(withNote('Have the safety hazard made safe by a licensed builder.', f.majorSafetyHazardDetails));
    if (f.treatmentRecommended === 'Yes') out.push(withNote('A termite treatment is recommended.', f.treatmentComments));
    if (/management plan proposed/.test(str(f.managementSystemStatus))) out.push('A termite management plan is proposed. See "Proposed termite management" in this report.');
    if (a.invasiveRecommended === 'Yes') out.push(withNote('An invasive inspection is recommended.', a.invasiveComments));
    if (a.highRiskAreas === 'Yes') out.push(withNote('Access should be gained to the high risk areas that could not be inspected.', a.highRiskDetails));
    const conds = conduciveFound(report);
    if (conds.length) out.push(`Attend to the ${conds.length === 1 ? 'condition' : `${conds.length} conditions`} listed under "Conditions that attract termites".`);
    const every = str(f.reinspectionInterval);
    if (every) {
      const by = dueBy(c.inspectionDate, every);
      out.push(`A full inspection and written report should be conducted at this property every ${every}.${by ? ` The next is due by ${by}.` : ''}`);
    }
    return out;
  }

  // What was looked for and not found: the "No" answers, as sentences.
  function cleared(report) {
    const f = sec(report, 'findings');
    const c = sec(report, 'conducive');
    return [
      said('live', f.liveTermitesFound === 'No' ? 'No' : ''),
      said('nest', f.nestFound === 'No' ? 'No' : ''),
      said('workings', f.workingsFound === 'No' ? 'No' : ''),
      said('borers', f.borersFound === 'No' ? 'No' : ''),
      said('hazard', f.majorSafetyHazard === 'No' ? 'No' : ''),
      said('priorTreatment', f.priorTreatmentEvidence === 'No' ? 'No' : ''),
      said('notice', f.durableNoticeFound === 'No' ? 'No' : ''),
      said('leaks', c.waterLeaksFound === 'No' ? 'No' : ''),
      said('moisture', c.highMoistureFound === 'No' ? 'No' : ''),
      said('decay', c.fungalDecayFound === 'No' ? 'No' : ''),
      said('mould', c.mouldFound === 'No' ? 'No' : ''),
    ].filter(Boolean);
  }

  // Which reports this layout knows how to set out. The other documents
  // (treatment record, plan, certificate, monitoring) keep the current print
  // until they are done the same way.
  function supports(job, report) {
    if (!job || job.jobType !== 'termite' || !report) return false;
    const type = report.documentType || 'timber_pest_inspection';
    return type === 'timber_pest_inspection';
  }

  // ---------- The document ----------
  const STYLE = `
    *{box-sizing:border-box;}
    body{margin:0;background:#eef1ee;color:#1c2a23;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14.5px;line-height:1.5;}
    .sheet{max-width:820px;margin:0 auto;background:#fff;padding:28px 32px 40px;}
    .bar{max-width:820px;margin:0 auto;padding:10px 32px;background:#fff8e1;border-bottom:1px solid #e6d9a8;font-size:13px;display:flex;gap:12px;align-items:center;justify-content:space-between;}
    .bar button{font:inherit;font-weight:600;padding:8px 14px;border-radius:8px;border:1px solid #b9c2bc;background:#fff;cursor:pointer;}
    .cr-head{display:flex;align-items:center;gap:14px;padding-bottom:12px;border-bottom:3px solid #0a6b37;}
    .cr-logo{max-height:64px;max-width:200px;}
    .cr-biz{font-weight:700;font-size:18px;line-height:1.2;}
    .cr-kind{color:#5d6d63;font-size:13px;}
    .cr-cover{display:block;width:100%;max-height:300px;object-fit:cover;border-radius:8px;margin:16px 0 4px;}
    h1{font-size:24px;line-height:1.25;margin:14px 0 2px;}
    .cr-when{color:#5d6d63;margin:0 0 2px;}
    h2{font-size:17px;margin:26px 0 8px;padding-bottom:4px;border-bottom:1px solid #dfe4e0;page-break-after:avoid;}
    h3{font-size:15px;margin:0 0 4px;}
    p{margin:0 0 8px;}
    .glance{list-style:none;margin:0;padding:0;}
    .glance li{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #eef1ee;page-break-inside:avoid;}
    .glance strong{display:block;}
    .dot{flex:none;width:12px;height:12px;border-radius:50%;margin-top:5px;}
    .dot-good{background:#1f8a4c;} .dot-warn{background:#d98a00;} .dot-bad{background:#c0392b;}
    .todo{margin:0;padding-left:22px;} .todo li{margin:0 0 6px;}
    .note{color:#5d6d63;font-size:12.5px;}
    .finding{border:1px solid #dfe4e0;border-left:4px solid #c0392b;border-radius:8px;padding:12px 14px;margin:0 0 12px;}
    .finding.warn{border-left-color:#d98a00;} .finding.info{border-left-color:#8a968f;}
    .said{white-space:pre-wrap;overflow-wrap:anywhere;}
    .photos{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;}
    .photos figure{margin:0;page-break-inside:avoid;}
    .photos img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;border:1px solid #dfe4e0;}
    figcaption{font-size:12px;color:#5d6d63;margin-top:3px;}
    .clear{margin:0;padding-left:22px;} .clear li{margin:0 0 3px;}
    .facts{width:100%;border-collapse:collapse;font-size:13.5px;}
    .facts th{width:38%;text-align:left;font-weight:600;color:#5d6d63;vertical-align:top;padding:5px 10px 5px 0;}
    .facts td{padding:5px 0;white-space:pre-wrap;overflow-wrap:anywhere;}
    .facts tr{border-bottom:1px solid #eef1ee;}
    .sig{display:block;max-width:260px;border:1px solid #dfe4e0;margin-top:6px;}
    .sketch{display:block;max-width:100%;border:1px solid #dfe4e0;border-radius:6px;}
    .terms{font-size:12px;color:#33413a;}
    .break{page-break-before:always;}
    /* Sections that come from report-print.js (the walk, the amendments). */
    .section{margin:0 0 12px;} .section-head{background:none !important;padding:0;}
    .section-head h2{color:inherit;}
    .field{padding:6px 0;} .field-label{font-weight:600;font-size:13px;color:#5d6d63;} .field-value{font-size:13.5px;}
    .product-pdf-table,.amendments-table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px;}
    .product-pdf-table th,.product-pdf-table td,.amendments-table th,.amendments-table td{border:1px solid #dfe4e0;padding:5px 7px;text-align:left;vertical-align:top;}
    .product-pdf-table th,.amendments-table th{background:#f4f6f4;}
    @media print{body{background:#fff;} .sheet{max-width:none;padding:0;} .no-print{display:none !important;}}
  `;

  // The words printed at the foot of every page, where the browser can do it.
  function pageRule(address, when) {
    const css = (s) => str(s).replace(/[\\"\n\r]/g, ' ');
    return `@page{size:A4;margin:14mm 14mm 18mm;`
      + `@bottom-left{content:"${css(address)}${when ? ` \\00B7  ${css(when)}` : ''}";font-size:9pt;color:#5d6d63;}`
      + `@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:9pt;color:#5d6d63;}}`;
  }

  function buildHtml(job, report, opts) {
    const o = opts || {};
    const captions = o.captions || new Map();
    const urls = Array.isArray(o.trackedUrls) ? o.trackedUrls : [];
    const U = window.ReportSchemaUtils;
    const P = window.ReportPrint;
    const std = (U && U.inspectionStandard) ? U.inspectionStandard(report) : null;
    const org = window.Org ? window.Org.provider() : {};
    const logo = window.Org && window.Org.logo ? window.HtmlSafe.imageSrc(window.Org.logo()) : '';
    const client = sec(report, 'clientDetails');
    const prop = sec(report, 'property');
    const f = sec(report, 'findings');
    const c = sec(report, 'conducive');
    const a = sec(report, 'access');
    const insp = sec(report, 'inspector');
    const agr = sec(report, 'agreement');
    const ack = sec(report, 'acknowledgement');
    const e = escapeHtml;

    const figures = (photos, fallback) => {
      const usable = (Array.isArray(photos) ? photos : []).filter((p) => p && p.blob);
      if (!usable.length) return '';
      return `<div class="photos">${usable.map((p) => {
        const url = URL.createObjectURL(p.blob);
        urls.push(url);
        const cap = captions.get(p.sourceId) || captions.get(p.id) || fallback || '';
        return `<figure><img src="${url}" alt="">${cap ? `<figcaption>${e(cap)}</figcaption>` : ''}</figure>`;
      }).join('')}</div>`;
    };
    const para = (text) => (str(text) ? `<p class="said">${e(str(text))}</p>` : '');
    const facts = (rows) => {
      const kept = rows.filter(([, v]) => (Array.isArray(v) ? v.length : str(v)));
      if (!kept.length) return '';
      return `<table class="facts">${kept.map(([k, v]) => `<tr><th>${e(k)}</th><td>${e(Array.isArray(v) ? v.join(', ') : str(v))}</td></tr>`).join('')}</table>`;
    };
    const image = (cls, dataUrl) => { const src = window.HtmlSafe.imageSrc(dataUrl); return src ? `<img class="${cls}" src="${src}" alt="">` : ''; };

    const address = str(client.propertyAddress) || str(job && job.address);
    const when = [fmtDate(client.inspectionDate), fmtTime(client.inspectionTime)].filter(Boolean);
    const title = std ? std.title : 'Termite Inspection Report';

    // ---- cover ----
    const coverPhoto = (Array.isArray(prop.propertyPhotos) ? prop.propertyPhotos : []).find((p) => p && p.blob);
    let coverImg = '';
    if (coverPhoto) { const url = URL.createObjectURL(coverPhoto.blob); urls.push(url); coverImg = `<img class="cr-cover" src="${url}" alt="The property">`; }

    let html = `<div class="cr-head">${logo ? `<img class="cr-logo" src="${logo}" alt="">` : ''}`
      + `<div><div class="cr-biz">${e(org.providerName || '')}</div><div class="cr-kind">${e(title)}</div></div></div>`;
    html += coverImg;
    html += `<h1>${e(address || (job && job.name) || '')}</h1>`;
    html += `<p class="cr-when">${when.length ? `Inspected ${e(when.join(' at '))}. ` : ''}${e(std ? std.coverLine : '')}${std ? '.' : ''}</p>`;
    if (str(client.clientName)) html += `<p class="cr-when">Prepared for ${e(str(client.clientName))}.</p>`;

    const lines = glance(report);
    if (lines.length) {
      html += `<h2>At a glance</h2><ul class="glance">${lines.map((l) => `<li><span class="dot dot-${l.tone}"></span><span><strong>${e(l.title)}</strong>${e(l.text)}</span></li>`).join('')}</ul>`;
    }
    const todo = actions(report);
    if (todo.length) html += `<h2>What to do now</h2><ol class="todo">${todo.map((t) => `<li class="said">${e(t)}</li>`).join('')}</ol>`;
    html += `<p class="note" style="margin-top:14px">This page is a summary. The full report follows, with its terms and conditions, and should be read with it.</p>`;
    if (str(insp.inspectorName)) {
      html += `<p class="note">Inspector: ${e(str(insp.inspectorName))}${str(insp.inspectorLicence) ? `, licence ${e(str(insp.inspectorLicence))}` : ''}${org.providerName ? `, for ${e(org.providerName)}` : ''}.</p>`;
    }

    // ---- what we found ----
    let found = '';
    const block = (tone, heading, body) => { found += `<div class="finding${tone === 'bad' ? '' : ` ${tone}`}"><h3>${e(heading)}</h3>${body}</div>`; };
    if (f.liveTermitesFound === 'Yes') {
      block('bad', 'Live termites', `<p>${e(SAID.live.yes + where(f.liveTermitesAreas))}</p>`
        + facts([['Species', f.termiteSpecies], ['Potential for associated damage', f.riskOfAssociatedDamage]])
        + para(f.liveTermitesLocation) + figures(f.liveTermitesPhotos, 'Live termites'));
    }
    if (f.nestFound === 'Yes') block('bad', 'Termite nest', `<p>${e(SAID.nest.yes)}</p>${para(f.nestLocation)}${figures(f.nestPhotos, 'Termite nest')}`);
    if (f.workingsFound === 'Yes') {
      block('bad', 'Termite workings or damage', `<p>${e(SAID.workings.yes + where(f.workingsAreas))}</p>`
        + para(f.evidenceDetails) + facts([['Damage appears to be', f.damageSeverity]])
        + para(f.findingsAdditionalComments) + figures(f.damagePhotos, 'Termite workings or damage'));
    }
    if (f.majorSafetyHazard === 'Yes') block('bad', 'Safety hazard', `<p>${e(SAID.hazard.yes)}</p>${para(f.majorSafetyHazardDetails)}`);
    if (f.borersFound === 'Yes') {
      block('warn', 'Borers of seasoned timber', `<p>${e(SAID.borers.yes + where(f.borerAreas))}</p>`
        + facts([['Borer type', f.borerType], ['Activity appears to be', f.borerActivity], ['Damage appears to be', f.borerDamageSeverity]])
        + figures(f.borerPhotos, 'Borer damage'));
    }
    if (f.priorTreatmentEvidence === 'Yes') {
      block('info', 'Previous termite treatment', `<p>${e(SAID.priorTreatment.yes)}</p>`
        + facts([['Evidence found', list(f.priorTreatmentDescription)]]) + para(f.priorTreatmentComments));
    }
    if (f.durableNoticeFound === 'Yes') {
      block('info', 'Durable notice', `<p>${e(SAID.notice.yes)}</p>`
        + facts([['Date of treatment', f.durableNoticeDate]]) + para(f.durableNoticeDetails) + figures(f.durableNoticePhotos, 'Durable notice'));
    }
    if (str(f.existingManagementSystem) || str(f.managementSystemStatus)) {
      block('info', 'Termite management system', para(f.existingManagementSystem) + facts([['Assessment', f.managementSystemStatus]]));
    }
    if (str(f.treatmentComments) && f.treatmentRecommended !== 'Yes') block('info', 'Treatment', para(f.treatmentComments));
    if (str(f.otherTimberPestsObserved)) {
      block('info', 'Other timber pests observed', `<p class="note">Outside the scope of the Standard, noted as a duty to warn.</p>${para(f.otherTimberPestsObserved)}`);
    }
    const general = figures(f.findingsPhotos, '');
    const none = cleared(report);
    html += `<h2 class="break">What we found</h2>${found || '<p>No findings were recorded that need your attention.</p>'}${general}`;
    if (none.length) html += `<h3 style="margin-top:14px">Looked for and not found</h3><ul class="clear">${none.map((s) => `<li>${e(s)}</li>`).join('')}</ul>`;

    // ---- conditions ----
    const conds = conduciveFound(report);
    html += `<h2>Conditions that attract termites</h2>`;
    if (conds.length) {
      html += conds.map((x) => `<div class="finding warn"><h3>${e(x.name)}</h3><p>${e(x.said)}</p>${para(x.details)}${x.photos ? figures(c[x.photos], x.name) : ''}</div>`).join('');
    } else {
      html += `<p>None were recorded.</p>`;
    }
    const treeFigures = figures(c.treePhotos, 'Trees near the property');
    if (str(c.treeAssessmentNotes) || treeFigures) {
      html += `<div class="finding info"><h3>Trees near the property</h3>${para(c.treeAssessmentNotes)}${treeFigures}</div>`;
    }
    html += figures(c.conducivePhotos, '');

    // ---- inspected, and not ----
    if (P && P.buildWalkHtml) html += P.buildWalkHtml(job, report);
    html += `<h2>What we could not inspect</h2>`;
    const blocked = facts([
      ['Areas hindered', list(a.hinderedAreas)],
      ['Inside', list(a.interiorObstructions)],
      ['Outside', list(a.exteriorObstructions)],
      ['Subfloor', list(a.subfloorObstructions)],
      ['Roof void', list(a.roofVoidObstructions)],
      ['Other', a.otherHinderedDetails],
      ['Restricted access', a.restrictedAccess === 'Yes' ? (str(a.restrictedAccessDetails) || 'Yes') : ''],
      ['High risk areas needing access', a.highRiskAreas === 'Yes' ? (str(a.highRiskDetails) || 'Yes') : ''],
      ['Invasive inspection', a.invasiveRecommended === 'Yes' ? `Recommended. ${str(a.invasiveComments)}`.trim() : ''],
    ]);
    html += blocked
      ? `<p>Timber pests and damage may be present in areas that could not be inspected.</p>${blocked}`
      : `<p>No obstructions or restricted areas were recorded.</p>`;
    html += figures(a.obstructionPhotos, 'Obstruction') + figures(a.accessPhotos, '');

    // ---- sketch ----
    const sketch = image('sketch', sec(report, 'siteSketch').sketchImage);
    if (sketch) html += `<h2>Site sketch</h2>${sketch}`;

    // ---- proposed works, when the form raised them ----
    const works = sec(report, 'proposedWorks');
    const warranty = sec(report, 'worksWarranty');
    const worksFacts = facts([
      ['Management method proposed', list(works.managementMethod)],
      ['Extent of treatment', works.treatmentExtent],
      ['Areas to be treated', list(works.areasToTreat)],
      ['Drilling of hard surfaces', works.drillingRequired === 'Yes' ? (str(works.drillingDetail) || 'Yes') : works.drillingRequired],
      ['Products proposed', (Array.isArray(works.productsProposed) ? works.productsProposed : []).map((p) => str(p && p.productName)).filter(Boolean)],
      ['Areas that cannot be treated', works.untreatableAreas],
      ['Limitations of the proposed system', works.systemLimitations],
      ['Estimated time on site', works.estimatedDuration],
      ['What the occupants must do on the day', works.occupantRequirements],
      ['Warranty period offered', warranty.warrantyPeriod],
      ['To keep the warranty valid', list(warranty.warrantyConditions)],
      ['First inspection after the works', warranty.reinspectionAfterWorks],
      ['Anything else', warranty.worksNotes],
    ]);
    if (worksFacts && /management plan proposed/.test(str(f.managementSystemStatus))) {
      html += `<h2>Proposed termite management</h2>${worksFacts}${image('sketch', works.worksSketch)}`;
    }

    // ---- the detail ----
    html += `<h2 class="break">The property and this inspection</h2>` + facts([
      ['Client', client.clientName],
      ['Property inspected', address],
      ['Inspection date', fmtDate(client.inspectionDate)],
      ['Inspection time', fmtTime(client.inspectionTime)],
      ['Weather', client.weather],
      ['People present', list(client.peoplePresent)],
      ['Inspection type', client.inspectionClassification],
      ['The front of the dwelling faces', prop.facade],
      ['Site topography', prop.topography],
      ['Type of structure', prop.structureType],
      ['Height', prop.structureHeight],
      ['Wall construction', prop.wallConstruction],
      ['Floor type', prop.floorType],
      ['Roof frame and covering', prop.roofConstruction],
      ['Furnishing', prop.furnishingStatus],
      ['Occupancy', prop.occupancyStatus],
      ['Comments', prop.propertyComments],
    ]);

    html += `<h2>Our agreement</h2>` + facts([
      ['Inspection provider', org.providerName],
      ['ABN', org.providerAbn],
      ['Licence', org.providerLicence],
      ['Address', org.providerAddress],
      ['Phone', org.providerPhone],
      ['Email', org.providerEmail],
      ['Inspection requested', std ? std.typeLine : ''],
      ['Client agreement', agr.agreementStatus],
      ['Reason there is no signed agreement', agr.agreementStatus === 'No client agreement' ? agr.noAgreementReason : ''],
      ['Accepted by', agr.agreementAcceptedBy],
      ['Date agreed', fmtDate(agr.agreementAcceptedAt)],
      ['Access limitations agreed beforehand', agr.agreedAccessLimitations],
    ]) + image('sig', agr.agreementSignature);

    if (P && P.termsHtmlFor) html += `<h2>Terms and conditions</h2><div class="terms">${P.termsHtmlFor(report)}</div>`;

    html += `<h2>Signed</h2>` + facts([
      ['Inspector', insp.inspectorName],
      ['Licence', insp.inspectorLicence],
      ['Phone', insp.inspectorPhone],
      ['Signed on behalf of', org.signedOnBehalfOf],
      ['Date', fmtDate(insp.signatureDate)],
    ]) + image('sig', insp.inspectorSignature);
    const ackFacts = facts([
      ['Client acknowledgement', ack.ackStatus],
      ['Note', ack.ackStatus === 'Client not on site' ? ack.ackNotSignedNote : ''],
      ['Client', ack.clientAckName],
      ['Date', fmtDate(ack.clientAckDate)],
    ]);
    if (ackFacts) html += ackFacts + image('sig', ack.clientSignature);

    if (P && P.buildAmendmentsAppendixHtml) html += P.buildAmendmentsAppendixHtml(report);
    return html;
  }

  // Where each filed photo was taken, by the photo it came from: the walk
  // files an Issue's photo under its spot ("Hot Water System").
  async function captionsFor(jobId) {
    const map = new Map();
    try {
      for (const cap of await window.DB.getCaptures(jobId)) {
        if (cap && cap.id && str(cap.zone)) map.set(cap.id, str(cap.zone));
      }
    } catch (err) { /* captions are a nicety; the report still prints */ }
    return map;
  }

  // Opens the preview in its own window, the way Export does. Opened first,
  // filled second: a window opened after an await is treated as a pop-up.
  async function open(job, report) {
    const win = window.open('', '_blank');
    if (!win) { toast('Allow pop-ups to see the preview'); return null; }
    const captions = await captionsFor(job.id);
    const client = sec(report, 'clientDetails');
    const address = str(client.propertyAddress) || str(job.address);
    const U = window.ReportSchemaUtils;
    const title = (U && U.inspectionStandard) ? U.inspectionStandard(report).title : 'Termite Inspection Report';
    win.document.write(`<!DOCTYPE html><html lang="en-AU"><head><meta charset="utf-8">`
      + `<meta name="viewport" content="width=device-width, initial-scale=1">`
      + `<title>${escapeHtml(title)}</title><style>${STYLE}${pageRule(address, fmtDate(client.inspectionDate))}</style></head><body>`
      + `<div class="bar no-print"><span>Preview of the new client layout. Reports are still sent in the current layout.</span>`
      + `<button onclick="window.print()">Print / Save as PDF</button></div>`
      + `<div class="sheet">${buildHtml(job, report, { captions })}</div></body></html>`);
    win.document.close();
    return win;
  }

  // The button on the report screen. Built here, not in index.html, so a
  // stale cached page cannot leave half of this behind. Not offered to a
  // subcontractor: what the client receives is the business's to judge.
  function renderPreviewButton({ job, report, anchor }) {
    const old = document.getElementById('client-preview-btn');
    if (old) old.remove();
    if (!anchor || !anchor.parentNode || !supports(job, report)) return;
    if (window.Subcontractor && window.Subcontractor.isSub && window.Subcontractor.isSub()) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'client-preview-btn';
    btn.className = 'btn btn-outline full';
    btn.textContent = 'Preview the new client layout';
    btn.addEventListener('click', () => { open(job, report).catch((err) => { if (window.ErrorLog) window.ErrorLog.note(err, 'client report: preview'); toast('The preview could not be opened.'); }); });
    anchor.parentNode.insertBefore(btn, anchor.nextSibling);
  }

  window.ReportClient = {
    supports, glance, actions, cleared, conduciveFound, buildHtml, open, renderPreviewButton,
    fmtDate, fmtTime, dueBy, SAID, STYLE,
  };
})();
