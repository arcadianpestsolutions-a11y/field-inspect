// Safe Work Method Statement — the document a builder, strata manager or
// facilities company asks for before they will let you on site, and the one
// you want to have filled in honestly the day something goes wrong.
//
// WHAT THE LAW ACTUALLY REQUIRES
// A SWMS is mandatory for high risk construction work under the WHS
// Regulation 2017 (NSW) reg 291-300. Routine pest control in an occupied
// house is not a construction project, so strictly the mandate often does not
// bite. Three things make it matter anyway:
//
//   1. Entering a subfloor can meet the definition of a CONFINED SPACE
//      (reg 5), which carries its own duties — a risk assessment, atmospheric
//      testing, a standby person — regardless of whether anyone calls the job
//      construction.
//   2. Roof void access is work at height. Above two metres it is high risk
//      construction work in its own right.
//   3. Commercial clients require one contractually. No SWMS, no site access,
//      no invoice.
//
// Reg 299 says a SWMS must state the work, the hazards, the control measures,
// and how those controls are implemented, monitored and reviewed. The
// sections below are arranged in that order so the document reads as the
// regulation expects, rather than as a checklist that happens to cover it.
//
// WHY THE HAZARDS ARE SPECIFIC
// A generic safety template is worth nothing on site, because nobody reads
// the fifteenth copy of "ensure adequate lighting". Everything here is a
// thing that actually happens under a Macarthur house: bare wiring stapled to
// a bearer, a redback in the access hatch, fifty degrees in a roof void in
// February, asbestos sheeting in a pre-1990 subfloor. Where a control is a
// number, the number is here — a ladder at 1:4, a hatch you can get back out
// of, thirteen-eleven-twenty-six for poisons.
//
// Gated sections keep it short. A spray-only job never sees the subfloor or
// roof-void pages, which is the difference between a document that is filled
// in properly and one that is clicked through.

const SWMS_YES_NO = ['Yes', 'No'];
const SWMS_RISK = ['Low', 'Medium', 'High'];

