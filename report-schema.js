// Report schema — single source of truth for the digital Termite Inspection
// Report, modelled on an AS 3660.2-2017 report template.
//
// Each section has: id, number, title, icon, color, fields[]
// Each field has: id, label, type, options?, showIf?, required?, aiFillable?, default?
//
// Field types: text | textarea | select | yesno | multiselect | date | time |
//              photos | signature | static | productList (repeatable
//              structured records — see pest-treatment-schema.js's
//              "chemicals" section; rendered/validated generically by
//              report.js just like every other type here)
//
// `showIf: { field: 'otherFieldId', equals: 'Yes' }` — field only renders/counts
// once the condition is met (mirrors the conditional layout in the source PDFs).
// `required: true` — field must have a value for the section to show a green tick.
// `aiFillable: true` — this is a field the AI Draft step is expected to populate
// from photos/narration; everything else is human-only (signatures,
// licence numbers, fixed business info).

const YES_NO = ['Yes', 'No'];

const REPORT_SCHEMA = [
  {
    id: 'summary',
    number: 1,
    title: 'Inspection Summary',
    subtitle: 'Auto-generated from your answers below — read together with the full report.',
    icon: '📋',
    color: '#0f9e8e',
    computed: true,
    fields: [],
  },
  {
    id: 'clientDetails',
    number: 2,
    title: 'Client Details',
    subtitle: 'The Client is the person or entity for whom the inspection is being undertaken.',
    icon: '👤',
    color: '#1f7a4d',
    fields: [
      // A catch-all bucket for anything photographed that doesn't map to a
      // specific checklist item — obstructions, general evidence, whatever
      // else normally has a photo in an inspection report. AI sorts these
      // into the right section/field automatically when the report is
      // generated (sortGeneralPhotos in report.js); the technician never has
      // to know in advance which field a given photo belongs in.
      {
        id: 'generalPhotos',
        label: 'General Site Photos (obstructions, evidence — AI sorts these into the right sections)',
        type: 'photos',
        autoSorts: true,
      },
      { id: 'clientName', label: 'Client Name', type: 'text', required: true },
      { id: 'clientAddress', label: 'Client Address', type: 'text' },
      { id: 'clientPhone', label: 'Client Phone', type: 'text' },
      { id: 'clientEmail', label: 'Client Email', type: 'text' },
      { id: 'propertyAddress', label: 'Property Inspected Address', type: 'text', required: true },
      { id: 'inspectionDate', label: 'Inspection Date', type: 'date', required: true },
      { id: 'inspectionTime', label: 'Inspection Time', type: 'time' },
      { id: 'weather', label: 'Weather Conditions at time of inspection', type: 'text', aiFillable: true },
      {
        id: 'inspectionClassification',
        label: 'Inspection Classification (AS 3660.2-2017)',
        type: 'select',
        required: true,
        options: [
          'Pre-purchase / one-off inspection',
          'Regular inspection (recommended at least every 12 months)',
          'Special inspection (elevated risk — up to every 6 months)',
        ],
        default: 'Regular inspection (recommended at least every 12 months)',
      },
    ],
  },
  {
    id: 'agreement',
    number: 3,
    title: 'About Our Agreement',
    subtitle: 'Purpose, scope and limitations — agreed with the client BEFORE the inspection begins.',
    icon: 'ℹ️',
    color: '#1f7a4d',
    softRequired: true,
    fields: [
      {
        id: 'inspectionType', label: 'Inspection Type Requested', type: 'static',
        default: 'Standard Timber Pest Inspection in accordance with AS 4349.3-2010',
      },
      { id: 'providerName', label: 'Inspection Provider', type: 'static', orgField: 'providerName' },
      { id: 'providerAddress', label: 'Address', type: 'static', orgField: 'providerAddress' },
      { id: 'providerPhone', label: 'Phone', type: 'static', orgField: 'providerPhone' },
      { id: 'providerEmail', label: 'Email', type: 'static', orgField: 'providerEmail' },
      // The pre-engagement agreement is the strongest document available when
      // a claim is made, because it fixes scope and access limitations BEFORE
      // the inspection rather than describing them afterwards. AS 3660.2 lists
      // it first in its documentation set; the app previously had no equivalent
      // and captured the client's acknowledgement only at the end of the job.
      { id: 'agreementAcceptedBy', label: 'Agreement accepted by (client name)', type: 'text', required: true },
      { id: 'agreementAcceptedAt', label: 'Date agreed', type: 'date', required: true },
      {
        id: 'agreedAccessLimitations',
        label: 'Access limitations agreed before the inspection (areas the client knows cannot be accessed)',
        type: 'textarea',
      },
      { id: 'agreementSignature', label: 'Client signature — agreement to scope and limitations', type: 'signature', required: true },
    ],
  },
  {
    id: 'property',
    number: 4,
    title: 'About the Property Inspected',
    subtitle: 'Primary details describing and identifying the Property that is to be inspected.',
    icon: '🏠',
    color: '#1c8fc4',
    fields: [
      { id: 'propertyPhotos', label: 'Property Photo', type: 'photos', aiFillable: true },
      {
        id: 'facade', label: 'The front facade of the dwelling faces', type: 'select', aiFillable: true,
        options: ['Approximately North', 'Approximately North East', 'Approximately East', 'Approximately South East',
          'Approximately South', 'Approximately South West', 'Approximately West', 'Approximately North West'],
      },
      {
        id: 'topography', label: 'Site Topography', type: 'select', aiFillable: true,
        options: ['Falls to the North', 'Falls to the South', 'Falls to the East', 'Falls to the West', 'Relatively Flat'],
      },
      {
        id: 'structureType', label: 'Type of Structure', type: 'select', required: true, aiFillable: true,
        options: ['Detached house', 'Semi-detached house', 'Townhouse', 'Unit/Apartment', 'Duplex', 'Commercial premises'],
        default: 'Detached house',
      },
      {
        id: 'structureHeight', label: 'Height of Structure', type: 'select', aiFillable: true,
        options: ['Single Storey', 'Double Storey', 'Triple Storey or more'],
        default: 'Single Storey',
      },
      {
        id: 'wallConstruction', label: 'Wall Construction', type: 'select', required: true, aiFillable: true,
        options: ['Brick Veneer', 'Full Brick', 'Weatherboard', 'Fibro/Asbestos Cement', 'Concrete/Block', 'Mixed/Other'],
        default: 'Brick Veneer',
      },
      {
        id: 'floorType', label: 'Floor Type', type: 'select', required: true, aiFillable: true,
        options: ['Timber Floor', 'Concrete Slab', 'Suspended Concrete', 'Mixed Timber/Concrete'],
        default: 'Concrete Slab',
      },
      {
        id: 'roofConstruction', label: 'Roof Frame / Covering', type: 'select', aiFillable: true,
        options: ['Timber Truss — Cement Tile', 'Timber Truss — Terracotta Tile', 'Timber Truss — Metal/Colorbond',
          'Steel Truss — Metal/Colorbond', 'Timber Frame — Tile', 'Other/Mixed'],
        default: 'Timber Truss — Cement Tile',
      },
      {
        id: 'furnishingStatus', label: 'Property Furnishing Status', type: 'select', aiFillable: true,
        options: ['At the time of the inspection the property was fully furnished',
          'At the time of the inspection the property was partly furnished',
          'At the time of the inspection the property was unfurnished'],
        default: 'At the time of the inspection the property was fully furnished',
      },
      {
        id: 'occupancyStatus', label: 'Property Occupancy Status', type: 'select', aiFillable: true,
        options: ['At the time of inspection the property was occupied', 'At the time of inspection the property was vacant'],
        default: 'At the time of inspection the property was occupied',
      },
    ],
  },
  {
    id: 'siteSketch',
    number: 5,
    title: 'Site Sketch (Mud Map)',
    subtitle: 'A simple hand-drawn plan of the property — sketch the outline as you walk and drop labels for rooms, moisture readings, damage, or anything worth marking on the map.',
    icon: '🗺️',
    color: '#0d9488',
    fields: [
      { id: 'sketchImage', label: 'Site Sketch', type: 'sketch' },
      // Invisible companion to sketchImage: the markers as data, so a
      // later edit restores real markers instead of a flat picture. Renders
      // nothing, prints nothing — sketchImage is still what the PDF shows.
      { id: 'sketchData', label: 'Sketch marker data', type: 'sketchData' },
    ],
  },
  {
    id: 'access',
    number: 6,
    title: 'Areas We Were Unable to Inspect',
    subtitle: 'Details outlining the limitations and hindrances related to the Inspection, and why.',
    icon: '⊘',
    color: '#2662c9',
    fields: [
      { id: 'accessPhotos', label: 'Photos of Areas Inspected / Obstructions', type: 'photos', triggersAiFill: true },
      { id: 'hinderedObstructions', label: 'Were there any obstructions that may conceal possible termite attack?', type: 'yesno', required: true, aiFillable: true },
      { id: 'hinderedAreas', label: 'Hindered Areas', type: 'multiselect', options: ['The Interior', 'The Exterior', 'Subfloor', 'Roof Void'], showIf: { field: 'hinderedObstructions', equals: 'Yes' }, aiFillable: true },
      { id: 'interiorObstructions', label: 'Interior Obstructions', type: 'multiselect', options: ['Furniture', 'Flooring', 'Fixtures', 'Items/belongings stored against wall', 'Items/belongings stored in cupboards'], showIf: { field: 'hinderedObstructions', equals: 'Yes' }, aiFillable: true },
      { id: 'exteriorObstructions', label: 'Exterior Obstructions', type: 'multiselect', options: ['Stored Articles', 'Dense Vegetation', 'Paving/Decking'], showIf: { field: 'hinderedObstructions', equals: 'Yes' }, aiFillable: true },
      { id: 'subfloorObstructions', label: 'Subfloor Obstructions', type: 'multiselect', options: ['Low Clearance', 'Stored Articles', 'Plumbing'], showIf: { field: 'hinderedObstructions', equals: 'Yes' }, aiFillable: true },
      { id: 'roofVoidObstructions', label: 'Roof Void Obstructions', type: 'multiselect', options: ['Insulation', 'Sarking', 'Low Clearance'], showIf: { field: 'hinderedObstructions', equals: 'Yes' }, aiFillable: true },
      { id: 'obstructionPhotos', label: 'Obstruction Photos', type: 'photos', showIf: { field: 'hinderedObstructions', equals: 'Yes' }, aiFillable: true },
      { id: 'restrictedAccess', label: 'Were there any normally accessible areas that had restricted access?', type: 'yesno', required: true, aiFillable: true },
      { id: 'restrictedAccessDetails', label: 'Restricted Access Details', type: 'textarea', showIf: { field: 'restrictedAccess', equals: 'Yes' }, aiFillable: true },
      { id: 'highRiskAreas', label: 'Were there any High Risk Area(s) to which access should be gained or fully gained?', type: 'yesno', required: true, aiFillable: true },
      { id: 'invasiveRecommended', label: 'Is an Invasive Inspection recommended to this property?', type: 'yesno', required: true, aiFillable: true },
      { id: 'invasiveComments', label: 'Invasive Inspection Comments', type: 'textarea', showIf: { field: 'invasiveRecommended', equals: 'Yes' }, aiFillable: true },
    ],
  },
  {
    id: 'findings',
    number: 7,
    title: 'Findings & Observations',
    subtitle: 'Report on the location and details of termite activity detected at the time of the Inspection.',
    icon: '🔍',
    color: '#154a8a',
    fields: [
      { id: 'findingsPhotos', label: 'Findings Photos', type: 'photos', triggersAiFill: true },
      { id: 'liveTermitesFound', label: 'Were live termites found at the time of the inspection?', type: 'yesno', required: true, aiFillable: true, confirmBeforeUse: true },
      { id: 'termiteSpecies', label: 'Termite species (genus/species), if determinable', type: 'text', showIf: { field: 'liveTermitesFound', equals: 'Yes' }, aiFillable: true },
      { id: 'riskOfAssociatedDamage', label: 'Potential for associated damage arising from this activity', type: 'select', options: ['Low', 'Moderate', 'High'], showIf: { field: 'liveTermitesFound', equals: 'Yes' }, aiFillable: true },
      { id: 'nestFound', label: 'Was a termite nest found at the time of Inspection?', type: 'yesno', required: true, aiFillable: true, confirmBeforeUse: true },
      { id: 'nestLocation', label: 'Nest Location(s)', type: 'textarea', showIf: { field: 'nestFound', equals: 'Yes' }, aiFillable: true },
      { id: 'nestPhotos', label: 'Nest Photos', type: 'photos', showIf: { field: 'nestFound', equals: 'Yes' }, aiFillable: true },
      { id: 'workingsFound', label: 'Was evidence of termite workings or damage found?', type: 'yesno', required: true, aiFillable: true, confirmBeforeUse: true },
      { id: 'workingsAreas', label: 'Areas where workings/damage were found', type: 'multiselect', options: ['The Exterior', 'The Interior', 'The Site', 'Landscaping Timbers', 'Trees', 'Subfloor', 'Roof Void'], showIf: { field: 'workingsFound', equals: 'Yes' }, aiFillable: true },
      { id: 'evidenceDetails', label: 'Details of the nature of the evidence found', type: 'textarea', showIf: { field: 'workingsFound', equals: 'Yes' }, aiFillable: true },
      { id: 'damagePhotos', label: 'Damage Photos', type: 'photos', showIf: { field: 'workingsFound', equals: 'Yes' }, aiFillable: true },
      { id: 'damageSeverity', label: 'Damage appears to be', type: 'select', options: ['Minor', 'Minor to Moderate', 'Moderate', 'Moderate to Extensive', 'Extensive'], showIf: { field: 'workingsFound', equals: 'Yes' }, aiFillable: true },
      { id: 'findingsAdditionalComments', label: 'Additional Comments', type: 'textarea', showIf: { field: 'workingsFound', equals: 'Yes' }, aiFillable: true },
      { id: 'treatmentRecommended', label: 'Is a termite treatment recommended?', type: 'yesno', required: true, aiFillable: true, confirmBeforeUse: true },
      { id: 'treatmentComments', label: 'Treatment Comments', type: 'textarea', showIf: { field: 'treatmentRecommended', equals: 'Yes' }, aiFillable: true },
      { id: 'priorTreatmentEvidence', label: 'Was evidence of a previous treatment located?', type: 'yesno', required: true, aiFillable: true, confirmBeforeUse: true },
      { id: 'existingManagementSystem', label: 'Existing termite management system present, type & condition', type: 'textarea', aiFillable: true },
      // The gate for the action-plan half of this report. Answering "adequate"
      // ends the document here; any other answer opens the proposed-works and
      // warranty sections below, because a system that is absent, inadequate
      // or failed is a recommendation waiting to be written down.
      //
      // Deliberately a separate question from existingManagementSystem above.
      // That field describes what is there; this one is the professional
      // judgement about it, and judgement is what the rest of the document
      // hangs off.
      {
        id: 'managementSystemStatus',
        label: 'Is the existing termite management system adequate for this property?',
        type: 'select', required: true, aiFillable: true, confirmBeforeUse: true,
        options: [
          'Adequate — no further works proposed',
          'None present — management plan proposed',
          'Present but inadequate — management plan proposed',
          'Present but failed or compromised — management plan proposed',
        ],
      },
      { id: 'durableNoticeFound', label: 'Was a durable Notice found at the time of this inspection?', type: 'yesno', required: true, aiFillable: true, confirmBeforeUse: true },
      // A durable notice or treatment sticker (commonly in the meter box or
      // subfloor) is evidence, not just a checkbox — the photo is what a
      // client or a later inspector actually needs to see.
      { id: 'durableNoticePhotos', label: 'Durable Notice Photos', type: 'photos', showIf: { field: 'durableNoticeFound', equals: 'Yes' }, aiFillable: true },
      // AS 4349.3-2010 covers FOUR timber pest categories: subterranean
      // termites, dampwood termites, borers of seasoned timber, and wood
      // decay fungi. Termites and fungal decay had proper fields; borers
      // were reachable only through the free-text note below, which meant a
      // borer inspection could be skipped entirely without the completion
      // gate ever showing the section as incomplete.
      { id: 'borersFound', label: 'Was evidence of borers of seasoned timber found?', type: 'yesno', required: true, aiFillable: true, confirmBeforeUse: true },
      {
        id: 'borerType', label: 'Borer type, if determinable', type: 'select',
        options: ['Lyctid (powderpost) borer', 'Anobium (furniture) borer', 'Queensland pine beetle',
          'Auger beetle', 'Other', 'Not determinable'],
        showIf: { field: 'borersFound', equals: 'Yes' }, aiFillable: true,
      },
      {
        id: 'borerActivity', label: 'Borer activity appears to be', type: 'select',
        options: ['Active', 'Inactive / old damage only', 'Not determinable'],
        showIf: { field: 'borersFound', equals: 'Yes' }, aiFillable: true,
      },
      {
        id: 'borerAreas', label: 'Areas where borer damage was found', type: 'multiselect',
        options: ['The Interior', 'The Exterior', 'Subfloor', 'Roof Void', 'Flooring', 'Joinery', 'Structural Timbers'],
        showIf: { field: 'borersFound', equals: 'Yes' }, aiFillable: true,
      },
      {
        id: 'borerDamageSeverity', label: 'Borer damage appears to be', type: 'select',
        options: ['Minor', 'Minor to Moderate', 'Moderate', 'Moderate to Extensive', 'Extensive'],
        showIf: { field: 'borersFound', equals: 'Yes' }, aiFillable: true,
      },
      { id: 'borerPhotos', label: 'Borer Damage Photos', type: 'photos', showIf: { field: 'borersFound', equals: 'Yes' }, aiFillable: true },
      { id: 'otherTimberPestsObserved', label: 'Evidence of other timber pests observed (e.g. drywood termites) — outside the scope of this Standard but noted as a duty to warn', type: 'textarea', aiFillable: true },
      { id: 'reinspectionInterval', label: 'A full inspection and written report should be conducted at this property every', type: 'select', options: ['3 months', '6 months', '12 months'], default: '12 months' },
      { id: 'susceptibility', label: 'In our opinion, the susceptibility of this property to termites is considered to be', type: 'select', required: true, options: ['LOW', 'MODERATE', 'HIGH'], aiFillable: true, confirmBeforeUse: true },
    ],
  },
  {
    id: 'conducive',
    number: 8,
    title: 'Conducive Conditions',
    subtitle: 'Conditions identified that are conducive to Termite activity.',
    icon: '⚠️',
    color: '#123a66',
    fields: [
      { id: 'conducivePhotos', label: 'Conducive Conditions Photos', type: 'photos', triggersAiFill: true },
      // identifiesTrees triggers the "🌳 Identify Tree" button in
      // renderPhotosField (report.js) — species + termite susceptibility per
      // tree, same pattern as pestPhotos' identifiesInsects. Results are
      // added to treeAssessmentNotes with one tap, not written automatically.
      { id: 'treePhotos', label: 'Trees Near the Property', type: 'photos', identifiesTrees: true },
      { id: 'treeAssessmentNotes', label: 'Tree Species & Termite Susceptibility', type: 'textarea', aiFillable: true },
      { id: 'waterLeaksFound', label: 'Were water leaks found at the time of inspection?', type: 'yesno', required: true, aiFillable: true },
      { id: 'waterTankPresent', label: 'Was a water tank(s) located at the time of inspection?', type: 'yesno', aiFillable: true },
      { id: 'tankDrainageWorkNeeded', label: 'Is there a need for work to rectify overflow drainage?', type: 'yesno', showIf: { field: 'waterTankPresent', equals: 'Yes' }, aiFillable: true },
      { id: 'highMoistureFound', label: 'Were high moisture readings found at the time of Inspection?', type: 'yesno', required: true, aiFillable: true },
      { id: 'moistureMeterType', label: 'Moisture meter used', type: 'text', default: '"TRAMEX" encounter moisture meter', showIf: { field: 'highMoistureFound', equals: 'Yes' } },
      { id: 'moistureDetails', label: 'Details & Recommendations', type: 'textarea', showIf: { field: 'highMoistureFound', equals: 'Yes' }, aiFillable: true },
      { id: 'fungalDecayFound', label: 'Was evidence of Fungal Decay found at the time of the inspection?', type: 'yesno', required: true, aiFillable: true },
      { id: 'siteDrainage', label: 'Site drainage appears to be generally', type: 'select', options: ['Adequate', 'Inadequate'], aiFillable: true, default: 'Adequate' },
      { id: 'subfloorDrainage', label: 'Subfloor drainage appears to be generally', type: 'select', options: ['Adequate', 'Inadequate', 'Not applicable'], aiFillable: true, default: 'Adequate' },
      { id: 'ventilation', label: 'At the time of inspection, ventilation appeared to be', type: 'select', options: ['Adequate', 'Inadequate'], aiFillable: true, default: 'Adequate' },
      { id: 'antCappingCondition', label: 'Termite shields (ant capping) appear to be', type: 'select', options: ['Adequate', 'Inadequate', 'Not present'], aiFillable: true, default: 'Adequate' },
      { id: 'antCappingDetails', label: 'Details & Recommendations', type: 'textarea', showIf: { field: 'antCappingCondition', equals: 'Inadequate' }, aiFillable: true },
      { id: 'weepHolesClear', label: 'Weep holes are clear and visible', type: 'yesno', aiFillable: true, default: 'Yes' },
    ],
  },
  // ---------- The action-plan half, shown only when it is needed ----------
  //
  // These two sections carry a section-level showIf, which names a field in
  // ANOTHER section (unlike a field's showIf, which names one of its own
  // siblings). When the technician answers that the existing management
  // system is adequate, they are not on screen at all.
  //
  // Hidden rather than merely optional, on purpose. An empty section sitting
  // in the list reads as work somebody forgot to do, and a timber pest
  // inspection on a property that needs nothing should end cleanly rather
  // than trail a blank proposal behind it.
  {
    id: 'proposedWorks',
    number: 9,
    title: 'Proposed Termite Management',
    subtitle: 'What you propose to do about what the inspection found.',
    icon: '🛠️',
    color: '#b45309',
    showIf: {
      section: 'findings',
      field: 'managementSystemStatus',
      oneOf: [
        'None present — management plan proposed',
        'Present but inadequate — management plan proposed',
        'Present but failed or compromised — management plan proposed',
      ],
    },
    fields: [
      // A different drawing from the Site Sketch in section 5. That one marks
      // what was FOUND; this one marks what is PROPOSED — the treated zone,
      // drill lines, where stations go. Sharing one sketch between the two
      // would mean either losing the findings or drawing the proposal on top
      // of them.
      { id: 'worksSketch', label: 'Proposed works — mark the treated zone, drill lines and station positions', type: 'sketch' },
      { id: 'worksSketchData', label: 'Proposed works marker data', type: 'sketchData' },
      {
        id: 'managementMethod', label: 'Management method proposed', type: 'multiselect', required: true, aiFillable: true,
        options: ['Chemical soil treated zone (AS 3660.2)', 'Reticulation system', 'Termite baiting system',
          'Physical barrier', 'Combination — see notes'],
      },
      {
        id: 'treatmentExtent', label: 'Extent of treatment', type: 'select', required: true, aiFillable: true,
        options: ['Complete perimeter', 'Partial — see limitations below', 'Localised / spot treatment only'],
      },
      {
        id: 'areasToTreat', label: 'Areas to be treated', type: 'multiselect', required: true, aiFillable: true,
        options: ['External perimeter', 'Internal perimeter', 'Subfloor', 'Slab penetrations', 'Garage',
          'Patio / paved areas', 'Landscaping timbers', 'Trees and stumps'],
      },
      { id: 'drillingRequired', label: 'Will drilling of hard surfaces be required?', type: 'yesno', required: true },
      {
        id: 'drillingDetail', label: 'What will be drilled, and how it will be made good',
        type: 'textarea', required: true, showIf: { field: 'drillingRequired', equals: 'Yes' },
      },
      { id: 'productsProposed', label: 'Products proposed', type: 'productList', required: true },
      {
        id: 'untreatableAreas', label: 'Areas that cannot be treated, and why',
        type: 'textarea', aiFillable: true,
      },
      {
        id: 'systemLimitations', label: 'Limitations of the proposed system (what it does not protect against)',
        type: 'textarea', required: true,
      },
      { id: 'estimatedDuration', label: 'Estimated time on site', type: 'text' },
      {
        id: 'occupantRequirements',
        label: 'What the occupants must do on the day (vacating, pets, fish tanks, covering food)',
        type: 'textarea', required: true,
      },
    ],
  },
  {
    id: 'worksWarranty',
    number: 10,
    title: 'Warranty & Ongoing Requirements',
    subtitle: 'What is guaranteed, for how long, and what the client must do to keep it.',
    icon: '📜',
    color: '#166534',
    showIf: {
      section: 'findings',
      field: 'managementSystemStatus',
      oneOf: [
        'None present — management plan proposed',
        'Present but inadequate — management plan proposed',
        'Present but failed or compromised — management plan proposed',
      ],
    },
    fields: [
      {
        id: 'warrantyPeriod', label: 'Warranty period offered', type: 'select', required: true,
        options: ['No warranty offered', '12 months', '2 years', '3 years', '5 years',
          'For the service life of the system, subject to annual inspection'],
      },
      {
        id: 'warrantyConditions', label: 'What the client must do to keep the warranty valid',
        type: 'multiselect', required: true,
        options: ['Annual inspection by a licensed technician', 'Do not disturb the treated zone',
          'Keep stations clear of mulch and debris', 'Repair identified moisture problems',
          'Remove timber in contact with soil', 'Notify us of any building works near the treated zone'],
      },
      {
        id: 'reinspectionAfterWorks', label: 'First inspection after the works is due', type: 'select',
        required: true, options: ['3 months', '6 months', '12 months'], default: '12 months',
      },
      { id: 'worksNotes', label: 'Anything else the client should know', type: 'textarea', aiFillable: true },
    ],
  },
  {
    id: 'terms',
    number: 11,
    title: 'Terms & Conditions',
    subtitle: 'Terms and condition details related to the Inspection undertaken and Report provided.',
    icon: '📖',
    color: '#3d3d8f',
    fixed: true,
    fields: [],
  },
  {
    id: 'inspector',
    number: 12,
    title: 'Inspector Details',
    subtitle: 'Contact details of the Inspection Provider and the Inspector that undertook the Inspection.',
    icon: '🧑‍🔧',
    color: '#6a3d9e',
    fields: [
      { id: 'inspectorName', label: 'Inspector Name', type: 'text', required: true },
      { id: 'inspectorAddress', label: 'Inspector Address', type: 'text' },
      { id: 'inspectorLicence', label: 'Inspector Licence', type: 'text', required: true },
      { id: 'inspectorPhone', label: 'Inspector Phone', type: 'text' },
      { id: 'signedOnBehalfOf', label: 'Signed on behalf of', type: 'static', orgField: 'signedOnBehalfOf' },
      { id: 'inspectorSignature', label: 'Inspector Signature', type: 'signature', required: true },
      { id: 'signatureDate', label: 'Date', type: 'date' },
    ],
  },
  {
    id: 'acknowledgement',
    number: 13,
    title: 'Client Acknowledgement',
    subtitle: 'Acknowledgement and acceptance of the Report to be completed by the Client.',
    icon: '✅',
    color: '#a12a72',
    softRequired: true,
    fields: [
      { id: 'clientAckName', label: 'Client Name', type: 'text' },
      { id: 'clientSignature', label: 'Signature', type: 'signature', required: true },
      { id: 'clientAckDate', label: 'Date', type: 'date' },
    ],
  },
];

