// Client for the `analyze-inspection` Supabase Edge Function — AI report
// drafting and zone recognition from inspection photographs. All API keys stay
// server-side in the Edge Function; this module only ever talks to Supabase,
// never Anthropic/OpenAI directly.
//
// Mirrors sync.js's own local-only fallback: if Supabase isn't configured,
// window.AI simply doesn't exist, and callers should check for it.
(() => {
  'use strict';

  // ---------- Error wording ----------
  // Defined and exported ABOVE the Supabase guards below, the same way
  // sync.js exports SyncMessages: these two are pure string handling with no
  // Supabase dependency, and turning a server failure into something a
  // technician can act on is exactly the part worth having tests for. Left
  // below the guards they would be unreachable in any environment without a
  // configured backend — including the test suite.

  // Turns whatever came back from the Edge Function into something a
  // technician standing at a property can act on. The raw strings are
  // written for whoever is debugging the function — "Unknown action —
  // expected draft-report, trace-building, ..." is accurate and useless to
  // the person holding the phone. Each case below says what went wrong AND
  // what to do about it. Anything unrecognised keeps its original text
  // rather than being swallowed: a mystery message still beats no message.
  function humanError(err) {
    const raw = String((err && err.message) || err || '');

    // Client is newer than the deployed function: the feature shipped but
    // the server side hasn't been deployed yet.
    if (/unknown action/i.test(raw)) {
      return 'This AI feature is not switched on yet — the app has it, the server still needs updating. Nothing you did wrong.';
    }
    if (/not authenticated|jwt|\b401\b/i.test(raw)) {
      return 'You have been signed out. Log out and back in, then try again.';
    }
    if (/failed to fetch|networkerror|load failed|offline/i.test(raw)
        || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      return 'No connection. Your photos are saved on this device — try again once you have signal.';
    }
    if (/\b404\b|not found/i.test(raw)) {
      return 'The AI service could not be reached. It may not be deployed yet.';
    }
    if (/timeout|timed out|\b504\b|deadline/i.test(raw)) {
      return 'The AI took too long to answer. Try again, or with fewer photos at once.';
    }
    if (/rate limit|\b429\b|quota|overloaded/i.test(raw)) {
      return 'The AI service is busy right now. Wait a moment and try again.';
    }
    // Last line of defence: supabase-js's own wording, reaching here only if
    // edgeErrorMessage() could not recover the real body. It describes an
    // HTTP status to whoever wrote the code and nothing at all to the person
    // holding the phone, so it never ships as-is.
    if (/non-2xx status code/i.test(raw)) {
      return 'The AI service rejected that request. If it keeps happening, the server may need updating.';
    }
    return raw;
  }

  // Digs the message the Edge Function actually sent out of a failed
  // invoke(). supabase-js collapses EVERY non-2xx into the single string
  // "Edge Function returned a non-2xx status code" and hands the real
  // response over separately, on error.context. Without this, none of the
  // cases in humanError() above can ever match on a 4xx/5xx — including the
  // "unknown action" one written precisely for the situation where the app
  // is newer than the deployed function, which is the situation this
  // project has actually been in. The technician got the raw supabase-js
  // string instead of the sentence that tells them what to do about it.
  async function edgeErrorMessage(error) {
    try {
      if (error && error.context && typeof error.context.json === 'function') {
        const source = typeof error.context.clone === 'function' ? error.context.clone() : error.context;
        const body = await source.json();
        if (body && body.error) return String(body.error);
      }
    } catch (e) {
      // Not JSON, already consumed, or no body at all — the generic message
      // below is still better than throwing from the error handler.
    }
    return String((error && error.message) || error || '');
  }

  window.AIMessages = { humanError, edgeErrorMessage };

  if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_PUBLISHABLE_KEY) {
    console.warn('[ai] Supabase not configured — AI features unavailable.');
    return;
  }

  // Reuses sync.js's client (loaded first, script-order in index.html)
  // rather than creating a second one — two clients sharing the same auth
  // storage key trigger Supabase's "multiple GoTrueClient instances"
  // warning and risk undefined behavior on token refresh.
  if (!window.supabaseClient) {
    console.warn('[ai] sync.js did not initialize a Supabase client — AI features unavailable.');
    return;
  }
  const supabaseClient = window.supabaseClient;

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // Same as blobToBase64 but keeps the "data:image/...;base64," prefix —
  // needed for the frames[].dataUrl shape the Edge Function expects.
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // Splits a data URL into the shape the Edge Function wants.
  //
  // Throws rather than substituting an empty string, which is what the three
  // photo call sites below used to do. An empty base64 travels all the way to
  // Anthropic and comes back as "image cannot be empty" — a 400 naming
  // nothing the technician can act on and nothing a developer can locate. It
  // only happens when a blob is not really an image, which is a bug worth
  // surfacing where it occurs rather than three layers downstream.
  function imagePart(dataUrl) {
    const text = String(dataUrl || '');
    const match = /^data:(image\/\w+);base64,(.+)$/.exec(text);
    if (!match) {
      throw new Error('That photo is not in a format the AI can read '
        + `(${text.slice(0, 24) || 'empty'}…). Try retaking it.`);
    }
    return { mediaType: match[1], base64: match[2] };
  }

  // Builds the compact field-schema description the Edge Function's prompt
  // needs, straight from the single source of truth in report-schema.js (or
  // pest-treatment-schema.js for jobType 'pest_treatment') — never
  // duplicated/hand-maintained separately. Pass a sectionId to scope it to
  // just that section's aiFillable fields.
  function buildAiFillableFieldSchema(onlySectionId, jobType) {
    const schema = (jobType === 'pest_treatment' ? window.PEST_TREATMENT_SCHEMA : window.REPORT_SCHEMA) || [];
    const fields = [];
    for (const section of schema) {
      if (onlySectionId && section.id !== onlySectionId) continue;
      for (const field of section.fields || []) {
        if (!field.aiFillable) continue;
        fields.push({
          sectionId: section.id,
          fieldId: field.id,
          label: field.label,
          type: field.type,
          options: field.options || undefined,
        });
      }
    }
    return fields;
  }

  // Samples JPEG stills from a recorded video Blob at roughly evenly-spaced
  // timestamps, via a hidden <video> + canvas — same drawImage/toBlob shape
  // already used for inspectionStillBtn in app.js, just driven by seek()
  // instead of a live stream.
  async function invoke(body) {
    let data;
    let error;
    try {
      ({ data, error } = await supabaseClient.functions.invoke('analyze-inspection', { body }));
    } catch (err) {
      // supabase-js throws rather than returning on transport failure.
      throw new Error(humanError(err));
    }
    if (error) throw new Error(humanError(new Error(await edgeErrorMessage(error))));
    if (data && data.error) throw new Error(humanError(new Error(data.error)));
    return data;
  }

  // Traces the subject building's exterior perimeter out of aerial photos and
  // returns it as a 0-1 polygon ready to draw on the sketch canvas.
  //
  // This covers the case where no vector building outline exists in any open
  // dataset: the model reads the roofline out of the imagery instead. It is
  // deliberately NOT part of the automatic fetchFootprint cascade, because it
  // costs an API call and takes a few seconds. The technician asks for it,
  // and what comes back is a starting shape they correct on the canvas.
  //
  // Every available capture is sent, not just the best one. Tree canopy is
  // the main reason a trace comes back wrong, and the two providers fly on
  // different dates — a corner lost under a canopy in one is often plainly
  // visible in the other.
  //
  // Exterior perimeter only: no interior walls, no room subdivision.
  async function traceBuildingOutline(lat, lng) {
    const captures = window.Geo ? await window.Geo.fetchAerialImages(lat, lng) : [];
    const images = [];
    for (const capture of captures) {
      const match = /^data:(image\/\w+);base64,(.+)$/.exec(capture.dataUrl);
      if (match) images.push({ label: capture.label, mediaType: match[1], base64: match[2] });
    }
    if (!images.length) throw new Error('No aerial imagery available for this address.');

    const data = await invoke({ action: 'trace-building', images });
    if (!data || !Array.isArray(data.polygon) || data.polygon.length < 3) {
      throw new Error('Could not make out a building outline in the aerial imagery.');
    }
    return {
      polygon: data.polygon,
      confidence: data.confidence || 'medium',
      note: data.note || '',
      obscured: data.obscured || '',
      imageUrl: captures[0].dataUrl,
    };
  }

  // Drafts the report from the photographs taken during a walkthrough — the
  // path used since inspections became photo-only.
  //
  // This is a better input than the video frames it replaces, and the prompt
  // exploits that: each image is one the technician deliberately took, and it
  // arrives labelled with the zone they were standing in. The Edge Function is
  // told to read every photo against the whole question set rather than only
  // the obstruction fields — a photo of a subfloor bearer speaks to moisture,
  // ventilation, ant capping and workings all at once, and previously all of
  // that went unused.
  const INSPECTION_PHOTO_LIMIT = 24;

  async function analyzeInspectionPhotos(captures, jobType) {
    const usable = (captures || []).filter((c) => c && c.photoBlob).slice(0, INSPECTION_PHOTO_LIMIT);
    if (!usable.length) throw new Error('No photos were captured for this inspection.');

    const photos = await Promise.all(usable.map(async (capture, i) => ({
      // The zone is the single most useful thing the model gets: it turns
      // "a wall" into "a subfloor wall", which is the difference between a
      // guess and a finding.
      zone: capture.zone || '',
      sequence: i + 1,
      takenAt: capture.createdAt || null,
      dataUrl: await blobToDataUrl(capture.photoBlob),
    })));

    return invoke({
      action: 'draft-report',
      reportType: jobType || 'termite',
      photos,
      fieldSchema: buildAiFillableFieldSchema(undefined, jobType),
    });
  }

  // Analyzes just the photos attached to one report section's "photos" field
  // (e.g. the Access/Findings/Conducive sections' top-of-section photo
  // uploads) and drafts values for that section's aiFillable fields only.
  // Reuses the same 'draft-report' Edge Function action as analyzeInspectionPhotos
  // — it already treats audio as optional, so no audio is sent here at all.
  // Returns { transcript, draftFields, frameNotes } same shape as
  // analyzeInspectionPhotos; caller reads draftFields[sectionId].
  async function analyzeSectionPhotos(photoBlobs, sectionId, jobType) {
    const frames = await Promise.all(photoBlobs.map(async (blob, i) => ({
      timestamp: i,
      dataUrl: await blobToDataUrl(blob),
    })));
    const fieldSchema = buildAiFillableFieldSchema(sectionId, jobType);
    return invoke({ action: 'draft-report', reportType: jobType || 'termite', frames, fieldSchema });
  }

  // Identifies the pest/insect in one or more close-up photos — species-level
  // where the photo supports it, with confidence and reasoning the
  // technician can check. `targetPestOptions` lets the Edge Function map its
  // answer onto whichever picklist category (targetPests) fits best, so the
  // caller can offer a one-tap "apply" rather than making the technician
  // retype what the model already said. Returns { identifications: [...] } —
  // never applied to the report on its own; see identify-pest-btn in
  // report.js.
  async function identifyPest(photoBlobs, targetPestOptions) {
    const usable = (photoBlobs || []).filter(Boolean);
    if (!usable.length) throw new Error('No photo to identify.');
    const images = await Promise.all(usable.map(async (blob) => {
      const dataUrl = await blobToDataUrl(blob);
      return imagePart(dataUrl);
    }));
    return invoke({ action: 'identify-pest', images, targetPestOptions: targetPestOptions || [] });
  }

  // Identifies a tree/stump's species and termite susceptibility from one or
  // more photos — feeds the Conducive Conditions section, since a dead or
  // susceptible tree near the building is exactly the kind of condition that
  // section records. Returns { trees: [...] }; never applied on its own, see
  // the tree-photos field in report-schema.js's conducive section.
  async function identifyTree(photoBlobs) {
    const usable = (photoBlobs || []).filter(Boolean);
    if (!usable.length) throw new Error('No photo to identify.');
    const images = await Promise.all(usable.map(async (blob) => {
      const dataUrl = await blobToDataUrl(blob);
      return imagePart(dataUrl);
    }));
    return invoke({ action: 'identify-tree', images });
  }

  // Sorts a bucket of untagged/general photos into whichever specific photo
  // field each is actually evidence for. `targets` is the list of candidate
  // fields — [{sectionId, fieldId, label}] — built by the caller from the
  // report schema (see sortGeneralPhotos in report.js). Returns
  // { assignments: [{ photoIndex, sectionId, fieldId, reasoning }] };
  // `photoIndex` is 1-based, matching photoBlobs' order. A photo with no
  // matching entry is left unassigned — that's an expected, normal result,
  // not a failure.
  async function sortGeneralPhotos(photoBlobs, targets) {
    const usable = (photoBlobs || []).filter(Boolean);
    if (!usable.length) return { assignments: [] };
    const images = await Promise.all(usable.map(async (blob) => {
      const dataUrl = await blobToDataUrl(blob);
      return imagePart(dataUrl);
    }));
    return invoke({ action: 'sort-photos', images, targets: targets || [] });
  }

  window.AI = {
    analyzeInspectionPhotos, analyzeSectionPhotos, traceBuildingOutline,
    identifyPest, identifyTree, sortGeneralPhotos,
    // Exported so report.js formats its own catch blocks the same way,
    // rather than keeping a second copy of this logic in sync.
    humanError,
  };
})();
