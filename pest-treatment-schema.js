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

// Job categories for general pest work. Picking one on Client & Site
// prefills PPE (safety section) and Application Equipment (treatment
// section) with what that kind of job typically needs — a starting point
// the technician confirms or edits, never a silent answer. See jobCategory
// below and applyJobCategoryPrefill() in report.js, which only ever writes
// into a field that's still blank.
const PEST_JOB_CATEGORIES = [
  {
    id: 'exteriorOnly',
    label: 'Exterior Only',
    blurb: 'Perimeter and exterior-only treatment — no interior access required.',
    ppe: ['Nitrile Gloves', 'Eye Protection (Safety Glasses/Goggles)', 'Respirator/Mask', 'Enclosed Footwear', 'Long Sleeves/Pants'],
    equipment: ['Power Rig / Vehicle-Mounted Sprayer', 'Backpack Sprayer', 'Hand Compression Sprayer'],
  },
  {
    id: 'endOfLeaseFlea',
    label: 'End of Lease (Flea Treatment)',
    blurb: 'Flea treatment for a vacating tenancy — full interior coverage.',
    ppe: ['Nitrile Gloves', 'Eye Protection (Safety Glasses/Goggles)', 'Half-Face Respirator (A1P2 Filter)', 'Disposable Coveralls', 'Shoe Covers'],
    equipment: ['Hand Compression Sprayer', 'Backpack Sprayer', 'Indoor Aerosol/ULV Fogger (if applicable)'],
  },
  {
    id: 'fullGeneralPest',
    label: 'Full General Pest',
    blurb: 'Standard internal and external general pest treatment.',
    ppe: ['Chemical-Resistant Nitrile Gloves', 'Eye Protection (Safety Glasses/Goggles)', 'Respirator/Mask', 'Enclosed Footwear'],
    equipment: ['Hand Compression Sprayer', 'Dust Applicator / Hand Duster', 'Gel Bait Gun'],
  },
  {
    id: 'rodentServices',
    label: 'Rodent Services',
    blurb: 'Rodent baiting and monitoring — stations, not spray.',
    ppe: ['Heavy-Duty Rubber/Nitrile Gloves', 'Dust Mask / P2 Respirator', 'Eye Protection (Safety Glasses/Goggles)'],
    equipment: ['Lockable Rodent Bait Stations', 'Bait Key', 'Flashlight/Headlamp', 'Tracking Powder Applicator'],
  },
];
window.PEST_JOB_CATEGORIES = PEST_JOB_CATEGORIES;

