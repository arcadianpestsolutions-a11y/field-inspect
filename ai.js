// Client for the `analyze-inspection` Supabase Edge Function — AI report
// drafting, zone/room recognition, and voice-guided mud-map room
// subdivision. All API keys stay server-side in the Edge Function; this
// module only ever talks to Supabase, never Anthropic/OpenAI directly.
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

  // Builds the compact field-schema description the Edge Function's prompt
  // needs, straight from the single source of truth in report-schema.js —
  // never duplicated/hand-maintained separately.
  function buildAiFillableFieldSchema() {
    const schema = window.REPORT_SCHEMA || [];
    const fields = [];
    for (const section of schema) {
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

  function pickClosestWay(elements, lat, lng) {
    const ways = elements.filter((el) => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 3);
    if (!ways.length) return null;
    let best = null;
    let bestDist = Infinity;
    for (const way of ways) {
      const cLat = way.geometry.reduce((sum, p) => sum + p.lat, 0) / way.geometry.length;
      const cLng = way.geometry.reduce((sum, p) => sum + p.lon, 0) / way.geometry.length;
      const dist = Math.hypot(cLat - lat, cLng - lng);
      if (dist < bestDist) { bestDist = dist; best = way; }
    }
    return best;
  }

  // Converts a real lat/lon building outline into a normalized 0-1 polygon
  // in canvas space (0,0 top-left), with a little padding so the outline
  // doesn't touch the edges. Latitude increases north but canvas y
  // increases downward, hence the flip on the y axis.
  function normalizePolygon(geometry) {
    const lats = geometry.map((p) => p.lat);
    const lngs = geometry.map((p) => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const latSpan = Math.max(maxLat - minLat, 1e-9);
    const lngSpan = Math.max(maxLng - minLng, 1e-9);
    const pad = 0.12;
    return geometry.map((p) => [
      pad + (1 - 2 * pad) * ((p.lon - minLng) / lngSpan),
      pad + (1 - 2 * pad) * (1 - (p.lat - minLat) / latSpan),
    ]);
  }

  // Fetches a real building footprint (preferred) or a satellite-image
  // fallback for the given coordinates, to use as the mud-map sketch's
  // background layer. Free, no API key: OSM's Overpass API for the vector
  // footprint (same usage-policy philosophy as the existing Nominatim
  // address search — public instance, not for heavy automated traffic),
  // falling back to a keyless Esri World Imagery static tile when no
  // building is mapped at that location (common outside dense-data areas).
  // Returns { source: 'osm', polygon } | { source: 'satellite', imageUrl } | { source: 'none' }.
  async function fetchFootprint(lat, lng) {
    try {
      const overpassQuery = `[out:json][timeout:15];way["building"](around:40,${lat},${lng});out geom;`;
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: 'data=' + encodeURIComponent(overpassQuery),
      });
      if (res.ok) {
        const data = await res.json();
        const way = pickClosestWay(data.elements || [], lat, lng);
        if (way) return { source: 'osm', polygon: normalizePolygon(way.geometry) };
      }
    } catch (err) {
      console.warn('[ai] Overpass footprint lookup failed, falling back to satellite imagery:', err.message || err);
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { source: 'none' };
    const pad = 0.0009; // ~60-70m either side — roughly the property plus immediate surrounds
    const bbox = [lng - pad, lat - pad, lng + pad, lat + pad].join(',');
    const imageUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export' +
      `?bbox=${bbox}&bboxSR=4326&size=680,840&format=jpg&f=image`;
    return { source: 'satellite', imageUrl };
  }

  async function invoke(body) {
    const { data, error } = await supabaseClient.functions.invoke('analyze-inspection', { body });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  // Analyzes a finished inspection's footage: samples frames, sends them
  // plus the recording's audio for transcription + drafting. Returns
  // { transcript, draftFields, frameNotes } — caller persists this onto
  // report.aiDraft, never directly into report.sections (suggestions only).
  async function analyzeInspection(footageBlob) {
    const frames = await extractFrames(footageBlob, 12);
    const audioBase64 = await blobToBase64(footageBlob);
    const fieldSchema = buildAiFillableFieldSchema();

    return invoke({
      action: 'draft-report',
      frames,
      audioBase64,
      audioMimeType: footageBlob.type || 'video/webm',
      fieldSchema,
    });
  }

  // footprint: normalized (0-1) polygon, same coordinate space as the
  // sketch canvas. Returns { transcript, rooms: [{label, polygon}] }.
  async function subdivideRooms(audioBlob, footprint) {
    const audioBase64 = await blobToBase64(audioBlob);
    return invoke({
      action: 'subdivide-rooms',
      audioBase64,
      audioMimeType: audioBlob.type || 'audio/webm',
      footprint,
    });
  }

  window.AI = { analyzeInspection, subdivideRooms, fetchFootprint };
})();
