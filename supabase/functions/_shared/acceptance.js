// What the client is being asked to agree to, and whether what came back is
// an agreement at all.
//
// Shared between the client-portal Edge Function (which runs under Deno) and
// the browser test suite, which is why it is a plain ES module with no imports
// and no platform calls. Same arrangement as _shared/reminder-sms.js: the
// rules that decide what goes in front of somebody signing a contract are
// worth having a test on, and a rule that only exists inside a Deno handler
// cannot have one.

export const MAX_SIGNATURE_CHARS = 400_000;
export const MAX_NAME_CHARS = 120;

export const str = (v) => (v == null ? '' : String(v)).trim();

const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

// Named fields out of the report, one at a time. NOT a spread, and not a loop
// over whatever keys happen to be there: `sections` holds the technician's
// findings, the audit trail and the photographs, and the only things that
// leave the portal function are the ones written out below.
//
// These ids are the Termite Management Action Plan's own — see
// termite-management-schemas.js. A document that has none of them produces
// null and the portal simply shows no quote block, which is correct: a
// monitoring report has no price to agree to.
//
// The quoted amount is the thing that makes this a quote. Without it there is
// nothing to put a number next to, so there is nothing to show.
export function quoteFrom(sections) {
  if (!sections || typeof sections !== 'object') return null;
  const warranty = sections.warranty || {};
  const works = sections.proposedWorks || {};

  const amount = str(warranty.quotedAmount);
  if (!amount) return null;

  return {
    amount,
    validUntil: str(warranty.quoteValidUntil) || null,
    method: list(works.managementMethod),
    extent: str(works.treatmentExtent) || null,
    duration: str(works.estimatedDuration) || null,
    // A warranty period is only shown when a warranty was actually offered.
    // Showing "12 months" next to "Warranty offered? No" because the period
    // field still held a leftover value would be a promise nobody made.
    warrantyPeriod: str(warranty.warrantyOffered) === 'Yes'
      ? (str(warranty.warrantyPeriod) || null) : null,
    warrantyConditions: str(warranty.warrantyOffered) === 'Yes'
      ? list(warranty.warrantyConditions) : [],
    reinspection: str(warranty.reinspectionInterval) || null,
  };
}

// Whether the acceptance section was already signed in person. The portal is
// told the boolean so it stops asking a client to agree to something they
// already signed in front of the technician — two conflicting acceptances of
// one quote is exactly the mess worth not creating.
export function signedOnSite(sections) {
  if (!sections || typeof sections !== 'object') return false;
  return !!str((sections.acknowledgement || {}).clientSignature);
}

// Returns an error code, or null when the submission is an acceptance.
//
// Shape is checked before length, so a wrong KIND of value is named as the
// wrong kind rather than as too big — "that signature did not come through"
// when the real problem is that no signature was drawn sends somebody back to
// try the same thing again.
//
// The length cap is not a guess at how big a real signature is. It is a bound:
// without one, a public endpoint accepts an arbitrarily large string from
// anybody holding a link.
export function checkAcceptance({ name, signature }) {
  const cleanName = str(name).slice(0, MAX_NAME_CHARS);
  if (cleanName.length < 2) return 'need-name';
  const sig = str(signature);
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig)) return 'need-signature';
  if (sig.length > MAX_SIGNATURE_CHARS) return 'signature-too-big';
  return null;
}