const PEST_TREATMENT_SCHEMA = [
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
    subtitle: 'The Client is the person or entity for whom this pest treatment service is being carried out.',
    icon: '👤',
    color: '#b45309',
    fields: [
      // The report's cover image. Required, because it is the first thing the
      // client sees and the report is visibly unfinished without it — the
      // cover renders a large empty band where the photo should be, which is
      // what a service report looked like when this was optional.
      {
        id: 'coverPhoto',
        label: 'Front of property — this becomes the report cover',
        type: 'photos', required: true, aiFillable: true,
      },
      {
        id: 'jobCategory',
        label: 'Job Category',
        type: 'choiceCards',
        categories: PEST_JOB_CATEGORIES,
      },
      { id: 'clientName', label: 'Client Name', type: 'text', required: true },
      { id: 'clientAddress', label: 'Client Address', type: 'text' },
      { id: 'clientPhone', label: 'Client Phone', type: 'text', required: true },
      { id: 'clientEmail', label: 'Client Email', type: 'text' },
      { id: 'propertyAddress', label: 'Treated Property Address', type: 'text', required: true },
      {
        id: 'propertyType', label: 'Property Type', type: 'select', required: true,
        options: ['Residential', 'Commercial', 'Industrial'],
        default: 'Residential',
      },
      { id: 'inspectionDate', label: 'Service Date', type: 'date', required: true },
      // Start AND finish time are both required by the NSW Pesticides
      // Regulation 2017 cl 36 — "time of application including start and
      // finish time". inspectionTime keeps its id (auto-filled when the
      // technician taps Start Inspection) and is relabelled as the start.
      { id: 'inspectionTime', label: 'Application Start Time', type: 'time', required: true },
      { id: 'applicationFinishTime', label: 'Application Finish Time', type: 'time', required: true },
      { id: 'weather', label: 'Weather Conditions at time of treatment', type: 'text', aiFillable: true },
      {
        id: 'occupierDetails',
        label: 'Property owner / occupier — name and contact (if different from the client above)',
        type: 'text',
      },
    ],
  },
  {
    id: 'agreement',
    number: 3,
    title: 'Service Scope',
    subtitle: 'What this service covers and its limitations.',
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
    id: 'pestIdentification',
    number: 4,
    title: 'Target Pests & Evidence',
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
    title: 'Work Carried Out',
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
      {
        id: 'equipmentUsed', label: 'Application Equipment', type: 'multiselect', aiFillable: true,
        options: ['Power Rig / Vehicle-Mounted Sprayer', 'Backpack Sprayer', 'Hand Compression Sprayer',
          'Indoor Aerosol/ULV Fogger (if applicable)', 'Dust Applicator / Hand Duster', 'Gel Bait Gun',
          'Lockable Rodent Bait Stations', 'Bait Key', 'Flashlight/Headlamp', 'Tracking Powder Applicator', 'Other'],
      },
      { id: 'treatmentNotes', label: 'Additional Treatment Notes', type: 'textarea', aiFillable: true },
    ],
  },
  {
    id: 'chemicals',
    number: 6,
    title: 'Products Applied',
    subtitle: 'Record of every chemical product applied during this treatment, as required for pesticide use record-keeping. Add one entry per product — most spray jobs use two or three.',
    icon: '🧴',
    color: '#7c2d12',
    fields: [
      { id: 'products', label: 'Products Used', type: 'productList', required: true },
    ],
  },
  {
    id: 'safety',
    number: 7,
    title: 'Site Safety & Records',
    subtitle: 'What was around the treatment area, what you did about it, and the pesticide-use record the law requires.',
    icon: '⚠️',
    color: '#b91c1c',
    fields: [
      // A pesticide job in an occupied home is a risk assessment whether or
      // not anyone writes one down. Recording what was present makes the
      // action taken mean something — a report saying "moved animals to an
      // unaffected part of the property" with no animals recorded reads as
      // boilerplate, and that is exactly how it has been going out.
      {
        id: 'risksPresent',
        label: 'What was present on or near the treatment area?',
        type: 'multiselect', required: true,
        options: ['People / children', 'Dog(s)', 'Cat(s)', 'Caged bird(s)', 'Fish / aquarium',
          'Other animals', 'Vegetable garden', "Child's play area", 'Clothes line', 'Pool',
          'Waterways / stormwater', 'A/C unit', 'Food preparation area', 'Nothing of concern'],
        aiFillable: true,
      },
      {
        id: 'riskActions',
        label: 'What did you do about it?',
        type: 'multiselect',
        options: ['Informed people/children to vacate the area', 'Moved animals to an unaffected part of the property',
          'Covered or removed caged birds', 'Covered fish tank / turned off pump', 'Used low-toxicity product internally',
          'All rodent bait placed in tamper-proof stations', 'Treated after hours', 'Removed obstacles from the area',
          'Covered food preparation surfaces', 'Kept product clear of the pool and stormwater'],
        aiFillable: true,
        // Reversed dependency, deliberately: the action is the field the
        // technician reaches for, so the prompt fires there rather than on a
        // field they have already skipped past.
        requiresCompanion: {
          fieldId: 'risksPresent',
          label: 'What was present on or near the treatment area?',
          message: 'You recorded an action taken to manage a risk, but nothing in the risks list. Tick what was actually there — or "Nothing of concern" if the action was precautionary.',
        },
      },
      { id: 'additionalRiskAction', label: 'Anything else you did to make the site safe', type: 'textarea' },

      { id: 'spillKitAvailable', label: 'Spill kit on the vehicle?', type: 'yesno', default: 'Yes' },
      { id: 'sdsOnSite', label: 'Safety Data Sheets on site?', type: 'yesno', default: 'Yes' },
      { id: 'ppeUsed', label: 'PPE worn', type: 'multiselect', required: true,
        options: ['Nitrile Gloves', 'Chemical-Resistant Nitrile Gloves', 'Heavy-Duty Rubber/Nitrile Gloves',
          'Eye Protection (Safety Glasses/Goggles)', 'Respirator/Mask', 'Half-Face Respirator (A1P2 Filter)',
          'Dust Mask / P2 Respirator', 'Enclosed Footwear', 'Long Sleeves/Pants', 'Disposable Coveralls',
          'Shoe Covers', 'Other'], aiFillable: true },
      { id: 'firstAidOnSite', label: 'First aid kit on site?', type: 'yesno', default: 'Yes' },
      {
        id: 'safeToCommence', label: 'Was it safe to commence work?', type: 'yesno',
        required: true, default: 'Yes',
      },
      {
        id: 'unsafeReason', label: 'Why was it not safe, and what happened instead?',
        type: 'textarea', required: true,
        showIf: { field: 'safeToCommence', equals: 'No' },
      },

      // Wind speed and direction must be recorded whenever a pesticide is
      // applied OUTDOORS with spray equipment (NSW Pesticides Regulation 2017
      // cl 36), at the start of application and on any significant change.
      // Only shown once the technician says the job included outdoor
      // spraying, so indoor-only jobs aren't cluttered with it.
      {
        id: 'appliedOutdoorsWithSpray',
        label: 'Was any pesticide applied outdoors using spray equipment?',
        type: 'yesno', required: true,
      },
      {
        id: 'windSpeed', label: 'Wind speed at start of application (km/h)', type: 'text',
        showIf: { field: 'appliedOutdoorsWithSpray', equals: 'Yes' }, required: true,
        // Auto-filled from the weather lookup at Start Inspection; the range
        // exists for the times it is typed by hand.
        range: { min: 0, max: 90, unit: 'km/h' },
        aiFillable: true,
      },
      {
        id: 'windDirection', label: 'Wind direction at start of application', type: 'select',
        options: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
        showIf: { field: 'appliedOutdoorsWithSpray', equals: 'Yes' }, required: true,
        aiFillable: true,
      },
      {
        id: 'temperature', label: 'Temperature (°C)', type: 'text',
        showIf: { field: 'appliedOutdoorsWithSpray', equals: 'Yes' },
        // A service report went to a client reading "Temperature: 222". The
        // range is what stops the next one.
        range: { min: -10, max: 55, unit: '°C' },
        aiFillable: true,
      },
      {
        id: 'windChanges', label: 'Significant wind change during application (time + new speed/direction)',
        type: 'textarea', showIf: { field: 'appliedOutdoorsWithSpray', equals: 'Yes' },
      },

      { id: 'signagePlaced', label: 'Warning signage / tape placed?', type: 'yesno' },
      { id: 'occupantsNotified', label: 'Occupants notified before treatment?', type: 'yesno' },
      { id: 'reEntryPeriod', label: 'Re-entry period', type: 'text', required: true,
        default: 'Once surfaces are dry (approximately 2 hours)' },
      { id: 'withholdingPeriod', label: 'Withholding period', type: 'text', default: 'Not applicable' },
      { id: 'sdsAvailable', label: 'Safety Data Sheet available on request?', type: 'yesno', default: 'Yes' },
    ],
  },
  {
    id: 'recommendations',
    number: 8,
    title: 'Advice & Next Steps',
    subtitle: 'Advice for the client and any follow-up treatment required.',
    icon: '📝',
    color: '#166534',
    fields: [
      // These four were free-text boxes and were blank on every report
      // examined — a blank box at the end of a long form is the easiest thing
      // in the world to skip. As pickable options they take one tap each, and
      // they are the part of the report a client actually acts on.
      {
        id: 'housekeepingRecs', label: 'Housekeeping & cleaning', type: 'multiselect', aiFillable: true,
        options: ['No action needed', 'Clean behind and under appliances', 'Store food in sealed containers',
          'Clear crumbs and spills promptly', 'Empty bins more frequently', 'Reduce clutter in storage areas',
          'Clean pet feeding area daily'],
      },
      {
        id: 'rubbishRecs', label: 'Rubbish & waste', type: 'multiselect', aiFillable: true,
        options: ['No action needed', 'Move bins away from the building line', 'Keep bin lids closed',
          'Remove green waste piles', 'Clear stored cardboard and packaging', 'Remove timber stacked against the house'],
      },
      {
        id: 'moistureRecs', label: 'Water & moisture', type: 'multiselect', aiFillable: true,
        options: ['No action needed', 'Repair leaking tap or pipe', 'Clear blocked gutters',
          'Improve drainage away from the building', 'Fix pooling water near the slab',
          'Improve subfloor ventilation', 'Reduce over-watering of garden beds'],
      },
      {
        id: 'proofingRecs', label: 'Building maintenance & proofing', type: 'multiselect', aiFillable: true,
        options: ['No action needed', 'Seal gaps around pipe penetrations', 'Fit door seals / brush strips',
          'Repair damaged flyscreens', 'Seal cracks in external walls', 'Trim vegetation back from the building',
          'Screen weep holes', 'Repair damaged roof tiles or eaves'],
      },
      { id: 'followUpRequired', label: 'Follow-up treatment required?', type: 'yesno', required: true },
      { id: 'followUpDate', label: 'Recommended Follow-up Date', type: 'date', required: true, showIf: { field: 'followUpRequired', equals: 'Yes' } },
      { id: 'treatmentLimitations', label: 'Treatment limitations / warranty conditions', type: 'textarea' },
      { id: 'generalRecommendations', label: 'Anything else the client should know', type: 'textarea', aiFillable: true },
      { id: 'additionalNotes', label: 'Internal notes (not shown to the client)', type: 'textarea' },
    ],
  },
  {
    id: 'terms',
    number: 9,
    title: 'Terms of Service',
    subtitle: 'Terms and conditions related to this pest treatment service.',
    icon: '📖',
    color: '#3d3d8f',
    fixed: true,
    fields: [],
  },
  {
    id: 'inspector',
    number: 10,
    title: 'Technician & Licence',
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
    title: 'Sign-Off',
    subtitle: 'Acknowledgement and acceptance of the service to be completed by the Client.',
    icon: '✅',
    color: '#a12a72',
    // Yellow until signed, but never blocks finalizing — the occupier is often
    // not on site when a treatment finishes. See computeSectionStatus.
    softRequired: true,
    fields: [
      { id: 'clientAckName', label: 'Client Name', type: 'text' },
      { id: 'clientSignature', label: 'Signature', type: 'signature', required: true },
      { id: 'clientAckDate', label: 'Date', type: 'date' },
    ],
  },
];

window.PEST_TREATMENT_SCHEMA = PEST_TREATMENT_SCHEMA;