function isFieldVisible(field, values) {
  if (!field.showIf) return true;
  return values[field.showIf.field] === field.showIf.equals;
}

// A section is 'green' once every required + currently-visible field has a
// value. Sections with no required fields (terms) are always green.
//
// `softRequired: true` marks a section that still shows yellow until it's
// complete, but does NOT block finalizing the report — used where the client
// has to sign and may not be on site (the pre-inspection agreement and the
// closing acknowledgement). That used to be a hardcoded check for the literal
// section id 'acknowledgement'; it's a schema flag now so a second such
// section doesn't need a second special case in the status logic.
// ---------- Field validation ----------
// Everything here exists because of a specific thing that reached a client's
// document. These are not hypothetical rules.
//
//   "Temperature (degrees Celcius): 222"  — printed on a service report in
//   August. Nothing rejected it, nobody caught it, the client received it.
//   Hence `range`.
//
//   "Quantity Of Concentrate Used" blank on every product row of every report
//   examined, while Total Mix Applied was filled. A diluted product with no
//   concentrate figure is an incomplete pesticide-use record. Hence
//   `requiredWhen` on repeatable rows.
//
//   "Action taken to eliminate any risk: Informed people/children to vacate"
//   with the risks-present list empty — an action against a risk that was
//   never recorded. Hence `requiresCompanion`.
//
// A rule that merely warns gets ignored at 4pm on a Friday. These block
// finalisation, and each one says what it wants and why.

