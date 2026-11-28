// The termite management lifecycle — the three documents that follow an
// inspection when termites are found or a barrier is installed.
//
// WHY THESE EXIST
// The app has always had one termite report, which conflated two different
// standards and covered only the inspection. The real-world record shows
// the inspection is less than half the termite work:
//
//   Termite Inspection Report (AS 3660.2)          116 submissions
//   Timber Pest Inspection (AS 4349.3)             112
//   Termite Management Plan Service Record (TM 3)  104   <- no equivalent
//   Termite Management Action Plan (TM 1)           72   <- no equivalent
//   Certificate of Installation (TM 5 / TM 4)       39   <- no equivalent
//
// 215 of those had nowhere to go. They are also the consequential ones: an
// action plan is a quote the client accepts, a certificate is a legal record
// a conveyancer will ask for years later, and a service record is what keeps
// a warranty alive.
//
// The three form one chain: propose the works (TM 1), certify them once
// installed (TM 4/TM 5), then service the system periodically (TM 3).

(() => {
  'use strict';

  // Sections shared with the inspection reports keep their ids on purpose —
  // report.js keys several behaviours off literal ids (inspector defaults,
  // the finalize gate's acknowledgement exemption, seeding from the job), and
  // matching them inherits all of that instead of needing a parallel branch.
  function clientSection(number, title, subtitle) {
    return {
      id: 'clientDetails', number, title, subtitle, icon: '👤', color: '#7c3f00',
      fields: [
        { id: 'clientName', label: 'Client Name', type: 'text', required: true },
        { id: 'clientPhone', label: 'Client Phone', type: 'text', required: true },
        { id: 'clientEmail', label: 'Client Email', type: 'text' },
        { id: 'propertyAddress', label: 'Property Address', type: 'text', required: true },
        { id: 'inspectionDate', label: 'Date', type: 'date', required: true },
      ],
    };
  }

  function inspectorSection(number) {
    return {
      id: 'inspector', number, title: 'Technician Details',
      subtitle: 'Who carried out this work.',
      icon: '🧑‍🔧', color: '#334155',
      fields: [
        { id: 'inspectorName', label: 'Technician Name', type: 'text', required: true },
        { id: 'inspectorLicence', label: 'Pest Management Licence Number', type: 'text', required: true },
        { id: 'inspectorPhone', label: 'Technician Phone', type: 'text' },
        { id: 'signedOnBehalfOf', label: 'Signed on behalf of', type: 'static', orgField: 'signedOnBehalfOf' },
        { id: 'inspectorSignature', label: 'Technician Signature', type: 'signature', required: true, askWith: ['inspectorName', 'inspectorLicence'] },
        { id: 'signatureDate', label: 'Date', type: 'date' },
      ],
    };
  }

  // ---------- TM 1 — Termite Management Action Plan (AS 3660.2-2017) ----------
  // What is proposed, why, and what the client is agreeing to. This is the
  // document that turns a finding into work, so the money and the warranty
  // terms have to be on it and unambiguous.
  const TERMITE_ACTION_PLAN_SCHEMA = [
    clientSection(1, 'Client & Property', 'Who this plan is for and where the works will be carried out.'),
    {
      id: 'basis', number: 2, title: 'Basis for This Plan',
      subtitle: 'The inspection that led here — a management plan should never appear out of nowhere.',
      icon: '🔍', color: '#b45309',
      fields: [
        { id: 'inspectionReference', label: 'Inspection report this follows from (date / reference)', type: 'text', required: true },
        {
          id: 'findingsSummary', label: 'What was found', type: 'textarea', required: true,
          aiFillable: true,
        },
        {
          id: 'termiteActivity', label: 'Live activity present at inspection?', type: 'yesno',
          required: true, aiFillable: true,
        },
        // Which termite it is decides what will work. Coptotermes,
        // Schedorhinotermes and Nasutitermes do not respond the same way to
        // the same system, so a plan that names a method without naming the
        // species cannot show why that method was the right one. Carried
        // here rather than left back in the inspection because this is the
        // document the client and any later assessor actually reads.
        {
          id: 'termiteSpecies', label: 'Termite species (genus/species, or "not determinable")',
          type: 'text', required: true, aiFillable: true,
          quickPicks: ['Coptotermes', 'Schedorhinotermes', 'Nasutitermes', 'Heterotermes', 'Not determinable'],
          showIf: { field: 'termiteActivity', equals: 'Yes' },
        },
        // v9, AS 3660.2 cl 5.2.1 and 5.5.1: where termites are active, killing
        // the colony comes FIRST, before a treated zone or any other risk
        // reduction. A plan that goes straight to a barrier while termites are
        // working inside the building has the order wrong.
        {
          id: 'colonyControl', since: 10, label: 'Colony control — first step while termites are active (AS 3660.2 cl 5.5.1)',
          type: 'select', required: true, aiFillable: true,
          options: ['Termiticidal dust into active workings', 'Liquid / foamed termiticide into galleries',
            'Baiting to colony elimination', 'Physical removal / destruction of the nest', 'Combination — see notes'],
          showIf: { field: 'termiteActivity', equals: 'Yes' },
        },
        {
          id: 'colonyControlNotes', since: 10, label: 'Colony control: where, how, and the follow-up check (dust/foam: leave undisturbed for the label period, then re-check)',
          type: 'textarea', aiFillable: true,
          showIf: { field: 'termiteActivity', equals: 'Yes' },
        },
        {
          id: 'riskLevel', label: 'Risk of further attack', type: 'select', required: true,
          options: ['LOW', 'MODERATE', 'HIGH'], aiFillable: true,
        },
        {
          id: 'standardApplied', label: 'Part of AS 3660 this plan is written under',
          type: 'select', required: true,
          options: ['AS 3660.2 — in and around existing buildings', 'AS 3660.1 — new building work'],
          default: 'AS 3660.2 — in and around existing buildings',
        },
      ],
    },
    // v9, AS 3660.2 cl 4.3.4. A required heading of the plan, and the one
    // that was missing entirely: what this termite can do, what happens if
    // nothing is done, and every risk the works themselves carry — including
    // the chemical and anything else it could reach.
    {
      id: 'riskAssessment', since: 10, number: 3, title: 'Risk Assessment',
      subtitle: 'What this termite can do, what happens if nothing is done, and the risks of the works themselves.',
      icon: '⚖️', color: '#9a3412',
      fields: [
        {
          id: 'termiteCapability', label: 'Known capabilities of this termite (how it attacks, how fast, how hard it is to control)',
          type: 'textarea', required: true, aiFillable: true,
        },
        {
          id: 'consequencesOfInaction', label: 'Likely consequences of doing nothing',
          type: 'textarea', required: true, aiFillable: true,
        },
        {
          id: 'treatmentRisks', label: 'Risks of the proposed works (chemical, occupants, pets, drains and waterways, slab or membrane damage from drilling)',
          type: 'textarea', required: true, aiFillable: true,
        },
        // Cl 5.4.4: management actions shall not remove predatory native ants,
        // birds and lizards. Cl 5.5.2.2: no chemical where it could reach a drain.
        {
          id: 'offTargetRisk', label: 'Risk to off-target organisms (predatory ants, birds, lizards, fish, bees) and how it is managed',
          type: 'textarea', required: true, aiFillable: true,
        },
      ],
    },
    {
      id: 'proposedWorks', number: 4, title: 'Proposed Management',
      subtitle: 'The method, its extent, and anything that cannot be treated.',
      icon: '🛠️', color: '#0369a1',
      fields: [
        {
          id: 'managementMethod', label: 'Management method proposed', type: 'multiselect', required: true,
          options: ['Chemical soil treated zone (AS 3660.2)', 'Reticulation system', 'Termite baiting system',
            'Physical barrier', 'Dusting / foaming of active workings', 'Removal of conducive conditions'],
        },
        {
          id: 'treatmentExtent', label: 'Extent of treatment', type: 'select', required: true,
          options: ['Complete perimeter', 'Partial — see limitations below', 'Localised / spot treatment only'],
        },
        {
          id: 'areasToTreat', label: 'Areas to be treated', type: 'multiselect', required: true,
          options: ['External perimeter', 'Internal perimeter', 'Subfloor', 'Slab penetrations', 'Garage',
            'Patio / paving', 'Retaining walls', 'Fencing', 'Trees / stumps', 'Bait station ring'],
        },
        {
          id: 'drillingRequired', label: 'Will drilling of hard surfaces be required?', type: 'yesno', required: true,
        },
        {
          id: 'drillingDetail', label: 'What will be drilled, and how it will be made good',
          type: 'textarea', required: true, showIf: { field: 'drillingRequired', equals: 'Yes' },
        },
        {
          id: 'untreatableAreas',
          label: 'Areas that cannot be treated, and why',
          type: 'textarea',
          // A management plan that quietly omits what it cannot cover is the
          // one that gets argued about later. This is the field that protects
          // the technician, so it is required rather than optional.
          required: true,
        },
        { id: 'productsProposed', label: 'Products proposed', type: 'productList', required: true },
        { id: 'estimatedDuration', label: 'Estimated time on site', type: 'text', required: true, quickPicks: ['Half a day', '1 day', '2 days'] },
        // v9, AS 3660.2 cl 4.3.5: the plan SHALL give the expected time on
        // site, the number of visits, and any works or changes required
        // before termite management can begin (commonly clearing debris and
        // obstructions). Time on site was optional; the other two were absent.
        { id: 'numberOfVisits', since: 10, label: 'Number of visits expected', type: 'text', required: true, quickPicks: ['1', '2', '3'] },
        {
          id: 'preWorksRequired', since: 10, label: 'Works or changes needed before termite management can begin (clear debris, remove obstructions, fix leaks)',
          type: 'textarea', required: true, aiFillable: true,
        },
        // AS 3660 expects the client to be told what else was possible, not
        // just what is being sold to them. It is also the technician's best
        // protection when someone asks later why baiting was not used.
        {
          id: 'optionsConsidered', label: 'Other management options considered, and why this one was chosen',
          type: 'textarea', required: true,
        },
        // Distinct from untreatableAreas above, which is about places. This
        // is about the system itself: what it does not do even where it is
        // installed correctly. A treated zone deters concealed entry, it does
        // not stop termites crossing an exposed surface in the open; baiting
        // depends on foraging termites finding the stations. Neither is a
        // guarantee against future attack, and saying so here is what stops
        // the plan being read as one.
        {
          id: 'systemLimitations', label: 'Limitations of the proposed system (what it does not protect against)',
          type: 'textarea', required: true,
        },
        // Not the same thing as the commercial warranty in the next section,
        // and conflating the two is a real compliance error: the expected
        // service life of a treated zone is a property of the chemical and
        // the soil it goes into, not of what the business chooses to
        // guarantee. Both belong in the document, separately.
        {
          id: 'expectedServiceLife', label: 'Expected service life of the treated zone / system',
          type: 'select',
          options: ['Not applicable — no treated zone proposed', 'Up to 3 years', 'Up to 5 years',
            'Up to 8 years', 'Up to 10 years', 'Per product label — stated in the attached label'],
          required: true,
        },
        // Chemical goes into someone's home. Who has to be out, for how
        // long, and what has to be covered or moved is part of the proposal,
        // not a conversation on the day.
        {
          id: 'occupantRequirements', label: 'What the occupants must do on the day (vacating, pets, fish tanks, covering food)',
          type: 'textarea', required: true,
        },
        // AS 3660 requires a durable notice recording what was installed to
        // be fixed at the property. Promising it in the plan is what makes it
        // happen; the Certificate of Installation then records where it went.
        {
          id: 'durableNoticeCommitted', label: 'A durable notice will be installed on completion',
          type: 'yesno', required: true, default: 'Yes',
        },
      ],
    },
    // v9, AS 3660.2 cl 4.3.6: the plan SHALL conclude with the expected
    // outcome, the ongoing risk-management requirements, the expected
    // duration of works, and how success or failure will be judged.
    {
      id: 'outcome', since: 10, number: 5, title: 'Anticipated Outcome',
      subtitle: 'What the client should expect, for how long, and how you will both know it worked.',
      icon: '🎯', color: '#0f766e',
      fields: [
        { id: 'expectedOutcome', label: 'Expected outcome', type: 'textarea', required: true, aiFillable: true },
        {
          id: 'programDuration', label: 'Expected duration of the works program (e.g. baiting typically several months)',
          type: 'text', required: true, quickPicks: ['1 day', '1 week', '1 to 3 months', '3 to 6 months'],
        },
        {
          id: 'successCriteria', label: 'How success or failure will be measured (e.g. no activity at the follow-up inspection; colony collapse observed in stations)',
          type: 'textarea', required: true,
        },
        {
          id: 'ongoingRiskManagement', label: 'Ongoing risk-management requirements after the works',
          type: 'textarea', required: true, aiFillable: true,
        },
      ],
    },
    {
      id: 'warranty', number: 6, title: 'Warranty & Ongoing Requirements',
      // "What we guarantee" is a commercial promise and is not the same as
      // how long the chemical is expected to last, which is recorded up in
      // Proposed Management. A client reading a 12-month warranty against an
      // 8-year treated zone should be seeing two different facts, not one
      // contradictory one.
      subtitle: 'What is guaranteed, for how long, and what the client must do to keep it. '
        + 'Separate from the expected service life of the system itself.',
      icon: '📜', color: '#166534',
      fields: [
        { id: 'warrantyOffered', label: 'Warranty offered?', type: 'yesno', required: true, default: 'Yes' },
        {
          id: 'warrantyPeriod', label: 'Warranty period', type: 'select',
          options: ['12 months', '2 years', '3 years', '5 years', '8 years'],
          required: true, showIf: { field: 'warrantyOffered', equals: 'Yes' },
        },
        {
          id: 'warrantyConditions', label: 'Conditions the client must meet',
          type: 'multiselect', required: true, showIf: { field: 'warrantyOffered', equals: 'Yes' },
          options: ['Annual inspection by us',
            'Six-monthly inspection where risk is high',
            'Treated zone must not be disturbed or breached',
            'Conducive conditions listed in the report to be rectified',
            'Notify us immediately of any suspected activity'],
        },
        {
          id: 'reinspectionInterval', label: 'Required inspection interval', type: 'select', required: true,
          options: ['3 months', '6 months', '12 months'], default: '12 months',
        },
        { id: 'quotedAmount', label: 'Quoted amount (inc GST)', type: 'text', required: true },
        { id: 'quoteValidUntil', label: 'Quote valid until', type: 'date', future: true },
      ],
    },
    {
      id: 'terms', number: 7, title: 'Terms & Conditions',
      subtitle: 'Terms applying to the proposed works.', icon: '📖', color: '#475569', fixed: true, fields: [],
    },
    inspectorSection(8),
    {
      id: 'acknowledgement', number: 9, title: 'Client Acceptance',
      subtitle: 'The client accepts the proposed management plan and its cost.',
      icon: '✅', color: '#166534',
      fields: [
        { id: 'clientAckName', label: 'Accepted by (name)', type: 'text', required: true },
        { id: 'clientSignature', label: 'Client Signature', type: 'signature', required: true },
        { id: 'clientAckDate', label: 'Date accepted', type: 'date', required: true },
      ],
    },
  ];

  // ---------- TM 4 / TM 5 — Certificate of Installation ----------
  // Issued once a termite management system is in. This is the document a
  // conveyancer or a builder's certifier asks for years later, so it records
  // exactly what went in, where, and what keeps it valid.
  const TERMITE_CERTIFICATE_SCHEMA = [
    clientSection(1, 'Property & Owner', 'The property the system protects, and who owns it.'),
    {
      id: 'installation', number: 2, title: 'System Installed',
      subtitle: 'What was installed, under which standard.',
      icon: '🧱', color: '#0369a1',
      fields: [
        {
          id: 'standardApplied', label: 'Standard applied', type: 'select', required: true,
          options: ['AS 3660.1-2014 — new construction', 'AS 3660.2-2017 — existing structure'],
        },
        {
          id: 'systemType', label: 'System installed', type: 'multiselect', required: true,
          options: ['Chemical soil treated zone', 'Reticulation system', 'Termite baiting system',
            'Physical barrier — sheet', 'Physical barrier — granular', 'Collar / penetration seal'],
        },
        { id: 'installationDate', label: 'Date installation completed', type: 'date', required: true },
        {
          id: 'areasTreated', label: 'Areas covered by the system', type: 'multiselect', required: true,
          options: ['External perimeter', 'Internal perimeter', 'Subfloor', 'Slab penetrations',
            'Garage', 'Patio / paving', 'Construction joints', 'Full under-slab'],
        },
        // v9, AS 3660.2 cl 5.9 (c): whether one system or an integrated
        // combination was applied.
        {
          id: 'singleOrIntegrated', since: 10, label: 'Single system or integrated system?', type: 'select', required: true,
          options: ['Single system', 'Integrated system (more than one component)'],
        },
        { id: 'productsUsed', label: 'Products installed', type: 'productList', required: true },
        // v9, cl 5.9 (a)(i) and 5.10 (c): the service life on the product
        // label, the area treated in m² and the perimeter / linear runs in m.
        // The product rows record dilution and total volume; these are the
        // quantities the certificate must show about the zone as a whole.
        {
          id: 'labelServiceLife', since: 10, label: 'Service life stated on the product label (e.g. "up to 8 years")',
          type: 'text', required: true, quickPicks: ['Up to 3 years', 'Up to 5 years', 'Up to 8 years', 'Up to 10 years'],
        },
        { id: 'areaTreatedM2', since: 10, label: 'Area of chemical application (m²) and where', type: 'text' },
        {
          id: 'linearMetresTreated', since: 10, label: 'Perimeter / linear treatment (m) — internal and external, and where',
          type: 'text', required: true,
        },
        // Cl 5.9 (a)(i): for reticulation, the maximum replenishing pressure
        // SHALL be shown prominently, with the termiticide volume per fill point.
        {
          id: 'reticMaxPressure', since: 10, label: 'Reticulation: maximum pressure for replenishing (per the manufacturer)',
          type: 'text', required: true, showIf: { field: 'systemType', includes: 'Reticulation system' },
        },
        {
          id: 'reticFillPoints', since: 10, label: 'Reticulation: volume of termiticide required at each fill point',
          type: 'textarea', required: true, showIf: { field: 'systemType', includes: 'Reticulation system' },
        },
        // Cl 5.9 (a)(ii): for a physical system, its name and how it was installed.
        {
          id: 'physicalSystemName', since: 10, label: 'Physical system: name and method of installation (physical barriers only)',
          type: 'textarea',
        },
        // Cl 5.5.2.2 (b)(iii): drilling to treat under the entire slab only
        // with a builder's or engineer's approval, and that advice goes in the
        // documentation given to the client.
        {
          id: 'underSlabApproval', since: 10, label: 'Builder / engineer harm-minimisation advice for under-slab drilling (who, date, what they approved)',
          type: 'textarea', required: true, showIf: { field: 'areasTreated', includes: 'Full under-slab' },
        },
        // Cl 5.5.2.2: no chemical where there is a risk of it entering a drain,
        // or before weather that could wash it in.
        {
          id: 'drainRiskChecked', since: 10, label: 'Chemical kept clear of drains (rubble / agricultural drains) and no rain expected to wash it in',
          type: 'yesno', required: true,
        },
        {
          id: 'installationPhotos', label: 'Photos of the installed system', type: 'photos',
          required: true, triggersAiFill: true,
        },
        {
          id: 'partialInstallation', label: 'Any part of the perimeter left untreated?', type: 'yesno',
          required: true, default: 'No',
        },
        {
          id: 'partialDetail', label: 'Which parts, and why', type: 'textarea', required: true,
          showIf: { field: 'partialInstallation', equals: 'Yes' },
        },
        // v9, cl 5.9 (f) and 5.2.2.2: limitations caused by the building's
        // design or construction, or by what the client asked for, and the
        // increased inspection frequency recommended because of them.
        {
          id: 'installationLimitations', since: 10,
          label: 'Limitations of the installation or of inspecting / maintaining it (building design, construction, client requirements) — or "None"',
          type: 'textarea', required: true,
        },
      ],
    },
    // v9, cl 5.9 (d): a diagram showing where the system components are.
    // Required — it is how anyone finds the treated zone years later.
    {
      id: 'systemDiagram', since: 10, number: 3, title: 'System Diagram',
      subtitle: 'Mark where the system components are — treated zone, drill lines, stations, reticulation fill points.',
      icon: '🗺️', color: '#0d9488',
      fields: [
        { id: 'systemSketch', label: 'Diagram of the system components', type: 'sketch', required: true },
        { id: 'sketchData', label: 'Diagram marker data', type: 'sketchData' },
      ],
    },
    // v9, cl 5.9 (i)–(l): slab and suspended-floor details. Only the parts
    // that apply are asked.
    {
      id: 'construction', since: 10, number: 4, title: 'Slab & Subfloor Details',
      subtitle: 'The floor construction the system works with, and what was done to it.',
      icon: '🏗️', color: '#57534e',
      fields: [
        {
          id: 'floorConstruction', label: 'Floor construction', type: 'multiselect', required: true,
          options: ['Concrete slab', 'Suspended floor'],
        },
        {
          id: 'slabType', label: 'Slab type', type: 'select', required: true,
          options: ['Raft', 'Infill', 'Formed-void (waffle)', 'Tied', 'Not determinable'],
          showIf: { field: 'floorConstruction', includes: 'Concrete slab' },
        },
        {
          id: 'slabConformance', label: 'Slab conforms to AS 2870 or AS 3600?', type: 'select', required: true,
          options: ['Yes', 'No — noted', 'Not determinable'],
          showIf: { field: 'floorConstruction', includes: 'Concrete slab' },
        },
        {
          id: 'slabInclusions', label: 'Slab inclusions (heater wires, pipes, sub-slab water storage in m) — or "None known"',
          type: 'text', showIf: { field: 'floorConstruction', includes: 'Concrete slab' },
        },
        {
          id: 'slabWorks', label: 'Slab works: number of penetrations treated; number and total length (m) of joints treated; works to slab edges or discontinuities',
          type: 'textarea', showIf: { field: 'floorConstruction', includes: 'Concrete slab' },
        },
        {
          id: 'subfloorClearance', label: 'Minimum clearance under the floor (mm), and under fixtures (mm)',
          type: 'text', required: true, showIf: { field: 'floorConstruction', includes: 'Suspended floor' },
        },
        {
          id: 'subfloorDrainage', label: 'Grading and drainage to prevent ponding', type: 'textarea',
          showIf: { field: 'floorConstruction', includes: 'Suspended floor' },
        },
        {
          id: 'subfloorVentilation', label: 'Subfloor ventilation to the NCC present?', type: 'select',
          options: ['Yes', 'No — see limitations', 'Not determinable'],
          showIf: { field: 'floorConstruction', includes: 'Suspended floor' },
        },
        {
          id: 'pierTreatment', label: 'Treatment applied to piers / stumps / pillars', type: 'textarea',
          showIf: { field: 'floorConstruction', includes: 'Suspended floor' },
        },
      ],
    },
    {
      id: 'durableNotice', number: 5, title: 'Durable Notice',
      subtitle: 'AS 3660 requires a durable notice fixed in a visible position recording the system installed.',
      icon: '🏷️', color: '#b45309',
      fields: [
        { id: 'noticeInstalled', label: 'Durable notice fixed?', type: 'yesno', required: true, default: 'Yes' },
        {
          id: 'noticeLocation', label: 'Where the notice was fixed', type: 'select',
          required: true, showIf: { field: 'noticeInstalled', equals: 'Yes' },
          options: ['Meter box', 'Inside kitchen sink cupboard', 'Subfloor access', 'Garage wall',
            'Hot water service', 'Other — see notes'],
        },
        {
          id: 'noticePhoto', label: 'Photo of the notice in place', type: 'photos',
          required: true, showIf: { field: 'noticeInstalled', equals: 'Yes' },
        },
        {
          id: 'noticeOmittedReason', label: 'Why no notice was fixed', type: 'textarea',
          required: true, showIf: { field: 'noticeInstalled', equals: 'No' },
        },
        // v9, cl 5.10 (e)–(g): the notice states whether chemical will need to
        // be reapplied, the product recommended for it, and the volume and
        // method at each location (including reticulation volume and pressure).
        // Recorded here so the certificate and the notice say the same thing.
        {
          id: 'reapplicationExpected', since: 10, label: 'Is reapplication of chemical expected (spray, injection or reticulation)?',
          type: 'yesno', required: true,
        },
        {
          id: 'reapplicationProduct', label: 'Product recommended for reapplication', type: 'text', required: true,
          showIf: { field: 'reapplicationExpected', equals: 'Yes' },
        },
        {
          id: 'reapplicationVolumes', label: 'Volume of diluted product and method at each location (and pressure at any reticulation point)',
          type: 'textarea', required: true, showIf: { field: 'reapplicationExpected', equals: 'Yes' },
        },
      ],
    },
    {
      id: 'warranty', number: 6, title: 'Warranty & Next Inspection',
      subtitle: 'What is covered and when the property must next be inspected.',
      icon: '📜', color: '#166534',
      fields: [
        { id: 'warrantyPeriod', label: 'Warranty period', type: 'select', required: true,
          options: ['12 months', '2 years', '3 years', '5 years', '8 years'] },
        { id: 'warrantyStart', label: 'Warranty commences', type: 'date', required: true },
        {
          id: 'reinspectionInterval', label: 'Inspection interval required to maintain the warranty',
          type: 'select', required: true, options: ['3 months', '6 months', '12 months'], default: '12 months',
        },
        // `future: true` (v192): a date that is ahead by nature gets no "Today" chip.
        { id: 'nextInspectionDue', label: 'Next inspection due', type: 'date', required: true, future: true },
        // v9, cl 5.9 (e) and (g): the scope of future inspections (not only
        // how often), and advice for maintaining the system.
        {
          id: 'futureInspectionScope', since: 10, label: 'Scope of future inspections (what each inspection must cover)',
          type: 'textarea', required: true,
          default: 'A full inspection to AS 3660.2 of the building, the treated zone and the inspection zones, at not more than the interval above.',
        },
        {
          id: 'maintenanceAdvice', since: 10, label: 'Advice for maintaining the system (keep treated zone undisturbed, no soil or mulch over it, tell us before works near it…)',
          type: 'textarea', required: true, aiFillable: true,
        },
        { id: 'warrantyConditions', label: 'Conditions and exclusions', type: 'textarea' },
      ],
    },
    {
      id: 'terms', number: 7, title: 'Terms & Conditions',
      subtitle: 'Terms applying to this certificate.', icon: '📖', color: '#475569', fixed: true, fields: [],
    },
    inspectorSection(8),
    {
      id: 'acknowledgement', number: 9, title: 'Client Acknowledgement',
      subtitle: 'The owner acknowledges the system and their obligation to maintain inspections.',
      icon: '✅', color: '#166534',
      fields: [
        { id: 'clientAckName', label: 'Acknowledged by (name)', type: 'text' },
        { id: 'clientSignature', label: 'Client Signature', type: 'signature' },
        { id: 'clientAckDate', label: 'Date', type: 'date' },
      ],
    },
  ];

  // ---------- TM 3 — Termite Management Plan Service Record ----------
  // The periodic visit to an installed system. Highest volume of the three
  // (104 submissions), and the one that keeps a warranty alive — a missed
  // service is what voids it.
  const TERMITE_MONITORING_SCHEMA = [
    clientSection(1, 'Client & Property', 'The property and the monitoring system installed on it.'),
    {
      id: 'systemServiced', number: 2, title: 'The System Being Monitored',
      subtitle: 'What is installed here and when it went in.',
      icon: '🧱', color: '#0369a1',
      fields: [
        {
          id: 'systemType', label: 'System installed', type: 'select', required: true,
          options: ['Termite baiting system', 'Chemical soil treated zone', 'Reticulation system',
            'Physical barrier', 'Combination — see notes'],
        },
        { id: 'installedDate', label: 'Date system installed', type: 'date' },
        { id: 'serviceNumber', label: 'Which monitoring visit is this? (e.g. 4th)', type: 'text' },
        { id: 'lastServiceDate', label: 'Date of previous visit', type: 'date' },
      ],
    },
    {
      id: 'stations', number: 3, title: 'The Stations',
      subtitle: 'Every station checked this visit, and what was in it. This is the report.',
      icon: '📍', color: '#7c2d12',
      fields: [
        // The repeatable station record is the heart of this document — a
        // service record without a per-station result is just an assertion
        // that someone attended.
        { id: 'stationRecords', label: 'Station inspection records', type: 'stationList', required: true },
        {
          id: 'systemCondition', label: 'Overall system condition', type: 'select', required: true,
          options: ['Intact and functioning', 'Minor damage — repaired this visit',
            'Damage requiring follow-up', 'Partially compromised — see notes'],
        },
        {
          id: 'stationsDamaged', label: 'Any stations damaged, buried or missing?', type: 'yesno',
          required: true, default: 'No',
        },
        {
          id: 'damageDetail', label: 'Which stations, and what was done', type: 'textarea',
          required: true, showIf: { field: 'stationsDamaged', equals: 'Yes' },
        },
      ],
    },
    {
      id: 'findings', number: 4, title: 'Activity Found',
      subtitle: 'What the stations and the structure turned up this visit.',
      icon: '🔍', color: '#b45309',
      fields: [
        { id: 'servicePhotos', label: 'Photos from this visit', type: 'photos', triggersAiFill: true },
        {
          id: 'activityFound', label: 'Termite activity found in any station?', type: 'yesno',
          required: true, aiFillable: true,
        },
        {
          id: 'activityDetail', label: 'Which stations, and what was observed', type: 'textarea',
          required: true, showIf: { field: 'activityFound', equals: 'Yes' }, aiFillable: true,
        },
        // v9, cl 5.5.1.4: no single test proves a colony is dead, and absence
        // at a station is NOT proof. Signs of impending collapse are an
        // overabundance of soldiers, sluggish or deformed termites, and white
        // deposits; a follow-up inspection about three months after presumed
        // collapse checks for further activity.
        {
          id: 'colonyStatus', since: 10, label: 'Colony status (absence from a station alone is not proof of colony death)', type: 'select',
          options: ['Not baiting — monitoring only', 'Feeding on bait', 'Signs of impending collapse (soldier overabundance, sluggish, white deposits)',
            'Presumed collapsed — follow-up inspection due in about 3 months', 'Activity moved away — colony status unknown'],
          aiFillable: true,
        },
        {
          id: 'baitReplenished', label: 'Bait replenished or replaced?', type: 'yesno', required: true,
        },
        { id: 'productsUsed', label: 'Product used this visit', type: 'productList' },
        {
          id: 'structureChecked', label: 'Structure visually checked for new activity?', type: 'yesno',
          required: true, default: 'Yes',
        },
        {
          id: 'structureFindings', label: 'Anything found on the structure', type: 'textarea',
          aiFillable: true,
        },
      ],
    },
    {
      id: 'recommendations', number: 5, title: 'Recommendations & Next Visit',
      subtitle: 'What the client should do, and when you are next due.',
      icon: '📝', color: '#166534',
      fields: [
        {
          id: 'clientActions', label: 'Client actions required', type: 'multiselect', aiFillable: true,
          options: ['No action needed', 'Keep stations clear of mulch and debris',
            'Do not disturb or move stations', 'Repair identified moisture problem',
            'Remove timber in contact with soil', 'Trim vegetation clear of the building',
            'Arrange full inspection — activity found'],
        },
        {
          id: 'warrantyStatus', label: 'Warranty status', type: 'select', required: true,
          options: ['Current — maintained by this service', 'At risk — client actions outstanding',
            'Lapsed — monitoring overdue'],
          default: 'Current — maintained by this service',
        },
        // v9, AS 3660.2 cl 5.2.2 and 5.5.1.3.3: baits and lures SHALL be
        // inspected at intervals not exceeding three months; monthly is
        // recommended while termites are feeding.
        {
          id: 'monitoringInterval', since: 10, label: 'Station inspection interval (AS 3660.2: no more than 3 months; monthly while feeding)',
          type: 'select', required: true,
          options: ['Monthly — termites feeding', 'Every 6 weeks', 'Every 2 months', 'Every 3 months (the maximum)'],
          default: 'Every 3 months (the maximum)',
        },
        { id: 'nextServiceDue', label: 'Next monitoring visit due', type: 'date', required: true, future: true },
        { id: 'serviceNotes', label: 'Notes', type: 'textarea', aiFillable: true },
      ],
    },
    {
      id: 'terms', number: 6, title: 'Terms & Conditions',
      subtitle: 'Terms applying to this monitoring visit.', icon: '📖', color: '#475569', fixed: true, fields: [],
    },
    inspectorSection(7),
    {
      id: 'acknowledgement', number: 8, title: 'Client Acknowledgement',
      subtitle: 'Signed on site where the client is present.',
      icon: '✅', color: '#166534',
      fields: [
        { id: 'clientAckName', label: 'Client Name', type: 'text' },
        { id: 'clientSignature', label: 'Signature', type: 'signature' },
        { id: 'clientAckDate', label: 'Date', type: 'date' },
      ],
    },
  ];

  window.TERMITE_ACTION_PLAN_SCHEMA = TERMITE_ACTION_PLAN_SCHEMA;
  window.TERMITE_CERTIFICATE_SCHEMA = TERMITE_CERTIFICATE_SCHEMA;
  window.TERMITE_MONITORING_SCHEMA = TERMITE_MONITORING_SCHEMA;
  // Old name kept pointing at the same schema: a report stamped
  // 'termite_service_record' resolves to the monitoring type now, and this
  // stops anything else that reached for the old global getting undefined.
  window.TERMITE_SERVICE_RECORD_SCHEMA = TERMITE_MONITORING_SCHEMA;
})();
