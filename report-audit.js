// The pure rules of the audit trail and the AI accuracy readout.
//
// These were inside report.js, which at four thousand lines is the largest
// piece of structural debt in the project. They are the part of it that is
// pure — values in, answer out, no DOM, no report state, no database — which
// is exactly what makes them safe to move and worth testing directly.
//
// WHAT MOVED: summarising a value for the log, deciding whether two values
// are the same answer, diffing a section before and after, and totalling the
// AI's kept-versus-corrected record across reports.
//
// WHAT DID NOT: recordAiReview, auditActor and appendAudit stay in report.js
// because each one reads or writes the open report, the current section or the
// signed-in user. Moving those would have meant passing half of report.js's
// state through a parameter list, which is a different and riskier change.
//
// Loaded before report.js, which reads these from window.ReportAudit.
(() => {
  'use strict';

  const AUDIT_TEXT_LIMIT = 140;

  // Audit entries must stay small and readable. Values here can be a 200KB
  // sketch data URL or an array of photo blobs, so nothing is ever stored
  // verbatim — what's recorded is enough to see that a change happened and
  // what kind, without turning the report row into a media archive.
  function summariseValue(value) {
    if (value === undefined || value === null || value === '') return '(blank)';
    if (Array.isArray(value)) {
      if (!value.length) return '(none)';
      if (value.every((v) => typeof v === 'string')) {
        const joined = value.join(', ');
        return joined.length > AUDIT_TEXT_LIMIT ? joined.slice(0, AUDIT_TEXT_LIMIT) + '…' : joined;
      }
      // Photo lists and product lists are arrays of objects.
      if (value.length && value[0] && value[0].blob !== undefined) {
        return `${value.length} photo${value.length === 1 ? '' : 's'}`;
      }
      if (value.length && value[0] && value[0].productName !== undefined) {
        const names = value.map((p) => p.productName || '(unnamed)').join(', ');
        return `${value.length} product${value.length === 1 ? '' : 's'}: ${names}`.slice(0, AUDIT_TEXT_LIMIT);
      }
      return `${value.length} item${value.length === 1 ? '' : 's'}`;
    }
    const str = String(value);
    if (str.startsWith('data:image/')) return '(image)';
    return str.length > AUDIT_TEXT_LIMIT ? str.slice(0, AUDIT_TEXT_LIMIT) + '…' : str;
  }

  // Deep-ish equality for the value shapes a section can hold. Photo arrays
  // hold Blobs, which never compare equal through JSON, so they're compared by
  // identity and length — enough to notice an added or removed photo without
  // reporting a spurious change every time a section is opened and saved.
  function valuesEqual(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, i) => {
        const other = b[i];
        if (item && typeof item === 'object' && other && typeof other === 'object') {
          if (item.blob !== undefined || other.blob !== undefined) return item === other || item.id === other.id;
          return JSON.stringify(item) === JSON.stringify(other);
        }
        return item === other;
      });
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    // Treat null/undefined/'' as the same "not answered" state, so merely
    // opening a section and saving it doesn't manufacture change events.
    const aBlank = a === undefined || a === null || a === '';
    const bBlank = b === undefined || b === null || b === '';
    return aBlank && bBlank;
  }

  function fieldLabel(section, fieldId) {
    const field = (section.fields || []).find((f) => f.id === fieldId);
    return field ? field.label : fieldId;
  }

  // Returns [{ fieldId, label, from, to }] for everything that actually
  // changed between the saved section and what's about to replace it.
  function diffSection(section, before, after) {
    const changes = [];
    const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    for (const fieldId of ids) {
      const from = before ? before[fieldId] : undefined;
      const to = after ? after[fieldId] : undefined;
      if (valuesEqual(from, to)) continue;
      changes.push({
        fieldId,
        label: fieldLabel(section, fieldId),
        from: summariseValue(from),
        to: summariseValue(to),
      });
    }
    return changes;
  }

  // Totals across every report on the device, for the readout in Saved
  // Reports. Reports written before this existed simply have no aiReview
  // and contribute nothing, which is correct — they are not evidence of
  // the AI being right or wrong either way.
  function aiAccuracySummary(reports) {
    let kept = 0;
    let corrected = 0;
    let reportsWithAi = 0;
    const fields = {};
    for (const report of reports || []) {
      const review = report && report.aiReview;
      if (!review || (!review.kept && !review.corrected)) continue;
      reportsWithAi += 1;
      kept += review.kept || 0;
      corrected += review.corrected || 0;
      for (const [key, counts] of Object.entries(review.fields || {})) {
        const acc = fields[key] || { kept: 0, corrected: 0 };
        acc.kept += counts.kept || 0;
        acc.corrected += counts.corrected || 0;
        fields[key] = acc;
      }
    }
    const total = kept + corrected;
    return {
      kept,
      corrected,
      total,
      reportsWithAi,
      keptPercent: total ? Math.round((kept / total) * 100) : null,
      fields,
    };
  }

  window.ReportAudit = {
    AUDIT_TEXT_LIMIT,
    summariseValue,
    valuesEqual,
    fieldLabel,
    diffSection,
    aiAccuracySummary,
  };
})();
