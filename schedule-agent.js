// Booking assistant — client half of the tool-use loop.
//
// The Edge Function runs the model; this file executes whatever tools the
// model asks for, against the local IndexedDB that the scheduler itself reads.
// That is deliberate: the phone is the offline source of truth, so the
// assistant sees exactly what the technician sees, including work that has not
// synced yet.
//
// book_job is the one tool that would change something. It is never executed
// straight away — it renders a confirmation card, and the technician's answer
// is what goes back to the model as the tool result. The assistant proposes;
// a human commits.
(() => {
  'use strict';

  // The client is resolved at call time rather than at load. Bailing out here
  // meant the whole panel ceased to exist whenever Supabase was unavailable —
  // including test and demo modes, where sync is deliberately switched off —
  // so a missing client turned into a missing feature with no explanation.
  // Now the panel loads, the local tools work, and only the model call needs
  // a client, which it can say plainly.
  const getClient = () => window.supabaseClient;

  const DAY_START_HOUR = 7;
  const DAY_END_HOUR = 18;
  const MAX_TOOL_ROUNDS = 8; // a stuck model must not loop forever on someone's data plan

  const el = (id) => document.getElementById(id);
  const panel = el('agent-panel');
  const logEl = el('agent-log');
  const inputEl = el('agent-input');
  const sendBtn = el('agent-send');
  const openBtn = el('agent-open');
  const closeBtn = el('agent-close');

  if (!panel) { console.warn('[schedule-agent] panel missing from the page'); return; }

  let history = [];   // the Anthropic messages array
  let busy = false;

  // ---------- local date helpers (local calendar days, never UTC) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const toLocalDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseLocalDate = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const parseLocalDateTime = (s) => {
    const [datePart, timePart = '09:00'] = String(s).split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    const [hh, mm] = timePart.split(':').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
  };
  const durationOf = (job) => job.scheduledDurationMins || 60;
  const fmtTime = (ts) => {
    const d = new Date(ts);
    const h = d.getHours();
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const mm = d.getMinutes();
    return `${h12}${mm ? ':' + pad(mm) : ''}${h < 12 ? 'am' : 'pm'}`;
  };

  // ---------- tool implementations ----------
  async function toolGetSchedule({ fromDate, toDate }) {
    const from = parseLocalDate(fromDate).getTime();
    const to = parseLocalDate(toDate).setHours(23, 59, 59, 999);
    const jobs = (await DB.getJobs())
      .filter((j) => j.scheduledAt && j.scheduledAt >= from && j.scheduledAt <= to)
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
    return {
      bookings: jobs.map((j) => ({
        jobId: j.id,
        name: j.name,
        address: j.address || '',
        jobType: j.jobType,
        date: toLocalDate(new Date(j.scheduledAt)),
        time: fmtTime(j.scheduledAt),
        durationMins: durationOf(j),
        status: j.status,
      })),
      // Totals let the model answer "how full is Thursday" without re-adding.
      dailyTotals: Object.entries(jobs.reduce((acc, j) => {
        const k = toLocalDate(new Date(j.scheduledAt));
        acc[k] = (acc[k] || 0) + durationOf(j);
        return acc;
      }, {})).map(([date, mins]) => ({ date, jobs: jobs.filter((j) => toLocalDate(new Date(j.scheduledAt)) === date).length, hours: mins / 60 })),
    };
  }

  async function toolFindFreeSlots({ date, durationMins }) {
    const day = parseLocalDate(date);
    const need = Math.max(1, Math.ceil((durationMins || 60) / 60));
    const jobs = (await DB.getJobs()).filter((j) =>
      j.scheduledAt && toLocalDate(new Date(j.scheduledAt)) === toLocalDate(day));

    const taken = new Set();
    let bookedMins = 0;
    for (const j of jobs) {
      const h = new Date(j.scheduledAt).getHours();
      bookedMins += durationOf(j);
      for (let i = 0; i < Math.ceil(durationOf(j) / 60); i++) taken.add(h + i);
    }

    const free = [];
    for (let h = DAY_START_HOUR; h + need <= DAY_END_HOUR; h++) {
      let fits = true;
      for (let i = 0; i < need; i++) if (taken.has(h + i)) { fits = false; break; }
      if (fits) free.push(`${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`);
    }
    return {
      date,
      workingHours: '7am-6pm',
      freeStartTimes: free,
      alreadyBookedJobs: jobs.length,
      alreadyBookedHours: bookedMins / 60,
      dayIsFull: bookedMins >= 8 * 60,
    };
  }

  async function toolListUnbooked() {
    const soon = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const jobs = (await DB.getJobs()).filter((j) => {
      if (j.scheduledAt) return false;
      if (j.status === 'completed' && !j.nextDueAt) return false;
      if (j.nextDueAt) return j.nextDueAt <= soon;
      return j.status !== 'completed';
    });
    return {
      unbooked: jobs.map((j) => ({
        jobId: j.id,
        name: j.name,
        address: j.address || '',
        jobType: j.jobType,
        dueDate: j.nextDueAt ? toLocalDate(new Date(j.nextDueAt)) : null,
        overdue: j.nextDueAt ? j.nextDueAt < Date.now() : false,
      })),
    };
  }

  async function toolSearchJobs({ query }) {
    const q = String(query || '').toLowerCase();
    const jobs = (await DB.getJobs()).filter((j) =>
      j.name.toLowerCase().includes(q) || (j.address || '').toLowerCase().includes(q));
    return {
      matches: jobs.slice(0, 10).map((j) => ({
        jobId: j.id,
        name: j.name,
        address: j.address || '',
        jobType: j.jobType,
        status: j.status,
        booked: j.scheduledAt ? `${toLocalDate(new Date(j.scheduledAt))} ${fmtTime(j.scheduledAt)}` : null,
      })),
    };
  }

  // The write path. Renders a confirm card and resolves with whatever the
  // technician chose — the model is told plainly if they declined.
  function toolBookJob({ jobId, dateTime, durationMins }) {
    return new Promise(async (resolve) => {
      const job = await DB.getJob(jobId);
      if (!job) { resolve({ booked: false, reason: 'No job with that id.' }); return; }
      const when = parseLocalDateTime(dateTime);
      if (!Number.isFinite(when.getTime())) { resolve({ booked: false, reason: 'Could not read that date/time.' }); return; }
      const mins = durationMins || 60;

      const card = document.createElement('div');
      card.className = 'agent-confirm';
      const text = document.createElement('div');
      text.className = 'agent-confirm-text';
      const dayLabel = when.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
      text.innerHTML = '';
      const t1 = document.createElement('strong');
      t1.textContent = job.name;
      text.appendChild(t1);
      const t2 = document.createElement('span');
      t2.textContent = `${dayLabel} at ${fmtTime(when.getTime())} · ${mins} min`;
      text.appendChild(t2);
      if (job.address) {
        const t3 = document.createElement('span');
        t3.className = 'agent-confirm-addr';
        t3.textContent = job.address;
        text.appendChild(t3);
      }
      card.appendChild(text);

      const row = document.createElement('div');
      row.className = 'row gap';
      const yes = document.createElement('button');
      yes.className = 'btn btn-primary flex1';
      yes.textContent = 'Book it';
      const no = document.createElement('button');
      no.className = 'btn btn-secondary flex1';
      no.textContent = 'No';
      row.appendChild(no);
      row.appendChild(yes);
      card.appendChild(row);
      logEl.appendChild(card);
      logEl.scrollTop = logEl.scrollHeight;

      const settle = (result, label) => {
        row.remove();
        const outcome = document.createElement('span');
        outcome.className = 'agent-confirm-outcome';
        outcome.textContent = label;
        card.appendChild(outcome);
        resolve(result);
      };

      yes.addEventListener('click', async () => {
        await DB.updateJob(jobId, { scheduledAt: when.getTime(), scheduledDurationMins: mins });
        if (window.Scheduler) await window.Scheduler.refresh();
        settle({ booked: true, jobName: job.name, at: `${toLocalDate(when)} ${fmtTime(when.getTime())}`, durationMins: mins }, '✓ Booked');
      });
      no.addEventListener('click', () => {
        settle({ booked: false, reason: 'The technician declined this time. Offer an alternative or ask what suits.' }, 'Declined');
      });
    });
  }

  const TOOL_IMPLS = {
    get_schedule: toolGetSchedule,
    find_free_slots: toolFindFreeSlots,
    list_unbooked_jobs: toolListUnbooked,
    search_jobs: toolSearchJobs,
    book_job: toolBookJob,
  };

  // ---------- transport ----------
  async function callAgent(messages) {
    const client = getClient();
    if (!client) throw new Error('Sign in to use the booking assistant.');
    const now = new Date();
    const { data, error } = await client.functions.invoke('schedule-agent', {
      body: {
        messages,
        today: toLocalDate(now),
        dayName: now.toLocaleDateString('en-AU', { weekday: 'long' }),
      },
    });
    if (error) {
      let detail = '';
      try {
        if (error.context && typeof error.context.json === 'function') {
          const parsed = await error.context.json();
          detail = parsed && parsed.error ? parsed.error : '';
        }
      } catch (e) { /* fall through */ }
      throw new Error(detail || error.message || 'Assistant unavailable');
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  // ---------- chat rendering ----------
  function addBubble(who, text) {
    const b = document.createElement('div');
    b.className = `agent-bubble agent-${who}`;
    b.textContent = text;
    logEl.appendChild(b);
    logEl.scrollTop = logEl.scrollHeight;
    return b;
  }

  function addThinking(label) {
    const b = document.createElement('div');
    b.className = 'agent-bubble agent-thinking';
    b.textContent = label;
    logEl.appendChild(b);
    logEl.scrollTop = logEl.scrollHeight;
    return b;
  }

  const TOOL_LABELS = {
    get_schedule: 'Checking the diary…',
    find_free_slots: 'Looking for gaps…',
    list_unbooked_jobs: 'Checking what needs booking…',
    search_jobs: 'Finding that job…',
    book_job: 'Proposing a booking…',
  };

  async function send() {
    const text = inputEl.value.trim();
    if (!text || busy) return;
    inputEl.value = '';
    addBubble('user', text);
    history.push({ role: 'user', content: text });

    busy = true;
    sendBtn.disabled = true;
    let status = addThinking('Thinking…');

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const reply = await callAgent(history);
        const blocks = reply.content || [];
        history.push({ role: 'assistant', content: blocks });

        const textOut = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        const toolUses = blocks.filter((b) => b.type === 'tool_use');

        if (textOut) { status.remove(); addBubble('assistant', textOut); status = null; }

        if (reply.stopReason !== 'tool_use' || !toolUses.length) break;

        if (!status) status = addThinking(TOOL_LABELS[toolUses[0].name] || 'Working…');
        else status.textContent = TOOL_LABELS[toolUses[0].name] || 'Working…';

        const results = [];
        for (const use of toolUses) {
          const impl = TOOL_IMPLS[use.name];
          let result;
          try {
            result = impl ? await impl(use.input || {}) : { error: `Unknown tool ${use.name}` };
          } catch (err) {
            result = { error: err.message || String(err) };
          }
          results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result) });
        }
        history.push({ role: 'user', content: results });
      }
      if (status) status.remove();
    } catch (err) {
      if (status) status.remove();
      addBubble('error', err.message || String(err));
    } finally {
      busy = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  openBtn.addEventListener('click', () => {
    panel.classList.remove('hidden');
    if (!logEl.children.length) {
      addBubble('assistant', 'Ask me things like "what does Thursday look like", "when am I free for a 2 hour job next week", or "book the Nguyen re-inspection Tuesday morning".');
    }
    inputEl.focus();
  });
  closeBtn.addEventListener('click', () => panel.classList.add('hidden'));

  window.ScheduleAgent = {
    open: () => openBtn.click(),
    reset: () => { history = []; logEl.innerHTML = ''; },
  };
})();
