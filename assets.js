// Assets — the stations physically installed at a property, and what each one
// has done over its life.
//
// WHY THIS IS A VIEW AND NOT ANOTHER STORE.
// The obvious build is a separate asset table that the report writes into.
// That would mean two records of the same station, kept in step by hope: a
// technician who edits the register on a visit would have to have that edit
// land in both, and the day they disagree is the day the warranty evidence
// stops being evidence.
//
// The station register already exists, already carries forward between
// visits, and is already where a technician manages stations. So an asset
// here is derived from the reports rather than stored beside them. Nothing to
// keep in sync, nothing to migrate, and the register a technician edits on
// site is the register the history is built from.
//
// What DID have to change is identity. carryForwardStations used to mint a
// fresh id for every station every visit, so station 7 was a different row
// each time and its history could only be reconstructed by matching printed
// numbers and trusting nobody had renumbered anything. Stations now carry an
// assetId for the life of the physical station — see report.js — and that id
// is what a QR sticker on the cap encodes.
//
// Pure: reports and jobs in, assets out. No DOM, no database.
(() => {
  'use strict';

  // A property, not a job. Jobs recur — a standing termite programme is a new
  // job every visit — so a station belongs to the address, and the chain of
  // recurring jobs is what ties those visits together.
  function propertyKeyFor(job, jobsById) {
    if (!job) return '';
    let root = job;
    const seen = new Set();
    while (root.recurringFromId && jobsById[root.recurringFromId] && !seen.has(root.id)) {
      seen.add(root.id);
      root = jobsById[root.recurringFromId];
    }
    return root.id;
  }

  const STATION_FIELDS = ['stationRecords'];

  // Every station row in a report, whichever section it is in. Termite
  // monitoring and rodent registers use the same field name in different
  // sections, and an asset does not care which.
  function stationsIn(report) {
    const out = [];
    if (!report || !report.sections) return out;
    for (const [sectionId, values] of Object.entries(report.sections)) {
      if (!values) continue;
      for (const field of STATION_FIELDS) {
        const rows = values[field];
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
          if (row && row.assetId) out.push({ ...row, sectionId });
        }
      }
    }
    return out;
  }

  const visitTime = (report, job) =>
    report.finalizedAt || (job && job.inspectionEndedAt) || report.updatedAt || 0;

  // The register for one property: every station ever recorded there, with
  // what it did on each visit, newest first.
  function registerFor(opts) {
    const o = opts || {};
    const jobs = o.jobs || [];
    const reports = o.reports || [];
    const jobsById = {};
    for (const j of jobs) jobsById[j.id] = j;

    const wanted = o.propertyKey;
    const byAsset = new Map();

    for (const report of reports) {
      const job = jobsById[report.jobId];
      if (!job) continue;
      if (wanted && propertyKeyFor(job, jobsById) !== wanted) continue;

      for (const row of stationsIn(report)) {
        if (!byAsset.has(row.assetId)) {
          byAsset.set(row.assetId, {
            assetId: row.assetId,
            kind: row.sectionId === 'rodentStations' ? 'rodent_station' : 'termite_station',
            stationNumber: row.stationNumber || '',
            location: row.location || '',
            propertyKey: propertyKeyFor(job, jobsById),
            address: job.address || '',
            history: [],
          });
        }
        const asset = byAsset.get(row.assetId);
        // The most recent visit wins for the label and the position, because
        // a station that was renumbered or moved is renumbered or moved from
        // then on rather than retrospectively.
        const at = visitTime(report, job);
        const newest = asset.history.length ? asset.history[0].at : -1;
        if (at >= newest) {
          if (row.stationNumber) asset.stationNumber = row.stationNumber;
          if (row.location) asset.location = row.location;
        }
        asset.history.push({
          at,
          jobId: job.id,
          status: row.status || '',
          action: row.action || '',
          note: row.note || '',
        });
        asset.history.sort((a, b) => b.at - a.at);
      }
    }

    const assets = Array.from(byAsset.values());
    // Sorted the way a technician walks them: by number, numerically, so
    // station 10 comes after station 9 rather than after station 1.
    assets.sort((a, b) => {
      const an = parseInt(a.stationNumber, 10);
      const bn = parseInt(b.stationNumber, 10);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
      return String(a.stationNumber).localeCompare(String(b.stationNumber));
    });
    return assets;
  }

  // Every property that has stations, for the register's front page.
  function propertiesWithStations(opts) {
    const o = opts || {};
    const jobs = o.jobs || [];
    const reports = o.reports || [];
    const jobsById = {};
    for (const j of jobs) jobsById[j.id] = j;

    const byProperty = new Map();
    for (const report of reports) {
      const job = jobsById[report.jobId];
      if (!job) continue;
      const rows = stationsIn(report);
      if (!rows.length) continue;
      const key = propertyKeyFor(job, jobsById);
      const at = visitTime(report, job);
      if (!byProperty.has(key)) {
        byProperty.set(key, {
          propertyKey: key,
          name: (jobsById[key] && jobsById[key].name) || job.name || '',
          address: (jobsById[key] && jobsById[key].address) || job.address || '',
          stations: new Set(),
          lastVisitAt: 0,
        });
      }
      const p = byProperty.get(key);
      for (const r of rows) p.stations.add(r.assetId);
      if (at > p.lastVisitAt) p.lastVisitAt = at;
    }

    return Array.from(byProperty.values())
      .map((p) => ({ ...p, stationCount: p.stations.size, stations: undefined }))
      .sort((a, b) => b.lastVisitAt - a.lastVisitAt);
  }

  // What a QR sticker on a station cap carries.
  //
  // A plain scope: URL rather than bare text, so a phone's own camera app —
  // which is what somebody will point at it before they ever open Scope —
  // shows something meaningful instead of a line of gibberish. It is
  // deliberately NOT an https link to the app: that would open a browser tab
  // and lose the report the technician has open. The app's own scanner reads
  // this directly.
  //
  // Nothing about the client is in it. A sticker on the outside of a bait
  // station in a front garden is readable by anyone walking past, so it
  // carries an opaque id and nothing else — no address, no name, no job.
  function qrPayload(assetId) {
    return `scope:station:${assetId}`;
  }

  function parseQr(text) {
    const m = /^scope:station:([A-Za-z0-9_-]+)$/.exec(String(text || '').trim());
    return m ? m[1] : null;
  }

  window.Assets = {
    propertyKeyFor,
    stationsIn,
    registerFor,
    propertiesWithStations,
    qrPayload,
    parseQr,
  };
})();
