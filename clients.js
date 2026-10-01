// Clients — who the work is for, as a record rather than four fields retyped
// onto every job.
//
// THE DISTINCTION THAT MAKES THIS WORK: A CLIENT IS NOT A PROPERTY.
// A client is who you talk to and who pays. A property is where the work
// happens. One client can have four properties, and one property can change
// hands and belong to a different client next year. So the job keeps the
// property address and the client keeps the contact details, and neither
// tries to be the other.
//
// THE JOB KEEPS ITS OWN COPY OF THE CLIENT'S DETAILS. THIS IS DELIBERATE.
// The tempting design is for a job to read the client's name and phone live
// from the client record, so one edit fixes everything. That would be wrong
// here: a finalised report is a compliance document, and the client details
// printed on it are part of what was signed. Reading them live means changing
// a phone number silently rewrites the client block on every report ever
// issued — the same failure report.js already documents for `static` fields
// rendering a schema default instead of the stored value.
//
// So `clientId` is a POINTER, used for finding, grouping and prefilling a new
// job. It never rewrites a job that already exists. Edit a client and
// yesterday's report still says what it said yesterday.
//
// Pure: records in, decisions out. No DOM, no database.
(() => {
  'use strict';

  // "0412 345 678", "0412345678" and "(04) 1234 5678" are one number. Digits
  // only is the sole reliable comparison. Mirrors DB._normalizePhone, and the
  // same expression is used by the SQL backfill in migration 029 so the app
  // and the database agree about who is the same person.
  const normalisePhone = (phone) => String(phone || '').replace(/\D/g, '');
  const normaliseEmail = (email) => String(email || '').trim().toLowerCase();

  // Same person if EITHER the phone or the email matches. A returning client
  // often gives a different phone — a new number, or a partner booking this
  // time — while keeping the same email, or the other way round. Requiring
  // both to match would split one client into several.
  function isSameClient(a, b) {
    if (!a || !b) return false;
    const pa = normalisePhone(a.phone || a.clientPhone);
    const pb = normalisePhone(b.phone || b.clientPhone);
    const ea = normaliseEmail(a.email || a.clientEmail);
    const eb = normaliseEmail(b.email || b.clientEmail);
    if (pa && pb && pa === pb) return true;
    if (ea && eb && ea === eb) return true;
    return false;
  }

  // What to call them in a list. Falls back through what is actually known
  // rather than showing a blank row — an unnamed client with a phone number
  // is still findable by that number.
  function labelFor(client) {
    if (!client) return 'Client';
    const name = String(client.name || '').trim();
    if (name) return name;
    if (client.phone) return client.phone;
    if (client.email) return client.email;
    return 'Unnamed client';
  }

  // Which existing client a set of contact details belongs to, if any.
  // Returns null rather than guessing when nothing matches.
  function matchClient(clients, details) {
    if (!details) return null;
    const phone = normalisePhone(details.phone || details.clientPhone);
    const email = normaliseEmail(details.email || details.clientEmail);
    if (!phone && !email) return null;
    return (clients || []).find((c) => isSameClient(c, { phone, email })) || null;
  }

  // Everything known about one client, assembled from their jobs. The client
  // record holds contact details; the history is derived, the same way the
  // station register is derived from reports rather than kept in step by hand.
  function summarise(client, jobs) {
    const theirs = (jobs || []).filter((j) => j.clientId === client.id);
    // A client's properties are the distinct addresses across their jobs.
    // Deduplicated loosely, because "12 Smith St" and "12 Smith Street" are
    // one place and a list that shows both looks broken.
    const seen = new Map();
    for (const job of theirs) {
      const addr = String(job.address || '').trim();
      if (!addr) continue;
      const key = addr.toLowerCase().replace(/\b(st|street|rd|road|ave|avenue|cres|crescent|pl|place|dr|drive)\b\.?/g, '')
        .replace(/[^a-z0-9]/g, '');
      if (!seen.has(key)) seen.set(key, { address: addr, jobs: 0, lastAt: 0 });
      const entry = seen.get(key);
      entry.jobs++;
      const at = job.inspectionEndedAt || job.scheduledAt || job.createdAt || 0;
      if (at > entry.lastAt) { entry.lastAt = at; entry.address = addr; }
    }
    const properties = Array.from(seen.values()).sort((a, b) => b.lastAt - a.lastAt);

    const dueNext = theirs
      .filter((j) => j.nextDueAt)
      .sort((a, b) => a.nextDueAt - b.nextDueAt)[0] || null;

    return {
      client,
      jobs: theirs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
      jobCount: theirs.length,
      properties,
      lastJobAt: theirs.reduce((max, j) => Math.max(max, j.inspectionEndedAt || j.createdAt || 0), 0),
      nextDueAt: dueNext ? dueNext.nextDueAt : null,
    };
  }

  // The fields a new job inherits when a client is chosen. Only the contact
  // details: the property address is the job's own, because this client may
  // have four of them and the one being booked is not knowable from here.
  function jobDefaultsFrom(client) {
    return {
      name: client.name || '',
      clientPhone: client.phone || '',
      clientEmail: client.email || '',
      clientId: client.id,
    };
  }

  window.Clients = {
    normalisePhone,
    normaliseEmail,
    isSameClient,
    labelFor,
    matchClient,
    summarise,
    jobDefaultsFrom,
  };
})();
