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
  // The inside gets no photo steps: clients do not want their cupboards and
  // belongings photographed. What blocks the view indoors is a set of ticks
  // written into the report (photo-walk.js INSIDE_NOTES), the rooms are
  // `tick` checks, and a photo inside is only taken when there is an issue.
  const CONDUCIVE = { schemaSection: 'conducive', schemaField: 'conducivePhotos' };
  const ACCESS = { schemaSection: 'access', schemaField: 'accessPhotos' };
  // v143: the list Tal agreed on 15 Nov 2026, drawn from what he photographed
  // and commented on across his last 60 Formitize inspections. Each step ends
  // as a photo marked OK or Issue, or as "Not here" (photo-walk.js).
  //
  // A label is also the zone its photos are filed under, so a label is never
  // reworded: a step that was split or replaced stays in the list `hidden`,
  // still filing the photos already taken against it.
  //
  // `tick: true` (the inside) is a check with no photo: OK or Issue, and a
  // photo only when there is an issue to show.
  const TERMITE_CHECKLIST = [
    { id: 'frontElevation', label: 'Front Elevation', area: 'outside' }, // handled by the existing front-photo prompt at Start Inspection
    { id: 'meterBox', label: 'Meter Box', area: 'outside', schemaSection: 'findings', schemaField: 'durableNoticePhotos',
      hint: 'Open it and photograph the inside of the door. The termite durable notice is usually there.',
      okLabel: 'Notice found', issueLabel: 'No notice', photoWhen: 'ok', rollup: { set: ['findings', 'durableNoticeFound'], ok: 'Yes', issue: 'No' } },
    { id: 'slabEdge', label: 'Slab Edge', area: 'outside', ...CONDUCIVE,
      hint: 'Each side of the house. Issue if the slab edge is covered by soil, paving, render or garden beds.',
      rollup: { set: ['conducive', 'slabEdgeComplies'], ok: 'Yes', issue: 'No', details: 'slabEdgeDetails' } },
    { id: 'weepHoles', label: 'Weep Holes', area: 'outside', ...CONDUCIVE,
      hint: 'Issue if weep holes are blocked, buried or bridged.',
      rollup: { set: ['conducive', 'weepHolesClear'], ok: 'Yes', issue: 'No', details: 'weepHoleDetails' } },
    { id: 'hotWater', label: 'Hot Water System', area: 'outside', ...CONDUCIVE,
      hint: 'The relief valve overflow, and where it drains to.',
      rollup: { leak: 'Hot Water Service relief valve' } },
    { id: 'airCon', label: 'Air Con Unit', area: 'outside', ...CONDUCIVE,
      hint: 'The outdoor unit and where its drain drips. Water against a wall draws termites.',
      rollup: { leak: 'Air conditioning overflow' } },
    { id: 'outsideTaps', label: 'Outside Taps', area: 'outside', ...CONDUCIVE,
      hint: 'Leaking taps, and whether there is a drain underneath.',
      rollup: { leak: 'Taps' } },
    { id: 'downpipes', label: 'Downpipes & Gutters', area: 'outside', ...CONDUCIVE,
      hint: 'Downpipes connected to stormwater, not draining against the house. Leaking gutters.',
      rollup: { leak: 'Down Pipes' } },
    { id: 'waterTank', label: 'Water Tank', area: 'outside', ...CONDUCIVE,
      hint: 'The tank and where its overflow drains to.',
      rollup: { set: ['conducive', 'tankDrainageWorkNeeded'], ok: 'No', issue: 'Yes', details: 'tankDetails', present: ['conducive', 'waterTankPresent'] } },
    { id: 'siteDrainage', label: 'Ground Levels & Drainage', area: 'outside', ...CONDUCIVE,
      hint: 'Ground falling toward the house, ponding, garden beds or paving built up against the walls.',
      rollup: { set: ['conducive', 'siteDrainage'], ok: 'Adequate', issue: 'Inadequate', details: 'siteDrainageDetails' } },
    { id: 'subfloorVents', label: 'Subfloor Vents', area: 'outside', ...CONDUCIVE,
      hint: 'Vents in the outside walls. Issue if they are blocked, buried or too few.',
      rollup: { set: ['conducive', 'ventilation'], ok: 'Adequate', issue: 'Inadequate', details: 'ventilationDetails' } },
    { id: 'trees', label: 'Trees & Stumps', area: 'outside', schemaSection: 'conducive', schemaField: 'treePhotos',
      hint: 'Trees close to the house, and any old stumps. Get close to any mud or nest.',
      rollup: { timber: true } },
    { id: 'fences', label: 'Fences & Retaining Walls', area: 'outside', ...CONDUCIVE,
      hint: 'Timber fences, sleepers and retaining walls: decay or termite damage.',
      rollup: { timber: true } },
    { id: 'decksPosts', label: 'Decks, Pergolas & Posts', area: 'outside', ...CONDUCIVE,
      hint: 'Decks, pergolas and verandah posts, especially any timber in or on the ground.',
      rollup: { timber: true } },
    { id: 'sheds', label: 'Sheds & Detached Garage', area: 'outside', ...CONDUCIVE,
      hint: 'Sheds, cubbies and a detached garage: damage, and timber stored inside.',
      rollup: { timber: true } },
    { id: 'baitStations', label: 'Bait / Monitoring Stations', area: 'outside', ...CONDUCIVE,
      hint: 'Any termite stations in the ground or on the walls, and their condition.' },
    { id: 'storedGoods', label: 'Stored Goods Against Walls', area: 'outside', ...ACCESS,
      hint: 'Timber, firewood or belongings stacked against the house. One photo can show several.' },
    { id: 'surroundings', label: 'Surroundings', area: 'outside', ...CONDUCIVE,
      hint: 'What is next door or behind: bushland or large trees within about 75 metres.' },
    { id: 'subfloorEntry', label: 'Subfloor Entry', area: 'subfloor', ...ACCESS,
      hint: 'The way in, and how much clearance there is.',
      blockedHint: 'Show why you could not get in: no access hatch, too low, blocked or unsafe.' },
    { id: 'subfloorGeneral', label: 'Subfloor General View', area: 'subfloor', ...ACCESS,
      hint: 'The view across the subfloor, showing ducting, plumbing or stored goods in the way.' },
    { id: 'antCapping', label: 'Piers & Ant Capping', area: 'subfloor', ...CONDUCIVE,
      hint: 'Issue if ant caps are missing, rusted, damaged or bridged.',
      rollup: { set: ['conducive', 'antCappingCondition'], ok: 'Adequate', issue: 'Inadequate', details: 'antCappingDetails' } },
    { id: 'subfloorTimbers', label: 'Bearers & Joists', area: 'subfloor', ...ACCESS,
      hint: 'Bearers, joists and flooring from below. Get close to any damage, mud leads or decay.',
      rollup: { timber: true } },
    { id: 'subfloorSoil', label: 'Subfloor Soil & Drainage', area: 'subfloor', ...CONDUCIVE,
      hint: 'Issue if the soil is damp or water is ponding.',
      rollup: { set: ['conducive', 'subfloorDrainage'], ok: 'Adequate', issue: 'Inadequate', details: 'subfloorDrainageDetails' } },
    { id: 'subfloorVentilation', label: 'Subfloor Ventilation', area: 'subfloor', ...CONDUCIVE,
      hint: 'Airflow from one side to the other. Issue if vents are blocked or the air is stale and damp.',
      rollup: { set: ['conducive', 'ventilation'], ok: 'Adequate', issue: 'Inadequate', details: 'ventilationDetails' } },
    { id: 'subfloorPlumbing', label: 'Plumbing Under Wet Areas', area: 'subfloor', ...CONDUCIVE,
      hint: 'Pipes under the bathroom, kitchen and laundry. Issue if anything is leaking.',
      rollup: { leak: 'Plumbing under floor' } },
    { id: 'subfloorDebris', label: 'Timber on Subfloor Ground', area: 'subfloor', ...CONDUCIVE,
      hint: 'Offcuts, formwork or stored timber lying on the soil.' },
    { id: 'roofVoidEntry', label: 'Roof Void Entry', area: 'roof', ...ACCESS,
      hint: 'The manhole, and anything that limits getting in or moving about.',
      blockedHint: 'Show why you could not get in: no manhole, sealed, too small, or unsafe.' },
    { id: 'roofGeneral', label: 'Roof Void General View', area: 'roof', ...ACCESS,
      hint: 'The view across the roof void from the manhole.' },
    { id: 'roofTimbers', label: 'Roof Timbers', area: 'roof', ...ACCESS,
      hint: 'Rafters, battens, trusses and top plates. Get close to any damage or mud leads.',
      rollup: { timber: true } },
    { id: 'roofObstructions', label: 'Insulation, Sarking & Ducting', area: 'roof', schemaSection: 'access', schemaField: 'obstructionPhotos',
      hint: 'Whatever covers the timbers. One photo can show several obstructions.' },
    { id: 'roofEdges', label: 'Roof Void Outer Edges', area: 'roof', ...ACCESS,
      hint: 'Toward the eaves, where clearance runs out.' },
    { id: 'roofLeaks', label: 'Roof Leak Signs', area: 'roof', ...CONDUCIVE,
      hint: 'Water staining on timbers, sarking or the ceiling.',
      rollup: { leak: 'Roof' } },
    { id: 'inBathrooms', label: 'Bathrooms & Showers', area: 'inside', tick: true, ...CONDUCIVE,
      hint: 'Moisture reading on the walls, and any leaks.',
      rollup: { leak: 'Bathroom' } },
    { id: 'inKitchen', label: 'Kitchen', area: 'inside', tick: true, ...CONDUCIVE,
      hint: 'Under the sink: leaks, and any treatment sticker.',
      rollup: { leak: 'Kitchen' } },
    { id: 'inLaundry', label: 'Laundry', area: 'inside', tick: true, ...CONDUCIVE,
      hint: 'Moisture reading, and any leaks.',
      rollup: { leak: 'Laundry' } },
    { id: 'inSkirtings', label: 'Skirtings & Architraves', area: 'inside', tick: true, ...ACCESS,
      hint: 'Sounded (tapped) for hollow or damaged timber.',
      rollup: { timber: true } },
    { id: 'inDoorsWindows', label: 'Door Frames & Window Sills', area: 'inside', tick: true, ...ACCESS,
      hint: 'Checked for damage or decay.',
      rollup: { timber: true } },
    { id: 'inWetWalls', label: 'Walls Behind Wet Areas', area: 'inside', tick: true, ...CONDUCIVE,
      hint: 'Moisture reading on the other side of showers and baths.',
      rollup: { set: ['conducive', 'highMoistureFound'], ok: 'No', issue: 'Yes', details: 'moistureDetails', photos: 'moisturePhotos' } },
    { id: 'inGarage', label: 'Attached Garage', area: 'inside', tick: true, ...ACCESS,
      hint: 'Slab edge, and goods stored against the walls.' },
    { id: 'inMould', label: 'Mould', area: 'inside', tick: true, ...CONDUCIVE,
      hint: 'Issue if mould growth was seen anywhere inside.',
      rollup: { set: ['conducive', 'mouldFound'], ok: 'No', issue: 'Yes', details: 'mouldDetails' } },
    // Replaced by the steps above in v143; still file photos already taken.
    { id: 'waterTanks', label: 'Water Tanks / Downpipes', area: 'outside', hidden: true, ...CONDUCIVE },
    { id: 'gardenBeds', label: 'Garden Beds Against Walls', area: 'outside', hidden: true, ...CONDUCIVE },
    { id: 'exteriorTimbers', label: 'External Timbers', area: 'outside', hidden: true, ...CONDUCIVE },
    { id: 'outbuildings', label: 'Sheds & Stored Items', area: 'outside', hidden: true, ...CONDUCIVE },
    { id: 'subfloorConditions', label: 'Subfloor Damp / Ventilation', area: 'subfloor', hidden: true, ...CONDUCIVE },
    { id: 'wetAreas', label: 'Kitchen / Bathroom', area: 'inside', hidden: true, ...CONDUCIVE },
  ];

  // What the client reads beside an item ticked OK (v151). Tal: an OK should
  // still tell the client something typical, without the technician typing.
  // Every sentence says what was SEEN on the day in the places that could be
  // inspected; none of them says a pest is absent.
  const OK_TEXT = {
    slabEdge: 'The slab edge was visible and not covered by soil, paving or garden beds where inspected.',
    weepHoles: 'Weep holes were open and clear where inspected.',
    hotWater: 'The relief valve overflow was piped to a drain or away from the building.',
    airCon: 'The unit’s drain was directed to a drain or away from the building.',
    outsideTaps: 'No leaking taps were seen, and taps drained away from the building.',
    downpipes: 'Downpipes and gutters appeared connected and were not discharging against the building.',
    waterTank: 'No leak or overflow against the building was seen.',
    siteDrainage: 'The ground fell away from the building and no ponding was seen.',
    subfloorVents: 'Subfloor vents were open and unobstructed where inspected.',
    trees: 'No evidence of timber pest activity was seen in the trees and stumps inspected.',
    fences: 'No evidence of timber pest activity or damage was seen in the fences and retaining walls inspected.',
    decksPosts: 'No evidence of timber pest activity or damage was seen in the decks, pergolas and posts inspected.',
    sheds: 'No evidence of timber pest activity or damage was seen in the outbuildings inspected.',
    baitStations: 'The stations seen were in place and in serviceable condition.',
    storedGoods: 'Nothing was stored against the outside walls where inspected.',
    surroundings: 'No bushland or large trees close to the building were noted.',
    subfloorEntry: 'The subfloor was entered and inspected where clearance allowed.',
    subfloorGeneral: 'The accessible subfloor was inspected.',
    antCapping: 'Ant capping was in place and in sound condition where it could be seen.',
    subfloorTimbers: 'No evidence of timber pest activity or damage was seen in the bearers, joists and flooring that could be inspected.',
    subfloorSoil: 'The subfloor soil was dry and no ponding was seen.',
    subfloorVentilation: 'Subfloor ventilation appeared adequate.',
    subfloorPlumbing: 'No leaks were seen in the plumbing under the wet areas.',
    subfloorDebris: 'No loose timber was seen lying on the subfloor ground.',
    roofVoidEntry: 'The roof void was entered and inspected where clearance allowed.',
    roofGeneral: 'The accessible roof void was inspected.',
    roofTimbers: 'No evidence of timber pest activity or damage was seen in the roof timbers that could be inspected.',
    roofObstructions: 'Nothing covered the roof timbers where inspected.',
    roofEdges: 'The outer edges of the roof void were inspected as far as clearance allowed.',
    roofLeaks: 'No water staining was seen on the roof timbers, sarking or ceiling.',
    inBathrooms: 'No leaks were seen and moisture readings were normal.',
    inKitchen: 'No leaks were seen under the sink.',
    inLaundry: 'No leaks were seen and moisture readings were normal.',
    inSkirtings: 'Skirtings and architraves sounded solid where they could be reached.',
    inDoorsWindows: 'No damage or decay was seen in the door frames and window sills inspected.',
    inWetWalls: 'Moisture readings on the walls behind the wet areas were normal.',
    inGarage: 'No issue was seen in the attached garage.',
    inMould: 'No mould growth was seen inside.',
  };
  // And for an Issue with no note typed (v156): found printing a bare
  // "Issue." in the client's report. What the Issue means for that item, in
  // the same "was seen" terms. A typed note is printed after it.
  const ISSUE_TEXT = {
    slabEdge: 'The slab edge was covered by soil, paving, render or garden beds in places, hiding termite entry from view.',
    weepHoles: 'Weep holes were blocked, buried or bridged in places.',
    hotWater: 'The relief valve overflow was discharging onto the ground beside the building.',
    airCon: 'The unit’s drain was discharging against or beside the building.',
    outsideTaps: 'A tap was leaking, or draining onto the ground beside the building.',
    downpipes: 'A downpipe or gutter was leaking, disconnected or discharging against the building.',
    waterTank: 'The tank or its overflow was leaking or discharging near the building.',
    siteDrainage: 'Ground levels or drainage directed water toward the building, or ponding was seen.',
    subfloorVents: 'Subfloor vents were blocked, buried or too few.',
    trees: 'A concern was noted in the trees or stumps close to the building.',
    fences: 'Timber pest activity, damage or decay was seen in the fences or retaining walls.',
    decksPosts: 'Timber pest activity, damage or decay was seen in the decks, pergolas or posts.',
    sheds: 'Timber pest activity, damage or decay was seen in an outbuilding.',
    baitStations: 'A station was missing, damaged or in poor condition.',
    storedGoods: 'Timber or belongings were stored against the outside walls, a conducive condition and an obstruction to inspection.',
    surroundings: 'Bushland or large trees close to the building increase the risk of termite attack.',
    subfloorEntry: 'Access to the subfloor was limited.',
    subfloorGeneral: 'Parts of the subfloor were obstructed.',
    antCapping: 'Ant capping was missing, rusted, damaged or bridged in places.',
    subfloorTimbers: 'Timber pest activity, damage or decay was seen in the subfloor timbers.',
    subfloorSoil: 'The subfloor soil was damp or water was ponding.',
    subfloorVentilation: 'Subfloor ventilation appeared inadequate.',
    subfloorPlumbing: 'A leak was seen in the plumbing under the wet areas.',
    subfloorDebris: 'Loose timber was lying on the subfloor ground.',
    roofVoidEntry: 'Access to the roof void was limited.',
    roofGeneral: 'Parts of the roof void were obstructed.',
    roofTimbers: 'Timber pest activity, damage or decay was seen in the roof timbers.',
    roofObstructions: 'Insulation, sarking or ducting covered the roof timbers in places, limiting the inspection.',
    roofEdges: 'The outer edges of the roof void could not be fully inspected.',
    roofLeaks: 'Water staining was seen on the roof timbers, sarking or ceiling.',
    inBathrooms: 'A leak or elevated moisture reading was found in a bathroom.',
    inKitchen: 'A leak was found in the kitchen.',
    inLaundry: 'A leak or elevated moisture reading was found in the laundry.',
    inSkirtings: 'Skirtings or architraves sounded hollow or showed damage.',
    inDoorsWindows: 'Damage or decay was seen in a door frame or window sill.',
    inWetWalls: 'An elevated moisture reading was found on a wall behind a wet area.',
    inGarage: 'An issue was found in the attached garage.',
    inMould: 'Mould growth was seen inside, an indicator of elevated moisture.',
  };
  for (const item of TERMITE_CHECKLIST) {
    if (OK_TEXT[item.id]) item.okText = OK_TEXT[item.id];
    if (ISSUE_TEXT[item.id]) item.issueText = ISSUE_TEXT[item.id];
  }

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
