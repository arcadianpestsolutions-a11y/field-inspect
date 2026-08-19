// Booking assistant — a tool-using conversation over the technician's diary.
//
// WHY THE TOOLS RUN ON THE CLIENT
// The schedule lives in IndexedDB on the phone and is the offline source of
// truth; Postgres is a sync target, not the authority. So this function does
// not touch job data at all. It runs the model, hands back whatever tool calls
// the model wants to make, and the app executes them locally and calls again
// with the results. That keeps the function stateless and means the assistant
// reads exactly what the technician sees.
//
// WHY BOOKING IS NOT A TOOL THE MODEL CAN JUST FIRE
// book_job writes to a real diary. The client treats a book_job call as a
// PROPOSAL and renders a confirm card — the model never commits a booking on
// its own. That matches how every other AI feature in this app behaves:
// suggest, show the working, let a human commit.
//
// Requires ANTHROPIC_API_KEY (already set for analyze-inspection).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
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

const TOOLS = [
  {
    name: 'get_schedule',
    description:
      'Read what is already booked in a date range. Use this before suggesting any time, so you never propose a slot that is taken. Returns each job with its start time, duration and address.',
    input_schema: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'Start date, YYYY-MM-DD, inclusive.' },
        toDate: { type: 'string', description: 'End date, YYYY-MM-DD, inclusive.' },
      },
      required: ['fromDate', 'toDate'],
    },
  },
  {
    name: 'find_free_slots',
    description:
      'Find free hours on a given day that can fit a job of a given length. The working day is 7am to 6pm. Use this rather than guessing which hours are free.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'The day to check, YYYY-MM-DD.' },
        durationMins: { type: 'number', description: 'How long the job needs, in minutes.' },
      },
      required: ['date', 'durationMins'],
    },
  },
  {
    name: 'list_unbooked_jobs',
    description:
      'List jobs that exist but have no booking yet, including properties that have come due for re-inspection. This is the work waiting to be scheduled.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_jobs',
    description:
      'Find jobs by client name or address, to identify which job the technician means. Returns the job id you need for book_job.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Part of a client name or address.' } },
      required: ['query'],
    },
  },
  {
    name: 'book_job',
    description:
      'Propose booking a job into a specific time. This does NOT book it directly — the technician sees a confirmation card and taps to accept or decline, and the result comes back to you. Always check the slot is free first, and say in your message what you are proposing and why.',
    input_schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The job id from search_jobs or list_unbooked_jobs.' },
        dateTime: { type: 'string', description: 'Local start time as YYYY-MM-DDTHH:MM (no timezone suffix).' },
        durationMins: { type: 'number', description: 'How long to allow, in minutes.' },
      },
      required: ['jobId', 'dateTime', 'durationMins'],
    },
  },
];

function systemPrompt(today: string, dayName: string) {
  return `You are the booking assistant inside Field Inspect, a pest control app used by Arcadian Pest Solutions in New South Wales, Australia. You help the technician read and fill their diary.

Today is ${dayName}, ${today}. All dates and times are local Australian time. When the technician says "tomorrow", "next Tuesday" or "this week", work it out from today's date.

How to behave:
- Always read before you suggest. Call get_schedule or find_free_slots to see what is actually there rather than assuming a slot is free.
- Keep replies short. This is read on a phone, often one-handed in a driveway. Two or three sentences, no preamble.
- When proposing a time, say why: what else is on that day, what gap you are using.
- Never invent a client, address or job. If you cannot find the job, say so and ask which one they mean.
- book_job only proposes — the technician confirms. Do not claim a job is booked until a tool result tells you it was confirmed.
- If a day is already at or over 8 hours, say so rather than quietly adding more.
- A standard termite inspection runs about 60-90 minutes and a general pest treatment about 60 minutes, unless the technician says otherwise. Ask if it matters and you genuinely cannot tell.
- Travel time between jobs is real but you do not have distances. If two jobs are in obviously different suburbs back to back, mention it rather than silently packing them together.`;
}

async function callClaude(messages: unknown[], today: string, dayName: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: systemPrompt(today, dayName),
      tools: TOOLS,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Claude API failed (${res.status}): ${await res.text()}`);
  return res.json();
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
    const { messages, today, dayName } = body;
    if (!Array.isArray(messages) || !messages.length) {
      return json({ error: 'messages[] is required' }, 400);
    }

    const reply = await callClaude(messages, today || '', dayName || '');

    // Hand the raw content blocks back so the client can execute any tool_use
    // and continue the loop. stop_reason tells it whether to keep going.
    return json({
      stopReason: reply.stop_reason,
      content: reply.content || [],
    });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
