// Report schema — single source of truth for the digital Termite Inspection
// Report, modelled on Arcadian Pest Solutions' AS 3660.2-2017 report template.
//
// Each section has: id, number, title, icon, color, fields[]
// Each field has: id, label, type, options?, showIf?, required?, aiFillable?, default?
//
// Field types: text | textarea | select | yesno | multiselect | date | time |
//              photos | signature | static
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
    id: 'clientDetails',
    number: 1,
    title: 'Client Details',
    subtitle: 'The Client is the person or entity for whom the inspection is being undertaken.',
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
    number: 2,
    title: 'About Our Agreement',
    subtitle: 'Defining the Purpose, Scope, Areas Covered and Limitations of the Inspection.',
    icon: 'ℹ️',
    color: '#1f7a4d',
    fixed: true,
    fields: [
      {
        id: 'inspectionType', label: 'Inspection Type Requested', type: 'static',
        default: 'Standard Termite Inspection in accordance with AS 3660.2-2017',
      },
      { id: 'providerName', label: 'Inspection Provider', type: 'static', default: 'Arcadian Pest Solutions' },
      { id: 'providerAddress', label: 'Address', type: 'static', default: '' },
      { id: 'providerPhone', label: 'Phone', type: 'static', default: '0291271320' },
      { id: 'providerEmail', label: 'Email', type: 'static', default: 'tal@arcadianpestsolutions.com.au' },
    ],
  },
  {
    id: 'summary',
    number: 3,
    title: 'Inspection Summary',
    subtitle: 'Auto-generated from your answers below — read together with the full report.',
    icon: '📋',
    color: '#0f9e8e',
    computed: true,
    fields: [],
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
      { id: 'otherTimberPestsObserved', label: 'Evidence of other timber pests observed (e.g. drywood termites, borers) — outside the scope of this Standard but noted as a duty to warn', type: 'textarea', aiFillable: true },
      { id: 'reinspectionInterval', label: 'A full inspection and written report should be conducted at this property every', type: 'select', options: ['3 months', '6 months', '12 months'], default: '12 months' },
      { id: 'susceptibility', label: 'In our opinion, the susceptibility of this property to termites is considered to be', type: 'select', required: true, options: ['LOW', 'MODERATE', 'HIGH'], aiFillable: true },
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
    title: 'Terms & Conditions',
    subtitle: 'Terms and condition details related to the Inspection undertaken and Report provided.',
    icon: '📖',
    color: '#3d3d8f',
    fixed: true,
    fields: [],
  },
  {
    id: 'inspector',
    number: 10,
    title: 'Inspector Details',
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
    title: 'Client Acknowledgement',
    subtitle: 'Acknowledgement and acceptance of the Report to be completed by the Client.',
    icon: '✅',
    color: '#a12a72',
    fields: [
      { id: 'clientAckName', label: 'Client Name', type: 'text' },
      { id: 'clientSignature', label: 'Signature', type: 'signature' },
      { id: 'clientAckDate', label: 'Date', type: 'date' },
    ],
  },
];

function isFieldVisible(field, values) {
  if (!field.showIf) return true;
  return values[field.showIf.field] === field.showIf.equals;
}

// A section is 'green' once every required + currently-visible field has a value.
// Sections with no required fields (agreement, terms) are always green.
// Acknowledgement is "soft required" — yellow until filled, but never blocks
// the rest of the report (the client may sign later / in person).
function computeSectionStatus(section, values) {
  if (section.computed || section.fixed) return 'green';
  const requiredFields = section.fields.filter((f) => f.required);
  for (const field of requiredFields) {
    if (!isFieldVisible(field, values)) continue;
    const val = values[field.id];
    if (val === undefined || val === null || val === '') return 'yellow';
  }
  if (section.id === 'acknowledgement') {
    return values.clientSignature ? 'green' : 'yellow';
  }
  return 'green';
}

function defaultValuesForSection(section) {
  const values = {};
  for (const field of section.fields) {
    if (field.default !== undefined) values[field.id] = field.default;
  }
  return values;
}

window.REPORT_SCHEMA = REPORT_SCHEMA;
window.ReportSchemaUtils = { isFieldVisible, computeSectionStatus, defaultValuesForSection, YES_NO };
