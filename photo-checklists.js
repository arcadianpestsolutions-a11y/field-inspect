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

  // The timber pest inspection, in the order a technician actually walks it:
  // the outside first, then under the floor if there is one, then the roof
  // void. `area` makes this a guided walk (photo-walk.js) rather than a row of
  // chips to remember: one shot at a time, with `hint` saying what to capture.
  //
  // The inside gets no photo steps. What blocks the view indoors is the same
  // furniture, fixtures and stored belongings on nearly every job, so it is a
  // set of ticks written into the report (photo-walk.js INSIDE_NOTES), and a
  // photo inside is only worth taking when there is damage or damp to show.
  // `hidden` keeps the old Kitchen / Bathroom label filing photos already
  // taken against it, without asking for it any more.
  const CONDUCIVE = { schemaSection: 'conducive', schemaField: 'conducivePhotos' };
  const ACCESS = { schemaSection: 'access', schemaField: 'accessPhotos' };
  const TERMITE_CHECKLIST = [
    { id: 'frontElevation', label: 'Front Elevation', area: 'outside' }, // handled by the existing front-photo prompt at Start Inspection
    { id: 'meterBox', label: 'Meter Box', area: 'outside', schemaSection: 'findings', schemaField: 'durableNoticePhotos',
      hint: 'Open it and photograph the inside of the door. The termite durable notice is usually there.' },
    { id: 'slabEdge', label: 'Slab Edge', area: 'outside', ...CONDUCIVE,
      hint: 'Anywhere the slab edge is covered by soil, paving, render or garden beds.' },
    { id: 'weepHoles', label: 'Weep Holes', area: 'outside', ...CONDUCIVE,
      hint: 'Weep holes that are blocked, buried or bridged.' },
    { id: 'airCon', label: 'Air Con Unit', area: 'outside', ...CONDUCIVE,
      hint: 'The outdoor unit and where its drain drips. Water against a wall draws termites.' },
    { id: 'hotWater', label: 'Hot Water System', area: 'outside', ...CONDUCIVE,
      hint: 'The relief valve overflow, and where it drains to.' },
    { id: 'waterTanks', label: 'Water Tanks / Downpipes', area: 'outside', ...CONDUCIVE,
      hint: 'Tanks and their overflow, and any downpipe that drains against the house.' },
    { id: 'gardenBeds', label: 'Garden Beds Against Walls', area: 'outside', ...CONDUCIVE,
      hint: 'Garden beds, mulch or soil built up against the walls.' },
    { id: 'exteriorTimbers', label: 'External Timbers', area: 'outside', ...CONDUCIVE,
      hint: 'Fences, retaining walls, sleepers, decks, pergolas: any timber touching the ground.' },
    { id: 'trees', label: 'Trees & Stumps', area: 'outside', schemaSection: 'conducive', schemaField: 'treePhotos',
      hint: 'Trees close to the house, and any old stumps.' },
    { id: 'outbuildings', label: 'Sheds & Stored Items', area: 'outside', ...CONDUCIVE,
      hint: 'Sheds, cubbies, and timber or rubbish stored against the house.' },
    { id: 'subfloorEntry', label: 'Subfloor Entry', area: 'subfloor', ...ACCESS,
      hint: 'The way in, then the view across the subfloor from it.' },
    { id: 'antCapping', label: 'Piers & Ant Capping', area: 'subfloor', ...CONDUCIVE,
      hint: 'Piers and ant caps that are missing, damaged or bridged.' },
    { id: 'subfloorConditions', label: 'Subfloor Damp / Ventilation', area: 'subfloor', ...CONDUCIVE,
      hint: 'Damp soil, leaking pipes, poor airflow, timber debris on the ground.' },
    { id: 'roofVoidEntry', label: 'Roof Void Entry', area: 'roof', ...ACCESS,
      hint: 'The manhole, then the view across the roof void from it.' },
    { id: 'roofTimbers', label: 'Roof Timbers', area: 'roof', ...ACCESS,
      hint: 'Rafters, battens and trusses. Get close to any damage or mud leads.' },
    { id: 'wetAreas', label: 'Kitchen / Bathroom', area: 'inside', hidden: true, ...CONDUCIVE },
  ];

  // A termite job's single report can represent any one of four document
  // types (see DOCUMENT_TYPES in report.js) — an inspection, an action
  // plan, a certificate, or a service record — but until now every termite
  // job got this same inspection-focused checklist regardless of which one
  // was actually active. A technician on site to install a barrier system
  // was being prompted for "Weep Holes" and "Kitchen / Bathroom" — findings
  // from an inspection that likely already happened — instead of anything
  // that document's own schema actually asks for.

  // Certificate of Installation: the whole point of this document is
  // proving what was physically installed, so its checklist is exactly the
  // two things the schema needs evidence of (see TERMITE_CERTIFICATE_SCHEMA
  // in termite-management-schemas.js).
  const TERMITE_CERTIFICATE_CHECKLIST = [
    { id: 'frontElevation', label: 'Front Elevation' },
    { id: 'installedSystem', label: 'Installed System', schemaSection: 'installation', schemaField: 'installationPhotos' },
    { id: 'durableNotice', label: 'Durable Notice', schemaSection: 'durableNotice', schemaField: 'noticePhoto' },
  ];

  // Service Record: a periodic visit to a system already installed. The
  // schema's own photo field lives in the Findings section, but a
  // technician thinking in terms of "what do I photograph" reads more
  // naturally as one item per thing being checked than one generic prompt —
  // both route to the same servicePhotos field either way.
  const TERMITE_SERVICE_RECORD_CHECKLIST = [
    { id: 'frontElevation', label: 'Front Elevation' },
    { id: 'stationCondition', label: 'Station / Bait Condition', schemaSection: 'findings', schemaField: 'servicePhotos' },
    { id: 'structureCheck', label: 'Structure — Any New Activity', schemaSection: 'findings', schemaField: 'servicePhotos' },
  ];

  // Action Plan deliberately has no checklist at all — TERMITE_ACTION_PLAN_
  // SCHEMA has no photo field anywhere in it. It's a proposal written from
  // an inspection that already happened ("Inspection report this follows
  // from" is a required field), not a document that needs its own fresh
  // evidence — sending a technician out with a photo checklist for a
  // document that has nowhere to put photos would be pure busywork.

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

  // documentType is optional and defaults to the standard inspection —
  // every existing caller that doesn't know or care which document is
  // active keeps working exactly as before.
  function forJob(job, jobCategory, documentType) {
    if (!job) return [];
    if (job.jobType === 'termite') {
      if (documentType === 'termite_certificate') return TERMITE_CERTIFICATE_CHECKLIST;
      // Accepts the old id too: a job stamped before the rename must still get
      // the right checklist rather than silently falling through to the
      // full-inspection one, which asks for subfloor and roof-void shots that
      // a monitoring visit never takes.
      if (documentType === 'termite_monitoring' || documentType === 'termite_service_record') {
        return TERMITE_SERVICE_RECORD_CHECKLIST;
      }
      if (documentType === 'termite_action_plan') return [];
      return TERMITE_CHECKLIST;
    }
    if (job.jobType === 'pest_treatment') return PEST_CHECKLISTS[jobCategory] || PEST_DEFAULT_CHECKLIST;
    return [];
  }

  window.PhotoChecklists = { forJob };
})();
