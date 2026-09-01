// Edge Function backing the AI-assisted inspection features:
//   - 'draft-report': reads the zone-labelled photographs from an inspection
//     (or, for older jobs and imported footage, sampled video frames plus
//     narration) and returns draft values for aiFillable report fields.
//   - 'trace-building': reads a building's exterior perimeter out of aerial
//     photography, returning a polygon that seeds the mud-map sketch.
//
// Both API keys (Anthropic, OpenAI) are Edge Function secrets, set via:
//   supabase secrets set ANTHROPIC_API_KEY=... OPENAI_API_KEY=...
// Never exposed to the client. Every request must carry a valid signed-in
// user's auth token (checked below) — this function costs real money per
// call, so it's gated the same way the rest of this app's data is (any
// authenticated technician, matching the existing shared-team RLS model).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface TranscriptSegment { start: number; end: number; text: string }
interface Transcription { text: string; segments: TranscriptSegment[] }

async function transcribeAudio(audioBase64: string, mimeType: string): Promise<Transcription> {
  const audioBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([audioBytes], { type: mimeType }), `audio.${ext}`);
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper transcription failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    text: data.text || '',
    segments: (data.segments || []).map((s: any) => ({ start: s.start, end: s.end, text: s.text })),
  };
}

async function callClaude(systemPrompt: string, userContent: unknown[]): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API call failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const textBlock = (data.content || []).find((b: any) => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

// Claude may wrap JSON in a code fence despite instructions not to — strip it defensively.
function extractJson(text: string): any {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const raw = match ? match[1] : text;
  return JSON.parse(raw);
}

async function handleDraftReport(body: any) {
  const { frames, photos, audioBase64, audioMimeType, fieldSchema, reportType } = body;
  // `photos` is the current shape: zone-labelled photographs from a
  // walkthrough. `frames` is the older one — video stills, still produced by
  // Import Footage and by jobs recorded before inspections became photo-only.
  const usingPhotos = Array.isArray(photos) && photos.length > 0;
  if (!usingPhotos && !Array.isArray(frames)) {
    return json({ error: 'draft-report requires photos[] or frames[]' }, 400);
  }
  if (!fieldSchema) return json({ error: 'draft-report requires fieldSchema' }, 400);

  const isPestTreatment = reportType === 'pest_treatment';

  const transcription = audioBase64
    ? await transcribeAudio(audioBase64, audioMimeType || 'audio/webm')
    : { text: '', segments: [] };

  function imageBlock(dataUrl: string) {
    const match = String(dataUrl || '').match(/^data:(image\/\w+);base64,(.+)$/);
    return {
      type: 'image',
      source: { type: 'base64', media_type: match ? match[1] : 'image/jpeg', data: match ? match[2] : '' },
    };
  }

  const domainDescription = isPestTreatment
    ? 'a general pest treatment / chemical application report (residential, commercial, or industrial pest control, Australia)'
    : 'a termite inspection report (AS 4349.3 / AS 3660.2-2017, Australia)';
  const zoneExamples = isPestTreatment
    ? '(e.g. "Kitchen", "Roof Void", "Exterior Perimeter")'
    : '(e.g. "Kitchen", "Subfloor", "Roof Void")';

  // Photographs are deliberate and zone-labelled, so they support a much more
  // thorough reading than sampled video frames did. The instruction that
  // matters most is the second block: previously the model effectively used
  // photos to answer the obstruction fields and little else, so a clear shot
  // of a subfloor bearer — which speaks to moisture, ventilation, ant capping
  // and workings all at once — went mostly unused.
  const sourceDescription = usingPhotos
    ? `You are given ${photos.length} photograph${photos.length === 1 ? '' : 's'} the technician deliberately took during the inspection. Each is labelled with the zone they were standing in and the order it was taken. These are considered photographs of things the technician chose to record, not incidental frames — treat every one as evidence that was worth capturing, and work out WHY each was taken.`
    : 'You are given still frames sampled from the technician\'s walkthrough video, and a transcript of any spoken narration.';

  const systemPrompt = `You are assisting a licensed pest technician drafting ${domainDescription}.

${sourceDescription}

READ EVERY PHOTO AGAINST THE WHOLE QUESTION SET, NOT JUST THE OBVIOUS FIELD.
A single image usually answers several questions at once. A subfloor photograph can show mudding (workings), damp staining (high moisture), blocked vents (ventilation), the state of ant capping, and stored goods against a wall (an obstruction) — all at the same time. Work through the field list below and, for each field, ask whether anything in ANY of the photographs bears on it. Do not stop at the first field a photo seems to be "for".

This applies especially to the yes/no findings. If the photographs show clear evidence relevant to a yes/no question, answer it. If they show the area plainly with no sign of the thing being asked about, that is also evidence and "No" may well be the right answer — say so. Only leave a field out when the photographs genuinely do not bear on it.

WHAT YOU MUST NOT DO.
Never invent specifics the images cannot support: termite species, product names, measured moisture percentages, timber types you cannot see, or the condition of an area that was not photographed. Absence of a photo is not evidence of absence — if no one photographed the roof void, say nothing about the roof void. Prefer leaving a field out to guessing at it. This is a DRAFT a licensed professional reviews, edits and confirms before it becomes a compliance document; a wrong confident answer costs them more time than a blank.

Fields you may fill (id, section, label, type, options if applicable):
${JSON.stringify(fieldSchema, null, 2)}

For each field you fill, give a one-line reason naming which photo or photos support it, so the technician can check your reading rather than take it on trust.

Also summarise what each zone showed ${zoneExamples}.

Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{
  "draftFields": { "<sectionId>": { "<fieldId>": "<value>" } },
  "fieldReasons": { "<sectionId>": { "<fieldId>": "photo 3 (Subfloor) shows ..." } },
  "frameNotes": [ { "zone": "Subfloor", "notes": "...", "photoNumbers": [3, 4] } ]
}`;

  const userContent: unknown[] = [];

  if (usingPhotos) {
    for (const photo of photos) {
      const zone = photo.zone ? String(photo.zone) : 'zone not recorded';
      userContent.push({ type: 'text', text: `Photo ${photo.sequence} — ${zone}` });
      userContent.push(imageBlock(photo.dataUrl));
    }
    userContent.push({
      type: 'text',
      text: 'Work through the field list and fill every field these photographs genuinely bear on.',
    });
  } else {
    userContent.push({
      type: 'text',
      text: `Narration transcript:\n${transcription.text || '(no narration captured)'}`,
    });
    for (const frame of frames.slice(0, 12)) userContent.push(imageBlock(frame.dataUrl));
  }

  const raw = await callClaude(systemPrompt, userContent);
  const parsed = extractJson(raw);

  return json({
    transcript: transcription.text,
    draftFields: parsed.draftFields || {},
    fieldReasons: parsed.fieldReasons || {},
    frameNotes: parsed.frameNotes || [],
  });
}

// 'identify-pest': reads one or more close-up photographs of a pest or
// insect and identifies it — common name, scientific name where the photo
// supports it, confidence, and which of the technician's own picklist
// categories it best matches. This is a narrower, harder question than
// 'draft-report' asks anywhere (species-level identification, not "does
// this photo bear on this yes/no field"), so it gets its own focused prompt
// rather than being folded into the general drafting pass.
//
// Same rule as everything else here: this is a suggestion a licensed
// technician reviews and applies deliberately (see identify-pest-btn in
// report.js) — it is never written into the report on its own.
async function handleIdentifyPest(body: any) {
  const images = Array.isArray(body.images) ? body.images : [];
  if (!images.length) return json({ error: 'identify-pest requires images[]' }, 400);

  const targetPestOptions: string[] = Array.isArray(body.targetPestOptions) ? body.targetPestOptions : [];

  const systemPrompt = `You are helping a licensed Australian pest control technician identify a pest or insect from a close-up inspection photograph.

You are given ${images.length === 1 ? 'one photograph' : `${images.length} photographs`} taken during a pest inspection or treatment job. Identify every DISTINCT pest or insect you can actually see — most photos show just one, but identify each separately if more than one is visible.

For each one give:
- "commonName": the common name (e.g. "German Cockroach"). Use the most specific name the photo actually supports — if you can only tell it's "a cockroach" and not the species, say that plainly rather than guessing a species.
- "scientificName": the binomial name, ONLY if the photo shows enough detail to support that specific a call. Empty string if not.
- "confidence": "high", "medium", or "low" — be honest. A blurry, distant, or partially-obscured shot is low confidence no matter how common the pest looks.
- "reasoning": one sentence naming the specific visible features that led to this identification (body shape, colouring, size relative to a visible reference, wing pattern, antennae, etc.) — the technician needs to be able to check your reading, not just trust it.
${targetPestOptions.length ? `- "matchedCategory": whichever of these categories this identification best fits — choose the single closest match, exactly as written: ${JSON.stringify(targetPestOptions)}. If genuinely none fit, use "Other".` : ''}

WHAT YOU MUST NOT DO. Never state species-level certainty a photograph cannot support. If the photo is too blurry, too distant, or too obscured to identify anything useful, say so in "reasoning" and use "low" confidence rather than inventing a specific answer. If you cannot identify anything at all in the photo(s) — no pest visible — return an empty identifications array rather than guessing at something.

Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{
  "identifications": [
    { "commonName": "...", "scientificName": "...", "confidence": "high" | "medium" | "low", "reasoning": "...", "matchedCategory": "..." }
  ]
}`;

  const userContent: unknown[] = [];
  images.forEach((img: any, i: number) => {
    userContent.push({ type: 'text', text: `Photo ${i + 1}` });
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.base64 },
    });
  });
  userContent.push({ type: 'text', text: 'Identify every distinct pest or insect actually visible in these photographs.' });

  const raw = await callClaude(systemPrompt, userContent);
  const parsed = extractJson(raw);

  const identifications = (Array.isArray(parsed.identifications) ? parsed.identifications : [])
    .filter((id: any) => id && typeof id.commonName === 'string' && id.commonName)
    .map((id: any) => ({
      commonName: id.commonName,
      scientificName: typeof id.scientificName === 'string' ? id.scientificName : '',
      confidence: ['high', 'medium', 'low'].includes(id.confidence) ? id.confidence : 'low',
      reasoning: typeof id.reasoning === 'string' ? id.reasoning : '',
      matchedCategory: typeof id.matchedCategory === 'string' ? id.matchedCategory : '',
    }));

  return json({ identifications });
}