function fieldValidationErrors(field, values) {
  const errors = [];
  if (!isFieldVisible(field, values)) return errors;
  const value = values[field.id];
  const blank = value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0);

  if (field.required && blank) {
    errors.push({ fieldId: field.id, label: field.label, kind: 'missing', message: `${field.label} is required.` });
    return errors; // no point range-checking something that isn't there
  }
  if (blank) return errors;

  if (field.range && (field.type === 'number' || field.type === 'text')) {
    const num = Number(String(value).replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(num)) {
      errors.push({ fieldId: field.id, label: field.label, kind: 'notNumber', message: `${field.label} should be a number.` });
    } else if (num < field.range.min || num > field.range.max) {
      errors.push({
        fieldId: field.id,
        label: field.label,
        kind: 'range',
        message: `${field.label} reads ${value}. Expected between ${field.range.min} and ${field.range.max}${field.range.unit ? ' ' + field.range.unit : ''}.`,
      });
    }
  }

  // "You recorded an action but not the thing it was for", and its mirror.
  if (field.requiresCompanion) {
    const companion = values[field.requiresCompanion.fieldId];
    const companionBlank = companion === undefined || companion === null || companion === ''
      || (Array.isArray(companion) && companion.length === 0);
    if (companionBlank) {
      errors.push({
        fieldId: field.requiresCompanion.fieldId,
        label: field.requiresCompanion.label || field.requiresCompanion.fieldId,
        kind: 'companion',
        message: field.requiresCompanion.message,
      });
    }
  }

  // Repeatable rows: a row that exists must be complete, or it is worse than
  // no row at all — it looks like a record and isn't one.
  if (field.type === 'productList' && Array.isArray(value)) {
    value.forEach((row, i) => {
      const position = `Product ${i + 1}${row.productName ? ` (${row.productName})` : ''}`;
      if (!row.productName) {
        errors.push({ fieldId: field.id, label: field.label, kind: 'rowIncomplete', message: `${position}: no product chosen.` });
        return;
      }
      const readyToUse = window.PestProducts && window.PestProducts.isReadyToUse(row.productName);
      if (!row.areaApplied || (Array.isArray(row.areaApplied) && !row.areaApplied.length)) {
        errors.push({ fieldId: field.id, label: field.label, kind: 'rowIncomplete', message: `${position}: no area recorded.` });
      }
      if (!readyToUse && !row.concentrateUsed) {
        errors.push({
          fieldId: field.id, label: field.label, kind: 'rowIncomplete',
          message: `${position}: concentrate used is blank. This is a diluted product, so the record needs it.`,
        });
      }
      if (!row.totalMixApplied) {
        errors.push({
          fieldId: field.id, label: field.label, kind: 'rowIncomplete',
          message: `${position}: ${readyToUse ? 'amount applied' : 'total mix applied'} is blank.`,
        });
      }
    });
  }

  return errors;
}