const SWMS_SCHEMA = [
  {
    id: 'swmsDetails',
    number: 1,
    title: 'Job and Site',
    subtitle: 'Who is doing the work, where, and for whom. A SWMS with no site on it protects nobody.',
    icon: '📄',
    color: '#1f7a4d',
    fields: [
      { id: 'providerName', label: 'Business', type: 'static', orgField: 'providerName' },
      { id: 'providerAbn', label: 'ABN', type: 'static', orgField: 'providerAbn' },
      { id: 'providerLicence', label: 'Pest Management Licence', type: 'static', orgField: 'providerLicence' },
      { id: 'siteAddress', label: 'Site Address', type: 'text', required: true },
      { id: 'workDate', label: 'Date of Work', type: 'date', required: true },
      { id: 'workDescription', label: 'Work Being Carried Out', type: 'textarea', required: true },
      // Only relevant on commercial and strata work, but it is the field the
      // principal contractor looks for first, so it sits near the top.
      { id: 'principalContractor', label: 'Principal Contractor / Site Contact', type: 'text' },
      { id: 'sitePhone', label: 'Site Contact Phone', type: 'text' },
      { id: 'inductionRequired', label: 'Site induction required before starting?', type: 'yesno' },
    ],
  },

  {
    id: 'swmsActivities',
    number: 2,
    title: 'What This Job Involves',
    subtitle: 'Answer these first. They decide which hazard pages you get — a spray-only job should not have to read the subfloor page.',
    icon: '🔀',
    color: '#0f9e8e',
    fields: [
      { id: 'entersSubfloor', label: 'Entering a subfloor or crawl space?', type: 'yesno', required: true },
      { id: 'entersRoofVoid', label: 'Entering a roof void, or working off a ladder?', type: 'yesno', required: true },
      { id: 'appliesChemical', label: 'Applying a pesticide or termiticide?', type: 'yesno', required: true },
      { id: 'drillsOrTrenches', label: 'Drilling concrete, or trenching around the building?', type: 'yesno', required: true },
      {
        id: 'preNinetyBuilding',
        label: 'Building built before 1990 (possible asbestos)?',
        type: 'select',
        options: ['Yes', 'No', 'Unknown — treat as if it is'],
        required: true,
      },
    ],
  },

  {
    id: 'swmsPreStart',
    number: 3,
    title: 'Before Starting',
    subtitle: 'Done on site, before anything is opened or sprayed. This is the part that prevents most of what goes wrong.',
    icon: '🚦',
    color: '#b45309',
    fields: [
      {
        id: 'preStartChecks',
        label: 'Completed before starting',
        type: 'multiselect',
        options: [
          'Walked the site and identified access points',
          'Located the switchboard and water shut-off',
          'Confirmed a clear exit path from every area to be entered',
          'Told the occupants what is happening and how long it will take',
          'Dogs secured and confirmed secured by the occupant',
          'Children, elderly or unwell occupants accounted for',
          'Checked for beehives, wasp nests and snakes around access points',
          'Vehicle parked clear of the driveway and not blocking access',
        ],
        required: true,
      },
      {
        id: 'occupantsOnSite',
        label: 'Anyone on site who needs special consideration',
        type: 'multiselect',
        options: [
          'Nobody home',
          'Young children',
          'Elderly or mobility-limited',
          'Pregnant occupant',
          'Asthmatic or chemically sensitive occupant',
          'Pets indoors',
          'Fish tank or bird aviary',
          'Food preparation business',
        ],
      },
      // The one that matters most when it is true. A technician in a subfloor
      // with nobody expecting them back is the scenario behind most of the
      // serious outcomes in this trade.
      { id: 'loneWorker', label: 'Working alone on this job?', type: 'yesno', required: true },
      {
        id: 'checkInArrangement',
        label: 'Check-in arrangement',
        type: 'text',
        placeholder: 'Who is expecting you, and by when',
        showIf: { field: 'loneWorker', equals: 'Yes' },
        required: true,
      },
      { id: 'preStartPhotos', label: 'Site condition photos', type: 'photos' },
    ],
  },

  {
    id: 'swmsSubfloor',
    number: 4,
    title: 'Subfloor Entry',
    subtitle: 'A subfloor with a restricted opening and no cross-flow ventilation may be a confined space under WHS Regulation 2017 (NSW) reg 5. If it is, the duties are different and stricter.',
    icon: '🕳️',
    color: '#7c2d12',
    showIf: { section: 'swmsActivities', field: 'entersSubfloor', equals: 'Yes' },
    fields: [
      {
        id: 'confinedSpaceCheck',
        label: 'Is this subfloor a confined space (restricted entry/exit, not designed for occupancy, risk of an unsafe atmosphere)?',
        type: 'select',
        options: [
          'No — open perimeter, cross-flow ventilation, easy exit',
          'Yes — entry refused, work done from outside the space',
          'Yes — entered under a confined space permit with a standby person',
        ],
        required: true,
      },
      {
        id: 'subfloorHazards',
        label: 'Hazards present',
        type: 'multiselect',
        options: [
          'Damaged or exposed electrical wiring',
          'Standing water or saturated ground',
          'Sewer or stormwater leak',
          'Low clearance — belly crawl only',
          'Rubble, star pickets or broken glass',
          'Redback or funnel-web habitat',
          'Rodent or possum droppings',
          'Discarded syringes',
          'Suspected asbestos sheeting or pipe lagging',
          'No natural light',
          'Single access point',
        ],
        aiFillable: true,
      },
      {
        id: 'subfloorControls',
        label: 'Controls in place',
        type: 'multiselect',
        options: [
          'Head torch plus a second light source carried',
          'Coveralls, knee pads, gloves and safety glasses',
          'P2 respirator worn',
          'Power isolated at the switchboard before entry',
          'Someone above ground knows entry and expected exit time',
          'Exit path kept clear and unobstructed at all times',
          'Did not enter — inspected from the access hatch only',
          'Ground sheet used over wet or contaminated ground',
        ],
        required: true,
      },
      { id: 'subfloorResidualRisk', label: 'Risk after controls', type: 'select', options: SWMS_RISK, required: true },
      { id: 'subfloorNotes', label: 'Anything else', type: 'textarea' },
      { id: 'subfloorPhotos', label: 'Subfloor hazard photos', type: 'photos' },
    ],
  },

  {
    id: 'swmsHeight',
    number: 5,
    title: 'Roof Void and Ladders',
    subtitle: 'Above two metres this is high risk construction work in its own right. A roof void in summer is also a heat hazard well before it is a fall hazard.',
    icon: '🪜',
    color: '#a16207',
    showIf: { section: 'swmsActivities', field: 'entersRoofVoid', equals: 'Yes' },
    fields: [
      {
        id: 'ladderChecks',
        label: 'Ladder set up correctly',
        type: 'multiselect',
        options: [
          'Industrial rated, inspected, no damage',
          'Set at 1:4 — one out for every four up',
          'Extends one metre above the landing point',
          'Footed on firm level ground, not on tiles or wet grass',
          'Secured at the top, or footed by a second person',
          'Three points of contact maintained',
          'Nothing carried up by hand — tools raised separately',
        ],
        required: true,
      },
      {
        id: 'roofVoidHazards',
        label: 'Roof void hazards',
        type: 'multiselect',
        options: [
          'Heat — void above 40°C',
          'Unbattened ceiling, plasterboard only between joists',
          'Live wiring and downlight transformers',
          'Loose or blown insulation, fibreglass or cellulose',
          'Rodent or possum contamination',
          'Bees or wasps in the void',
          'Limited headroom',
          'Suspected asbestos — old flue, lagging or sheeting',
        ],
        aiFillable: true,
      },
      {
        id: 'heightControls',
        label: 'Controls in place',
        type: 'multiselect',
        options: [
          'Weight taken on joists or battens only, never on plasterboard',
          'Crawl board used across the void',
          'Time in the void limited, water taken up',
          'Void entry deferred to early morning because of heat',
          'P2 respirator and eye protection worn',
          'Head torch used, no work in the dark',
          'Did not enter — inspected from the manhole only',
        ],
        required: true,
      },
      { id: 'heightResidualRisk', label: 'Risk after controls', type: 'select', options: SWMS_RISK, required: true },
      { id: 'heightNotes', label: 'Anything else', type: 'textarea' },
    ],
  },

  {
    id: 'swmsChemicals',
    number: 6,
    title: 'Chemicals',
    subtitle: 'Label directions are the law, not a suggestion — using a registered product off-label is an offence under the Pesticides Act 1999 (NSW).',
    icon: '🧪',
    color: '#166534',
    showIf: { section: 'swmsActivities', field: 'appliesChemical', equals: 'Yes' },
    fields: [
      { id: 'sdsOnHand', label: 'Safety Data Sheet on hand for every product being used?', type: 'yesno', required: true },
      {
        id: 'chemicalPpe',
        label: 'PPE worn, as required by the label',
        type: 'multiselect',
        options: [
          'Chemical-resistant gloves',
          'Safety glasses or face shield',
          'Coveralls',
          'Respirator with the cartridge the label specifies',
          'Rubber boots',
        ],
        required: true,
      },
      {
        id: 'chemicalControls',
        label: 'Controls in place',
        type: 'multiselect',
        options: [
          'Mixed outdoors, away from drains and stormwater',
          'Measured — never estimated by eye',
          'Occupants and pets out of treated areas during application',
          'Food, utensils and pet bowls covered or removed',
          'Fish tanks covered and air pumps switched off',
          'Ventilation opened after application',
          'Spill kit in the vehicle',
          'Empty containers triple-rinsed and retained',
          'Clean water carried for eye and skin flushing',
        ],
        required: true,
      },
      { id: 'reEntryPeriod', label: 'Re-entry period told to the occupant', type: 'text', placeholder: 'e.g. keep off treated surfaces until dry, about 2 hours' },
      {
        id: 'weatherSuitable',
        label: 'Weather suitable for application (no wind drift, no rain expected before it binds)?',
        type: 'yesno',
        required: true,
      },
      { id: 'chemicalResidualRisk', label: 'Risk after controls', type: 'select', options: SWMS_RISK, required: true },
    ],
  },

  {
    id: 'swmsDrilling',
    number: 7,
    title: 'Drilling and Trenching',
    subtitle: 'Cutting or drilling concrete generates respirable crystalline silica, which has its own exposure standard and its own long tail.',
    icon: '🛠️',
    color: '#b91c1c',
    showIf: { section: 'swmsActivities', field: 'drillsOrTrenches', equals: 'Yes' },
    fields: [
      {
        id: 'servicesLocated',
        label: 'Underground and in-slab services located before breaking ground?',
        type: 'select',
        options: [
          'Yes — plans checked and cable locator used',
          'Yes — Before You Dig enquiry lodged',
          'No services expected in the work area',
          'Not located — work deferred',
        ],
        required: true,
      },
      {
        id: 'drillingControls',
        label: 'Controls in place',
        type: 'multiselect',
        options: [
          'Water suppression or on-tool dust extraction used',
          'P2 respirator worn for all cutting and drilling',
          'Hearing protection worn',
          'Eye protection worn',
          'Exclusion zone kept around the work',
          'Trench kept shallow and backfilled the same day',
          'Slurry contained, not washed into stormwater',
        ],
        required: true,
      },
      { id: 'drillingResidualRisk', label: 'Risk after controls', type: 'select', options: SWMS_RISK, required: true },
    ],
  },

  {
    id: 'swmsAsbestos',
    number: 8,
    title: 'Asbestos',
    subtitle: 'In a pre-1990 building, assume it is there until proven otherwise. Nothing in pest control is worth disturbing it for.',
    icon: '☣️',
    color: '#6b21a8',
    showIf: { section: 'swmsActivities', field: 'preNinetyBuilding', notEquals: 'No' },
    fields: [
      {
        id: 'asbestosSeen',
        label: 'Material that may contain asbestos seen on site?',
        type: 'select',
        options: [
          'None seen',
          'Seen — in good condition, not disturbed',
          'Seen — damaged or friable, work stopped',
        ],
        required: true,
        aiFillable: true,
      },
      { id: 'asbestosWhere', label: 'Where', type: 'text', showIf: { field: 'asbestosSeen', notEquals: 'None seen' } },
      {
        id: 'asbestosControls',
        label: 'Controls in place',
        type: 'multiselect',
        options: [
          'Nothing drilled, cut or broken in the suspect area',
          'Treated as asbestos without testing',
          'Client informed in writing',
          'Work in that area stopped and quoted separately',
          'P2 respirator worn while in the area',
        ],
        showIf: { field: 'asbestosSeen', notEquals: 'None seen' },
      },
      { id: 'asbestosPhotos', label: 'Photos', type: 'photos', showIf: { field: 'asbestosSeen', notEquals: 'None seen' } },
    ],
  },

  {
    id: 'swmsEmergency',
    number: 9,
    title: 'Emergency',
    subtitle: 'Filled in before it is needed, because nobody looks up a hospital while carrying somebody to the ute.',
    icon: '🚑',
    color: '#be123c',
    fields: [
      {
        id: 'poisonsInfo',
        label: 'Poisons Information Centre',
        type: 'static',
        default: '13 11 26 — 24 hours, anywhere in Australia',
      },
      { id: 'emergencyNumber', label: 'Emergency services', type: 'static', default: '000' },
      { id: 'nearestHospital', label: 'Nearest hospital', type: 'text', placeholder: 'e.g. Campbelltown Hospital, Therry Rd' },
      { id: 'firstAidLocation', label: 'First aid kit location', type: 'text', placeholder: 'e.g. behind the driver seat' },
      { id: 'emergencyContactName', label: 'Emergency contact', type: 'text' },
      { id: 'emergencyContactPhone', label: 'Emergency contact phone', type: 'text' },
      {
        id: 'incidentProcedure',
        label: 'If something goes wrong',
        type: 'static',
        default: 'Make the area safe, get help, then record it in Scope the same day. '
          + 'A notifiable incident must be reported to SafeWork NSW on 13 10 50 immediately, '
          + 'and the site must not be disturbed until they say so.',
      },
    ],
  },

  {
    id: 'swmsSignoff',
    number: 10,
    title: 'Review and Sign-off',
    subtitle: 'A SWMS has to be prepared in consultation with the workers doing the job, and reviewed when the work or the site changes.',
    icon: '✅',
    color: '#0f766e',
    fields: [
      {
        id: 'consultationDone',
        label: 'Prepared in consultation with the workers carrying out this work?',
        type: 'yesno',
        required: true,
      },
      {
        id: 'monitoringMethod',
        label: 'How these controls are monitored',
        type: 'textarea',
        default: 'Checked at the start of the job and again whenever conditions change. '
          + 'Work stops and this statement is reviewed if a hazard is found that is not listed here.',
        required: true,
      },
      { id: 'technicianName', label: 'Technician name', type: 'text', orgField: 'inspectorName', required: true },
      { id: 'technicianLicence', label: 'Licence number', type: 'text', orgField: 'inspectorLicence' },
      { id: 'technicianSignature', label: 'Technician signature', type: 'signature', required: true },
      { id: 'signedDate', label: 'Date', type: 'date', required: true },
      // Only a builder or facilities manager ever signs this. It is optional
      // so a domestic job is not blocked waiting for a signature nobody is
      // there to give.
      { id: 'siteContactName', label: 'Site contact / principal contractor name', type: 'text' },
      { id: 'siteContactSignature', label: 'Site contact signature', type: 'signature' },
      { id: 'reviewDate', label: 'Review due', type: 'date' },
    ],
  },
];

window.SWMS_SCHEMA = SWMS_SCHEMA;
