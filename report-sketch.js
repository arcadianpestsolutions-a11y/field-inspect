// ===========================================================================
// report-sketch.js - the site sketch (mud map) pad (v128).
//
// Moved out of report.js, where it was 900 of its 4,500 lines. A canvas over
// an aerial photo of the property: trace the building outline (tapped, or
// walked corner by corner with GPS), drop numbered markers (bait stations,
// hot water, tanks, air con...), square it up, undo, and save it into the
// report as a picture plus the marker data.
//
// render(field, host) returns the field's element. host.job() is the job being
// reported on; host.values() is the open section's answers, which this writes
// the sketch (field.id) and its markers (sketchData) into. Nothing else from
// the report editor is touched.
//
// EXPOSES: window.ReportSketch = { render }
// ===========================================================================
(() => {
  'use strict';

  const { toast, askPrompt } = window.Common;

  function renderSketchField(field, host) {
    const job = () => host.job();
    const values = () => host.values();
    const wrap = document.createElement('div');
    wrap.className = 'sketch-field';

    const canvas = document.createElement('canvas');
    canvas.width = 340;
    canvas.height = 420;
    canvas.className = 'sketch-canvas';
    wrap.appendChild(canvas);

    const ctx = canvas.getContext('2d');

    // The technician's own strokes and labels live on their own offscreen
    // layer rather than being painted straight onto the visible canvas.
    // That separation is what makes the traced outline correctable: the base
    // (grid, aerial photo, polygons) can be re-rendered as many times as the
    // corners are dragged without ever destroying hand-drawn work.
    const ink = document.createElement('canvas');
    ink.width = canvas.width;
    ink.height = canvas.height;
    const inkCtx = ink.getContext('2d');
    inkCtx.strokeStyle = '#1a1a1a';
    inkCtx.lineWidth = 2.5;
    inkCtx.lineJoin = 'round';
    inkCtx.lineCap = 'round';

    function drawGrid() {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#eef1f6';
      ctx.lineWidth = 1;
      for (let x = 0; x <= canvas.width; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
      for (let y = 0; y <= canvas.height; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
    }

    // Two things are saved every redraw: the flattened image the report and
    // PDF already use, and the markers as data so a later edit gets real
    // markers back instead of a picture of them.
    function saveSnapshot() {
      values()[field.id] = canvas.toDataURL('image/png');
      values().sketchData = markers.length ? JSON.stringify({ markers }) : '';
    }

    // ---------- Aerial backdrop ----------
    // Three things can sit underneath the technician's own drawing, and they
    // stack in this order:
    //   backdropImage   — an aerial photo of the property, when no vector
    //                     geometry exists for it and it has to be traced
    //   sitePolygon     — the legal lot boundary from the NSW cadastre,
    //                     drawn dashed: it's the site, not the structure
    //   buildingPolygon — the building's exterior perimeter, drawn solid
    // Any of them can be absent. Exterior shapes only — nothing here ever
    // draws the inside of the house.
    let sitePolygon = null;
    let buildingPolygon = null;
    let backdropImage = null;
    let hasFreehandWork = false;
    let mode = 'draw'; // 'draw' | 'label' | 'corners' | 'stamp'

    // Placed pest-control markers, kept as structured data (not just baked
    // pixels) so they survive a later edit — see sketchData in
    // report-schema.js. Each is { id, kind, x, y, n, note } with x/y as
    // 0-1 fractions of the canvas, so they stay put at any size.
    let markers = [];
    let stampKind = 'drill';
    let gpsCorners = [];
    const stampBtns = {};

    // Declared up here, not with the rest of the UI at the bottom, because
    // the backdrop loader below reports what it found by rewriting it — and
    // that runs before the controls are built.
    const hint = Object.assign(document.createElement('p'), {
      className: 'empty-hint',
      textContent: 'Draw the outline with your finger, then switch to Add Label and tap anywhere to name a room or flag something. Trace Building reads the exterior perimeter off an aerial photo to start you off.',
    });

    function drawPolygon(polygon, style) {
      ctx.save();
      ctx.strokeStyle = style.stroke;
      ctx.fillStyle = style.fill;
      ctx.lineWidth = style.width;
      if (style.dash) ctx.setLineDash(style.dash);
      ctx.beginPath();
      polygon.forEach(([x, y], i) => {
        const px = x * canvas.width, py = y * canvas.height;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Corner handles are deliberately large: this gets used one-handed on a
    // phone at a job site, so a 9px target with a 22px touch radius (below)
    // is the difference between usable and infuriating.
    function drawCornerHandles() {
      if (!buildingPolygon) return;
      ctx.save();
      buildingPolygon.forEach(([x, y]) => {
        const px = x * canvas.width, py = y * canvas.height;
        ctx.beginPath();
        ctx.arc(px, py, 9, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#2c7a4b';
        ctx.stroke();
      });
      ctx.restore();
    }

    function redrawBase() {
      drawGrid();
      if (backdropImage) ctx.drawImage(backdropImage, 0, 0, canvas.width, canvas.height);
      if (sitePolygon) {
        drawPolygon(sitePolygon, { stroke: '#b26a00', fill: 'rgba(178,106,0,0.05)', width: 2, dash: [6, 4] });
      }
      if (buildingPolygon) {
        drawPolygon(buildingPolygon, { stroke: '#2c7a4b', fill: 'rgba(44,122,75,0.10)', width: 2.5, dash: null });
      }
      ctx.drawImage(ink, 0, 0);
      drawMarkers();
      drawLegend();
      if (mode === 'corners') drawCornerHandles();
    }

    // Every redraw goes through here so the saved snapshot never drifts out
    // of sync with what's on screen. Handles are a transient editing aid, so
    // the snapshot is taken without them.
    function commit() {
      const editing = mode === 'corners';
      if (editing) { mode = 'draw'; redrawBase(); mode = 'corners'; }
      else redrawBase();
      saveSnapshot();
      if (editing) redrawBase();
    }

    function setBackdropImage(url) {
      return new Promise((resolve) => {
        const img = new Image();
        // The imagery services send Access-Control-Allow-Origin, so this
        // keeps the canvas untainted and saveSnapshot()'s toDataURL() working.
        img.crossOrigin = 'anonymous';
        img.onload = () => { backdropImage = img; resolve(true); };
        img.onerror = () => { console.warn('[report] aerial backdrop image failed to load'); resolve(false); };
        img.src = url;
      });
    }

    // shouldDraw=false when restoring an already-saved sketch: the footprint
    // is still worth fetching so a later redraw has it, but the canvas must
    // not be touched — it already shows the technician's saved work.
    async function loadFootprintData(shouldDraw) {
      if (!(window.Geo && job())) return;
      // Jobs created by typing the address rather than tapping a suggestion
      // carry no coordinates, which is why the mud map often came up blank
      // with nothing said about why. Resolve the address now instead.
      const coords = await window.Geo.ensureJobCoords(job());
      if (!coords) {
        // Marked as a problem rather than phrased as one. This message is why
        // the sketch "doesn't work" — it comes up blank with an explanation
        // nobody reads, because it looks exactly like the ordinary
        // instructions above it.
        hint.className = 'empty-hint sketch-needs-address';
        hint.textContent = (job() && job().address)
          ? `No map location found for “${job().address}”, so there is no aerial photo to trace. `
            + 'Check the address on the job — re-pick it from the suggestions — or draw the outline by hand.'
          : 'This job has no address, so there is no aerial photo to trace. '
            + 'Add the property address to the job, or draw the outline by hand.';
        return;
      }
      try {
        const footprint = await window.Geo.fetchFootprint(coords.lat, coords.lng);
        const polygon = footprint.polygon;
        const usable = Array.isArray(polygon) && polygon.length >= 3;

        if (footprint.source === 'osm' && usable) {
          buildingPolygon = polygon;
          hint.textContent = 'Outline loaded from map data. Adjust Corners to correct it, or draw over it.';
        } else if (footprint.source === 'cadastre' && usable) {
          sitePolygon = polygon;
          if (footprint.lotId) hint.textContent = `Site boundary shown for ${footprint.lotId}. Trace the building inside it.`;
        } else if (footprint.source === 'satellite' && footprint.imageUrl) {
          if (!(await setBackdropImage(footprint.imageUrl))) return;
        } else {
          return;
        }

        if (shouldDraw) commit();
      } catch (err) {
        console.warn('[report] aerial backdrop fetch failed:', err.message || err);
      }
    }

    const existing = values()[field.id];
    if (existing) {
      // A saved sketch is a flat image — the polygon behind it is gone, so it
      // is restored onto the ink layer and treated as hand-drawn work.
      const img = new Image();
      img.onload = () => { inkCtx.drawImage(img, 0, 0, canvas.width, canvas.height); redrawBase(); };
      img.src = existing;
      hasFreehandWork = true;
      loadFootprintData(false);
    } else {
      drawGrid();
      loadFootprintData(true);
    }

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      const point = e.touches && e.touches.length ? e.touches[0] : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e);
      return { x: (point.clientX - rect.left) * (canvas.width / rect.width), y: (point.clientY - rect.top) * (canvas.height / rect.height) };
    }

    // ---------- Corner editing ----------
    const GRAB_RADIUS = 22;
    let draggingCorner = -1;
    let lastTapAt = 0;
    let lastTapCorner = -1;

    function cornerAt(p) {
      if (!buildingPolygon) return -1;
      let best = -1, bestDist = GRAB_RADIUS;
      buildingPolygon.forEach(([x, y], i) => {
        const d = Math.hypot(x * canvas.width - p.x, y * canvas.height - p.y);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      return best;
    }

    // Where along the perimeter a tap falls, so tapping an edge can insert a
    // corner the model missed — common where tree canopy hid a whole wing.
    function edgeAt(p) {
      if (!buildingPolygon || buildingPolygon.length < 2) return -1;
      let best = -1, bestDist = 18;
      for (let i = 0; i < buildingPolygon.length; i++) {
        const a = buildingPolygon[i];
        const b = buildingPolygon[(i + 1) % buildingPolygon.length];
        const ax = a[0] * canvas.width, ay = a[1] * canvas.height;
        const bx = b[0] * canvas.width, by = b[1] * canvas.height;
        const dx = bx - ax, dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (!lenSq) continue;
        let t = ((p.x - ax) * dx + (p.y - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(ax + t * dx - p.x, ay + t * dy - p.y);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      return best;
    }

    function startCornerEdit(e) {
      const p = pos(e);
      const idx = cornerAt(p);
      const now = Date.now();

      if (idx >= 0) {
        // Double-tap a corner to delete it (never below a triangle).
        if (idx === lastTapCorner && now - lastTapAt < 400 && buildingPolygon.length > 3) {
          buildingPolygon.splice(idx, 1);
          lastTapCorner = -1;
          commit();
          e.preventDefault();
          return;
        }
        lastTapCorner = idx;
        lastTapAt = now;
        draggingCorner = idx;
        e.preventDefault();
        return;
      }

      const edge = edgeAt(p);
      if (edge >= 0) {
        buildingPolygon.splice(edge + 1, 0, [p.x / canvas.width, p.y / canvas.height]);
        draggingCorner = edge + 1;
        commit();
      }
      e.preventDefault();
    }

    function moveCorner(e) {
      if (draggingCorner < 0) return;
      const p = pos(e);
      buildingPolygon[draggingCorner] = [
        Math.max(0, Math.min(1, p.x / canvas.width)),
        Math.max(0, Math.min(1, p.y / canvas.height)),
      ];
      redrawBase();
      e.preventDefault();
    }

    function endCornerEdit() {
      if (draggingCorner < 0) return;
      draggingCorner = -1;
      commit();
    }

    // ---------- Freehand drawing ----------
    let drawing = false;
    function start(e) {
      if (mode === 'corners') { startCornerEdit(e); return; }
      if (mode === 'label') {
        const p = pos(e);
        // Both of these have to happen before the dialog is awaited:
        // preventDefault does nothing once the event has finished
        // dispatching, and pos(e) reads coordinates off the live event.
        e.preventDefault();
        askPrompt('Label for this spot (e.g. Kitchen, High moisture, Damage):', '',
          { title: 'Label this spot', okLabel: 'Add label' }).then((text) => {
          if (!text) return;
          inkCtx.fillStyle = '#c0552a';
          inkCtx.beginPath();
          inkCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          inkCtx.fill();
          inkCtx.font = '13px sans-serif';
          inkCtx.fillText(text, p.x + 8, p.y + 4);
          hasFreehandWork = true;
          commit();
        });
        return;
      }
      drawing = true;
      const p = pos(e);
      inkCtx.beginPath();
      inkCtx.moveTo(p.x, p.y);
      e.preventDefault();
    }

    function move(e) {
      if (mode === 'corners') { moveCorner(e); return; }
      if (!drawing || mode !== 'draw') return;
      const p = pos(e);
      inkCtx.lineTo(p.x, p.y);
      inkCtx.stroke();
      redrawBase();
      e.preventDefault();
    }

    function end() {
      if (mode === 'corners') { endCornerEdit(); return; }
      if (!drawing) return;
      drawing = false;
      hasFreehandWork = true;
      commit();
    }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    const controls = document.createElement('div');
    controls.className = 'row gap sketch-controls';

    const drawBtn = document.createElement('button');
    drawBtn.type = 'button';
    drawBtn.className = 'btn btn-secondary flex1 active';
    drawBtn.textContent = '✏️ Draw';

    const labelBtn = document.createElement('button');
    labelBtn.type = 'button';
    labelBtn.className = 'btn btn-secondary flex1';
    labelBtn.textContent = '🏷️ Add Label';

    const cornersBtn = document.createElement('button');
    cornersBtn.type = 'button';
    cornersBtn.className = 'btn btn-secondary flex1';
    cornersBtn.textContent = '📐 Adjust Corners';

    function setMode(next) {
      if (next === 'corners' && !buildingPolygon) {
        toast('No outline to adjust yet — use Trace Building first, or draw one by hand.');
        return;
      }
      mode = next;
      drawBtn.classList.toggle('active', mode === 'draw');
      if (mode !== 'stamp') {
        Object.keys(stampBtns).forEach((k) => stampBtns[k].classList.remove('active'));
      }
      labelBtn.classList.toggle('active', mode === 'label');
      cornersBtn.classList.toggle('active', mode === 'corners');
      redrawBase();
      if (mode === 'corners') {
        hint.textContent = 'Drag a corner to move it. Tap an edge to add a corner. Double-tap a corner to delete it.';
      }
    }
    drawBtn.addEventListener('click', () => setMode('draw'));
    labelBtn.addEventListener('click', () => setMode('label'));
    cornersBtn.addEventListener('click', () => setMode('corners'));

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-secondary';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
      // Clear wipes the technician's own drawing and labels back to the base
      // layer — it does not lose an already-loaded backdrop or outline.
      inkCtx.clearRect(0, 0, ink.width, ink.height);
      hasFreehandWork = false;
      commit();
    });

    // Australian houses are overwhelmingly rectilinear, so a trace read off a
    // partly-obscured roof can be snapped back to right angles: take the
    // dominant wall direction and force every edge onto that axis or its
    // perpendicular. This is deterministic geometry, not another guess — it
    // turns an approximately-right outline into a plausible footprint, and
    // it's the cheapest way to recover from canopy blurring the corners.
    function squareUp(polygon) {
      if (!polygon || polygon.length < 4) return polygon;
      // Aspect-correct so angles are measured in real-world space, not in the
      // canvas's stretched coordinates.
      const ar = canvas.width / canvas.height;
      const pts = polygon.map(([x, y]) => [x * ar, y]);

      let bestAngle = 0, bestLen = -1;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len > bestLen) { bestLen = len; bestAngle = Math.atan2(b[1] - a[1], b[0] - a[0]); }
      }
      const cos = Math.cos(-bestAngle), sin = Math.sin(-bestAngle);
      const rot = pts.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);

      // In the rotated frame every wall should be axis-aligned: for each edge,
      // move whichever coordinate varies less onto a shared value.
      for (let i = 0; i < rot.length; i++) {
        const j = (i + 1) % rot.length;
        const dx = Math.abs(rot[j][0] - rot[i][0]);
        const dy = Math.abs(rot[j][1] - rot[i][1]);
        if (dx < dy) {
          const mid = (rot[i][0] + rot[j][0]) / 2;
          rot[i][0] = mid; rot[j][0] = mid;
        } else {
          const mid = (rot[i][1] + rot[j][1]) / 2;
          rot[i][1] = mid; rot[j][1] = mid;
        }
      }

      const back = rot.map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos]);
      return back.map(([x, y]) => [
        Math.max(0, Math.min(1, x / ar)),
        Math.max(0, Math.min(1, y)),
      ]);
    }

    const squareBtn = document.createElement('button');
    squareBtn.type = 'button';
    squareBtn.className = 'btn btn-secondary flex1';
    squareBtn.textContent = '📏 Square Up';
    squareBtn.addEventListener('click', () => {
      if (!buildingPolygon) { toast('No outline to square up yet.'); return; }
      buildingPolygon = squareUp(buildingPolygon);
      commit();
      hint.textContent = 'Corners squared to right angles. Adjust Corners if any wall moved the wrong way.';
    });

    // Reads the building's exterior perimeter off aerial photos and lays it
    // down as the base shape, for when no open dataset has a vector outline
    // for the property — or has one, but for the wrong building. A starting
    // shape to correct, not an answer — hence a button the technician presses
    // rather than something that happens to them.
    const traceBtn = document.createElement('button');
    traceBtn.type = 'button';
    traceBtn.className = 'btn btn-secondary flex1';
    traceBtn.textContent = '🛰️ Trace Building';
    traceBtn.addEventListener('click', async () => {
      if (!(window.Geo && job())) return;
      // The trace itself runs on the Edge Function, unlike the rest of the
      // sketch pad's geo features — so it is the one thing here that needs a
      // signed-in session, and says so rather than appearing to do nothing.
      if (!window.AI) {
        toast('Tracing needs you to be signed in. The aerial backdrop still works — trace the outline by hand.');
        return;
      }
      const label = traceBtn.textContent;
      traceBtn.disabled = true;
      traceBtn.textContent = '🛰️ Tracing…';
      try {
        const coords = await window.Geo.ensureJobCoords(job());
        if (!coords) {
          toast('Could not find this address on the map. Check the address on the job, then try again.');
          return;
        }
        const traced = await window.AI.traceBuildingOutline(coords.lat, coords.lng);
        // Show the photo underneath the outline so the technician can see
        // what was traced and judge it, rather than trusting a bare shape.
        if (!backdropImage && traced.imageUrl) await setBackdropImage(traced.imageUrl);
        buildingPolygon = traced.polygon;
        setMode('corners');
        commit();
        const obscured = traced.obscured ? ` Uncertain near: ${traced.obscured}.` : '';
        hint.textContent = `Traced outline (${traced.confidence} confidence).${traced.note ? ' ' + traced.note : ''}${obscured} Drag any corner that looks wrong.`;
        toast(traced.confidence === 'low'
          ? 'Traced, but the roof was hard to see — check every corner.'
          : 'Outline traced — drag any corner that looks wrong.');
      } catch (err) {
        if (window.ErrorLog) window.ErrorLog.note(err, 'site sketch: trace outline');
        toast(err.message || 'Could not trace the building outline.');
      } finally {
        traceBtn.disabled = false;
        traceBtn.textContent = label;
      }
    });

    controls.appendChild(drawBtn);
    controls.appendChild(labelBtn);
    controls.appendChild(clearBtn);
    wrap.appendChild(controls);

    const shapeRow = document.createElement('div');
    shapeRow.className = 'row gap sketch-controls';
    shapeRow.appendChild(traceBtn);
    shapeRow.appendChild(cornersBtn);
    shapeRow.appendChild(squareBtn);
    wrap.appendChild(shapeRow);

    wrap.appendChild(hint);

    // ================= Pest markers, GPS corners, auto-legend =================
    // Written for a technician on a ladder with one hand free. Every control
    // says what it does in plain words, the app does the tidying (numbering,
    // squaring, the legend) so the client-facing result looks the same no
    // matter who drew it, and anything that cannot work says why.

    const STAMPS = {
      drill: { label: 'Drill point', short: 'Drill / rod point', shape: 'circle', colour: '#c0392b', numbered: true },
      bait: { label: 'Bait station', short: 'Bait station', shape: 'square', colour: '#8e44ad', numbered: true },
      pier: { label: 'Pier', short: 'Pier', shape: 'triangle', colour: '#7f8c8d', numbered: false },
      tree: { label: 'Tree', short: 'Tree', shape: 'tree', colour: '#2c7a4b', numbered: false },
      water: { label: 'Water', short: 'Tap / water source', shape: 'drop', colour: '#2980b9', numbered: false },
      meter: { label: 'Meter box', short: 'Electric / gas meter', shape: 'meter', colour: '#b26a00', numbered: false },
      // The moisture sources. All four are conducive conditions in their own
      // right — a leaking HWS relief valve or an air-con condensate line
      // discharging against the slab is a textbook termite attractant — so
      // marking where they sit on the plan is doing double duty.
      hws: { label: 'Hot water', short: 'Hot water system', shape: 'cylinder', colour: '#c0392b', numbered: false },
      tank: { label: 'Water tank', short: 'Water tank', shape: 'tank', colour: '#2980b9', numbered: false },
      aircon: { label: 'Air con', short: 'Air conditioner', shape: 'aircon', colour: '#16a085', numbered: false },
      downpipe: { label: 'Downpipe', short: 'Downpipe / drain', shape: 'pipe', colour: '#34495e', numbered: false },
    };

    const markerDataField = 'sketchData';

    function nextNumber(kind) {
      const used = markers.filter((m) => m.kind === kind).map((m) => m.n).filter((n) => typeof n === 'number');
      return used.length ? Math.max.apply(null, used) + 1 : 1;
    }

    function drawMarkers() {
      for (const m of markers) {
        const spec = STAMPS[m.kind];
        if (!spec) continue;
        const x = m.x * canvas.width;
        const y = m.y * canvas.height;
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = spec.colour;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        if (spec.shape === 'circle') {
          ctx.arc(x, y, 9, 0, Math.PI * 2);
        } else if (spec.shape === 'square') {
          ctx.rect(x - 8, y - 8, 16, 16);
        } else if (spec.shape === 'triangle') {
          ctx.moveTo(x, y - 9); ctx.lineTo(x + 8, y + 7); ctx.lineTo(x - 8, y + 7); ctx.closePath();
        } else if (spec.shape === 'drop') {
          ctx.moveTo(x, y - 10);
          ctx.quadraticCurveTo(x + 9, y + 2, x, y + 9);
          ctx.quadraticCurveTo(x - 9, y + 2, x, y - 10);
          ctx.closePath();
        } else if (spec.shape === 'meter') {
          ctx.rect(x - 8, y - 6, 16, 12);
        } else if (spec.shape === 'cylinder') {
          // tall upright cylinder — reads as a hot water unit
          ctx.rect(x - 5, y - 10, 10, 20);
        } else if (spec.shape === 'tank') {
          // squat wide cylinder — reads as a rainwater tank
          ctx.rect(x - 9, y - 6, 18, 13);
        } else if (spec.shape === 'aircon') {
          ctx.rect(x - 9, y - 6, 18, 12);
        } else if (spec.shape === 'pipe') {
          ctx.rect(x - 3, y - 10, 6, 20);
        } else {
          ctx.arc(x, y - 3, 8, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();
        if (spec.shape === 'tree') {
          ctx.beginPath(); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 10); ctx.stroke();
        }
        // Fins, so an air conditioner is not just another rectangle next to
        // the meter box at a glance.
        if (spec.shape === 'aircon') {
          ctx.beginPath();
          for (let fx = -5; fx <= 5; fx += 5) { ctx.moveTo(x + fx, y - 3); ctx.lineTo(x + fx, y + 3); }
          ctx.stroke();
        }
        if (spec.shape === 'tank' || spec.shape === 'cylinder') {
          ctx.beginPath();
          ctx.moveTo(x - (spec.shape === 'tank' ? 9 : 5), y - (spec.shape === 'tank' ? 2 : 5));
          ctx.lineTo(x + (spec.shape === 'tank' ? 9 : 5), y - (spec.shape === 'tank' ? 2 : 5));
          ctx.stroke();
        }
        if (spec.numbered && typeof m.n === 'number') {
          ctx.fillStyle = spec.colour;
          ctx.font = 'bold 10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(m.n), x, y + 0.5);
        }
        ctx.restore();
      }
    }

    // The biggest difference between a sketch that reads as a professional's
    // and one that reads as a doodle is whether the client can tell what the
    // symbols mean. So the legend is not something the technician has to
    // remember — it draws itself from whatever was actually placed, and it
    // disappears when there is nothing to explain.
    function drawLegend() {
      const kinds = [];
      for (const m of markers) if (STAMPS[m.kind] && kinds.indexOf(m.kind) === -1) kinds.push(m.kind);
      if (!kinds.length) return;
      // Two columns once the list gets long: a legend that eats half the plan
      // defeats the point of drawing one.
      const rowH = 14;
      const cols = kinds.length > 5 ? 2 : 1;
      const perCol = Math.ceil(kinds.length / cols);
      const colW = 122;
      const boxH = perCol * rowH + 11;
      const boxW = cols * colW + 4;
      const x0 = 6;
      const y0 = canvas.height - boxH - 6;
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.93)';
      ctx.strokeStyle = '#c9cfd8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(x0, y0, boxW, boxH);
      ctx.fill();
      ctx.stroke();
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      kinds.forEach((k, i) => {
        const spec = STAMPS[k];
        const col = Math.floor(i / perCol);
        const cx = x0 + col * colW;
        const cy = y0 + 9 + (i % perCol) * rowH;
        let count = 0;
        for (const m of markers) if (m.kind === k) count++;
        ctx.strokeStyle = spec.colour;
        ctx.fillStyle = '#fff';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        const boxy = ['square', 'meter', 'aircon', 'tank', 'cylinder', 'pipe'];
        if (boxy.indexOf(spec.shape) !== -1) ctx.rect(cx + 8, cy - 4, 8, 8);
        else ctx.arc(cx + 12, cy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#333';
        ctx.fillText(spec.short + (count > 1 ? ' (' + count + ')' : ''), cx + 24, cy);
      });
      ctx.restore();
    }

    function markerAt(p) {
      for (let i = markers.length - 1; i >= 0; i--) {
        const m = markers[i];
        const dx = m.x * canvas.width - p.x;
        const dy = m.y * canvas.height - p.y;
        if (Math.hypot(dx, dy) <= 14) return i;
      }
      return -1;
    }

    // ---------- GPS corner marking ----------
    // Deliberately NOT watchPosition streaming. A phone fix is 3-5 m at best
    // and worse hard against a wall, so continuously tracing a walk produces
    // a wobbly blob several metres off the building — useless as a mud map.
    // Standing still at each corner and averaging the fixes removes most of
    // the random error, and four deliberate points beat four hundred noisy
    // ones. The result is squared up afterwards regardless.
    const GPS_MAX_ACCURACY_M = 10;
    const GPS_SAMPLE_MS = 6000;
    let wakeLock = null;

    async function holdScreenAwake(on) {
      try {
        if (on && !wakeLock && navigator.wakeLock) {
          wakeLock = await navigator.wakeLock.request('screen');
        } else if (!on && wakeLock) {
          await wakeLock.release();
          wakeLock = null;
        }
      } catch (err) {
        // A screen that sleeps is survivable. A crash mid-walk is not.
      }
    }

    function sampleCorner(onProgress) {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('This device cannot do GPS.'));
          return;
        }
        const fixes = [];
        const id = navigator.geolocation.watchPosition(
          (p) => {
            fixes.push({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
            onProgress(p.coords.accuracy, fixes.length);
          },
          (err) => {
            navigator.geolocation.clearWatch(id);
            reject(new Error(err && err.code === 1
              ? 'Location is turned off for this site. Switch it on in your browser settings, then try again.'
              : 'Could not get a location. Step out from under the eaves and try again.'));
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: GPS_SAMPLE_MS }
        );
        setTimeout(() => {
          navigator.geolocation.clearWatch(id);
          const good = fixes.filter((f) => f.acc <= GPS_MAX_ACCURACY_M);
          if (!good.length) {
            let best = null;
            for (const f of fixes) if (best === null || f.acc < best) best = f.acc;
            reject(new Error(best !== null
              ? 'Signal only reached ' + Math.round(best) + ' m accuracy — too rough to place a corner. Step away from the wall and try again.'
              : 'No GPS signal here. Step into the open and try again.'));
            return;
          }
          let sLat = 0, sLng = 0, sAcc = 0;
          for (const f of good) { sLat += f.lat; sLng += f.lng; sAcc += f.acc; }
          resolve({
            lat: sLat / good.length,
            lng: sLng / good.length,
            acc: Math.round(sAcc / good.length),
          });
        }, GPS_SAMPLE_MS);
      });
    }

    // Corners arrive as lat/lng. Convert to metres on a local flat plane
    // (accurate enough across one house), then fit that shape into the canvas
    // with a margin, preserving the real aspect ratio so the plan is to scale.
    function cornersToPolygon(corners) {
      if (!corners || corners.length < 3) return null;
      let latSum = 0;
      for (const c of corners) latSum += c.lat;
      const lat0 = latSum / corners.length;
      const mPerLat = 111320;
      const mPerLng = 111320 * Math.cos(lat0 * Math.PI / 180);
      const pts = corners.map((c) => [c.lng * mPerLng, -c.lat * mPerLat]);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const minX = Math.min.apply(null, xs);
      const maxX = Math.max.apply(null, xs);
      const minY = Math.min.apply(null, ys);
      const maxY = Math.max.apply(null, ys);
      const wM = Math.max(maxX - minX, 0.001);
      const hM = Math.max(maxY - minY, 0.001);
      const pad = 0.14;
      const scale = Math.min((1 - pad * 2) * canvas.width / wM, (1 - pad * 2) * canvas.height / hM);
      const offX = (canvas.width - wM * scale) / 2;
      const offY = (canvas.height - hM * scale) / 2;
      return {
        polygon: pts.map((pt) => [
          (offX + (pt[0] - minX) * scale) / canvas.width,
          (offY + (pt[1] - minY) * scale) / canvas.height,
        ]),
        widthM: wM,
        heightM: hM,
      };
    }

    // ---------- controls ----------
    const gpsRow = document.createElement('div');
    gpsRow.className = 'row gap sketch-controls';
    const gpsBtn = document.createElement('button');
    gpsBtn.type = 'button';
    gpsBtn.className = 'btn btn-secondary flex1';
    const gpsDoneBtn = document.createElement('button');
    gpsDoneBtn.type = 'button';
    gpsDoneBtn.className = 'btn btn-primary flex1 hidden';
    gpsRow.appendChild(gpsBtn);
    gpsRow.appendChild(gpsDoneBtn);

    function updateGpsUi() {
      const n = gpsCorners.length;
      gpsBtn.textContent = n ? 'Mark Corner ' + (n + 1) : 'Walk the Corners';
      gpsDoneBtn.classList.toggle('hidden', n < 3);
      gpsDoneBtn.textContent = 'Draw the Outline (' + n + ')';
    }

    gpsBtn.addEventListener('click', async () => {
      if (!gpsCorners.length) {
        hint.textContent = 'Stand at one corner of the house, hold still, and tap again. Then walk to the next corner and do the same, all the way around.';
      }
      gpsBtn.disabled = true;
      const original = gpsBtn.textContent;
      await holdScreenAwake(true);
      try {
        const fix = await sampleCorner((acc, count) => {
          gpsBtn.textContent = 'Hold still... ' + Math.round(acc) + ' m (' + count + ')';
        });
        gpsCorners.push(fix);
        toast('Corner ' + gpsCorners.length + ' marked, give or take ' + fix.acc + ' m.');
        hint.textContent = gpsCorners.length < 3
          ? gpsCorners.length + ' of at least 3 corners done. Walk to the next corner.'
          : gpsCorners.length + ' corners done. Keep going, or tap Draw the Outline once you have been all the way around.';
      } catch (err) {
        if (window.ErrorLog) window.ErrorLog.note(err, 'site sketch: GPS');
        gpsBtn.textContent = original;
        toast(err.message);
        hint.textContent = err.message;
      } finally {
        gpsBtn.disabled = false;
        updateGpsUi();
      }
    });

    gpsDoneBtn.addEventListener('click', () => {
      const fitted = cornersToPolygon(gpsCorners);
      if (!fitted) { toast('Mark at least 3 corners first.'); return; }
      buildingPolygon = squareUp(fitted.polygon);
      gpsCorners = [];
      updateGpsUi();
      holdScreenAwake(false);
      commit();
      hint.textContent = 'Outline drawn from your walk, about '
        + Math.round(fitted.widthM) + ' m by ' + Math.round(fitted.heightM)
        + ' m, and squared to right angles. Check it against the house — use Adjust Corners to drag anything that looks wrong.';
      toast('Outline drawn. Check it before you finish.');
    });

    const stampRow = document.createElement('div');
    stampRow.className = 'row gap wrap sketch-controls';
    Object.keys(STAMPS).forEach((kind) => {
      const spec = STAMPS[kind];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-secondary sketch-stamp-btn';
      b.textContent = spec.label;
      b.addEventListener('click', () => {
        stampKind = kind;
        setMode('stamp');
        Object.keys(stampBtns).forEach((k) => stampBtns[k].classList.remove('active'));
        b.classList.add('active');
        hint.textContent = 'Tap the plan wherever a ' + spec.short.toLowerCase()
          + ' goes. Numbering happens by itself. Tap one again to add a note or remove it.';
      });
      stampBtns[kind] = b;
      stampRow.appendChild(b);
    });

    // ---------- placing and editing markers ----------
    canvas.addEventListener('click', async (e) => {
      if (mode !== 'stamp') return;
      const p = pos(e);
      const hit = markerAt(p);
      if (hit >= 0) {
        const m = markers[hit];
        const spec = STAMPS[m.kind];
        const answer = await askPrompt(
          'Type a note for this one, or type DELETE to remove it.',
          m.note || '',
          { title: spec.short + (typeof m.n === 'number' ? ' ' + m.n : ''), okLabel: 'Save note' }
        );
        if (answer === null) return;
        if (answer.trim().toUpperCase() === 'DELETE') markers.splice(hit, 1);
        else m.note = answer.trim();
        commit();
        return;
      }
      const spec = STAMPS[stampKind];
      markers.push({
        id: DB.uid(),
        kind: stampKind,
        x: p.x / canvas.width,
        y: p.y / canvas.height,
        n: spec.numbered ? nextNumber(stampKind) : null,
        note: '',
      });
      commit();
    });

    // Markers restore as data, so coming back to this section gives back
    // markers you can move and edit rather than a picture of them. The
    // flattened PNG still goes to sketchImage, so the report and the PDF are
    // unchanged.
    try {
      const savedData = values()[markerDataField];
      if (savedData) {
        const parsed = JSON.parse(savedData);
        if (parsed && Array.isArray(parsed.markers)) markers = parsed.markers;
      }
    } catch (err) {
      // A corrupt blob must never stop the sketch pad from opening.
    }

    wrap.appendChild(gpsRow);
    wrap.appendChild(stampRow);
    updateGpsUi();
    if (markers.length) commit();
    return wrap;
  }

  window.ReportSketch = { render: renderSketchField };
})();
