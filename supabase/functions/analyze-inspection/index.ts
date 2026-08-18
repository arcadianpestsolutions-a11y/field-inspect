// Single Edge Function handling two actions for the AI-assisted inspection
// features:
//   - 'draft-report': analyzes sampled video frames + audio narration from a
//     finished inspection, returns draft values for aiFillable report fields.
//   - 'subdivide-rooms': analyzes a spoken room description + a known
//     building footprint, returns a proposed room-polygon subdivision for
//     the mud-map sketch.
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
      max_tokens: 4096,
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
  const { frames, audioBase64, audioMimeType, fieldSchema, reportType } = body;
  if (!Array.isArray(frames) || !fieldSchema) {
    return json({ error: 'draft-report requires frames[] and fieldSchema' }, 400);
  }
  const isPestTreatment = reportType === 'pest_treatment';

  const transcription = audioBase64
    ? await transcribeAudio(audioBase64, audioMimeType || 'audio/webm')
    : { text: '', segments: [] };

  // Cap frames sent to the model — keeps cost/latency bounded regardless of
  // inspection length; the client is responsible for sensible sampling.
  const imageBlocks = frames.slice(0, 12).map((f: { timestamp: number; dataUrl: string }) => {
    const match = f.dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    return {
      type: 'image',
      source: { type: 'base64', media_type: match ? match[1] : 'image/jpeg', data: match ? match[2] : '' },
    };
  });

  const domainDescription = isPestTreatment
    ? 'a general pest treatment / chemical application report (residential, commercial, or industrial pest control, Australia)'
    : 'a termite inspection report (AS 3660.2-2017, Australia)';
  const zoneExamples = isPestTreatment
    ? '(e.g. "Kitchen", "Roof Void", "Exterior Perimeter")'
    : '(e.g. "Kitchen", "Subfloor", "Roof Void")';
  const systemPrompt = `You are assisting a licensed pest technician drafting ${domainDescription}. You are given still frames sampled from the technician's walkthrough video and a transcript of their spoken narration. Your job: propose draft values ONLY for the fields listed below, based on what's visible/audible. Never invent specifics you can't support from the frames or transcript (species, product names, exact measurements, etc.) — leave a field out of your response entirely if you're not reasonably confident, rather than guessing. This is a DRAFT for a licensed professional to review, edit, and confirm before it becomes part of a compliance document — it is not the final report.

Fields you may fill (id, section, label, type, options if applicable):
${JSON.stringify(fieldSchema, null, 2)}

Also identify, for distinct time ranges in the footage, what zone/room is being shown ${zoneExamples} and any brief pest-relevant notes for that zone.

Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{
  "draftFields": { "<sectionId>": { "<fieldId>": "<value>" } },
  "frameNotes": [ { "startSeconds": 0, "endSeconds": 12, "zone": "Kitchen", "notes": "..." } ]
}`;

  const userContent = [
    { type: 'text', text: `Narration transcript:\n${transcription.text || '(no narration captured)'}` },
    ...imageBlocks,
  ];

  const raw = await callClaude(systemPrompt, userContent);
  const parsed = extractJson(raw);

  return json({
    transcript: transcription.text,
    draftFields: parsed.draftFields || {},
    frameNotes: parsed.frameNotes || [],
  });
}

async function handleSubdivideRooms(body: any) {
  const { audioBase64, audioMimeType, footprint } = body;
  if (!audioBase64 || !footprint) {
    return json({ error: 'subdivide-rooms requires audioBase64 and footprint' }, 400);
  }

  const transcription = await transcribeAudio(audioBase64, audioMimeType || 'audio/webm');

  const systemPrompt = `You are helping a pest inspector sketch a rough mud-map of a property. You're given the known exterior footprint of the building as a polygon in a 0-1 normalized coordinate space (0,0 = top-left, 1,1 = bottom-right, matching how it's drawn on screen), and a spoken description of the room layout. Propose a rough subdivision of the footprint into labeled rooms matching the description. This is an approximate reference sketch, not a survey — reasonable estimates are fine, precision is not expected.

Known footprint (normalized polygon, in drawing order):
${JSON.stringify(footprint)}

Spoken room description (transcript):
${transcription.text}

Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{
  "rooms": [ { "label": "Kitchen", "polygon": [[0.1,0.1],[0.5,0.1],[0.5,0.4],[0.1,0.4]] } ]
}
All polygon coordinates must be normalized 0-1 and stay within the given footprint.`;

  const raw = await callClaude(systemPrompt, [{ type: 'text', text: 'Generate the room subdivision now.' }]);
  const parsed = extractJson(raw);

  return json({ transcript: transcription.text, rooms: parsed.rooms || [] });
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
    if (body.action === 'subdivide-rooms') return await handleSubdivideRooms(body);
    return json({ error: 'Unknown action — expected "draft-report" or "subdivide-rooms"' }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
