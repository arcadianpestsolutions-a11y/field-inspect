// Report schema — General Pest Treatment / Chemical Application report,
// for residential, commercial, or industrial pest control jobs (as opposed
// to report-schema.js's AS 3660.2 termite inspection report). Same shape
// and field-type conventions as report-schema.js (see the header comment
// there) — reuses window.ReportSchemaUtils rather than duplicating it,
// since isFieldVisible/computeSectionStatus/defaultValuesForSection are
// already generic over any section/field, not termite-specific.
//
// Deliberately reuses the same section ids as the termite schema for
// clientDetails / agreement / summary / terms / inspector / acknowledgement
// — report.js has a handful of behaviors keyed to those literal ids
// (per-login inspector defaults, the Finalize-gating exemption for
// acknowledgement, the seed-from-job logic in loadOrCreateReport) that this
// schema gets for free by matching them, instead of needing a parallel
// branch for every one of those ids.

const PEST_TREATMENT_SCHEMA = [
  {
    id: 'clientDetails',
    number: 1,
    title: 'Client Details',
    subtitle: 'The Client is the person or entity for whom this pest treatment service is being carried out.',
    icon: '👤',
    color: '#b45309',
    fields: [
      { id: 'clientName', label: 'Client Name', type: 'text', required: true },
      { id: 'clientAddress', label: 'Client Address', type: 'text' },
      { id: 'clientPhone', label: 'Client Phone', type: 'text' },
      { id: 'clientEmail', label: 'Client Email', type: 'text' },
      { id: 'propertyAddress', label: 'Treated Property Address', type: 'text', required: true },
      {
        id: 'propertyType', label: 'Property Type', type: 'select', required: true,
        options: ['Residential', 'Commercial', 'Industrial'],
        default: 'Residential',
      },
      { id: 'inspectionDate', label: 'Service Date', type: 'date', required: true },
      { id: 'inspectionTime', label: 'Service Time', type: 'time' },
      { id: 'weather', label: 'Weather Conditions at time of treatment', type: 'text', aiFillable: true },
    ],
  },
  {
    id: 'agreement',
    number: 2,
    title: 'About Our Agreement',
    subtitle: 'Defining the Purpose, Scope and Limitations of this Service.',
    icon: 'ℹ️',
    color: '#b45309',
    fixed: true,
    fields: [
      {
        id: 'inspectionType', label: 'Service Requested', type: 'static',
        default: 'General Pest Treatment / Chemical Application Service',
      },
      { id: 'providerName', label: 'Service Provider', type: 'static', default: 'Arcadian Pest Solutions' },
      { id: 'providerAddress', label: 'Address', type: 'static', default: '' },
      { id: 'providerPhone', label: 'Phone', type: 'static', default: '0291271320' },
      { id: 'providerEmail', label: 'Email', type: 'static', default: 'tal@arcadianpestsolutions.com.au' },
    ],
  },
  {
    id: 'summary',
    number: 3,
    title: 'Treatment Summary',
    subtitle: 'Auto-generated from your answers below — read together with the full report.',
    icon: '📋',
    color: '#0f9e8e',
    computed: true,
    fields: [],
  },
  {
    id: 'pestIdentification',
    number: 4,
    title: 'Pest Identification',
    subtitle: 'The pest(s) targeted by this treatment and evidence observed on site.',
    icon: '🐜',
    color: '#92400e',
    fields: [
      { id: 'pestPhotos', label: 'Photos of Pest Activity / Evidence', type: 'photos', triggersAiFill: true },
      {
        id: 'targetPests', label: 'Target Pest(s)', type: 'multiselect', required: true, aiFillable: true,
        options: ['Cockroaches', 'Ants', 'Spiders', 'Rodents (Rats/Mice)', 'Wasps/Bees', 'Silverfish',
          'Fleas', 'Stored Product Pests', 'Flies', 'Bed Bugs', 'General Pest Treatment', 'Other'],
      },
      { id: 'pestEvidence', label: 'Evidence Observed (droppings, nests, damage, sightings, etc.)', type: 'textarea', aiFillable: true },
      { id: 'affectedAreas', label: 'Areas Affected', type: 'textarea', aiFillable: true },
      { id: 'infestationLevel', label: 'Infestation Level', type: 'select', options: ['Low', 'Moderate', 'High'], aiFillable: true },
    ],
  },
  {
    id: 'treatmentDetails',
    number: 5,
    title: 'Treatment Details',
    subtitle: 'The method and areas of treatment carried out.',
    icon: '🧪',
    color: '#0369a1',
    fields: [
      { id: 'treatmentPhotos', label: 'Photos of Treatment Areas', type: 'photos', triggersAiFill: true },
      {
        id: 'treatmentMethods', label: 'Treatment Method(s)', type: 'multiselect', required: true, aiFillable: true,
        options: ['Spray', 'Dust', 'Bait Stations', 'Gel Bait', 'Fumigation', 'Misting/ULV',
          'Physical/Mechanical Removal', 'Exclusion Works', 'Other'],
      },
      {
        id: 'areasTreated', label: 'Areas Treated', type: 'multiselect', required: true, aiFillable: true,
        options: ['Interior', 'Exterior Perimeter', 'Roof Void', 'Subfloor', 'Garden/Landscape',
          'Kitchen', 'Bathroom', 'Roof/Eaves', 'Drainage/Stormwater', 'Other'],
      },
      { id: 'equipmentUsed', label: 'Equipment Used', type: 'textarea', aiFillable: true },
      { id: 'treatmentNotes', label: 'Additional Treatment Notes', type: 'textarea', aiFillable: true },
    ],
  },
  {
    id: 'chemicals',
    number: 6,
    title: 'Chemicals / Products Used',
    subtitle: 'Record of the chemical product(s) applied during this treatment, for pesticide use record-keeping.',
    icon: '🧴',
    color: '#7c2d12',
    fields: [
      { id: 'productName', label: 'Product / Trade Name', type: 'text', required: true },
      { id: 'apvmaNumber', label: 'APVMA Registration Number', type: 'text' },
      { id: 'activeConstituent', label: 'Active Constituent(s)', type: 'text' },
      { id: 'batchNumber', label: 'Batch / Lot Number', type: 'text' },
      { id: 'quantityApplied', label: 'Quantity Applied (e.g. 2.5 L, 500 g)', type: 'text' },
      { id: 'dilutionRate', label: 'Dilution / Application Rate', type: 'text' },
      { id: 'additionalProducts', label: 'Additional Products Used (if more than one)', type: 'textarea' },
    ],
  },
  {
    id: 'safety',
    number: 7,
    title: 'Safety & Compliance',
    subtitle: 'Safety measures taken and compliance details for this treatment.',
    icon: '⚠️',
    color: '#b91c1c',
    fields: [
      { id: 'ppeUsed', label: 'PPE Used', type: 'multiselect', options: ['Respirator', 'Gloves', 'Coveralls', 'Eye Protection', 'Boots', 'Other'], aiFillable: true },
      { id: 'signagePlaced', label: 'Warning signage / tape placed?', type: 'yesno' },
      { id: 'occupantsNotified', label: 'Occupants notified prior to treatment?', type: 'yesno' },
      { id: 'reEntryPeriod', label: 'Re-entry Period', type: 'text' },
      { id: 'withholdingPeriod', label: 'Withholding Period', type: 'text' },
      { id: 'sdsAvailable', label: 'Safety Data Sheet (SDS) available on request?', type: 'yesno', default: 'Yes' },
    ],
  },
  {
    id: 'recommendations',
    number: 8,
    title: 'Recommendations & Follow-Up',
    subtitle: 'Advice for the client and any follow-up treatment required.',
    icon: '📝',
    color: '#166534',
    fields: [
      { id: 'followUpRequired', label: 'Follow-up treatment required?', type: 'yesno' },
      { id: 'followUpDate', label: 'Recommended Follow-up Date', type: 'date', showIf: { field: 'followUpRequired', equals: 'Yes' } },
      { id: 'generalRecommendations', label: 'General Recommendations for the Client', type: 'textarea', aiFillable: true },
      { id: 'additionalNotes', label: 'Additional Notes', type: 'textarea' },
    ],
  },
  {
    id: 'terms',
    number: 9,
    title: 'Terms & Conditions',
    subtitle: 'Terms and conditions related to this pest treatment service.',
    icon: '📖',
    color: '#3d3d8f',
    fixed: true,
    fields: [],
  },
  {
    id: 'inspector',
    number: 10,
    title: 'Technician Details',
    subtitle: 'Contact details of the Service Provider and the Technician who carried out the treatment.',
    icon: '🧑‍🔧',
    color: '#6a3d9e',
    fields: [
      { id: 'inspectorName', label: 'Technician Name', type: 'text', required: true },
      { id: 'inspectorAddress', label: 'Technician Address', type: 'text' },
      { id: 'inspectorLicence', label: 'Pest Control Licence Number', type: 'text', required: true },
      { id: 'inspectorPhone', label: 'Technician Phone', type: 'text' },
      { id: 'signedOnBehalfOf', label: 'Signed on behalf of', type: 'static', default: 'Arcadian Pest Solutions' },
      { id: 'inspectorSignature', label: 'Technician Signature', type: 'signature', required: true },
      { id: 'signatureDate', label: 'Date', type: 'date' },
    ],
  },
  {
    id: 'acknowledgement',
    number: 11,
    title: 'Client Acknowledgement',
    subtitle: 'Acknowledgement and acceptance of the service to be completed by the Client.',
    icon: '✅',
    color: '#a12a72',
    fields: [
      { id: 'clientAckName', label: 'Client Name', type: 'text' },
      { id: 'clientSignature', label: 'Signature', type: 'signature' },
      { id: 'clientAckDate', label: 'Date', type: 'date' },
    ],
  },
];

window.PEST_TREATMENT_SCHEMA = PEST_TREATMENT_SCHEMA;
