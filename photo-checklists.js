// Typical photos for each job type — what replaces "walk the whole property
// on camera" (removed in v39/v41) with a checklist of the shots a technician
// actually needs for that kind of job. Ported from comparing Arcadian's own
// job categories and forms in Formitize against what report-schema.js and
// pest-treatment-schema.js already collect.
//
// Each item is a chip in the capture screen's checklist row. Tapping one
// sets the current zone to its label — capture, storage and gallery grouping
// are all untouched (a checklist label is just a zone string, same as
// anything typed by hand). `schemaSection`/`schemaField` are optional: when
// present, ReportUI.attachChecklistPhotos (report.js) copies that item's
// captures into the matching report photo field once Finish Inspection runs,
// so the shot lands where the report already expects a photo rather than
// only living in the gallery. An item with neither is informational only —
// nothing to route, the technician just gets a reminder to take it.
//
// This list is a starting point, not gospel — it should keep changing as
// real jobs show what's actually useful to prompt for.

(() => {
  'use strict';

  const TERMITE_CHECKLIST = [
    { id: 'frontElevation', label: 'Front Elevation' }, // handled by the existing front-photo prompt at Start Inspection
    { id: 'meterBox', label: 'Meter Box', schemaSection: 'findings', schemaField: 'durableNoticePhotos' },
    { id: 'subfloorEntry', label: 'Subfloor Entry', schemaSection: 'access', schemaField: 'accessPhotos' },
    { id: 'roofVoidEntry', label: 'Roof Void Entry', schemaSection: 'access', schemaField: 'accessPhotos' },
    { id: 'weepHoles', label: 'Weep Holes', schemaSection: 'conducive', schemaField: 'conducivePhotos' },
    { id: 'antCapping', label: 'Ant Capping', schemaSection: 'conducive', schemaField: 'conducivePhotos' },
    { id: 'slabEdge', label: 'Slab Edge', schemaSection: 'conducive', schemaField: 'conducivePhotos' },
    { id: 'wetAreas', label: 'Kitchen / Bathroom', schemaSection: 'conducive', schemaField: 'conducivePhotos' },
    { id: 'exteriorTimbers', label: 'External Timbers', schemaSection: 'conducive', schemaField: 'conducivePhotos' },
  ];

  const PEST_CHECKLISTS = {
    'Exterior Only': [
      { id: 'frontElevation', label: 'Front Elevation' },
      { id: 'exteriorPerimeter', label: 'Exterior Perimeter', schemaSection: 'treatmentDetails', schemaField: 'treatmentPhotos' },
      { id: 'entryPoints', label: 'Entry Points / Weep Holes', schemaSection: 'pestIdentification', schemaField: 'pestPhotos' },
    ],
    'End of Lease (Flea Treatment)': [
      { id: 'frontElevation', label: 'Front Elevation' },
      { id: 'carpetedRooms', label: 'Carpeted Rooms Treated', schemaSection: 'treatmentDetails', schemaField: 'treatmentPhotos' },
      { id: 'petAreas', label: 'Pet Bedding / High-Flea Areas', schemaSection: 'pestIdentification', schemaField: 'pestPhotos' },
    ],
    'Full General Pest': [
      { id: 'frontElevation', label: 'Front Elevation' },
      { id: 'kitchen', label: 'Kitchen', schemaSection: 'treatmentDetails', schemaField: 'treatmentPhotos' },
      { id: 'bathroom', label: 'Bathroom', schemaSection: 'treatmentDetails', schemaField: 'treatmentPhotos' },
      { id: 'exteriorPerimeter', label: 'Exterior Perimeter', schemaSection: 'treatmentDetails', schemaField: 'treatmentPhotos' },
      { id: 'evidence', label: 'Pest Evidence Close-Up', schemaSection: 'pestIdentification', schemaField: 'pestPhotos' },
    ],
    'Rodent Services': [
      { id: 'frontElevation', label: 'Front Elevation' },
      { id: 'baitStations', label: 'Bait Station Placement', schemaSection: 'treatmentDetails', schemaField: 'treatmentPhotos' },
      { id: 'evidence', label: 'Droppings / Gnaw Damage', schemaSection: 'pestIdentification', schemaField: 'pestPhotos' },
    ],
  };

  // No category chosen yet (or the technician skipped it) — still worth a
  // short, generic prompt rather than nothing.
  const PEST_DEFAULT_CHECKLIST = [
    { id: 'frontElevation', label: 'Front Elevation' },
    { id: 'treatmentArea', label: 'Treatment Area', schemaSection: 'treatmentDetails', schemaField: 'treatmentPhotos' },
    { id: 'evidence', label: 'Pest Evidence', schemaSection: 'pestIdentification', schemaField: 'pestPhotos' },
  ];

  function forJob(job, jobCategory) {
    if (!job) return [];
    if (job.jobType === 'termite') return TERMITE_CHECKLIST;
    if (job.jobType === 'pest_treatment') return PEST_CHECKLISTS[jobCategory] || PEST_DEFAULT_CHECKLIST;
    return [];
  }

  window.PhotoChecklists = { forJob };
})();
