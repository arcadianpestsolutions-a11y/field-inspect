// Demo mode — a self-contained sandbox for handing the app to someone to try.
//
// WHY THIS EXISTS RATHER THAN A TEST LOGIN
// Every RLS policy on this project is `to authenticated using (true)`: a
// deliberate shared-team model, so any signed-in account can read every job,
// report, photo and invoice. That is correct for a technician and completely
// wrong for a tester — handing a friend a login would hand them real clients'
// names, addresses, phone numbers and inspection photographs.
//
// So demo mode never signs in at all. It runs against its own IndexedDB
// (field-inspect-db-demo), seeded with invented jobs, and touches nothing
// real. Cloud features are inert because they are auth-gated server-side —
// which also means a tester tapping "AI Draft" cannot spend real money.
//
// Activated with ?demo=1. Everything below no-ops otherwise.
(() => {
  'use strict';

  if (!window.IS_DEMO) return;

  // Fictional clients at real-looking Macarthur-region addresses, so the app
  // looks like a working week rather than an empty shell.
  const SEED_JOBS = [
    { name: 'Hartley Residence', address: '14 Wattle Grove, Ingleburn NSW 2565', jobType: 'termite',
      clientPhone: '0412 334 561', clientEmail: 'j.hartley@example.com', dayOffset: 0, hour: 8, mins: 90, status: 'completed', finalized: true },
    { name: 'Minto Trade Supplies', address: '2 Airds Road, Minto NSW 2566', jobType: 'pest_treatment',
      clientPhone: '02 9603 1188', clientEmail: 'ops@mintotrade.example.com', dayOffset: 0, hour: 11, mins: 60, status: 'review' },
    { name: 'Okafor Townhouse', address: '7 Banksia Crescent, Leumeah NSW 2560', jobType: 'termite',
      clientPhone: '0433 887 210', clientEmail: 'a.okafor@example.com', dayOffset: 1, hour: 9, mins: 120, status: 'new' },
    { name: 'Campbelltown Early Learning', address: '31 Queen Street, Campbelltown NSW 2560', jobType: 'pest_treatment',
      clientPhone: '02 4625 7740', clientEmail: 'admin@ctownearly.example.com', dayOffset: 1, hour: 13, mins: 90, status: 'new' },
    { name: 'Whitmore Cottage', address: '9 Kendall Place, Glen Alpine NSW 2560', jobType: 'termite',
      clientPhone: '0400 552 913', clientEmail: 's.whitmore@example.com', dayOffset: 3, hour: 8, mins: 90, status: 'new' },
    { name: 'Raby Road Warehouse', address: '88 Raby Road, Gledswood Hills NSW 2557', jobType: 'pest_treatment',
      clientPhone: '02 4648 2201', clientEmail: 'site@rabyroad.example.com', dayOffset: 4, hour: 10, mins: 180, status: 'new' },
    // Unbooked, so the scheduler's backlog and the Due filter have something in them.
    { name: 'Delaney Property', address: '5 Rosewood Avenue, Ambarvale NSW 2560', jobType: 'termite',
      clientPhone: '0421 668 034', clientEmail: 'm.delaney@example.com', unbooked: true, dueOffset: -9, status: 'completed' },
    { name: 'Harrington Duplex', address: '22 Fitzgibbon Lane, Woodbine NSW 2560', jobType: 'termite',
      clientPhone: '0407 119 425', clientEmail: 'p.harrington@example.com', unbooked: true, dueOffset: 11, status: 'completed' },
    { name: 'Nasser Family Home', address: '3 Sturt Close, Bradbury NSW 2560', jobType: 'pest_treatment',
      clientPhone: '0438 902 776', clientEmail: 'r.nasser@example.com', unbooked: true },
  ];

  function atLocal(dayOffset, hour) {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  }

  // A finished termite report, so a tester can open one and see a real
  // document rather than a blank form.
  function sampleTermiteReport(jobId, job) {
    const U = window.ReportSchemaUtils;
    const sections = {};
    for (const s of window.REPORT_SCHEMA) sections[s.id] = U.defaultValuesForSection(s);
    Object.assign(sections.clientDetails, {
      clientName: job.name,
      clientAddress: job.address,
      clientPhone: job.clientPhone,
      clientEmail: job.clientEmail,
      propertyAddress: job.address,
      inspectionDate: new Date().toISOString().slice(0, 10),
      inspectionTime: '08:00',
      weather: 'Partly cloudy, 19°C, wind 11 km/h',
    });
    Object.assign(sections.agreement, {
      agreementAcceptedBy: 'J. Hartley',
      agreementAcceptedAt: new Date().toISOString().slice(0, 10),
      agreedAccessLimitations: 'Subfloor access hatch behind the laundry; roof void via the hallway manhole.',
    });
    Object.assign(sections.access, {
      hinderedObstructions: 'Yes',
      hinderedAreas: ['The Interior', 'Subfloor'],
      interiorObstructions: ['Items/belongings stored against wall'],
      subfloorObstructions: ['Low Clearance'],
      restrictedAccess: 'No',
      highRiskAreas: 'Yes',
      invasiveRecommended: 'No',
    });
    Object.assign(sections.findings, {
      liveTermitesFound: 'No',
      nestFound: 'No',
      workingsFound: 'Yes',
      workingsAreas: ['Subfloor', 'Landscaping Timbers'],
      evidenceDetails: 'Inactive mudding to the eastern subfloor pier and to a retaining sleeper on the southern boundary. No live activity detected at the time of inspection.',
      damageSeverity: 'Minor',
      treatmentRecommended: 'Yes',
      treatmentComments: 'Recommend a perimeter chemical treated zone and removal of the sleeper in contact with soil.',
      priorTreatmentEvidence: 'No',
      borersFound: 'No',
      durableNoticeFound: 'No',
      reinspectionInterval: '12 months',
      susceptibility: 'MODERATE',
    });
    Object.assign(sections.conducive, {
      waterLeaksFound: 'No',
      highMoistureFound: 'Yes',
      moistureDetails: 'Elevated readings to the eastern subfloor, consistent with poor cross-flow ventilation.',
      fungalDecayFound: 'No',
      siteDrainage: 'Adequate',
      subfloorDrainage: 'Inadequate',
      ventilation: 'Inadequate',
      antCappingCondition: 'Adequate',
      weepHolesClear: 'Yes',
    });
    Object.assign(sections.inspector, {
      inspectorName: 'Demo Technician',
      inspectorAddress: 'Ingleburn',
      inspectorLicence: 'DEMO-0000',
      inspectorPhone: '0291271320',
    });
    return { jobId, sections, finalizedAt: Date.now() - 3600000 };
  }

  async function seedIfEmpty() {
    const existing = await DB.getJobs();
    if (existing.length) return;

    for (const spec of SEED_JOBS) {
      const job = await DB.addJob({
        name: spec.name,
        address: spec.address,
        jobType: spec.jobType,
        clientPhone: spec.clientPhone,
        clientEmail: spec.clientEmail,
        scheduledAt: spec.unbooked ? null : atLocal(spec.dayOffset, spec.hour),
        scheduledDurationMins: spec.mins || 60,
      });

      const changes = {};
      if (spec.status && spec.status !== 'new') changes.status = spec.status;
      if (typeof spec.dueOffset === 'number') changes.nextDueAt = atLocal(spec.dueOffset, 9);
      if (Object.keys(changes).length) await DB.updateJob(job.id, changes);

      if (spec.finalized) await DB.saveReport(sampleTermiteReport(job.id, spec));
    }
  }

  function banner() {
    const bar = document.createElement('div');
    bar.className = 'demo-banner';
    const text = document.createElement('span');
    text.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = 'DEMO';
    text.appendChild(strong);
    text.appendChild(document.createTextNode(' · Sample data only. Nothing here is real and nothing is saved to the cloud.'));
    bar.appendChild(text);

    const reset = document.createElement('button');
    reset.className = 'link-btn';
    reset.textContent = 'Reset demo';
    reset.addEventListener('click', async () => {
      if (!confirm('Clear the demo data and start again?')) return;
      for (const j of await DB.getJobs()) await DB.deleteJob(j.id);
      location.reload();
    });
    bar.appendChild(reset);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  // Runs after the other modules have defined themselves.
  window.addEventListener('load', async () => {
    try {
      banner();
      await seedIfEmpty();
      if (window.showJobListView) window.showJobListView();
      if (window.renderJobListPublic) await window.renderJobListPublic();
    } catch (err) {
      console.error('[demo] could not start demo mode:', err);
    }
  });
})();
