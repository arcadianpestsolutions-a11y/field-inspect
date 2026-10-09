// ---------------------------------------------------------------------------
// restore.js - put a backup file (from "Export All Data") back onto this phone.
//
// PURPOSE   The Export button made a file, but nothing could read it back. This
//           reads it, shows exactly what it would change, and only then writes.
// EXPOSES   window.Restore = { parse, plan, describe, apply, readLocal, pickAndRestore }
// DEPENDS   DB (reads, and the *Raw puts that keep each record's own updatedAt),
//           Dialog (the question), UndoDelete (finishes a pending delete first),
//           Sync (optional: a sync afterwards sends restored records to the cloud).
// TESTS     tests/run-tests.js - "Restore" group.
//
// THE RULES, which are the whole point of this file:
//   1. It ADDS and UPDATES. It never deletes anything, and never replaces a record
//      on this phone with an OLDER copy: where both exist, the newer one wins, the
//      same rule sync uses.
//   2. Anything deleted ON PURPOSE after the backup was made stays deleted. The
//      tombstones that make a delete stick across devices are respected here too,
//      or a restore would quietly undo every deliberate delete since the backup.
//   3. It writes with each record's own timestamps (the *Raw puts), so a restored
//      old copy cannot look newer than the cloud's and overwrite it on the next
//      sync. Records the cloud does not have are then uploaded by the normal sync.
//   4. Photos are not in the backup file and are not touched.
//   5. A file that is not a Scope backup, or is from a newer version of the app,
//      is refused before anything is read into the database.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  const SUPPORTED_FORMATS = [1, 2];
  const MAX_BYTES = 80 * 1024 * 1024;

  // Each kind of record: where it lives in the file, what makes one valid, which
  // tombstone table it answers to, and how to write it without re-stamping it.
  const KINDS = [
    { key: 'clients', label: ['client', 'clients'], table: 'clients', id: (r) => r.id, put: (r) => window.DB.putClientRaw(r) },
    { key: 'jobs', label: ['job', 'jobs'], table: 'jobs', id: (r) => r.id, put: (r) => window.DB.putJobRaw(r) },
    { key: 'reports', label: ['report', 'reports'], table: 'reports', id: (r) => r.jobId, needsJob: (r) => r.jobId, put: (r) => window.DB.putReportRaw(r) },
    { key: 'invoices', label: ['invoice', 'invoices'], table: 'invoices', id: (r) => r.id, needsJob: (r) => r.jobId, put: (r) => window.DB.putInvoiceRaw(r) },
    { key: 'leads', label: ['enquiry', 'enquiries'], table: 'leads', id: (r) => r.id, put: (r) => window.DB.putLeadRaw(r) },
    { key: 'swms', label: ['safety statement', 'safety statements'], table: 'swms', id: (r) => r.id, put: (r) => window.DB.putSwmsRaw(r) },
  ];

  const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200;
  const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

  // ---------- Reading the file ----------
  // Returns { ok: true, data } or { ok: false, reason } with a sentence for a person.
  function parse(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'That file is empty.' };
    if (text.length > MAX_BYTES) return { ok: false, reason: 'That file is far too big to be a Scope backup.' };
    let data;
    try { data = JSON.parse(text); } catch (e) {
      return { ok: false, reason: 'That is not a Scope backup file (it could not be read). Choose the .json file that Export All Data made.' };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.jobs)) {
      return { ok: false, reason: 'That is not a Scope backup file. Choose the .json file that Export All Data made.' };
    }
    const format = data.format == null ? 1 : data.format;
    if (!SUPPORTED_FORMATS.includes(format)) {
      return { ok: false, reason: 'That backup was made by a newer version of Scope. Update the app, then try again.' };
    }
    return { ok: true, data: Object.assign({}, data, { format }) };
  }

  // ---------- What is on this phone now ----------
  async function readLocal() {
    const DB = window.DB;
    const [jobs, reports, invoices, clients, leads, swms, deletions] = await Promise.all([
      DB.getJobs(), DB.getAllReports(), DB.getAllInvoices(), DB.getClients(), DB.getLeads(), DB.getAllSwms(), DB.getDeletions(),
    ]);
    return { jobs, reports, invoices, clients, leads, swms, deleted: new Set((deletions || []).map((d) => d.key)) };
  }

  // ---------- Deciding, without writing anything ----------
  // Pure: given the parsed backup and what is on the phone, what would a restore do?
  function plan(data, local) {
    const out = { kinds: {}, writes: [], totals: { add: 0, update: 0, same: 0, deleted: 0, invalid: 0, orphan: 0 } };
    const jobIdsAfter = new Set((local.jobs || []).map((j) => j.id));
    const deleted = local.deleted || new Set();

    for (const kind of KINDS) {
      const k = { add: 0, update: 0, same: 0, deleted: 0, invalid: 0, orphan: 0 };
      out.kinds[kind.key] = k;
      const existing = new Map((local[kind.key] || []).map((r) => [kind.id(r), r]));
      const incoming = Array.isArray(data[kind.key]) ? data[kind.key] : [];
      for (const rec of incoming) {
        const id = rec && typeof rec === 'object' ? kind.id(rec) : null;
        if (!isId(id)) { k.invalid++; continue; }
        if (deleted.has(`${kind.table}:${id}`)) { k.deleted++; continue; }
        if (kind.needsJob) {
          const jobId = kind.needsJob(rec);
          if (!isId(jobId) || deleted.has(`jobs:${jobId}`) || !jobIdsAfter.has(jobId)) { k.orphan++; continue; }
        }
        const mine = existing.get(id);
        if (!mine) {
          k.add++;
          out.writes.push({ kind: kind.key, record: rec });
          if (kind.key === 'jobs') jobIdsAfter.add(id);
        } else if ((Number(rec.updatedAt) || 0) > (Number(mine.updatedAt) || 0)) {
          k.update++;
          out.writes.push({ kind: kind.key, record: rec });
        } else {
          k.same++;
        }
      }
      Object.keys(k).forEach((n) => { out.totals[n] += k[n]; });
    }
    return out;
  }

  // ---------- Saying what it will do ----------
  function listOf(p, field) {
    return KINDS.map((kind) => [p.kinds[kind.key][field], kind.label]).filter(([n]) => n > 0).map(([n, l]) => plural(n, l));
  }

  function joinAnd(parts) {
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  }

  // A few short paragraphs, safe for textContent.
  function describe(p, meta) {
    const m = meta || {};
    const lines = [];
    const when = m.exportedAt ? new Date(m.exportedAt) : null;
    const whenText = when && !Number.isNaN(when.getTime())
      ? when.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'an unknown date';
    lines.push(`This backup is from ${whenText}${m.appVersion ? ` (Scope ${m.appVersion})` : ''}.`);
    const adds = listOf(p, 'add');
    const updates = listOf(p, 'update');
    if (!adds.length && !updates.length) {
      lines.push('Everything in it is already on this phone, or newer here. Nothing would change.');
    } else {
      if (adds.length) lines.push(`It will add ${joinAnd(adds)} that are not on this phone.`);
      if (updates.length) lines.push(`It will bring ${joinAnd(updates)} up to the newer copy in the backup.`);
    }
    if (p.totals.deleted) lines.push(`${plural(p.totals.deleted, ['item was', 'items were'])} deleted after this backup was made and will stay deleted.`);
    if (p.totals.orphan) lines.push(`${plural(p.totals.orphan, ['report or invoice', 'reports or invoices'])} belong to jobs that are not here and will be left out.`);
    if (p.totals.invalid) lines.push(`${plural(p.totals.invalid, ['damaged entry', 'damaged entries'])} will be skipped.`);
    lines.push('Nothing on this phone will be deleted, and nothing newer here will be replaced by an older copy. Photos are not in backup files and are not touched.');
    return lines;
  }

  // ---------- Writing ----------
  async function apply(p) {
    let written = 0;
    // Clients before jobs before the things that hang off jobs, so nothing is ever
    // written pointing at a record that is not there yet.
    for (const kind of KINDS) {
      for (const w of p.writes.filter((x) => x.kind === kind.key)) {
        await kind.put(w.record);
        written++;
      }
    }
    // Signed in, a sync sends up anything the cloud does not have and pulls down
    // anything newer there. Not awaited: the restore is done either way.
    if (window.Sync && window.Sync.pullAll && window.Sync.currentUserId && window.Sync.currentUserId()) {
      window.Sync.pullAll().catch(() => {});
    }
    if (window.renderJobListPublic) { try { window.renderJobListPublic(); } catch (e) { /* redraws later */ } }
    try { window.dispatchEvent(new Event('scope-captures-changed')); } catch (e) { /* ignore */ }
    return { written };
  }

  // ---------- The button on the Archive screen ----------
  const ask = (msg, opts) => (window.Dialog ? window.Dialog.confirm(msg, opts) : Promise.resolve(window.confirm(msg)));
  const say = (m) => (window.appToast ? window.appToast(m) : null);

  function resultLine(text) {
    const line = document.getElementById('restore-result');
    if (line) { line.textContent = text; line.classList.toggle('hidden', !text); }
  }

  // Runs the whole thing for a chosen File. Returns what happened, for tests.
  async function restoreFile(file) {
    if (!file) return { ok: false, reason: 'No file chosen.' };
    let text;
    try { text = await file.text(); } catch (e) { return finish({ ok: false, reason: 'That file could not be opened.' }); }
    const parsed = parse(text);
    if (!parsed.ok) return finish(parsed);
    if (window.UndoDelete && window.UndoDelete.flush) await window.UndoDelete.flush(); // a pending delete is final first
    const local = await readLocal();
    const p = plan(parsed.data, local);
    const lines = describe(p, parsed.data);
    if (!p.writes.length) return finish({ ok: true, written: 0, plan: p, message: lines.slice(1, 2).join(' ') || 'Nothing to restore.' });
    const yes = await ask(lines.join('\n\n'), { title: 'Restore this backup?', okLabel: 'Restore', cancelLabel: 'Cancel' });
    if (!yes) return finish({ ok: false, cancelled: true, plan: p, reason: 'Nothing was changed.' });
    try {
      const r = await apply(p);
      const done = `Restored. ${r.written} record${r.written === 1 ? '' : 's'} put back.`;
      return finish({ ok: true, written: r.written, plan: p, message: done });
    } catch (e) {
      if (window.ErrorLog) window.ErrorLog.note(e, 'restore: write');
      return finish({ ok: false, plan: p, reason: 'The restore stopped part-way. What was restored is safe; run it again to finish (it skips what is already back).' });
    }
  }

  function finish(result) {
    const text = result.ok ? (result.message || 'Done.') : (result.reason || 'Nothing was changed.');
    resultLine(text);
    say(text);
    return result;
  }

  // Built beside the Export button, and only shown when it is (the people who can
  // back up are the people who can restore).
  function mount() {
    const exportBtn = document.getElementById('export-data-btn');
    if (!exportBtn || document.getElementById('restore-btn')) return;
    const hint = exportBtn.nextElementSibling && exportBtn.nextElementSibling.classList.contains('empty-hint')
      ? exportBtn.nextElementSibling : exportBtn;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'restore-btn';
    btn.className = 'btn btn-outline full';
    btn.textContent = 'Restore from a backup file';
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'restore-file';
    input.accept = '.json,application/json';
    // Visually hidden rather than display:none: some phones will not open the file
    // picker for an input that is not rendered at all.
    input.className = 'visually-hidden';
    input.setAttribute('aria-label', 'Backup file to restore');
    const result = document.createElement('p');
    result.id = 'restore-result';
    result.className = 'empty-hint hidden';
    result.setAttribute('role', 'status');
    hint.parentNode.insertBefore(btn, hint.nextSibling);
    btn.parentNode.insertBefore(input, btn.nextSibling);
    input.parentNode.insertBefore(result, input.nextSibling);
    btn.addEventListener('click', () => { input.value = ''; input.click(); });
    let busy = false;
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file || busy) return;
      busy = true;
      btn.disabled = true;
      btn.textContent = 'Reading the backup…';
      try { await restoreFile(file); } finally {
        busy = false;
        btn.disabled = false;
        btn.textContent = 'Restore from a backup file';
      }
    });
    const sync = () => btn.classList.toggle('hidden', exportBtn.classList.contains('hidden'));
    sync();
    new MutationObserver(sync).observe(exportBtn, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  window.Restore = { parse, plan, describe, apply, readLocal, restoreFile, mount, KINDS, SUPPORTED_FORMATS };
})();
