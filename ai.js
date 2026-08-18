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

  // GeoJSON rings are [lng, lat] tuples (note the order) — convert to the
  // same {lat, lon} shape Overpass's geometry uses so normalizePolygon()
  // works for either source unchanged.
  function geoJsonRingToLatLon(ring) {
    return ring.map(([lng, lat]) => ({ lat, lon: lng }));
  }

  // Second-tier footprint source: Nominatim's reverse geocode can return
  // real polygon geometry (not just a point) when the matched OSM feature
  // is a way/relation with area — same free/keyless service already used
  // for address autocomplete, just a different endpoint/param.
  async function fetchNominatimPolygon(lat, lng) {
    // zoom=18 was tested and found to over-zoom to a bare Point for some
    // buildings (e.g. the Sydney Opera House) instead of matching the
    // building way itself; zoom=17 reliably resolved to a real Polygon in
    // testing while staying precise enough not to match a whole suburb.
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&polygon_geojson=1&zoom=17`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const geojson = data && data.geojson;
    if (!geojson) return null;
    let ring = null;
    if (geojson.type === 'Polygon' && geojson.coordinates[0] && geojson.coordinates[0].length >= 3) {
      ring = geojson.coordinates[0];
    } else if (geojson.type === 'MultiPolygon' && geojson.coordinates[0] && geojson.coordinates[0][0] && geojson.coordinates[0][0].length >= 3) {
      ring = geojson.coordinates[0][0];
    }
    return ring ? geoJsonRingToLatLon(ring) : null;
  }

  // Fetches a real building footprint (preferred) or a satellite-image
  // fallback for the given coordinates, to use as the mud-map sketch's
  // background layer. Three tiers, all free/keyless:
  //   1. OSM Overpass — vector building outline (best case).
  //   2. Nominatim reverse polygon — a second shot at vector geometry when
  //      Overpass's node placement missed the building.
  //   3. A tightly-cropped satellite photo of just the property — last
  //      resort only, when neither service has area data for this address.
  // Returns { source: 'osm', polygon } | { source: 'satellite', imageUrl } | { source: 'none' }.
  async function fetchFootprint(lat, lng) {
    try {
      const overpassQuery = `[out:json][timeout:15];way["building"](around:60,${lat},${lng});out geom;`;
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
      console.warn('[ai] Overpass footprint lookup failed, trying Nominatim polygon next:', err.message || err);
    }

    try {
      const geometry = await fetchNominatimPolygon(lat, lng);
      if (geometry) return { source: 'osm', polygon: normalizePolygon(geometry) };
    } catch (err) {
      console.warn('[ai] Nominatim polygon lookup failed, falling back to satellite imagery:', err.message || err);
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { source: 'none' };
    // ~25-30m either side (~55m total span) — tight enough to frame just the
    // target property and its immediate surrounds, not the whole street.
    const pad = 0.00025;
    const bbox = [lng - pad, lat - pad, lng + pad, lat + pad].join(',');
    const imageUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export' +
      `?bbox=${bbox}&bboxSR=4326&size=680,840&format=jpg&f=image`;
    return { source: 'satellite', imageUrl };
  }

  // WMO weather codes, per Open-Meteo's docs — https://open-meteo.com/en/docs
  const WMO_WEATHER_DESCRIPTIONS = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    66: 'Light freezing rain', 67: 'Heavy freezing rain',
    71: 'Slight snow fall', 73: 'Moderate snow fall', 75: 'Heavy snow fall', 77: 'Snow grains',
    80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
    85: 'Slight snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
  };

  // Real-time weather at the property's coordinates, via Open-Meteo — free,
  // keyless, no signup (same philosophy as Nominatim/Overpass elsewhere in
  // this file). Returns a short human-readable string, or null on failure.
  async function fetchCurrentWeather(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const cw = data.current_weather;
      if (!cw) return null;
      const desc = WMO_WEATHER_DESCRIPTIONS[cw.weathercode] || 'Conditions unavailable';
      return `${desc}, ${Math.round(cw.temperature)}°C, wind ${Math.round(cw.windspeed)} km/h`;
    } catch (err) {
      console.warn('[ai] weather fetch failed:', err.message || err);
      return null;
    }
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

  window.AI = { analyzeInspection, subdivideRooms, fetchFootprint, fetchCurrentWeather, analyzeSectionPhotos };
})();
