// Common comments: ready-made wording for the situations that come up on
// inspection after inspection, offered under a comment box and inserted with
// one tap, then edited like anything typed.
//
// WHERE THE WORDING COMES FROM. Every template here is drawn from the 328
// comments Tal wrote across his 60 most recent Formitize inspections (Nov 2025
// to Oct 2026): the phrases he actually used, tidied up and with the job-
// specific parts turned into [square brackets] to fill in. Nothing was
// invented as "what a report should say"; if a situation is not here, it is
// because it did not come up.
//
// NOT AUTOMATIC. A template is only ever inserted when the technician taps it.
// It is a starting sentence, not a finding: the [brackets] are there so a
// template cannot be submitted looking finished when it is not.
//
// Keyed by the report field id the comment box belongs to (report-schema.js).
//
// EXPOSES: window.CommentTemplates { forField(fieldId) -> [{ label, text }], all }
(() => {
  'use strict';

  const T = (label, text) => ({ label, text });

  const ALL = {
    // ---- Findings ----
    evidenceDetails: [
      T('Old damage in a fence post', 'Old termite damage found in a fence post. No live termites were found at the time of inspection.'),
      T('Stumps / trees in the yard', 'Trees and stumps within 75 metres of the house show evidence of termite workings, which suggests an active colony in the local area.'),
      T('Debris timber in contact with soil', 'Old termite damage found in felled trees and debris timber in contact with soil.'),
      T('Landscaping timber retaining wall', 'Termite damage found in the landscaping timber retaining wall. This is known to the home owner.'),
      T('Same as last inspection', 'Same damage as recorded at the last inspection, with no change found.'),
      T('Damage patched over', 'The termite damage has been patched over, so its full extent could not be assessed visually.'),
      T('Throughout the home', 'Termite workings and damage are spread throughout the home, especially on the [side] side.'),
    ],
    findingsAdditionalComments: [
      T('Yard damage, deck inaccessible', 'Most of the damage is in the yard trees, but there could be additional damage under the deck, which was inaccessible at the time of inspection.'),
      T('Old damage from a previous attack', 'Old damage from a previous termite attack. No live termites were found at the time of inspection.'),
    ],
    nestLocation: [
      T('Base of a dead tree', 'Termite structure at the base of a dead tree and in the ground around it. There is a high chance of active termites here, but confirming it would require invasive inspection methods.'),
      T('Mound near the house', 'Small termite mound on the [side] side of the house, near a tree.'),
      T('Mound some distance away', 'Large termite mound approximately [distance] metres [direction] of the house.'),
      T('Overrun by ants', 'The nest has been overrun by ants, which means it is unlikely to be a threat.'),
    ],
    treatmentComments: [
      T('TMS recommended (quote on request)', 'Installation of a termite management system is recommended to prevent future hidden termite ingress. A quote is available on request.'),
      T('TMS recommended for long-term protection', 'Installation of a termite management system is recommended for long-term protection, as the original ant capping for the older part of the house is insufficient or missing.'),
      T('Always-active bait stations, with price', 'Installation of approximately [number] Exterra Everready termite management stations is recommended due to hidden termite access points where termites could enter the structure undetected. These stations passively bait and eliminate nests as foraging termites search for timber. Approximate cost $[install] to install and $[annual] for annual termite management, GST included. A detailed quote is available on request.'),
      T('High risk: garden bed against the house', 'Additional termite management is advised as there are higher-risk areas for termite attack. The [garden bed / fill] against the side of the house creates a significant risk of hidden termite entry from this area.'),
      T('Moist subfloor', 'The subfloor is excessively moist and installation of a termite management system is recommended to prevent further, more serious damage.'),
      T('Existing system non-compliant', 'There is a [system name] system installed, however it is non-compliant: [reason]. Repair of the system [and a chemical treatment] is recommended.'),
      T('Additional protection where not to code', 'Installation of additional termite management is recommended in areas that are not up to code. A quote is available on request.'),
      T('Baiting program commenced', 'Baiting program commenced, and installation of an Exterra Everready system is recommended.'),
      T('Spot treatment completed', 'Spot treatment completed.'),
    ],
    existingManagementSystem: [
      T('TMS in place, adequate', 'Termite management system in place is adequate protection, combined with regular inspections.'),
      T('TMS in place and up to date', '[System name] termite management system in place and up to date, next service due [month/year].'),
      T('In place, but bridging risk', 'A termite management system is already in place and annual inspections are recommended, but the [deck attachment / adjoining slab] could be a bridging area termites use to go over the barrier. A quote for additional protection is available on request.'),
      T('Physical barrier, if maintained', 'If properly maintained, the [Flickguard / Kordon / Graniteguard] system in place is sufficient protection combined with regular inspections at this time.'),
      T('Ageing system, add to it', 'Installation of an additional system alongside the existing one is recommended due to the age and potential failure of the [slab / Graniteguard] system.'),
    ],
    priorTreatmentComments: [
      T('Looked after by us', 'Termite management system in place and looked after by Arcadian Pest Solutions.'),
      T('Sticker in meter box', 'Treatment sticker located in the meter box.'),
    ],
    durableNoticeDetails: [
      T('Sticker in meter box', 'Durable notice located in the meter box.'),
      T('Chemical due', 'Chemical treatment recorded; the next treatment is due [month/year].'),
    ],

    // ---- Areas not inspected ----
    otherHinderedDetails: [
      T('No subfloor access', 'Unable to access the subfloor, which is a significant termite risk to the floorboards.'),
      T('Low subfloor clearance', 'Parts of the subfloor are below 400 mm clearance and could not be crawled through.'),
    ],
    highRiskDetails: [
      T('Low clearance subfloor', 'Parts of the subfloor below 400 mm clearance could not be accessed.'),
      T('Wall cavities', 'Wall cavities are a high-risk area as there are many undetectable entrance points for termites.'),
      T('Trees with activity', 'Trees in the yard have had termite activity; there may be nests in the base of the tree roots.'),
      T('Floor gives way', 'The floor gives way at [location], likely termite damage to the joist underneath. Invasive inspection is recommended.'),
    ],
    invasiveComments: [
      T('Hidden damage suspected', 'Termite activity was found and the full extent of any damage cannot be determined visually. An invasive inspection is recommended.'),
    ],

    // ---- Conducive conditions ----
    otherConduciveDetails: [
      T('Bushland nearby', 'The surrounding bushland is a natural environment for termites.'),
      T('Large trees within 75 m', 'There are large trees within 75 metres of the house, which can harbour termite nests within striking distance of the structure.'),
      T('Termites forage up to 100 m', 'The bushland on the [side] side of the house is a natural termite habitat, and termites can attack from up to 100 metres away from their main nest.'),
      T('Timber debris in subfloor', 'Off-cuts and debris timber left in the subfloor from construction are conducive to termite activity and should be removed.'),
      T('Timber against the house', 'Debris timber, pallets or stored materials lying against the external wall are conducive to termite attack and should be moved away from the house.'),
      T('Firewood / hedges too close', 'Firewood is stored against the slab edge and hedges are too close to the external walls. Please keep a 300 mm gap between hedges and the house wall.'),
      T('Posts set in soil', 'Timber posts should sit in steel stirrups or shoes with a 75 mm gap between the timber and the soil, but these are set directly in soil. This could allow hidden termite ingress.'),
      T('Fence touching soil', 'Fences touching soil should have a minimum 25 mm gap to extend their service life. Exposing a gap underneath the fence is recommended.'),
      T('Vegetation against walls', 'Significant vegetation growth around the exterior walls should be managed and kept clear of the house.'),
      T('Wet subfloor, clear for airflow', 'The subfloor is too wet, especially on the low side, which creates ideal conditions for termite attack. Clearing timber away from the house and thinning the vegetation on the [side] side is recommended to allow more light and airflow to the subfloor.'),
      T('Slab meets timber floor', 'Where the concrete slab meets the suspended timber floor is a common problem area for termite ingress.'),
      T('Deck damp and enclosed', 'The deck is damp and enclosed, which is highly susceptible to termite ingress.'),
    ],
    slabEdgeDetails: [
      T('75 mm minimum standard', 'Areas of the structure on a concrete slab should have a minimum 75 mm exposed slab edge inspection zone to meet the Australian Standard. Without it, termites can enter the structure without revealing themselves.'),
      T('Covered by soil / garden', 'The slab edge is concealed by [soil / garden beds / mulch / stones] in many areas. Exposing the slab edge is recommended to prevent hidden termite ingress: 75 mm should be visible above soft surfaces and 25 mm above hard surfaces.'),
      T('Covered by path or patio', 'The slab edge is concealed by an adjoining [path / patio slab / pavers], which blocks the 75 mm inspection zone.'),
      T('Construction joints', 'This does not appear to be a monolithic (one-pour) slab; plans would be needed to confirm. Construction joints where two or more slabs meet can be a major vulnerability for termite ingress.'),
      T('Stored items against slab', 'The [shed / stored articles] pushed up against the exterior slab edge make the termite management system non-compliant.'),
      T('Barrier supersedes, clearance short', 'The slab edge exposure is superseded by the [Flickguard / Graniteguard] physical termite management system, however that system requires 75 mm clearance below the weephole level over soft surfaces and 25 mm over hard surfaces. In the [location] the clearance is only [measurement].'),
      T('Termguard pipe exposed', 'The Termguard system supersedes the slab edge requirement, however the pipe must be buried in soil to function and is not correctly installed. Repair and servicing are recommended.'),
    ],
    slabEdgeComments: [
      T('System supersedes slab edge', 'The [Termguard / Graniteguard] system in place supersedes the slab edge exposure requirement.'),
      T('Flickguard with slab edge', 'Flickguard system working in conjunction with slab edge exposure.'),
    ],
    antCappingDetails: [
      T('Rusted throughout', 'The ant capping is rusted through in most places and cannot be relied upon to force termites to expose their workings. Termites could potentially enter through the ant capping undetected.'),
      T('Some rust starting', 'Most of the ant capping is adequate, but some caps are rusting, which creates weak points in its protection.'),
      T('Missing on piers / old bearers', 'Some of the subfloor piers [and old bearers] do not have adequate ant capping.'),
      T('No capping at all', 'None of the piers have any ant capping, which means the building has nothing to prevent hidden termite ingress. Installation of an exterior termite management system is recommended to compensate; a builder could also install ant capping, but that would require major renovation.'),
      T('Insufficient overlap', 'The ant capping is insufficient and does not extend the required 75 mm overlap.'),
      T('Rusted and badly positioned', 'The ant capping is rusted and has insufficient coverage and overlap to properly protect the joists. This is a serious issue: consider having a builder lift the joists and install new ant capping, or having an exterior termite management system installed.'),
      T('Timber / stone used as bearer', '[Timber / sandstone] is being used as a bearer, which does not meet the Australian Standard.'),
    ],
    siteDrainageDetails: [
      T('Downpipes cracked / spilling', 'Cracked or open downpipes are letting water spill and pool against the house, which can encourage termites. A plumber is recommended to repair them.'),
      T('No drainage under tap', 'There is no drainage under the outdoor tap, which could lead to excessive moisture draining against the slab edge.'),
      T('Water pools on one side', 'Significant moisture pools in the ground on the [side] side of the building; drainage is inadequate.'),
      T('Drains higher than ground', 'The drains appear to sit higher than the surrounding ground level. A plumber is recommended for advice.'),
      T('Not a plumber: get advice', 'We claim no expertise in plumbing, however the drainage does not appear sufficient. A plumber is recommended to make sure run-off does not feed back to the house edges.'),
      T('Wet subfloor suggests drainage', 'Significant moisture in the subfloor suggests insufficient drainage. A builder is recommended to assess.'),
    ],
    subfloorDrainageDetails: [
      T('Water sits at the low point', 'The subfloor soil level is uneven, so water seeps to the low point and sits there.'),
      T('Damp, same as last year', 'The subfloor is damp, the same as at the last inspection, which suggests drainage may be insufficient.'),
      T('Run-off through subfloor', 'Rain water run-off flows through the subfloor and has nowhere to escape, which increases the humidity of the subfloor. A plumber or builder is recommended for advice.'),
      T('Fix downpipes and gutters', 'Fix the downpipes and guttering to prevent overflow underneath the floor.'),
      T('Moisture throughout', 'Significant moisture is held in the subfloor throughout; this is conducive to termite activity.'),
    ],
    ventilationDetails: [
      T('Not enough subfloor vents', 'There is not enough ventilation for subfloor airflow. A builder is recommended to add vents or subfloor fans to keep the floor dry.'),
      T('Too wet for ventilation to help', 'There is high moisture in the subfloor; it is too wet for the current ventilation to make much difference.'),
      T('Bathroom mould', 'Bathroom ventilation appears inadequate due to mould above the exhaust fan and in the cornices.'),
      T('Lots of mould', 'There is a lot of mould; contacting a mould specialist and increasing ventilation to the building is recommended.'),
    ],
    moistureDetails: [
      T('Bathroom / kitchen walls', 'High moisture levels were found in the [bathroom / kitchen / laundry] walls. A leaking pipe is suspected; a plumber is recommended to investigate.'),
      T('Subfloor moisture', 'Significant moisture was found in the subfloor, which is conducive to termite ingress.'),
      T('Probably recent rain', 'High moisture readings are likely due to the recent rain.'),
      T('Around active termites', 'High moisture was found around the areas of active termites.'),
      T('Air con overflow', 'The air conditioner overflow should be redirected away from the house edge.'),
    ],
    waterLeakDetails: [
      T('Broken downpipe', 'The downpipe on the [side] side is broken, causing leakage when it rains. A plumber is recommended to repair it.'),
      T('Air con overflow at house edge', 'The air conditioner overflow drains against the house edge, creating a permanently wet area that is conducive to termite attack.'),
      T('Leak found from subfloor', 'There appears to be a leak in the [laundry / kitchen] area, detected from the subfloor. A plumber is recommended to inspect and advise.'),
      T('Gutters', 'Gutter at the [location] is leaking; a plumber is recommended to fix the gutters and downpipes.'),
      T('Leaking tap', 'A leaking tap in the yard is creating a conducive environment for termite attack.'),
    ],
    tankDetails: [
      T('Hot water overflow at slab', 'The hot water system overflow drains against the slab edge. Attaching a hose to direct it further from the house edge is recommended.'),
      T('Hot water and air con', 'The hot water system and air conditioner drainage should be drained further away from the slab edge of the house.'),
    ],
    fungalDecayLocation: [
      T('Sporadic, minor', 'Sporadic timber decay, nothing too severe.'),
      T('Fence', 'The [side] fence shows signs of decay and deterioration and is likely overdue for replacement.'),
      T('Landscaping timbers', 'Decay in the front landscaping timbers; replacing them with a water-resistant material is recommended.'),
      T('Verandah / door frames', 'Minor decay in the [verandah boards / door frame / window sills].'),
      T('Joist from a leak', 'A leaking [amenity / pipe] is causing decay in a joist.'),
    ],
    fungalDecayComments: [
      T('Deck: builder to assess', 'Decay has made the timber brittle and flaky, and the underside has been painted over. A builder is recommended to assess the overall safety of the deck.'),
      T('Mostly superficial', 'There are other instances of decay throughout the subfloor, but mostly superficial.'),
      T('Starting from moisture', 'Minor decay is starting due to excessive moisture.'),
      T('Old house, poor condition', 'Fungal decay was found sporadically; the house is very old and in poor condition.'),
    ],
    weepHoleDetails: [
      T('Soil over weepholes', 'Soil is covering the weepholes in the [location]. Lower the soil to leave a 75 mm gap below the bottom of the weepholes; soil at this level can let termites tunnel over any existing physical barrier.'),
      T('Blocked by vegetation', 'Some weepholes are blocked by vegetation and debris. It is an easy clear, but they should be kept clear.'),
      T('Covered by decking / path', 'Weepholes are covered by the [decking / path slab / stones] at the [location], which creates a bridging issue.'),
      T('Shed blocks inspection', 'The shed blocks inspection of the weepholes on the [side] side of the house.'),
      T('Keep them clear', 'Weepholes should be kept free and clear of obstruction to allow wall cavities to stay dry.'),
    ],
    mouldDetails: [
      T('Bathroom and walls', 'Mould growth was found in the bathroom and on some walls behind curtains.'),
      T('Health concern', 'Mould is spreading through the [room] ceiling. This is a health concern; keep the area well ventilated with a fan, an open window or a new vent after the mould is removed.'),
    ],
    externalTimberDetails: [
      T('Deck needs replacing', 'The [front deck] appears to need replacement.'),
    ],
    propertyComments: [
      T('Weathered, sporadic rot', 'The overall building condition is weathered; rot damage is sporadic.'),
    ],
  };

  // ---- The business's own templates (migration 039, v142) ----
  //
  // Added and hidden from the picker itself, shared by everybody in the
  // business through Supabase, and kept on the phone so the picker works with
  // no signal. Changes need a connection; reading never does.
  //
  // In test and demo mode nothing leaves the page: changes live in memory, so
  // a demo or a test run can never write to the real business's list.
  const CACHE_KEY = 'scope.commentTemplates.v1';
  const online = () => !!(window.supabaseClient && !window.IS_TEST && !window.IS_DEMO);
  let rows = [];
  try { if (online()) rows = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]') || []; } catch (e) { rows = []; }
  const keep = () => { if (online()) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch (e) { /* full */ } } };
  const uid = () => `ct_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  async function refresh() {
    if (!online()) return rows;
    try {
      const { data, error } = await window.supabaseClient.from('comment_templates')
        .select('id, field_id, kind, label, text, updated_at').order('created_at', { ascending: true });
      if (!error && Array.isArray(data)) { rows = data; keep(); }
    } catch (e) { /* offline: the cached list stands */ }
    return rows;
  }

  // Your own first (newest last within them), then the built-ins you have
  // not hidden. Each item says which it is, so the picker knows whether
  // "remove" deletes it or just hides it.
  function forField(fieldId) {
    const mine = rows.filter((r) => r.field_id === fieldId);
    const hidden = new Set(mine.filter((r) => r.kind === 'hidden').map((r) => r.label));
    const custom = mine.filter((r) => r.kind === 'custom').map((r) => ({ label: r.label, text: r.text, id: r.id, custom: true }));
    const builtIn = (ALL[fieldId] || []).filter((t) => !hidden.has(t.label)).map((t) => ({ ...t, builtIn: true }));
    return custom.concat(builtIn);
  }

  async function write(row) {
    if (!online()) { rows.push(row); return row; }
    const { error } = await window.supabaseClient.from('comment_templates').insert(row);
    if (error) throw new Error(/relation|does not exist/i.test(error.message) ? 'Saving your own comments needs a database update (migration 039).' : error.message);
    rows.push(row);
    keep();
    return row;
  }

  async function add(fieldId, label, text) {
    const l = String(label || '').trim().slice(0, 40);
    const t = String(text || '').trim().slice(0, 2000);
    if (!l || !t) throw new Error('A common comment needs a short name and some wording.');
    const now = Date.now();
    const userId = window.Sync && window.Sync.currentUserId ? window.Sync.currentUserId() : null;
    return write({ id: uid(), field_id: fieldId, kind: 'custom', label: l, text: t, created_by: userId, created_at: now, updated_at: now });
  }

  // Your own: deleted. A built-in: hidden for the whole business (it stays
  // in the app, so it can be brought back with restoreHidden).
  async function remove(fieldId, item) {
    if (item.custom) {
      if (online()) {
        const { error } = await window.supabaseClient.from('comment_templates').delete().eq('id', item.id);
        if (error) throw new Error(error.message);
      }
      rows = rows.filter((r) => r.id !== item.id);
      keep();
      return;
    }
    const now = Date.now();
    await write({ id: uid(), field_id: fieldId, kind: 'hidden', label: item.label, text: '', created_at: now, updated_at: now });
  }

  async function restoreHidden(fieldId) {
    const ids = rows.filter((r) => r.field_id === fieldId && r.kind === 'hidden').map((r) => r.id);
    if (!ids.length) return 0;
    if (online()) {
      const { error } = await window.supabaseClient.from('comment_templates').delete().in('id', ids);
      if (error) throw new Error(error.message);
    }
    rows = rows.filter((r) => !ids.includes(r.id));
    keep();
    return ids.length;
  }

  const hiddenCount = (fieldId) => rows.filter((r) => r.field_id === fieldId && r.kind === 'hidden').length;

  if (online()) setTimeout(() => { refresh(); }, 5000);

  window.CommentTemplates = {
    forField, add, remove, restoreHidden, hiddenCount, refresh,
    all: ALL,
    _reset: () => { rows = []; }, // the suite starts each test clean
  };
})();
