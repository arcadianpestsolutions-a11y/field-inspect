// The termite management lifecycle — the three documents that follow an
// inspection when termites are found or a barrier is installed.
//
// WHY THESE EXIST
// The app has always had one termite report, which conflated two different
// standards and covered only the inspection. Arcadian's actual record shows
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
        { id: 'signedOnBehalfOf', label: 'Signed on behalf of', type: 'static', default: 'Arcadian Pest Solutions' },
        { id: 'inspectorSignature', label: 'Technician Signature', type: 'signature', required: true },
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
        {
          id: 'riskLevel', label: 'Risk of further attack', type: 'select', required: true,
          options: ['LOW', 'MODERATE', 'HIGH'], aiFillable: true,
        },
      ],
    },
    {
      id: 'proposedWorks', number: 3, title: 'Proposed Management',
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
        { id: 'estimatedDuration', label: 'Estimated time on site', type: 'text' },
      ],
    },
    {
      id: 'warranty', number: 4, title: 'Warranty & Ongoing Requirements',
      subtitle: 'What is guaranteed, for how long, and what the client must do to keep it.',
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
          options: ['Annual inspection by Arcadian Pest Solutions',
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
        { id: 'quoteValidUntil', label: 'Quote valid until', type: 'date' },
      ],
    },
    {
      id: 'terms', number: 5, title: 'Terms & Conditions',
      subtitle: 'Terms applying to the proposed works.', icon: '📖', color: '#475569', fixed: true, fields: [],
    },
    inspectorSection(6),
    {
      id: 'acknowledgement', number: 7, title: 'Client Acceptance',
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
        { id: 'productsUsed', label: 'Products installed', type: 'productList', required: true },
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
      ],
    },
    {
      id: 'durableNotice', number: 3, title: 'Durable Notice',
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
      ],
    },
    {
      id: 'warranty', number: 4, title: 'Warranty & Next Inspection',
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
        { id: 'nextInspectionDue', label: 'Next inspection due', type: 'date', required: true },
        { id: 'warrantyConditions', label: 'Conditions and exclusions', type: 'textarea' },
      ],
    },
    {
      id: 'terms', number: 5, title: 'Terms & Conditions',
      subtitle: 'Terms applying to this certificate.', icon: '📖', color: '#475569', fixed: true, fields: [],
    },
    inspectorSection(6),
    {
      id: 'acknowledgement', number: 7, title: 'Client Acknowledgement',
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
  const TERMITE_SERVICE_RECORD_SCHEMA = [
    clientSection(1, 'Client & Property', 'The property and the system being serviced.'),
    {
      id: 'systemServiced', number: 2, title: 'System Being Serviced',
      subtitle: 'What is installed here and when it went in.',
      icon: '🧱', color: '#0369a1',
      fields: [
        {
          id: 'systemType', label: 'System installed', type: 'select', required: true,
          options: ['Termite baiting system', 'Chemical soil treated zone', 'Reticulation system',
            'Physical barrier', 'Combination — see notes'],
        },
        { id: 'installedDate', label: 'Date system installed', type: 'date' },
        { id: 'serviceNumber', label: 'Which service visit is this? (e.g. 4th)', type: 'text' },
        { id: 'lastServiceDate', label: 'Date of previous service', type: 'date' },
      ],
    },
    {
      id: 'stations', number: 3, title: 'Stations & System Condition',
      subtitle: 'Every station inspected this visit, and what was in it.',
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
      subtitle: 'What the visit turned up.',
      icon: '🔍', color: '#b45309',
      fields: [
        { id: 'servicePhotos', label: 'Photos from this service', type: 'photos', triggersAiFill: true },
        {
          id: 'activityFound', label: 'Termite activity found in any station?', type: 'yesno',
          required: true, aiFillable: true,
        },
        {
          id: 'activityDetail', label: 'Which stations, and what was observed', type: 'textarea',
          required: true, showIf: { field: 'activityFound', equals: 'Yes' }, aiFillable: true,
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
      id: 'recommendations', number: 5, title: 'Recommendations & Next Service',
      subtitle: 'What the client should do, and when you are back.',
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
            'Lapsed — service overdue'],
          default: 'Current — maintained by this service',
        },
        { id: 'nextServiceDue', label: 'Next service due', type: 'date', required: true },
        { id: 'serviceNotes', label: 'Notes', type: 'textarea', aiFillable: true },
      ],
    },
    {
      id: 'terms', number: 6, title: 'Terms & Conditions',
      subtitle: 'Terms applying to this service.', icon: '📖', color: '#475569', fixed: true, fields: [],
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
  window.TERMITE_SERVICE_RECORD_SCHEMA = TERMITE_SERVICE_RECORD_SCHEMA;
})();
