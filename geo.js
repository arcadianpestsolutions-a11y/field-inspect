// Geospatial helpers — everything the app derives from a property's address.
//
// WHY THIS IS SEPARATE FROM ai.js
// Every service used here is free, keyless and CORS-open: Nominatim for
// geocoding, Overpass for building outlines and street frontage, NSW Spatial
// Services for cadastre and aerial imagery, Open-Meteo for elevation and
// weather. None of it needs a Supabase session or costs anything per call.
//
// While these lived in ai.js they inherited its guard, which returns early
// when Supabase is unconfigured — so the mud-map backdrop, site topography,
// facade orientation and weather all silently did nothing in demo mode, and
// would have died the same way if the Supabase keys were ever wrong. Nothing
// said why. Splitting them out means the address-derived features work
// wherever the app runs, signed in or not.
//
// ai.js keeps only what genuinely needs the Edge Function: report drafting,
// photo analysis, and the AI building trace.
(() => {
  'use strict';

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
  // works for either source unchanged. Esri's `rings` use that same [x, y]
  // ordering, so cadastre geometry goes through this untouched too.
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

  // ---------- NSW Spatial Services (SIX Maps) ----------
  // NSW publishes its cadastre and aerial imagery as open, CORS-enabled
  // ArcGIS REST services — no key, no signup, no quota, same philosophy as
  // the Nominatim/Overpass usage above. Worth preferring inside NSW because
  // the imagery is dramatically sharper at single-property zoom than the
  // global basemap.
  //
  // Worth having as a fallback because the tiers above it are unreliable in
  // practice, for two separate reasons: OSM building coverage locally is
  // patchy (spot checks around Ingleburn returned 15, 9, 1 and 0 buildings
  // within 60m), and Overpass rate-limits hard — one of those four checks
  // needed three attempts before it stopped returning an error page. A
  // single failed Overpass call is indistinguishable from "no building
  // here", so there needs to be something underneath it.
  const SIX_MAPS = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public';
  const NSW_BOUNDS = { minLat: -37.6, maxLat: -28.1, minLng: 140.9, maxLng: 153.7 };

  function isInNsw(lat, lng) {
    return lat >= NSW_BOUNDS.minLat && lat <= NSW_BOUNDS.maxLat
      && lng >= NSW_BOUNDS.minLng && lng <= NSW_BOUNDS.maxLng;
  }

  // Third-tier footprint source: the NSW cadastre's Lot layer (layer 9 of
  // NSW_Cadastre). This is the legal property boundary, not the building —
  // NSW publishes no building-footprint layer at all — but a real, correctly
  // proportioned site perimeter is a far better base to sketch the house
  // inside than a blank grid, and it carries the lot/DP reference, which is
  // worth having on a compliance document regardless.
  async function fetchCadastreLot(lat, lng) {
    if (!isInNsw(lat, lng)) return null;
    const params = new URLSearchParams({
      geometry: `${lng},${lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      returnGeometry: 'true',
      outFields: 'lotidstring,planlotarea,planlotareaunits',
      f: 'json',
    });
    const res = await fetch(`${SIX_MAPS}/NSW_Cadastre/MapServer/9/query?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    const feature = (data.features || [])[0];
    const ring = feature && feature.geometry && feature.geometry.rings && feature.geometry.rings[0];
    if (!ring || ring.length < 3) return null;
    const attrs = feature.attributes || {};
    return {
      geometry: geoJsonRingToLatLon(ring),
      lotId: attrs.lotidstring || '',
      area: Number.isFinite(attrs.planlotarea) ? attrs.planlotarea : null,
      areaUnits: attrs.planlotareaunits || '',
    };
  }

  // ---------- Aerial imagery ----------
  // Matches the sketch canvas's 340x420 aspect so the crop is never squashed.
  const AERIAL_W = 680;
  const AERIAL_H = 840;
  // Half-height of the crop in degrees of latitude: 0.0003 deg is about 33m,
  // giving a ~67m tall by ~54m wide frame — a suburban block and its
  // immediate surrounds, not the street.
  const AERIAL_PAD_LAT = 0.0003;

  // Ground distance per degree differs between the axes, and longitude
  // shrinks with latitude, so derive the longitude padding from the latitude
  // padding to keep the crop's real-world aspect equal to the canvas's.
  // Without this every mud map is subtly stretched east-west.
  function aerialBbox(lat, lng) {
    const padLng = (AERIAL_PAD_LAT * (AERIAL_W / AERIAL_H)) / Math.cos((lat * Math.PI) / 180);
    return {
      minLng: lng - padLng,
      minLat: lat - AERIAL_PAD_LAT,
      maxLng: lng + padLng,
      maxLat: lat + AERIAL_PAD_LAT,
    };
  }

  function nswImageryUrl(lat, lng) {
    const b = aerialBbox(lat, lng);
    const params = new URLSearchParams({
      bbox: `${b.minLng},${b.minLat},${b.maxLng},${b.maxLat}`,
      bboxSR: '4326',
      imageSR: '4326',
      size: `${AERIAL_W},${AERIAL_H}`,
      format: 'jpg',
      transparent: 'false',
      f: 'image',
    });
    return `${SIX_MAPS}/NSW_Imagery/MapServer/export?${params}`;
  }

  // Standard Web Mercator tile math — the XYZ scheme every slippy map uses.
  function lngToTileX(lng, z) { return ((lng + 180) / 360) * Math.pow(2, z); }
  function latToTileY(lat, z) {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('aerial tile failed to load'));
      img.src = src;
    });
  }

  // Outside NSW we fall back to Esri's global imagery, which only serves
  // pre-rendered tiles: its dynamic `export` endpoint has been retired and
  // now returns HTTP 500 for every request. That endpoint was this app's
  // only satellite source, so the mud-map backdrop had silently stopped
  // loading anywhere. Stitch the covering tiles onto a canvas and crop to
  // the bbox instead. The tiles send Access-Control-Allow-Origin, so the
  // canvas stays untainted and toDataURL() keeps working.
  async function stitchAerialTiles(lat, lng, zoom = 19) {
    const b = aerialBbox(lat, lng);
    const x0 = lngToTileX(b.minLng, zoom), x1 = lngToTileX(b.maxLng, zoom);
    const y0 = latToTileY(b.maxLat, zoom), y1 = latToTileY(b.minLat, zoom);
    const tx0 = Math.floor(x0), tx1 = Math.floor(x1);
    const ty0 = Math.floor(y0), ty1 = Math.floor(y1);
    const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;
    // Sanity guard: a correct bbox at this zoom needs a handful of tiles.
    // Anything larger means bad coordinates — bail rather than fire dozens
    // of requests at the tile server.
    if (!(cols >= 1 && rows >= 1 && cols * rows <= 25)) return null;

    const sheet = document.createElement('canvas');
    sheet.width = cols * 256;
    sheet.height = rows * 256;
    const sheetCtx = sheet.getContext('2d');

    const tiles = [];
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
        tiles.push(
          loadImage(url)
            .then((img) => sheetCtx.drawImage(img, (tx - tx0) * 256, (ty - ty0) * 256))
            // One missing tile shouldn't cost the whole backdrop — leave
            // that square blank and keep the rest.
            .catch(() => {})
        );
      }
    }
    await Promise.all(tiles);

    const out = document.createElement('canvas');
    out.width = AERIAL_W;
    out.height = AERIAL_H;
    out.getContext('2d').drawImage(
      sheet,
      (x0 - tx0) * 256, (y0 - ty0) * 256, (x1 - x0) * 256, (y1 - y0) * 256,
      0, 0, AERIAL_W, AERIAL_H
    );
    return out.toDataURL('image/jpeg', 0.85);
  }

  // Returns a ready-to-draw aerial crop of just this property as a data URL,
  // so it can be both drawn on the canvas and posted to the tracing model
  // without downloading it twice. NSW imagery first, global tiles elsewhere.
  async function nswAerialDataUrl(lat, lng) {
    if (!isInNsw(lat, lng)) return null;
    try {
      const res = await fetch(nswImageryUrl(lat, lng));
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.type.indexOf('image/') !== 0) return null;
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('could not read imagery blob'));
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn('[geo] NSW imagery fetch failed:', err.message || err);
      return null;
    }
  }

  async function esriAerialDataUrl(lat, lng) {
    try {
      return await stitchAerialTiles(lat, lng);
    } catch (err) {
      console.warn('[geo] global aerial tile stitch failed:', err.message || err);
      return null;
    }
  }

  async function fetchAerialImage(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return (await nswAerialDataUrl(lat, lng)) || (await esriAerialDataUrl(lat, lng));
  }

  // Both providers, for tracing. This matters more than it looks: NSW Spatial
  // Services and Esri are independent captures flown on different dates, in
  // different seasons and light. Comparing the same address in both, one is
  // routinely sunlit with the roofline legible while the other is in deep
  // shadow under heavier canopy. Tree cover is the single biggest cause of a
  // bad trace, so giving the model two looks at the same roof lets it read
  // corners out of whichever image happens to show them.
  async function fetchAerialImages(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const [nsw, esri] = await Promise.all([
      nswAerialDataUrl(lat, lng),
      esriAerialDataUrl(lat, lng),
    ]);
    const images = [];
    if (nsw) images.push({ label: 'NSW Spatial Services capture', dataUrl: nsw });
    if (esri) images.push({ label: 'Esri World Imagery capture (different date)', dataUrl: esri });
    return images;
  }

  // Fetches a base shape for the mud-map sketch's background layer. Four
  // tiers, all free and keyless, best geometry first:
  //   1. OSM Overpass — a true vector building outline.
  //   2. Nominatim reverse polygon — a second shot at vector geometry when
  //      Overpass's node placement missed the building.
  //   3. NSW cadastre lot — the legal site boundary. Not the building, but
  //      a real, correctly proportioned perimeter to place it within.
  //   4. A tight aerial crop of just this property, to trace over by hand or
  //      to hand to traceBuildingOutline() below.
  // Returns one of:
  //   { source: 'osm',       polygon }
  //   { source: 'cadastre',  polygon, lotId, area, areaUnits }
  //   { source: 'satellite', imageUrl }
  //   { source: 'none' }
  async function fetchFootprint(lat, lng) {
    try {
      const overpassQuery = `[out:json][timeout:15];way["building"](around:60,${lat},${lng});out geom;`;

      // Overpass rate-limits aggressively and answers with an HTML/XML error
      // page rather than an HTTP error, so a throttled request parses as zero
      // buildings — indistinguishable from a property that genuinely isn't
      // mapped. Testing four addresses around Ingleburn, one needed three
      // attempts before it stopped being throttled. Retrying matters because
      // a real OSM outline is exact: every needless fall-through costs an
      // aerial trace that then has to fight tree canopy for the same answer.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 1200 * attempt));
        const res = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: 'data=' + encodeURIComponent(overpassQuery),
        });
        if (!res.ok) continue;
        const text = await res.text();
        if (text.trim().startsWith('<')) continue; // throttled, not empty
        const data = JSON.parse(text);
        const way = pickClosestWay(data.elements || [], lat, lng);
        if (way) return { source: 'osm', polygon: normalizePolygon(way.geometry) };
        break; // a clean JSON answer with no buildings is a real answer
      }
    } catch (err) {
      console.warn('[geo] Overpass footprint lookup failed, trying Nominatim polygon next:', err.message || err);
    }

    try {
      const geometry = await fetchNominatimPolygon(lat, lng);
      if (geometry) return { source: 'osm', polygon: normalizePolygon(geometry) };
    } catch (err) {
      console.warn('[geo] Nominatim polygon lookup failed, trying the NSW cadastre next:', err.message || err);
    }

    try {
      const lot = await fetchCadastreLot(lat, lng);
      if (lot) {
        return {
          source: 'cadastre',
          polygon: normalizePolygon(lot.geometry),
          lotId: lot.lotId,
          area: lot.area,
          areaUnits: lot.areaUnits,
        };
      }
    } catch (err) {
      console.warn('[geo] NSW cadastre lookup failed, falling back to aerial imagery:', err.message || err);
    }

    const imageUrl = await fetchAerialImage(lat, lng);
    return imageUrl ? { source: 'satellite', imageUrl } : { source: 'none' };
  }


  // ---------- Address geocoding ----------
  // Coordinates were previously captured only when the technician tapped an
  // autocomplete suggestion. Typing the address in full and pressing Create —
  // which is what most people do when they already know the address — left
  // addressLat/addressLng null, and every feature keyed off them (the mud-map
  // backdrop, the aerial trace, weather, topography) silently did nothing.
  // Nothing said why. This resolves the address text on demand instead, so a
  // job gets coordinates however it was entered.
  async function geocodeAddress(address) {
    const query = String(address || '').trim();
    if (query.length < 6) return null;
    const url = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&countrycodes=au,nz&limit=1&q='
      + encodeURIComponent(query);
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const results = await res.json();
      const hit = Array.isArray(results) && results[0];
      if (!hit) return null;
      const lat = parseFloat(hit.lat);
      const lng = parseFloat(hit.lon);
      return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
    } catch (err) {
      console.warn('[geo] geocode failed:', err.message || err);
      return null;
    }
  }

  // Returns the job's coordinates, geocoding and persisting them the first
  // time if the job was created without any. Callers can treat a job as always
  // having coordinates if its address is real.
  async function ensureJobCoords(job) {
    if (!job) return null;
    if (typeof job.addressLat === 'number' && typeof job.addressLng === 'number') {
      return { lat: job.addressLat, lng: job.addressLng };
    }
    const coords = await geocodeAddress(job.address);
    if (!coords) return null;
    try {
      await window.DB.updateJob(job.id, { addressLat: coords.lat, addressLng: coords.lng });
      job.addressLat = coords.lat;
      job.addressLng = coords.lng;
    } catch (err) {
      console.warn('[geo] could not persist geocoded coords:', err.message || err);
    }
    return coords;
  }

  // ---------- Site topography ----------
  // Answers "which way does the land fall?" by sampling ground elevation in a
  // ring around the property and finding the direction of steepest descent.
  //
  // Open-Meteo's elevation API is the same free, keyless, CORS-open service
  // already used here for weather. Two things about its data make a naive
  // implementation quietly wrong, and both are handled below:
  //
  //  1. It returns exactly 0 at whole-degree latitudes — a tile seam. Measured:
  //     -33.99995 gives 35m and -34.00005 gives 37m, but -34.00000 gives 0.
  //     A 35m cliff that isn't there would dominate any slope calculation.
  //  2. Genuine no-data also comes back as 0.
  //
  // So zeros are discarded rather than believed, and if too few samples
  // survive the function declines to answer instead of guessing. On a
  // compliance document, "the technician looked" beats a confident invention.
  const TOPO_RADIUS_DEG = 0.0011; // ~120m — the fall of the site, not the street

  // Nudges a coordinate off an exact whole degree, where the DEM has a seam.
  function avoidTileSeam(value) {
    return Math.abs(value - Math.round(value)) < 1e-4 ? Math.round(value) + 1e-4 : value;
  }

  const TOPO_HEADINGS = [
    { label: 'Falls to the North', bearing: 0 },
    { label: 'Falls to the East', bearing: 90 },
    { label: 'Falls to the South', bearing: 180 },
    { label: 'Falls to the West', bearing: 270 },
  ];

  // Returns { topography, drop, confident } or null when the data won't
  // support an answer. `drop` is metres of fall across the sampled ring.
  async function fetchSiteTopography(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const d = TOPO_RADIUS_DEG;
    const dLng = d / Math.cos((lat * Math.PI) / 180);

    // 8 compass points plus the centre.
    const ring = [
      { name: 'N', lat: lat + d, lng },
      { name: 'NE', lat: lat + d, lng: lng + dLng },
      { name: 'E', lat, lng: lng + dLng },
      { name: 'SE', lat: lat - d, lng: lng + dLng },
      { name: 'S', lat: lat - d, lng },
      { name: 'SW', lat: lat - d, lng: lng - dLng },
      { name: 'W', lat, lng: lng - dLng },
      { name: 'NW', lat: lat + d, lng: lng - dLng },
    ];
    const points = [{ name: 'C', lat, lng }, ...ring];
    const lats = points.map((p) => avoidTileSeam(p.lat).toFixed(6)).join(',');
    const lngs = points.map((p) => avoidTileSeam(p.lng).toFixed(6)).join(',');

    let elevations;
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`);
      if (!res.ok) return null;
      const data = await res.json();
      elevations = data && data.elevation;
    } catch (err) {
      console.warn('[geo] elevation lookup failed:', err.message || err);
      return null;
    }
    if (!Array.isArray(elevations) || elevations.length !== points.length) return null;

    const valid = points
      .map((p, i) => ({ ...p, elev: elevations[i] }))
      .filter((p) => Number.isFinite(p.elev) && p.elev !== 0);

    // Need the centre plus most of the ring to say anything useful.
    const centre = valid.find((p) => p.name === 'C');
    const edges = valid.filter((p) => p.name !== 'C');
    if (!centre || edges.length < 6) return null;

    // Fit a plane the cheap way: sum each edge's drop as a vector away from
    // centre, so opposing slopes cancel and a consistent tilt accumulates.
    const COMPASS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
    let vx = 0, vy = 0;
    for (const edge of edges) {
      const drop = centre.elev - edge.elev; // positive = land falls that way
      const rad = (COMPASS[edge.name] * Math.PI) / 180;
      vy += drop * Math.cos(rad);
      vx += drop * Math.sin(rad);
    }

    const elevs = valid.map((p) => p.elev);
    const relief = Math.max(...elevs) - Math.min(...elevs);
    const magnitude = Math.hypot(vx, vy);

    // Under ~2m of fall across 240m the site reads as flat to anyone standing
    // on it, and the DEM's own vertical error is a metre or two anyway.
    if (relief < 2 || magnitude < 1) {
      return { topography: 'Relatively Flat', drop: relief, confident: relief < 2 };
    }

    let bearing = (Math.atan2(vx, vy) * 180) / Math.PI;
    if (bearing < 0) bearing += 360;
    const best = TOPO_HEADINGS.reduce((acc, h) => {
      let diff = Math.abs(bearing - h.bearing);
      if (diff > 180) diff = 360 - diff;
      return diff < acc.diff ? { label: h.label, diff } : acc;
    }, { label: null, diff: 999 });

    return { topography: best.label, drop: relief, confident: relief >= 3 };
  }

  // ---------- Facade orientation ----------
  // Maps a compass heading to the wording the report schema expects.
  const FACADE_POINTS = [
    'Approximately North', 'Approximately North East', 'Approximately East', 'Approximately South East',
    'Approximately South', 'Approximately South West', 'Approximately West', 'Approximately North West',
  ];

  // The technician stands on the street and photographs the front of the
  // house, so the phone points at the facade — the direction the facade FACES
  // is the reverse of where the camera is looking.
  function facadeFromHeading(heading) {
    if (!Number.isFinite(heading)) return null;
    const facing = (heading + 180) % 360;
    const index = Math.round(facing / 45) % 8;
    return FACADE_POINTS[index];
  }

  // Which way the front of the house faces, worked out from the street rather
  // than from a compass.
  //
  // A compass reading was the obvious approach and is the weaker one: it needs
  // a motion-sensor permission prompt on iOS, it is thrown off by the steel in
  // a wall or a phone held at an angle, and it only produces an answer if the
  // technician remembers to take the front photo in the right mode. Houses
  // front the street, so the bearing from the dwelling to the nearest road
  // gives the same answer with no permission, no sensor, and it works for a
  // job booked from the office before anyone has visited.
  //
  // Service ways are matched only as a last resort: they are driveways and
  // rear lanes, and the nearest one is often closer than the actual street.
  async function fetchFacadeOrientation(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    async function nearestRoad(filter) {
      const query = `[out:json][timeout:20];way["highway"~"${filter}"](around:150,${lat},${lng});out geom;`;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 1200 * attempt));
        const res = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
        });
        if (!res.ok) continue;
        const text = await res.text();
        // Overpass answers a throttled request with an XML error page, which
        // parses as "no roads here" if taken at face value.
        if (text.trim().startsWith('<')) continue;
        const data = JSON.parse(text);
        const ways = (data.elements || []).filter((e) => e.type === 'way' && Array.isArray(e.geometry));
        if (!ways.length) return null;

        let best = null;
        for (const way of ways) {
          for (const point of way.geometry) {
            const dy = (point.lat - lat) * 111320;
            const dx = (point.lon - lng) * 111320 * Math.cos((lat * Math.PI) / 180);
            const dist = Math.hypot(dx, dy);
            if (!best || dist < best.dist) {
              best = { dist, dx, dy, name: (way.tags && way.tags.name) || '', highway: way.tags && way.tags.highway };
            }
          }
        }
        return best;
      }
      return null;
    }

    let best = null;
    try {
      best = await nearestRoad('^(residential|tertiary|secondary|primary|unclassified|living_street)$');
      if (!best) best = await nearestRoad('^(service|track)$');
    } catch (err) {
      console.warn('[geo] facade orientation lookup failed:', err.message || err);
      return null;
    }
    if (!best) return null;

    // Geocoders routinely place an address on the road centreline rather than
    // on the building, especially where there is no building polygon. The
    // bearing from a point to the road it is standing on is noise, and a
    // confidently wrong compass direction on a compliance document is worse
    // than an empty field the technician fills in from the kerb. Measured on
    // 31 Queen Street, Campbelltown: the geocode landed 0m from the street.
    if (best.dist < 8) return null;

    let bearing = (Math.atan2(best.dx, best.dy) * 180) / Math.PI;
    if (bearing < 0) bearing += 360;

    return {
      facade: facadeFromBearing(bearing),
      street: best.name,
      metres: Math.round(best.dist),
      // A street more than 60m away usually means a battle-axe block or a
      // rural setback, where the frontage may not face the road at all.
      confident: best.dist <= 60 && best.highway !== 'service' && best.highway !== 'track',
    };
  }

  // The facade faces toward the street, so the bearing from house to road is
  // the facing direction directly — no reversal. Contrast facadeFromHeading
  // below, where the camera is pointed AT the house from the street.
  function facadeFromBearing(bearing) {
    if (!Number.isFinite(bearing)) return null;
    const index = Math.round(((bearing % 360) + 360) % 360 / 45) % 8;
    return FACADE_POINTS[index];
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
      console.warn('[geo] weather fetch failed:', err.message || err);
      return null;
    }
  }

  window.Geo = {
    geocodeAddress,
    ensureJobCoords,
    fetchFootprint,
    fetchAerialImage,
    fetchAerialImages,
    fetchSiteTopography,
    fetchFacadeOrientation,
    facadeFromBearing,
    facadeFromHeading,
    fetchCurrentWeather,
  };
})();
