// The timber pest inspection agreement a client signs before the visit
// (migration 034). What it says, whether a job is one that has it, and
// whether it was already signed on the day.
//
// Shared between the client-portal Edge Function (Deno), send-client-message
// (which puts the link in the booking confirmation) and the browser test
// suite, which is why it is a plain ES module with no imports and no platform
// calls. Same arrangement as acceptance.js beside it.
//
// THE WORDING is the report's own fixed terms (FIXED_TERMS_HTML in report.js)
// said BEFORE the inspection instead of after it, plus what to have ready on
// the day. It is versioned: the version and the exact paragraphs go into the
// acceptance row's `presented` snapshot, so if this text is ever changed, what
// an earlier client agreed to is still on record word for word. Change the
// wording, change AGREEMENT_VERSION.
//
// Not legal advice. Have a solicitor read it before relying on it.

export const AGREEMENT_VERSION = 'tpi-agreement-2026-10-13';

export const str = (v) => (v == null ? '' : String(v)).trim();

export const AGREEMENT_TERMS = [
  {
    heading: 'What we will inspect',
    text: 'A visual, non-invasive timber pest inspection of the property, carried out in accordance with '
      + 'AS 4349.3-2010 (Inspection of buildings — Timber pest inspections), using the inspection '
      + 'methodology of AS 3660.2-2017 where it applies. It looks for the four timber pest categories in '
      + 'that Standard: subterranean termites, dampwood termites, borers of seasoned timber, and wood decay fungi.',
  },
  {
    heading: 'What it does not cover',
    text: 'Drywood termites and mould are outside the scope of the Standard. If we see signs of them, or of '
      + 'any other pest outside the scope, we will note it in the report and recommend a specialist inspection.',
  },
  {
    heading: 'Non-invasive',
    text: 'We will not cut into, dismantle or remove any part of the building, its linings, coverings or '
      + 'insulation, and we will not move furniture or stored belongings. Timber pest activity and damage '
      + 'can be hidden behind or within any of these and not be found by an inspection of this kind.',
  },
  {
    heading: 'Areas we cannot get to',
    text: 'Areas that are inaccessible, obstructed, restricted or unsafe on the day will not be inspected, '
      + 'and the report will list them. Termite activity and damage that cannot be detected may be present '
      + 'despite the inspection.',
  },
  {
    heading: 'Access on the day',
    text: 'Please have someone home to let us in, and make sure we can get to the meter box, the subfloor '
      + 'access, the roof void manhole and under the sinks. Pets secured, please.',
  },
  {
    heading: 'The report',
    text: 'The report is for you, the client, and nobody else may rely on it. We keep records of the '
      + 'inspection, including photographs and the report, for at least three years (AS 3660.2-2017).',
  },
  {
    heading: 'Your rights',
    text: 'Nothing in this agreement excludes, restricts or changes any guarantee or right you have under '
      + 'the Australian Consumer Law.',
  },
];

// Whether this is a job that has the agreement at all. A timber pest
// inspection, or a termite job whose document has not been chosen yet (a new
// booking defaults to the inspection). Not a monitoring visit, a certificate,
// an action plan or a general pest treatment: none of those start with this
// agreement, and putting one in front of a client would be a contract for
// something they did not book.
export function needsAgreement(jobType, documentType) {
  if (str(jobType) === 'pest_treatment') return false;
  const doc = str(documentType);
  return doc === '' || doc === 'timber_pest_inspection';
}

// Whether the agreement section was already signed in person, so the portal
// stops asking.
export function agreementSignedOnSite(sections) {
  if (!sections || typeof sections !== 'object') return false;
  return !!str((sections.agreement || {}).agreementSignature);
}

// What the page shows and what is frozen into `presented`. Named fields only:
// `sections` holds the technician's findings and none of that leaves here.
// The one thing read from the report is what the technician wrote as access
// limitations already agreed (agreement.agreedAccessLimitations), because the
// client is agreeing to those too.
export function agreementFrom({ sections, address, scheduledAt }) {
  const agreement = (sections && typeof sections === 'object' && sections.agreement) || {};
  return {
    version: AGREEMENT_VERSION,
    address: str(address),
    scheduledAt: Number(scheduledAt) || null,
    terms: AGREEMENT_TERMS.map((t) => ({ heading: t.heading, text: t.text })),
    accessLimitations: str(agreement.agreedAccessLimitations).slice(0, 2000) || null,
  };
}