function sectionValidationErrors(section, values) {
  if (section.computed || section.fixed) return [];
  const errors = [];
  for (const field of section.fields || []) {
    errors.push(...fieldValidationErrors(field, values));
  }
  return errors;
}

// A section is green only when it has nothing outstanding — the same signal
// technicians already read, now covering bad values and not just blanks.
function computeSectionStatus(section, values) {
  if (section.computed || section.fixed) return 'green';
  return sectionValidationErrors(section, values).length ? 'yellow' : 'green';
}

// Everything standing between this report and a client, across all sections.
function reportValidationErrors(schema, sections) {
  const out = [];
  for (const section of schema) {
    const errors = sectionValidationErrors(section, (sections && sections[section.id]) || {});
    for (const error of errors) out.push({ ...error, sectionId: section.id, sectionTitle: section.title });
  }
  return out;
}

// `org` supplies the provider block — business name, phone, email, address.
// Those used to be schema defaults with the company name written into them,
// which is why two businesses could not use the same file.
//
// Stamped onto the report at creation, not read live at render. A report is a
// record of what was said on the day: if the office phone changes next year,
// last year's report must keep showing the number that was on it when it was
// signed.
function defaultValuesForSection(section, org) {
  // Both blocks, merged. The provider block is the business; the inspector
  // block is the person signing. A SWMS needs a field from each on the same
  // page, and there is no reason a schema should have to know which of the
  // two an orgField came from — only that it is a fact about who is doing
  // the work, kept in one place so two documents cannot disagree.
  const provider = (org && typeof org.provider === 'function') ? org.provider() : (org || {});
  const inspector = (org && typeof org.inspector === 'function') ? org.inspector() : {};
  const source = { ...provider, ...inspector };
  const values = {};
  for (const field of section.fields) {
    if (field.orgField) {
      values[field.id] = source[field.orgField] || '';
      continue;
    }
    if (field.default !== undefined) values[field.id] = field.default;
  }
  return values;
}