// 'trace-building': reads a building's exterior perimeter out of aerial
// photos of the property, so the mud-map sketch starts from the real shape of
// the house instead of a blank grid.
//
// Background: when the open datasets have nothing, there is nothing else to
// fall back on. OSM building coverage locally is patchy (spot checks around
// Ingleburn returned 15, 9, 1 and 0 buildings within 60m) and Overpass
// rate-limits hard, and NSW Spatial Services publishes cadastre (lot
// boundaries) but no building layer at all. Geoscape's national building
// dataset is commercial, and Microsoft's 11.3M-building Australian release is
// a ~6GB bulk download rather than a queryable API. Reading the roofline out
// of the imagery is the one approach that works from a phone, per-property,
// on demand.
//
// Tree canopy is by far the biggest cause of a poor trace, so the prompt
// below leans hard on the three things that recover an outline the canopy has
// hidden: cross-referencing two captures flown on different dates, reading
// the building's shadow (which falls on open ground the canopy doesn't
// cover), and exploiting the fact that houses are rectilinear so an occluded
// corner can be inferred from the walls that are visible.
//
// The result is a starting shape for a licensed technician to correct on
// site — same rule as every other AI feature here: suggest, never commit.
async function handleTraceBuilding(body: any) {
  // `images` is the current shape; a lone imageBase64 is still accepted so a
  // client cached from a previous release keeps working after this deploys.
  const images = Array.isArray(body.images) && body.images.length
    ? body.images
    : body.imageBase64
      ? [{ label: 'aerial capture', base64: body.imageBase64, mediaType: body.imageMediaType }]
      : [];

  if (!images.length) return json({ error: 'trace-building requires images[]' }, 400);

  const systemPrompt = `You are tracing a building's exterior perimeter from aerial photography, to seed the base shape of a pest inspection "mud map" (site sketch).

You are given ${images.length === 1 ? 'one aerial image' : `${images.length} aerial images of the SAME property, flown on different dates`}. Each is a tight, north-up crop centred on the subject property, roughly 67m tall by 54m wide. ${images.length > 1 ? 'The captures differ in season, sun angle and tree growth. Cross-reference them: a roof corner buried under canopy or shadow in one image is frequently plain to see in another. Build ONE outline using the best evidence from across all of them.' : ''}

Identify the MAIN building at the centre of the image — the dwelling or primary structure. Ignore detached sheds and garages, driveways, pools, pergolas, and neighbouring buildings intruding at the edges.

TREE COVER IS THE MAIN DIFFICULTY. When canopy hides part of the roof, do not guess vaguely and do not shrink the outline to only the part you can see — that produces a building smaller than reality, which is worse than a considered estimate. Instead, recover the hidden edges using:
1. THE SHADOW. The building casts a hard-edged shadow onto open ground, and that shadow is usually clear of the canopy that hides the roof itself. A shadow's outline is a reliable, correctly-proportioned copy of the roofline — read the hidden corners off it.
2. STRAIGHT LINES CONTINUE. Ridge lines, gutters, eaves and wall lines run straight and do not change direction under a tree. Project a visible wall through the canopy until it meets another projected wall, and put the corner there.
3. RECTILINEAR GEOMETRY. Australian houses are overwhelmingly rectangular, L-shaped, T-shaped or stepped. Corners are 90 degrees; opposite walls are parallel and usually equal length. If three corners are visible and a fourth is hidden, its position is determined — compute it, don't guess it.
4. ROOF TEXTURE AND COLOUR. Tile and metal roofs differ in colour and texture from tree canopy even in shadow. Canopy is irregular and blobby; roofs are flat planes with straight boundaries.

Rules for the outline itself:
- Do NOT subdivide it. No interior walls, no rooms.
- Do NOT trace eaves separately from the wall line — one single closed outline.
- Keep corners square where the building clearly is square, and opposite walls parallel where they clearly are.
- Do NOT smooth it into a blob, and do NOT return a plain bounding rectangle unless the building genuinely is a simple rectangle.
- Typically 4-12 corners.

Give coordinates as [x, y] fractions of the image, where [0,0] is the top-left corner and [1,1] is the bottom-right. All images share the same bounds, so one coordinate system covers them all. List the points in order around the perimeter, and do not repeat the first point at the end.

Be honest about uncertainty rather than confident and wrong — a technician is standing at the property and will correct this, so telling them WHERE to look is genuinely useful:
- "confidence": "high" only if you could see or soundly infer every corner.
- "obscured": a short plain-English list of which parts of the building you had to infer, e.g. "north-west corner and the rear wing". Empty string if none.

Respond with ONLY a JSON object, no other text, no markdown fences:
{"polygon": [[x,y], ...], "confidence": "high" | "medium" | "low", "note": "<one short sentence on what you traced>", "obscured": "<what you had to infer, or empty>"}`;

  const userContent: unknown[] = [];
  images.forEach((img: any, i: number) => {
    userContent.push({ type: 'text', text: `Image ${i + 1}: ${img.label || 'aerial capture'}` });
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.base64 },
    });
  });
  userContent.push({
    type: 'text',
    text: "Trace the main building's exterior perimeter. Use the shadow and the straight-line/right-angle rules to place any corner the tree canopy hides.",
  });

  const raw = await callClaude(systemPrompt, userContent);
  const parsed = extractJson(raw);

  // The client draws this straight onto a canvas, so every vertex must be a
  // finite number inside the image before it goes back.
  const polygon = (Array.isArray(parsed.polygon) ? parsed.polygon : [])
    .filter((p: any) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p: number[]) => [
      Math.min(1, Math.max(0, p[0])),
      Math.min(1, Math.max(0, p[1])),
    ]);

  // Deliberately a 200 carrying an `error` field, not a 4xx: supabase-js
  // collapses every non-2xx into a generic "non-2xx status code" message and
  // discards the body, so a status code here would cost the technician the
  // one sentence that actually tells them what went wrong. The client's
  // invoke() helper already checks `data.error` and throws on it.
  if (polygon.length < 3) {
    return json({ error: 'Could not make out a building outline in this imagery.' });
  }

  return json({
    polygon,
    confidence: parsed.confidence || 'medium',
    note: parsed.note || '',
    obscured: parsed.obscured || '',
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return json({ error: 'Not authenticated' }, 401);

    const body = await req.json();
    if (body.action === 'draft-report') return await handleDraftReport(body);
    if (body.action === 'trace-building') return await handleTraceBuilding(body);
    if (body.action === 'identify-pest') return await handleIdentifyPest(body);

    return json({ error: 'Unknown action — expected "draft-report", "trace-building", or "identify-pest"' }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
