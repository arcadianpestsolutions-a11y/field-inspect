// Client for the `analyze-inspection` Supabase Edge Function — AI report
// drafting and zone recognition from inspection footage. All API keys stay
// server-side in the Edge Function; this module only ever talks to Supabase,
// never Anthropic/OpenAI directly.
//
// Mirrors sync.js's own local-only fallback: if Supabase isn't configured,
// window.AI simply doesn't exist, and callers should check for it.
(() => {
  'use strict';

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
  function extractFrames(videoBlob, maxFrames) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(videoBlob);
      video.src = url;

      video.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read recorded video for frame extraction'));
      });

      video.addEventListener('loadedmetadata', async () => {
        const duration = video.duration && isFinite(video.duration) ? video.duration : 0;
        if (duration <= 0) { URL.revokeObjectURL(url); resolve([]); return; }

        const count = Math.max(1, Math.min(maxFrames, Math.ceil(duration / 8)));
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        const ctx = canvas.getContext('2d');
        const frames = [];

        for (let i = 0; i < count; i++) {
          const t = (duration * (i + 0.5)) / count;
          await new Promise((seekResolve) => {
            video.addEventListener('seeked', seekResolve, { once: true });
            video.currentTime = t;
          });
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push({ timestamp: t, dataUrl: canvas.toDataURL('image/jpeg', 0.7) });
        }

        URL.revokeObjectURL(url);
        resolve(frames);
      });
    });
  }

  async function invoke(body) {
    const { data, error } = await supabaseClient.functions.invoke('analyze-inspection', { body });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
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

  // Legacy path, kept for jobs recorded before inspections became photo-only
  // and for footage brought in through Import Footage: samples frames, sends
  // them plus the recording's audio for transcription and drafting. Returns
  // { transcript, draftFields, frameNotes } — the caller persists this onto
  // report.aiDraft, never straight into report.sections (suggestions only).
  async function analyzeInspection(footageBlob, jobType) {
    const frames = await extractFrames(footageBlob, 12);
    const audioBase64 = await blobToBase64(footageBlob);
    const fieldSchema = buildAiFillableFieldSchema(undefined, jobType);

    return invoke({
      action: 'draft-report',
      reportType: jobType || 'termite',
      frames,
      audioBase64,
      audioMimeType: footageBlob.type || 'video/webm',
      fieldSchema,
    });
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
  // Reuses the same 'draft-report' Edge Function action as analyzeInspection
  // — it already treats audio as optional, so no audio is sent here at all.
  // Returns { transcript, draftFields, frameNotes } same shape as
  // analyzeInspection; caller reads draftFields[sectionId].
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
      const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl);
      return { mediaType: match ? match[1] : 'image/jpeg', base64: match ? match[2] : '' };
    }));
    return invoke({ action: 'identify-pest', images, targetPestOptions: targetPestOptions || [] });
  }

  window.AI = {
    analyzeInspection, analyzeInspectionPhotos, analyzeSectionPhotos, traceBuildingOutline, identifyPest,
  };
})();
