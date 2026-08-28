// Report schema — single source of truth for the digital Termite Inspection
// Report, modelled on Arcadian Pest Solutions' AS 3660.2-2017 report template.
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
// from footage/photos/narration; everything else is human-only (signatures,
// licence numbers, fixed business info).

const YES_NO = ['Yes', 'No'];

const REPORT_SCHEMA = [
  {
    id: 'summary',
    number: 1,
    title: 'At a Glance',
    subtitle: 'Written for you from the answers below. Read together with the full report.',
    icon: '📋',
    color: '#0f9e8e',
    computed: true,
    fields: [],
  },
  {
    id: 'clientDetails',
    number: 2,
    title: 'Client & Site',
    subtitle: 'Who the inspection is for, and the property it covers.',
    icon: '👤',
    color: '#1f7a4d',
    fields: [
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
    title: 'Scope & Limitations',
    subtitle: 'What this inspection covers and what it cannot — agreed with the client before it begins.',
    icon: 'ℹ️',
    color: '#1f7a4d',
    softRequired: true,
    fields: [
      {
        id: 'inspectionType', label: 'Inspection Type Requested', type: 'static',
        default: 'Standard Timber Pest Inspection in accordance with AS 4349.3-2010',
      },
      { id: 'providerName', label: 'Inspection Provider', type: 'static', default: 'Arcadian Pest Solutions' },
      { id: 'providerAddress', label: 'Address', type: 'static', default: '' },
      { id: 'providerPhone', label: 'Phone', type: 'static', default: '0291271320' },
      { id: 'providerEmail', label: 'Email', type: 'static', default: 'tal@arcadianpestsolutions.com.au' },
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
    title: 'The Building',
    subtitle: 'How the property is built and how it sits on the block.',
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
    title: 'Site Plan',
    subtitle: 'A simple hand-drawn plan of the property — sketch the outline as you walk and drop labels for rooms, moisture readings, damage, or anything worth marking on the map.',
    icon: '🗺️',
    color: '#0d9488',
    fields: [
      { id: 'sketchImage', label: 'Site Sketch', type: 'sketch' },
    ],
  },
  {
    id: 'access',
    number: 6,
    title: 'Access & Restrictions',
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
    title: 'What We Found',
    subtitle: 'Report on the location and details of termite activity detected at the time of the Inspection.',
    icon: '🔍',
    color: '#154a8a',
    fields: [
      { id: 'findingsPhotos', label: 'Findings Photos', type: 'photos', triggersAiFill: true },
      { id: 'liveTermitesFound', label: 'Were live termites found at the time of the inspection?', type: 'yesno', required: true, aiFillable: true },
      { id: 'termiteSpecies', label: 'Termite species (genus/species), if determinable', type: 'text', showIf: { field: 'liveTermitesFound', equals: 'Yes' }, aiFillable: true },
      { id: 'riskOfAssociatedDamage', label: 'Potential for associated damage arising from this activity', type: 'select', options: ['Low', 'Moderate', 'High'], showIf: { field: 'liveTermitesFound', equals: 'Yes' }, aiFillable: true },
      { id: 'nestFound', label: 'Was a termite nest found at the time of Inspection?', type: 'yesno', required: true, aiFillable: true },
      { id: 'nestLocation', label: 'Nest Location(s)', type: 'textarea', showIf: { field: 'nestFound', equals: 'Yes' }, aiFillable: true },
      { id: 'nestPhotos', label: 'Nest Photos', type: 'photos', showIf: { field: 'nestFound', equals: 'Yes' }, aiFillable: true },
      { id: 'workingsFound', label: 'Was evidence of termite workings or damage found?', type: 'yesno', required: true, aiFillable: true },
      { id: 'workingsAreas', label: 'Areas where workings/damage were found', type: 'multiselect', options: ['The Exterior', 'The Interior', 'The Site', 'Landscaping Timbers', 'Trees', 'Subfloor', 'Roof Void'], showIf: { field: 'workingsFound', equals: 'Yes' }, aiFillable: true },
      { id: 'evidenceDetails', label: 'Details of the nature of the evidence found', type: 'textarea', showIf: { field: 'workingsFound', equals: 'Yes' }, aiFillable: true },
      { id: 'damagePhotos', label: 'Damage Photos', type: 'photos', showIf: { field: 'workingsFound', equals: 'Yes' }, aiFillable: true },
      { id: 'damageSeverity', label: 'Damage appears to be', type: 'select', options: ['Minor', 'Minor to Moderate', 'Moderate', 'Moderate to Extensive', 'Extensive'], showIf: { field: 'workingsFound', equals: 'Yes' }, aiFillable: true },
      { id: 'findingsAdditionalComments', label: 'Additional Comments', type: 'textarea', showIf: { field: 'workingsFound', equals: 'Yes' }, aiFillable: true },
      { id: 'treatmentRecommended', label: 'Is a termite treatment recommended?', type: 'yesno', required: true, aiFillable: true },
      { id: 'treatmentComments', label: 'Treatment Comments', type: 'textarea', showIf: { field: 'treatmentRecommended', equals: 'Yes' }, aiFillable: true },
      { id: 'priorTreatmentEvidence', label: 'Was evidence of a previous treatment located?', type: 'yesno', required: true, aiFillable: true },
      { id: 'existingManagementSystem', label: 'Existing termite management system present, type & condition', type: 'textarea', aiFillable: true },
      { id: 'durableNoticeFound', label: 'Was a durable Notice found at the time of this inspection?', type: 'yesno', required: true, aiFillable: true },
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
      { id: 'borersFound', label: 'Was evidence of borers of seasoned timber found?', type: 'yesno', required: true, aiFillable: true },
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
      { id: 'susceptibility', label: 'In our opinion, the susceptibility of this property to termites is considered to be', type: 'select', required: true, options: ['LOW', 'MODERATE', 'HIGH'], aiFillable: true },
    ],
  },
  {
    id: 'conducive',
    number: 8,
    title: 'Conditions Favouring Attack',
    subtitle: 'Conditions identified that are conducive to Termite activity.',
    icon: '⚠️',
    color: '#123a66',
    fields: [
      { id: 'conducivePhotos', label: 'Conducive Conditions Photos', type: 'photos', triggersAiFill: true },
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
  {
    id: 'terms',
    number: 9,
    title: 'Terms of Engagement',
    subtitle: 'Terms and condition details related to the Inspection undertaken and Report provided.',
    icon: '📖',
    color: '#3d3d8f',
    fixed: true,
    fields: [],
  },
  {
    id: 'inspector',
    number: 10,
    title: 'Inspector & Licence',
    subtitle: 'Contact details of the Inspection Provider and the Inspector that undertook the Inspection.',
    icon: '🧑‍🔧',
    color: '#6a3d9e',
    fields: [
      { id: 'inspectorName', label: 'Inspector Name', type: 'text', required: true },
      { id: 'inspectorAddress', label: 'Inspector Address', type: 'text' },
      { id: 'inspectorLicence', label: 'Inspector Licence', type: 'text', required: true },
      { id: 'inspectorPhone', label: 'Inspector Phone', type: 'text' },
      { id: 'signedOnBehalfOf', label: 'Signed on behalf of', type: 'static', default: 'Arcadian Pest Solutions' },
      { id: 'inspectorSignature', label: 'Inspector Signature', type: 'signature', required: true },
      { id: 'signatureDate', label: 'Date', type: 'date' },
    ],
  },
  {
    id: 'acknowledgement',
    number: 11,
    title: 'Sign-Off',
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

function defaultValuesForSection(section) {
  const values = {};
  for (const field of section.fields) {
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
const SCHEMA_VERSION = 4;

window.REPORT_SCHEMA = REPORT_SCHEMA;
window.REPORT_SCHEMA_VERSION = SCHEMA_VERSION;
window.ReportSchemaUtils = {
  isFieldVisible, computeSectionStatus, defaultValuesForSection, YES_NO,
  fieldValidationErrors, sectionValidationErrors, reportValidationErrors,
};
