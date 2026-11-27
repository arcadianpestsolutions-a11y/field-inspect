// What a report owes the client about how it was made, and what the
// technician owes the business before it goes (v183, Tal 27 Nov 2026).
//
//   limitationsNotice  The box near the top of an inspection report: what a
//                      visual inspection cannot see, in plain words, then the
//                      areas THIS job actually recorded as blocked or out of
//                      reach. The same layout Tal's Formitize report used (a
//                      summary line pointing at the blocked areas, full terms
//                      later), written in Scope's own words: nothing here is
//                      taken from the Standard or from anyone's report.
//   aiAssisted /       Whether software read the photos or suggested wording
//   aiDisclosure       on this report, and the line that says so beside the
//                      signature. Only printed when it is true, and only
//                      honest because of the sign-off below.
//   signOffStatement   The tick a technician must give before a report can be
//                      signed: they inspected it themselves and checked every
//                      finding. Recorded on the report and in its audit log;
//                      never printed and never shown to the client.
//
// EXPOSES: window.ReportAssurance = { limitationsNotice, aiAssisted,
//   aiDisclosure, signOffStatement, isInspection, LIMITS_GENERAL, retention,
//   KEEP_YEARS }   retention: how long a signed report holds its job back
//   from deletion (3 years; see the function).
(() => {
  'use strict';

  const str = (v) => (v == null ? '' : Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v)).trim();
  const list = (v) => (Array.isArray(v) ? v.filter((x) => str(x)) : (str(v) ? [str(v)] : []));

  function isInspection(report, job) {
    if (job && job.jobType === 'pest_treatment') return false;
    const doc = (report && report.documentType) || '';
    return doc === '' || doc === 'timber_pest_inspection';
  }

  const LIMITS_GENERAL = 'This was a visual inspection. We looked at everything we could see and safely reach on the day, '
    + 'and tapped and moisture-tested timber where it helped. Nothing was cut into, lifted or moved. That means we could not see '
    + 'inside wall cavities or behind wall and ceiling linings, under carpet, tiles or floating floors, behind furniture, '
    + 'built-in cupboards or stored belongings, or into any space we could not get into safely. Termites, or damage they have '
    + 'done, can be hidden in those places and not be found.';

  // Turns the access answers into short lines a client can read.
  function limitationsNotice(report, job) {
    if (!isInspection(report, job)) return null;
    const s = (report && report.sections) || {};
    const acc = s.access || {};
    const agr = s.agreement || {};
    const areas = [];
    if (acc.hinderedObstructions === 'Yes') {
      const parts = [
        ['Inside', acc.interiorObstructions],
        ['Outside', acc.exteriorObstructions],
        ['Subfloor', acc.subfloorObstructions],
        ['Roof void', acc.roofVoidObstructions],
      ];
      for (const [where, what] of parts) {
        const items = list(what);
        if (items.length) areas.push(`${where}: ${items.join(', ').toLowerCase()}.`);
      }
      // Areas ticked with no detail beside them still say where.
      const named = new Set(parts.filter(([, w]) => list(w).length).map(([w]) => w.toLowerCase()));
      const loose = list(acc.hinderedAreas).filter((a) => a !== 'Other'
        && !named.has(a.replace(/^The /, '').toLowerCase().replace('interior', 'inside').replace('exterior', 'outside')));
      if (loose.length) areas.push(`Partly blocked: ${loose.join(', ').toLowerCase()}.`);
      if (str(acc.otherHinderedDetails)) areas.push(str(acc.otherHinderedDetails));
    }
    if (acc.restrictedAccess === 'Yes' && str(acc.restrictedAccessDetails)) {
      for (const line of str(acc.restrictedAccessDetails).split(/\n+/)) if (line.trim()) areas.push(line.trim());
    }
    if (str(agr.agreedAccessLimitations)) areas.push('Agreed before the inspection: ' + str(agr.agreedAccessLimitations));
    // One mention each, in the order found.
    const seen = new Set();
    const unique = areas.filter((a) => { const k = a.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    return {
      general: LIMITS_GENERAL,
      areas: unique,
      none: unique.length ? '' : 'Nothing at this property was recorded as blocked or out of reach, but the limits above still apply.',
    };
  }

  // Software read a photo or suggested an answer on this report.
  function aiAssisted(report) {
    if (!report) return false;
    const d = report.aiDraft;
    if (d && ((Array.isArray(d.runs) && d.runs.length) || (d.draftFields && Object.keys(d.draftFields).length))) return true;
    const r = report.aiReview;
    if (r && ((r.kept || 0) + (r.corrected || 0) > 0)) return true;
    const walk = report.sections && report.sections.walkthrough;
    if (walk && walk.results && Object.values(walk.results).some((x) => x && x.ai)) return true;
    return false;
  }

  function aiDisclosure(report) {
    if (!aiAssisted(report)) return '';
    const insp = (report.sections && report.sections.inspector) || {};
    const who = [str(insp.inspectorName), str(insp.inspectorLicence) ? 'licence ' + str(insp.inspectorLicence) : '']
      .filter(Boolean).join(', ');
    return 'This report was prepared with the help of software that read the inspection photos and suggested wording. '
      + `Every finding in it was checked and approved on site by ${who || 'the licensed technician named above'}, who is responsible for it.`;
  }

  // What the technician ticks before signing. Worded for the document: an
  // inspection is looked at, a treatment or an installation is carried out.
  function signOffStatement(report, job) {
    if (isInspection(report, job)) {
      return 'I personally inspected the areas recorded in this report, and I checked every finding against what I saw on site. '
        + 'Anything the software suggested, I confirmed or corrected.';
    }
    return 'I personally carried out (or directly supervised) the work in this report, and I checked every entry in it. '
      + 'Anything the software suggested, I confirmed or corrected.';
  }

  // How long a signed report must be kept before its job can be deleted
  // (Tal, 27 Nov 2026). Every report's terms and the agreement the client
  // signs promise the records are kept for at least three years, so a signed
  // report is held for three years from signing. One with chemicals on it is
  // held by the chemical register's own rule (chem-register.js), with no
  // exceptions.
  //
  // The way out for a report signed by mistake: within a day of signing, and
  // only while it has not been emailed to anyone, it can still be deleted
  // (after a plain warning). After that nobody has relied on it yet.
  //
  // Returns null when nothing holds the report, otherwise
  //   { until, chemical, grace }   grace = deletable now, with the warning.
  const KEEP_YEARS = 3;
  const GRACE_MS = 24 * 60 * 60 * 1000;
  function retention(report, job, nowMs) {
    if (!report || !report.finalizedAt) return null;
    const now = typeof nowMs === 'number' ? nowMs : Date.now();
    const CR = window.ChemRegister;
    if (CR && CR.isRetained(report, job, now)) {
      return { until: CR.retainedUntil(report, job), chemical: true, grace: false };
    }
    const d = new Date(report.finalizedAt);
    const until = new Date(d.getFullYear() + KEEP_YEARS, d.getMonth(), d.getDate()).getTime();
    if (now >= until) return null;
    const grace = !report.emailedAt && now - report.finalizedAt < GRACE_MS;
    return { until, chemical: false, grace };
  }

  window.ReportAssurance = {
    limitationsNotice, aiAssisted, aiDisclosure, signOffStatement, isInspection, LIMITS_GENERAL,
    retention, KEEP_YEARS,
  };
})();