// BUMP THIS whenever a field is added, removed, renamed, or has its options
// or required-ness changed in either schema.
//
// A finalized report is a compliance document, and its meaning depends on the
// questions that were on screen when the technician answered them. Without a
// version stamped on each report, editing this file silently reinterprets
// every report ever written: a renamed field reads as blank, a removed one
// disappears from the PDF, a new required field makes old reports look
// incomplete. Stamping the version doesn't migrate anything — it makes the
// mismatch visible instead of silent, which is the part that matters when
// someone disputes a finding years later.
//
// History:
//   1 — first versioned release (termite + pest treatment schemas as shipped)
//   2 — sections renamed and reordered summary-first, both schemas
//   3 — pest treatment: added jobCategory; equipmentUsed changed from free
//       text to a picklist; ppeUsed options replaced with graded PPE
//   4 — termite: added durableNoticePhotos; pest treatment: targetPests
//       options expanded (German Cockroaches, Bird Lice / Mites, Possum,
//       Birds, Ticks) — both found comparing against Formitize's real forms
//   5 — termite: added treePhotos and treeAssessmentNotes to Conducive
//       Conditions, for the AI tree-species/termite-susceptibility identifier
//   6 — termite: added generalPhotos to Client Details, a catch-all AI
//       sorts into the right section/field on Generate Form
//   7 — termite action plan: added termiteSpecies and standardApplied to the
//       basis, and optionsConsidered, systemLimitations, expectedServiceLife,
//       occupantRequirements and durableNoticeCommitted to proposed works.
//       All AS 3660 expectations the plan recorded nowhere: which termite
//       (the method cannot be justified without it), what else was offered,
//       what the system does NOT protect against, and the service life of
//       the treated zone as a fact separate from the commercial warranty
const SCHEMA_VERSION = 7;

window.REPORT_SCHEMA = REPORT_SCHEMA;
window.REPORT_SCHEMA_VERSION = SCHEMA_VERSION;
window.ReportSchemaUtils = {
  isFieldVisible, computeSectionStatus, defaultValuesForSection, YES_NO,
  fieldValidationErrors, sectionValidationErrors, reportValidationErrors,
};
