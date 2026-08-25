// Demo mode — a self-contained sandbox for showing the app to someone.
//
// WHY THIS EXISTS RATHER THAN A TEST LOGIN
// Every RLS policy on this project is `to authenticated using (true)`: a
// deliberate shared-team model, so any signed-in account can read every job,
// report, photo and invoice. That is correct for a technician and completely
// wrong for an audience — handing someone a login would hand them real
// clients' names, addresses, phone numbers and inspection photographs.
//
// So demo mode never signs in at all. It runs against its own IndexedDB
// (field-inspect-db-demo), seeded with invented jobs, and touches nothing
// real. Cloud features are inert because they are auth-gated server-side —
// which also means a viewer tapping "AI Draft" cannot spend real money.
//
// WHAT IT SEEDS
// A fortnight of a plausible working week, built so that every part of the
// product has something to show rather than an empty state: finalized termite
// and pest-treatment reports, a job with live termites and one without,
// commercial and industrial treatments, photo galleries with zones, mud maps,
// invoices at three stages of the Xero pipeline, jobs due for re-inspection,
// and a booked calendar ahead.
//
// Sample photographs are drawn on a canvas and watermarked SAMPLE. That is
// deliberate: a demo report should never contain an image that could be
// mistaken for real evidence of termite damage at a real address.
//
// Activated with ?demo=1. Everything below no-ops otherwise.
(() => {
  'use strict';

  if (!window.IS_DEMO) return;

  const DAY = 24 * 60 * 60 * 1000;

  function atLocal(dayOffset, hour, minute) {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute || 0, 0, 0);
    return d.getTime();
  }

  // Local date, never toISOString() — that renders in UTC and dates a morning
  // job in AEST to the previous day, which on a compliance document is wrong.
  function localDate(dayOffset) {
    const d = new Date();
    d.setDate(d.getDate() + (dayOffset || 0));
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // ---------- generated sample media ----------

  function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  }

  // A stand-in for an inspection photograph: readable, obviously synthetic,
  // and watermarked so it can never be mistaken for real site evidence.
  function samplePhotoCanvas(zone, caption, hue) {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const x = c.getContext('2d');

    const bg = x.createLinearGradient(0, 0, 0, c.height);
    bg.addColorStop(0, `hsl(${hue}, 22%, 34%)`);
    bg.addColorStop(1, `hsl(${hue}, 26%, 18%)`);
    x.fillStyle = bg;
    x.fillRect(0, 0, c.width, c.height);

    // Suggestion of structure, so the tile doesn't read as a flat colour chip.
    x.strokeStyle = `hsla(${hue}, 30%, 70%, 0.20)`;
    x.lineWidth = 2;
    for (let i = -c.height; i < c.width; i += 46) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i + c.height, c.height);
      x.stroke();
    }

    x.fillStyle = 'rgba(0,0,0,0.35)';
    x.fillRect(0, c.height - 108, c.width, 108);

    x.fillStyle = '#fff';
    x.font = 'bold 34px system-ui, sans-serif';
    x.fillText(zone, 28, c.height - 62);
    x.font = '20px system-ui, sans-serif';
    x.fillStyle = 'rgba(255,255,255,0.82)';
    x.fillText(caption, 28, c.height - 28);

    x.save();
    x.translate(c.width - 40, 40);
    x.rotate(-Math.PI / 18);
    x.font = 'bold 26px system-ui, sans-serif';
    x.textAlign = 'right';
    x.fillStyle = 'rgba(255,255,255,0.55)';
    x.fillText('SAMPLE', 0, 0);
    x.restore();

    return c;
  }

  function samplePhotoBlob(zone, caption, hue) {
    return canvasToBlob(samplePhotoCanvas(zone, caption, hue));
  }

  // A handwriting-ish squiggle derived from the name, so each fictional
  // signatory gets a stable, distinct-looking mark.
  function sampleSignature(name) {
    const c = document.createElement('canvas');
    c.width = 420;
    c.height = 140;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);

    let seed = 0;
    for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) >>> 0;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    x.strokeStyle = '#12244a';
    x.lineWidth = 2.6;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.beginPath();
    x.moveTo(36, 96);
    for (let i = 0; i < 9; i++) {
      const cx = 36 + (i + 0.5) * 38;
      const cy = 96 - (28 + rand() * 46);
      const ex = 36 + (i + 1) * 38;
      const ey = 96 - rand() * 16;
      x.quadraticCurveTo(cx, cy, ex, ey);
    }
    x.stroke();

    x.beginPath();
    x.moveTo(30, 112);
    x.lineTo(384, 112);
    x.strokeStyle = 'rgba(18,36,74,0.28)';
    x.lineWidth = 1.4;
    x.stroke();

    return c.toDataURL('image/png');
  }

  // A finished mud map: perimeter, a few internal annotations and labels —
  // what the sketch pad produces once a technician has worked over a traced
  // outline. Drawn at the same 340x420 the sketch field uses.
  function sampleMudMap(outline, labels) {
    const c = document.createElement('canvas');
    c.width = 340;
    c.height = 420;
    const x = c.getContext('2d');

    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = '#eef1f6';
    x.lineWidth = 1;
    for (let i = 0; i <= c.width; i += 20) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, c.height); x.stroke(); }
    for (let i = 0; i <= c.height; i += 20) { x.beginPath(); x.moveTo(0, i); x.lineTo(c.width, i); x.stroke(); }

    x.beginPath();
    outline.forEach(([px, py], i) => {
      const ax = px * c.width, ay = py * c.height;
      if (i === 0) x.moveTo(ax, ay); else x.lineTo(ax, ay);
    });
    x.closePath();
    x.fillStyle = 'rgba(44,122,75,0.10)';
    x.fill();
    x.strokeStyle = '#2c7a4b';
    x.lineWidth = 2.5;
    x.stroke();

    x.font = '12px system-ui, sans-serif';
    for (const [lx, ly, text, kind] of labels) {
      const ax = lx * c.width, ay = ly * c.height;
      x.beginPath();
      x.arc(ax, ay, 4, 0, Math.PI * 2);
      x.fillStyle = kind === 'alert' ? '#c0552a' : '#1a1a1a';
      x.fill();
      x.fillText(text, ax + 8, ay + 4);
    }

    x.fillStyle = '#666';
    x.font = 'italic 11px system-ui, sans-serif';
    x.fillText('N ↑', 12, 20);
    return c.toDataURL('image/png');
  }

  const HOUSE_L = [[0.18, 0.20], [0.78, 0.20], [0.78, 0.52], [0.52, 0.52], [0.52, 0.82], [0.18, 0.82]];
  const HOUSE_RECT = [[0.16, 0.24], [0.82, 0.24], [0.82, 0.78], [0.16, 0.78]];
  const SHED_UNIT = [[0.14, 0.18], [0.86, 0.18], [0.86, 0.62], [0.14, 0.62]];

  // ---------- seed jobs ----------
  // Fictional clients at real-looking Macarthur-region addresses. Coordinates
  // are real so the mud map's aerial backdrop resolves for anyone who opens
  // the sketch pad during a demo.
  const SEED_JOBS = [
    {
      key: 'hartley', name: 'Hartley Residence', address: '14 Wattle Grove, Ingleburn NSW 2565',
      lat: -33.9989, lng: 150.8671, jobType: 'termite',
      clientPhone: '0412 334 561', clientEmail: 'j.hartley@example.com',
      dayOffset: -6, hour: 8, mins: 90, status: 'completed', report: 'termiteClean',
      invoice: 'sent', dueOffset: 359,
    },
    {
      key: 'okafor', name: 'Okafor Townhouse', address: '7 Banksia Crescent, Leumeah NSW 2560',
      lat: -34.0533, lng: 150.8402, jobType: 'termite',
      clientPhone: '0433 887 210', clientEmail: 'a.okafor@example.com',
      dayOffset: -4, hour: 9, mins: 120, status: 'completed', report: 'termiteActive',
      invoice: 'paid', dueOffset: 88,
    },
    {
      key: 'minto', name: 'Minto Trade Supplies', address: '2 Airds Road, Minto NSW 2566',
      lat: -34.0361, lng: 150.8447, jobType: 'pest_treatment',
      clientPhone: '02 9603 1188', clientEmail: 'ops@mintotrade.example.com',
      dayOffset: -3, hour: 11, mins: 60, status: 'completed', report: 'pestCommercial',
      invoice: 'paid', dueOffset: 87,
    },
    {
      key: 'earlylearning', name: 'Campbelltown Early Learning', address: '31 Queen Street, Campbelltown NSW 2560',
      lat: -34.0648, lng: 150.8142, jobType: 'pest_treatment',
      clientPhone: '02 4625 7740', clientEmail: 'admin@ctownearly.example.com',
      dayOffset: -2, hour: 13, mins: 90, status: 'completed', report: 'pestChildcare',
      invoice: 'sent', dueOffset: 88,
    },
    {
      key: 'raby', name: 'Raby Road Warehouse', address: '88 Raby Road, Gledswood Hills NSW 2557',
      lat: -34.0004, lng: 150.7638, jobType: 'pest_treatment',
      clientPhone: '02 4648 2201', clientEmail: 'site@rabyroad.example.com',
      dayOffset: -1, hour: 10, mins: 180, status: 'completed', report: 'pestIndustrial',
      invoice: 'draft', dueOffset: 89,
    },
    // Drafted but not signed off — shows the mid-flow review state.
    {
      key: 'whitmore', name: 'Whitmore Cottage', address: '9 Kendall Place, Glen Alpine NSW 2560',
      lat: -34.0873, lng: 150.7794, jobType: 'termite',
      clientPhone: '0400 552 913', clientEmail: 's.whitmore@example.com',
      dayOffset: 0, hour: 8, mins: 90, status: 'review', report: 'termiteDraft',
    },
    // Overdue and upcoming re-inspections, for the Due filter.
    {
      key: 'delaney', name: 'Delaney Property', address: '5 Rosewood Avenue, Ambarvale NSW 2560',
      lat: -34.0891, lng: 150.8006, jobType: 'termite',
      clientPhone: '0421 668 034', clientEmail: 'm.delaney@example.com',
      unbooked: true, status: 'completed', report: 'termiteClean', dueOffset: -9, invoice: 'paid',
    },
    {
      key: 'harrington', name: 'Harrington Duplex', address: '22 Fitzgibbon Lane, Woodbine NSW 2560',
      lat: -34.0796, lng: 150.8177, jobType: 'termite',
      clientPhone: '0407 119 425', clientEmail: 'p.harrington@example.com',
      unbooked: true, status: 'completed', report: 'termiteClean', dueOffset: 11, invoice: 'paid',
    },
    // The week ahead, so the scheduler and calendar aren't empty.
    {
      key: 'nasser', name: 'Nasser Family Home', address: '3 Sturt Close, Bradbury NSW 2560',
      lat: -34.0846, lng: 150.8181, jobType: 'pest_treatment',
      clientPhone: '0438 902 776', clientEmail: 'r.nasser@example.com',
      dayOffset: 1, hour: 9, mins: 60,
    },
    {
      key: 'kellerman', name: 'Kellerman Residence', address: '41 Airds Road, Minto NSW 2566',
      lat: -34.0332, lng: 150.8489, jobType: 'termite',
      clientPhone: '0410 776 220', clientEmail: 'd.kellerman@example.com',
      dayOffset: 1, hour: 11, mins: 90,
    },
    {
      key: 'stgeorges', name: "St George's Parish Hall", address: '12 Broughton Street, Campbelltown NSW 2560',
      lat: -34.0669, lng: 150.8171, jobType: 'pest_treatment',
      clientPhone: '02 4626 1180', clientEmail: 'office@stgeorges.example.com',
      dayOffset: 2, hour: 8, mins: 120,
    },
    {
      key: 'pemberton', name: 'Pemberton Street Units', address: '6 Pemberton Street, Oakdale NSW 2570',
      lat: -34.0703, lng: 150.5153, jobType: 'termite',
      clientPhone: '0447 231 909', clientEmail: 'strata@pemberton.example.com',
      dayOffset: 4, hour: 8, mins: 180,
    },
  ];

  // ---------- report builders ----------

  function baseSections(schema) {
    const U = window.ReportSchemaUtils;
    const sections = {};
    for (const s of schema) sections[s.id] = U.defaultValuesForSection(s);
    return sections;
  }

  function clientBlock(job, spec, extra) {
    return Object.assign({
      clientName: spec.name,
      clientAddress: spec.address,
      clientPhone: spec.clientPhone,
      clientEmail: spec.clientEmail,
      propertyAddress: spec.address,
      inspectionDate: localDate(spec.dayOffset || 0),
      inspectionTime: String(spec.hour || 8).padStart(2, '0') + ':00',
    }, extra || {});
  }

  function inspectorBlock(signature) {
    return {
      inspectorName: 'Sam Rivera',
      inspectorAddress: 'Ingleburn NSW 2565',
      inspectorLicence: 'DEMO-0000 (sample)',
      inspectorPhone: '0291271320',
      inspectorSignature: signature,
      signatureDate: localDate(0),
    };
  }

  const REPORTS = {
    // A clean inspection: old inactive workings, nothing live. The common case.
    termiteClean(spec, media) {
      const s = baseSections(window.REPORT_SCHEMA);
      Object.assign(s.clientDetails, clientBlock(null, spec, { weather: 'Partly cloudy, 19°C, wind 11 km/h NE' }));
      Object.assign(s.agreement, {
        agreementAcceptedBy: spec.name.split(' ')[0] + ' (owner)',
        agreementAcceptedAt: localDate(spec.dayOffset || 0),
        agreementSignature: media.clientSignature,
        agreedAccessLimitations: 'Subfloor access hatch behind the laundry; roof void via the hallway manhole.',
      });
      Object.assign(s.property, {
        propertyPhotos: media.propertyPhotos,
        facade: 'Approximately North East', topography: 'Relatively Flat',
        structureType: 'Detached house', structureHeight: 'Single Storey',
        wallConstruction: 'Brick Veneer', floorType: 'Mixed Timber/Concrete',
        roofConstruction: 'Timber Truss — Cement Tile',
        furnishingStatus: 'At the time of the inspection the property was fully furnished',
        occupancyStatus: 'At the time of inspection the property was occupied',
      });
      s.siteSketch.sketchImage = media.mudMap;
      Object.assign(s.access, {
        accessPhotos: media.accessPhotos,
        hinderedObstructions: 'Yes', hinderedAreas: ['The Interior', 'Subfloor'],
        interiorObstructions: ['Items/belongings stored against wall'],
        subfloorObstructions: ['Low Clearance'],
        restrictedAccess: 'No', highRiskAreas: 'Yes', invasiveRecommended: 'No',
      });
      Object.assign(s.findings, {
        liveTermitesFound: 'No', nestFound: 'No', workingsFound: 'Yes',
        workingsAreas: ['Subfloor', 'Landscaping Timbers'],
        evidenceDetails: 'Inactive mudding to the eastern subfloor pier and to a retaining sleeper on the southern boundary. No live activity detected at the time of inspection.',
        damageSeverity: 'Minor', treatmentRecommended: 'Yes',
        treatmentComments: 'Recommend a perimeter chemical treated zone and removal of the sleeper in contact with soil.',
        priorTreatmentEvidence: 'No', borersFound: 'No', durableNoticeFound: 'No',
        reinspectionInterval: '12 months', susceptibility: 'MODERATE',
      });
      Object.assign(s.conducive, {
        waterLeaksFound: 'No', highMoistureFound: 'Yes',
        moistureDetails: 'Elevated readings to the eastern subfloor, consistent with poor cross-flow ventilation.',
        fungalDecayFound: 'No', siteDrainage: 'Adequate', subfloorDrainage: 'Inadequate',
        ventilation: 'Inadequate', antCappingCondition: 'Adequate', weepHolesClear: 'Yes',
      });
      Object.assign(s.inspector, inspectorBlock(media.techSignature));
      Object.assign(s.acknowledgement, {
        clientAckName: spec.name, clientSignature: media.clientSignature, clientAckDate: localDate(spec.dayOffset || 0),
      });
      return s;
    },

    // Live activity — the serious end of the same form.
    termiteActive(spec, media) {
      const s = REPORTS.termiteClean(spec, media);
      Object.assign(s.clientDetails, { weather: 'Fine and sunny, 26°C, wind 8 km/h N' });
      Object.assign(s.findings, {
        liveTermitesFound: 'Yes', nestFound: 'No', workingsFound: 'Yes',
        workingsAreas: ['Subfloor', 'Interior', 'Fencing'],
        evidenceDetails: 'Live subterranean termites (Coptotermes sp. suspected, not identified to species on site) located in the subfloor to the south-east bearer, with active mudding tracking up the adjacent pier. Damage extends into the bearer and one floor joist. Live workings also present in the boundary fence palings.',
        damageSeverity: 'Major', treatmentRecommended: 'Yes',
        treatmentComments: 'URGENT. Do not disturb the workings. Recommend a chemical treated zone to AS 3660.1 plus in-situ treatment of active workings, followed by a timber replacement assessment by a licensed builder.',
        priorTreatmentEvidence: 'No', borersFound: 'No', durableNoticeFound: 'No',
        reinspectionInterval: '3 months', susceptibility: 'HIGH',
      });
      Object.assign(s.conducive, {
        waterLeaksFound: 'Yes',
        highMoistureFound: 'Yes',
        moistureDetails: 'Leaking hot water overflow discharging against the south-east external wall. Very high readings (>28%) to the south-east subfloor bearer and the adjacent soil.',
        fungalDecayFound: 'Yes', siteDrainage: 'Inadequate', subfloorDrainage: 'Inadequate',
        ventilation: 'Inadequate', antCappingCondition: 'Inadequate', weepHolesClear: 'No',
      });
      Object.assign(s.property, { structureType: 'Townhouse', structureHeight: 'Double Storey' });
      return s;
    },

    // Same form, part-completed — lands in Review rather than Completed.
    termiteDraft(spec, media) {
      const s = baseSections(window.REPORT_SCHEMA);
      Object.assign(s.clientDetails, clientBlock(null, spec, { weather: 'Overcast, 17°C, wind 14 km/h SW' }));
      Object.assign(s.property, {
        propertyPhotos: media.propertyPhotos,
        structureType: 'Detached house', structureHeight: 'Single Storey',
        wallConstruction: 'Weatherboard', floorType: 'Timber Floor',
      });
      s.siteSketch.sketchImage = media.mudMap;
      Object.assign(s.access, { accessPhotos: media.accessPhotos, hinderedObstructions: 'No' });
      return s;
    },

    pestCommercial(spec, media) {
      const s = baseSections(window.PEST_TREATMENT_SCHEMA);
      Object.assign(s.clientDetails, { coverPhoto: media.propertyPhotos.slice(0, 1), jobCategory: 'Full General Pest' });
      Object.assign(s.clientDetails, clientBlock(null, spec, {
        applicationFinishTime: '12:05',
        weather: 'Fine, 23°C, wind 9 km/h NE',
        occupierDetails: 'Site foreman present throughout; staff amenities vacated during application.',
      }));
      Object.assign(s.pestIdentification, {
        pestPhotos: media.pestPhotos,
        targetPests: ['Cockroaches'],
        pestEvidence: 'Live German cockroach activity in the staff kitchen and behind the dishwasher. Fresh droppings along the skirting behind the fridge. Two live sightings during inspection.',
        affectedAreas: 'Staff kitchen, amenities block, rear storage racking.',
        infestationLevel: 'Moderate',
      });
      Object.assign(s.treatmentDetails, {
        treatmentPhotos: media.treatmentPhotos,
        treatmentMethods: ['Spray', 'Gel Bait'],
        areasTreated: ['Interior', 'Kitchen', 'Exterior Perimeter'],
        equipmentUsed: ['Hand Compression Sprayer', 'Gel Bait Gun'],
        treatmentNotes: 'Crack-and-crevice application to harbourage points, gel bait to void areas behind and beneath appliances. External perimeter band applied to the amenities block.',
      });
      s.chemicals.products = [
        { id: 'p1', productName: 'Temprid 75', activeConstituent: 'Beta-cyfluthrin 25 g/L, Imidacloprid 50 g/L', areaApplied: ['Internal', 'External'], concentrateUsed: '48 mL', totalMixApplied: '6 L', dilutionRate: '8 mL / L', batchNumber: 'TP-2026-0418' },
        { id: 'p2', productName: 'Maxforce Gold Cockroach Gel', activeConstituent: 'Fipronil 0.3 g/kg', areaApplied: ['Internal'], totalMixApplied: '35 g', batchNumber: 'MF-2026-1130' },
        { id: 'p3', productName: 'Coopex Dusting Powder', activeConstituent: 'Permethrin 25:75 250 g/kg', areaApplied: ['Roof Void'], totalMixApplied: '400 g', batchNumber: 'CX-2026-0077' },
      ];
      Object.assign(s.safety, {
        risksPresent: ['People / children', 'Dog(s)'],
        riskActions: ['Informed people/children to vacate the area', 'Moved animals to an unaffected part of the property'],
        safeToCommence: 'Yes', spillKitAvailable: 'Yes', sdsOnSite: 'Yes', firstAidOnSite: 'Yes',
        appliedOutdoorsWithSpray: 'Yes', windSpeed: '9', windDirection: 'NE', temperature: '23',
        ppeUsed: ['Chemical-Resistant Nitrile Gloves', 'Eye Protection (Safety Glasses/Goggles)', 'Respirator/Mask', 'Enclosed Footwear'],
        signagePlaced: 'Yes', occupantsNotified: 'Yes',
        reEntryPeriod: '4 hours, or once surfaces are dry', withholdingPeriod: 'Not applicable',
        sdsAvailable: 'Yes',
      });
      Object.assign(s.recommendations, {
        followUpRequired: 'Yes', followUpDate: localDate((spec.dayOffset || 0) + 21),
        generalRecommendations: 'Seal the gap beneath the kitchen splashback. Empty and clean beneath the dishwasher weekly. Move cardboard stock off the floor in the rear racking to reduce harbourage.',
        additionalNotes: 'Follow-up gel bait replenishment booked for three weeks.',
      });
      Object.assign(s.inspector, inspectorBlock(media.techSignature));
      Object.assign(s.acknowledgement, {
        clientAckName: 'Site Foreman', clientSignature: media.clientSignature, clientAckDate: localDate(spec.dayOffset || 0),
      });
      return s;
    },

    pestChildcare(spec, media) {
      const s = REPORTS.pestCommercial(spec, media);
      Object.assign(s.clientDetails, { coverPhoto: media.propertyPhotos.slice(0, 1), jobCategory: 'Full General Pest' });
      Object.assign(s.clientDetails, clientBlock(null, spec, {
        applicationFinishTime: '14:35',
        weather: 'Fine, 21°C, wind 6 km/h E',
        occupierDetails: 'Treatment carried out after hours. Centre unoccupied. Director present for sign-off.',
      }));
      Object.assign(s.pestIdentification, {
        pestPhotos: media.pestPhotos,
        targetPests: ['Ants'],
        pestEvidence: 'Black ant trailing along the external playground edging and entering the toddler room via the door threshold. No interior nesting located.',
        affectedAreas: 'Playground perimeter, toddler room threshold, external store.',
        infestationLevel: 'Low',
      });
      Object.assign(s.treatmentDetails, {
        treatmentMethods: ['Spray', 'Gel Bait'],
        areasTreated: ['Exterior Perimeter', 'Interior', 'Garden/Landscape'],
        equipmentUsed: ['Hand Compression Sprayer', 'Gel Bait Gun'],
        treatmentNotes: 'External perimeter band to the playground edging and building line. Gel bait to the toddler room threshold void. No product applied to play surfaces or soft-fall.',
      });
      s.chemicals.products = [
        { id: 'p1', productName: 'Termidor HE Residual Termiticide', activeConstituent: 'Fipronil 96 g/L', areaApplied: ['External', 'Garden / Landscape'], concentrateUsed: '30 mL', totalMixApplied: '5 L', dilutionRate: '6 mL / L', batchNumber: 'TD-2026-0912' },
        { id: 'p2', productName: 'Advion Ant Gel', activeConstituent: 'Indoxacarb 0.5 g/kg', areaApplied: ['Internal'], totalMixApplied: '20 g', batchNumber: 'AD-2026-0233' },
      ];
      Object.assign(s.safety, {
        risksPresent: ['People / children', 'Dog(s)'],
        riskActions: ['Informed people/children to vacate the area', 'Moved animals to an unaffected part of the property'],
        safeToCommence: 'Yes', spillKitAvailable: 'Yes', sdsOnSite: 'Yes', firstAidOnSite: 'Yes',
        appliedOutdoorsWithSpray: 'Yes', windSpeed: '6', windDirection: 'E', temperature: '23',
        ppeUsed: ['Chemical-Resistant Nitrile Gloves', 'Eye Protection (Safety Glasses/Goggles)', 'Respirator/Mask', 'Enclosed Footwear'],
        signagePlaced: 'Yes', occupantsNotified: 'Yes',
        reEntryPeriod: '12 hours — centre cleared for opening next morning',
        withholdingPeriod: 'Not applicable', sdsAvailable: 'Yes',
      });
      Object.assign(s.recommendations, {
        followUpRequired: 'No',
        generalRecommendations: 'Keep the playground edging clear of leaf litter. Re-seal the toddler room door threshold before next season.',
        additionalNotes: 'All product applied outside operating hours in line with the centre\'s pest management policy.',
      });
      Object.assign(s.acknowledgement, { clientAckName: 'Centre Director' });
      return s;
    },

    pestIndustrial(spec, media) {
      const s = REPORTS.pestCommercial(spec, media);
      Object.assign(s.clientDetails, { coverPhoto: media.propertyPhotos.slice(0, 1), jobCategory: 'Rodent Services' });
      Object.assign(s.clientDetails, clientBlock(null, spec, {
        applicationFinishTime: '13:10',
        weather: 'Windy, 24°C, wind 21 km/h W',
        occupierDetails: 'Warehouse operating; forklift traffic controlled by site supervisor during application.',
      }));
      Object.assign(s.pestIdentification, {
        pestPhotos: media.pestPhotos,
        targetPests: ['Rodents (Rats/Mice)', 'Cockroaches'],
        pestEvidence: 'Rodent droppings along the northern racking run and gnaw damage to two pallet wraps. No live sightings. Evidence consistent with roof rat activity.',
        affectedAreas: 'Northern racking, loading dock, external bin compound.',
        infestationLevel: 'High',
      });
      Object.assign(s.treatmentDetails, {
        treatmentPhotos: media.treatmentPhotos,
        treatmentMethods: ['Bait Stations', 'Spray', 'Exclusion Works'],
        areasTreated: ['Interior', 'Exterior Perimeter', 'Drainage/Stormwater'],
        equipmentUsed: ['Lockable Rodent Bait Stations', 'Bait Key', 'Backpack Sprayer'],
        treatmentNotes: '14 lockable stations installed and mapped to the site plan — 8 external perimeter, 6 internal along the northern racking. All stations numbered and logged.',
      });
      s.chemicals.products = [
        { id: 'p1', productName: 'Contrac Blox', activeConstituent: 'Bromadiolone 0.05 g/kg', areaApplied: ['Internal', 'External', 'Bin area'], totalMixApplied: '1.4 kg across 14 stations', batchNumber: 'CB-2026-0561' },
        { id: 'p2', productName: 'Temprid 75', activeConstituent: 'Beta-cyfluthrin 25 g/L, Imidacloprid 50 g/L', areaApplied: ['Internal', 'External'], concentrateUsed: '72 mL', totalMixApplied: '9 L', dilutionRate: '8 mL / L', batchNumber: 'TP-2026-0418' },
      ];
      Object.assign(s.safety, {
        risksPresent: ['People / children', 'Dog(s)'],
        riskActions: ['Informed people/children to vacate the area', 'Moved animals to an unaffected part of the property'],
        safeToCommence: 'Yes', spillKitAvailable: 'Yes', sdsOnSite: 'Yes', firstAidOnSite: 'Yes',
        appliedOutdoorsWithSpray: 'Yes', windSpeed: '21', windDirection: 'W', temperature: '23',
        ppeUsed: ['Heavy-Duty Rubber/Nitrile Gloves', 'Dust Mask / P2 Respirator', 'Eye Protection (Safety Glasses/Goggles)'],
        signagePlaced: 'Yes', occupantsNotified: 'Yes',
        reEntryPeriod: '4 hours for treated zones', withholdingPeriod: 'Not applicable', sdsAvailable: 'Yes',
      });
      Object.assign(s.recommendations, {
        followUpRequired: 'Yes', followUpDate: localDate((spec.dayOffset || 0) + 28),
        generalRecommendations: 'Fit brush seals to the two roller doors. Relocate the external bin compound clear of the building line. Monthly station servicing recommended under a maintenance agreement.',
        additionalNotes: 'Station map supplied to the site supervisor. Next service due in four weeks.',
      });
      Object.assign(s.acknowledgement, { clientAckName: 'Site Supervisor' });
      return s;
    },
  };

  // ---------- gallery captures ----------
  const CAPTURE_PLAN = {
    termite: [
      ['Exterior', 'Front elevation, north-east aspect', 205],
      ['Subfloor', 'Eastern pier — inactive mudding', 25],
      ['Subfloor', 'Bearer and joist, south-east corner', 25],
      ['Roof Void', 'Truss inspection, hallway manhole', 260],
      ['Kitchen', 'Under-sink cabinet, moisture check', 190],
      ['Bathroom', 'Wet area, shower recess base', 190],
    ],
    pest_treatment: [
      ['Exterior Perimeter', 'External treated band, north wall', 205],
      ['Kitchen', 'Harbourage behind appliances', 25],
      ['Storage', 'Racking run and pallet bases', 40],
      ['Amenities', 'Staff amenities block', 190],
    ],
  };

  async function seedCaptures(jobId, jobType, startedAt) {
    const plan = CAPTURE_PLAN[jobType] || CAPTURE_PLAN.termite;
    let offset = 0;
    for (const [zone, caption, hue] of plan) {
      const blob = await samplePhotoBlob(zone, caption, hue);
      const capture = await DB.addCapture({ jobId, zone, type: 'photo', photoBlob: blob });
      offset += 4 * 60 * 1000;
      await DB.updateCapture(capture.id, { createdAt: startedAt + offset });
    }
  }

  // ---------- invoices ----------
  const INVOICE_LINES = {
    termite: [
      { description: 'Timber pest inspection — AS 4349.3 / AS 3660.2', quantity: 1, unitAmountCents: 38000 },
      { description: 'Written report and site plan', quantity: 1, unitAmountCents: 6500 },
    ],
    pest_treatment: [
      { description: 'General pest treatment — internal and external', quantity: 1, unitAmountCents: 29000 },
      { description: 'Chemical products and consumables', quantity: 1, unitAmountCents: 8500 },
      { description: 'Service report and pesticide use record', quantity: 1, unitAmountCents: 4500 },
    ],
  };

  async function seedInvoice(job, spec, index) {
    const lines = INVOICE_LINES[spec.jobType] || INVOICE_LINES.termite;
    const issue = localDate(spec.dayOffset || 0);
    const invoice = {
      id: DB.uid(),
      jobId: job.id,
      number: 'INV-' + String(1042 + index),
      issueDate: issue,
      dueDate: localDate((spec.dayOffset || 0) + 14),
      clientName: spec.name,
      clientEmail: spec.clientEmail,
      propertyAddress: spec.address,
      reference: spec.name,
      lineItems: lines.map((l) => ({ id: DB.uid(), ...l, taxExempt: false })),
      gstRegistered: true,
      status: spec.invoice === 'draft' ? 'draft' : 'sent',
      xeroInvoiceId: spec.invoice === 'draft' ? null : 'demo-xero-' + job.id,
      xeroStatus: spec.invoice === 'paid' ? 'PAID' : spec.invoice === 'sent' ? 'AUTHORISED' : null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await DB.saveInvoice(invoice);
  }

  // A plausible history for each seeded report, so the audit trail has
  // something to show. One job (Okafor — the live-termite find) carries a
  // post-finalization amendment, because that is the case the audit trail
  // exists for and the one worth demonstrating.
  function seedAuditLog(spec, finalizedAt) {
    const tech = 'sam.rivera@example.com';
    const start = atLocal(spec.dayOffset || 0, spec.hour || 8);
    const v = window.REPORT_SCHEMA_VERSION || null;
    const base = { userId: null, userEmail: tech, schemaVersion: v, afterFinalize: false };
    const log = [
      { ...base, at: start, event: 'created' },
      { ...base, at: start + 22 * 60000, event: 'field-changed', sectionId: 'clientDetails',
        sectionTitle: 'Client & Site', fieldId: 'weather', label: 'Weather Conditions at time of inspection',
        from: '(blank)', to: 'Partly cloudy, 19°C, wind 11 km/h NE', reason: '' },
    ];
    if (!finalizedAt) return log;

    log.push({ ...base, at: finalizedAt, event: 'finalized' });

    if (spec.key === 'okafor') {
      log.push({
        ...base,
        at: finalizedAt + 2 * DAY,
        afterFinalize: true,
        event: 'field-changed',
        sectionId: 'findings',
        sectionTitle: 'What We Found',
        fieldId: 'reinspectionInterval',
        label: 'Recommended Re-inspection Interval',
        from: '6 months',
        to: '3 months',
        reason: 'Interval shortened after discussing the extent of damage with the owner.',
      });
    }
    return log;
  }

  // ---------- seeding ----------

  async function buildMedia(spec) {
    const isTermite = spec.jobType === 'termite';
    const outline = isTermite ? (spec.key === 'okafor' ? HOUSE_RECT : HOUSE_L) : SHED_UNIT;
    const labels = isTermite
      ? [[0.30, 0.34, 'Living', 'note'], [0.60, 0.32, 'Kitchen', 'note'],
         [0.28, 0.68, 'Subfloor access', 'note'], [0.70, 0.46, 'Active workings', 'alert']]
      : [[0.28, 0.30, 'Staff kitchen', 'note'], [0.62, 0.30, 'Storage', 'note'],
         [0.30, 0.54, 'Amenities', 'note'], [0.66, 0.52, 'Bait station 3', 'alert']];

    const [p1, p2, a1] = await Promise.all([
      samplePhotoBlob('Front Elevation', spec.address.split(',')[0], 205),
      samplePhotoBlob('Rear Elevation', 'Yard and boundary', 120),
      samplePhotoBlob(isTermite ? 'Subfloor Access' : 'Treatment Area', 'Access point', 40),
    ]);

    return {
      mudMap: sampleMudMap(outline, labels),
      techSignature: sampleSignature('Sam Rivera'),
      clientSignature: sampleSignature(spec.name),
      propertyPhotos: [{ id: DB.uid(), blob: p1 }, { id: DB.uid(), blob: p2 }],
      accessPhotos: [{ id: DB.uid(), blob: a1 }],
      pestPhotos: [{ id: DB.uid(), blob: p1 }],
      treatmentPhotos: [{ id: DB.uid(), blob: a1 }],
    };
  }

  async function seedIfEmpty() {
    const existing = await DB.getJobs();
    if (existing.length) return;

    let invoiceIndex = 0;
    for (const spec of SEED_JOBS) {
      const job = await DB.addJob({
        name: spec.name,
        address: spec.address,
        addressLat: spec.lat,
        addressLng: spec.lng,
        jobType: spec.jobType,
        clientPhone: spec.clientPhone,
        clientEmail: spec.clientEmail,
        scheduledAt: spec.unbooked ? null : atLocal(spec.dayOffset, spec.hour),
        scheduledDurationMins: spec.mins || 60,
      });

      const changes = {};
      if (spec.status && spec.status !== 'new') changes.status = spec.status;
      if (typeof spec.dueOffset === 'number') changes.nextDueAt = atLocal(spec.dueOffset, 9);
      if (!spec.unbooked && spec.status) {
        const startedAt = atLocal(spec.dayOffset, spec.hour);
        changes.inspectionStartedAt = startedAt;
        changes.inspectionEndedAt = startedAt + (spec.mins || 60) * 60 * 1000;
        changes.inspectionDate = localDate(spec.dayOffset);
        changes.inspectionTime = String(spec.hour).padStart(2, '0') + ':00';
      }
      if (Object.keys(changes).length) await DB.updateJob(job.id, changes);

      if (spec.report) {
        const media = await buildMedia(spec);
        const sections = REPORTS[spec.report](spec, media);
        const report = {
          jobId: job.id,
          sections,
          schemaVersion: window.REPORT_SCHEMA_VERSION || null,
        };
        if (spec.status === 'completed') {
          report.finalizedAt = atLocal(spec.dayOffset || 0, (spec.hour || 8) + 2);
        }
        report.auditLog = seedAuditLog(spec, report.finalizedAt);
        await DB.saveReport(report);
      }

      if (spec.status && !spec.unbooked) {
        await seedCaptures(job.id, spec.jobType, atLocal(spec.dayOffset, spec.hour));
      }

      if (spec.invoice) await seedInvoice(job, spec, invoiceIndex++);
    }
  }

  function banner() {
    const bar = document.createElement('div');
    bar.className = 'demo-banner';
    const text = document.createElement('span');
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
      for (const inv of await DB.getAllInvoices()) await DB.deleteInvoice(inv.id);
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
