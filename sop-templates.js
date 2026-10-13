// Starter SOPs (v122). DRAFTS to start from, written from how Scope already
// works, not finished procedures: each one lands in the library as a draft,
// and only becomes a procedure when the business has read it, changed what
// does not match how it actually works, and approved it.
//
// Not legal or compliance advice. Check each against the product label, the
// SDS, the current Standards and your state's rules before approving it.
//
// Body format (sops-ui.js renders it): "## " starts a heading, "- " a bullet,
// "1. " a numbered step, a blank line a new paragraph.
//
// EXPOSES: window.SopTemplates = [{ key, title, category, body }]

(() => {
  'use strict';

  window.SopTemplates = [
    {
      key: 'timber-pest-inspection',
      title: 'Timber pest inspection',
      category: 'Inspection',
      body: `## Purpose
A visual, non-invasive timber pest inspection to AS 4349.3-2010, using the inspection methodology of AS 3660.2-2017 where it applies, reported the same way every time.

## Before the visit
1. Book the job in Scope as a Timber Pest Inspection, with the client's email and a time.
2. Leave "Email the inspection agreement" ticked, so the client reads and signs the scope and limitations before you arrive.
3. Check the agreement is signed (Client link on the job). If not, get it signed on site before starting.
4. Check the moisture meter (see the equipment check SOP) and the torch, ladder and PPE.

## On site
1. Start Inspection in Scope and take the front photo first, phone held sideways.
2. Follow the photo walk in order: outside, then the subfloor, then the roof void.
3. Answer the subfloor and roof void questions truthfully. If you cannot get in, say so and photograph why.
4. Inside: no photos of furniture or stored belongings. Tick what blocked the view. Photograph inside only for damage or damp.
5. Take moisture readings where conditions suggest it and record any high readings.
6. Do not disturb active termite workings. Note them, photograph them, and tell the client.

## The report
1. Generate Form, then check every AI suggestion yourself. Never accept a finding you did not see.
2. Record areas not inspected and why, in Areas We Were Unable to Inspect.
3. Finalize only when every section is complete. Send it to the client from Scope.

## Records
Keep the report, photos and notes for at least three years (Scope keeps them).`,
    },
    {
      key: 'chemical-handling',
      title: 'Pesticide handling, storage and spills',
      category: 'Chemicals',
      body: `## Purpose
Use, carry and store pesticides safely and as the label requires, and record every application.

## Using a product
1. Read the label and the SDS before use. The label directions are the law: rate, method, re-entry and any restrictions.
2. Wear the PPE the label and SDS require.
3. Never decant into food or drink containers. Use labelled containers only.
4. Record every application in the Scope service report: product, batch, rate, area, method and date.

## Carrying and storing
- Upright, secured, in a ventilated, locked compartment, away from food and people.
- Keep the SDS for every product carried, in the vehicle and in the office.
- Keep stock rotated; dispose of expired product through an approved disposal service.

## Spills
1. Stop the source if safe to do so, keep people and pets away.
2. Contain with absorbent material from the spill kit. Do not wash into drains or soil.
3. Bag and label the waste for disposal.
4. Record what happened, and report it if your state's rules or the SDS require it.

## Records
Keep application records for at least the period your state requires (NSW: 3 years).`,
    },
    {
      key: 'roof-subfloor-safety',
      title: 'Working in roof voids and subfloors',
      category: 'Safety',
      body: `## Purpose
Get into roof voids and subfloors safely, or record why you did not.

## Before going in
1. Someone knows where you are and roughly how long you will be.
2. Check for heat, live wiring, damaged or loose insulation, possible asbestos, sharp fixings, animals and poor footing.
3. Use the right ladder, set at the right angle, on firm ground. Three points of contact.
4. Wear the PPE for the space: knee pads, gloves, torch, P2 mask where there is dust or insulation.

## Do not go in when
- It is too hot to work safely, or there is no safe footing.
- There is visible damage that suggests asbestos, or exposed live wiring.
- The access is too small or blocked.

If you do not go in, answer "Yes, but I can't get in" in the Scope photo walk and photograph why. The report then says the area could not be accessed.

## Afterwards
Report any hazard found to the client in the report, and to the business if it needs a follow-up.`,
    },
    {
      key: 'reports-and-records',
      title: 'Client reports, records and privacy',
      category: 'Records',
      body: `## Purpose
Every client gets a complete, accurate report, and their information is looked after.

## Reports
1. Finalize a report only when it is complete and checked.
2. A finalized report is changed only by amendment, with a reason. Scope records who changed what.
3. Send reports from Scope, to the client's own email, and to nobody else without the client's permission.

## Records
- Reports, photos, agreements and invoices are kept for at least three years.
- Back up weekly (see the backup runbook) and check a restore works.

## Privacy
- Client details are used only to do the work and to remind them of it.
- A client who asks to stop receiving messages is opted out straight away.
- Never send client details to a personal email or messaging app.`,
    },
    {
      key: 'complaints-corrective-action',
      title: 'Complaints and corrective action',
      category: 'Quality',
      body: `## Purpose
Every complaint or mistake is fixed, and the cause is fixed so it does not happen again.

## When a client complains, or something goes wrong
1. Record it the same day: who, what, when, which job.
2. Acknowledge it with the client within one business day.
3. Fix the immediate problem: revisit, amend the report with a reason, re-treat, refund.
4. Work out why it happened. Was it the procedure, the training, the equipment, or a one-off?
5. Change what caused it: update the SOP, retrain, replace equipment. Record what was changed.
6. Check later that the change worked.

## Review
Look over all complaints and corrective actions at least once a year, as part of the management review.`,
    },
    {
      key: 'document-control',
      title: 'Document control: how this library works',
      category: 'Quality',
      body: `## Purpose
Everyone works to the current, approved version of each procedure.

## Rules
1. Each procedure has a code, an owner and a version number.
2. A new procedure, or a change to one, is a draft until an admin approves it. The approved version stays in force until then.
3. Each procedure is reviewed at least once a year (or as set). A review with no changes is recorded too.
4. Staff sign "I have read this" for each new version that applies to them.
5. Old versions are kept, never overwritten. A procedure no longer used is retired, not deleted.
6. Printed copies are uncontrolled. The library in Scope is the current version.`,
    },
    {
      key: 'equipment-check',
      title: 'Moisture meter and equipment checks',
      category: 'Quality',
      body: `## Purpose
Measuring equipment gives readings that can be relied on in a report.

## Moisture meter
1. Before each inspection day, check the meter powers on and the battery is good.
2. Check it against its test block or reference (per the maker's instructions) at least monthly, and record the result.
3. If it reads outside tolerance, stop using it, label it, and have it checked or replaced.

## Other equipment
- Ladders: inspect before use; tag out anything damaged.
- Torches and cameras: charged and working before the day.
- Spray equipment: check for leaks and calibration as the maker requires.

## Records
Keep a dated record of every check, and of what was done when something failed.`,
    },
  ];
})();
