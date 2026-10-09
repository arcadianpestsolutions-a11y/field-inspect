// Making a backup, and remembering when the last one was made.
//
// WHY THIS EXISTS. Scope's data lives in two places and neither is a backup. Each
// phone holds its own copy, and the cloud holds the shared one. The cloud is on
// Supabase's free plan, which takes NO automatic backups (their documentation
// says so, and tells free-plan users to export regularly and keep copies
// elsewhere); and on any plan, their backups cover the database but not the files
// in Storage, which is where every inspection photograph is. So the one backup
// the app can make is the file the Export button produces, and it was a button
// nobody had a reason to press twice. This remembers when it last worked and says
// so on the Archive screen, which is the whole of the reminder.
//
// WHAT COUNTS AS A BACKUP. The file was handed somewhere that can keep it. On a
// computer or an Android phone that is a download, and the app cannot tell whether
// the download was kept, only that it was started. On an iPhone it is the share
// sheet: a home-screen app on iOS handles a plain download badly (the file may
// open in a viewer and never be saved), whereas the share sheet puts the choice -
// Files, email, AirDrop - in front of the person. If they close it without
// choosing, that is NOT a backup and is not recorded as one.
//
// WHAT IS IN IT. Jobs, reports, invoices, clients, enquiries and safety
// statements. NOT photographs. restore.js reads the file back (Archive screen,
// "Restore from a backup file"): it adds and updates, never deletes.
(() => {
  'use strict';

  if (window.Backup) return;

  const KEY = 'scope-last-backup';
  // A week. Past that the line turns amber, which is the nudge.
  const OK_DAYS = 7;

  const pad = (n) => String(n).padStart(2, '0');

  // LOCAL date, never toISOString(). That is UTC, so a backup made at 8am in Sydney
  // was stamped with yesterday's date, and the file name is the only thing telling
  // two backups apart.
  const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fileName = (d) => `field-inspect-backup-${localDate(d || new Date())}.json`;

  // ---- remembering --------------------------------------------------------
  function last() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      return v && Number.isFinite(v.at) ? v : null;
    } catch (e) { return null; }
  }

  // If storage is blocked (a private window) this is simply never remembered, and
  // the line says "no backup yet": which errs towards asking, not towards a false
  // sense of safety.
  function record(counts, via) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        at: Date.now(), counts: counts || null, via: via || '', version: window.APP_VERSION || '',
      }));
    } catch (e) { /* not remembered */ }
    render();
  }

  // ---- how long ago -------------------------------------------------------
  // By calendar days, not by dividing milliseconds by 86,400,000. On the days the
  // clocks change a day is 23 or 25 hours, and "yesterday at 9am" read as "today"
  // when the division came out at 0.96.
  function daysBetween(from, to) {
    const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / 86400000);
  }

  // How many records have been created or changed since the backup was made.
  // This is the number that makes an old backup mean something: "19 days ago" is
  // abstract, "and 23 things have changed since" is the thing at risk.
  function changedSince(at, data) {
    let n = 0;
    for (const list of [data.jobs, data.reports, data.invoices, data.clients, data.leads, data.swms]) {
      for (const r of list || []) if (r && (r.updatedAt || r.createdAt || 0) > at) n++;
    }
    return n;
  }

  const totalOf = (data) => ['jobs', 'reports', 'invoices', 'clients', 'leads', 'swms']
    .reduce((n, k) => n + ((data[k] || []).length), 0);

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // What to say, and how loudly. Pure: takes the last backup, the time, and a
  // plain object of the records, so it can be tested without a database.
  function describe(lastBackup, now, data) {
    const d = data || {};
    if (!lastBackup) {
      const total = totalOf(d);
      return {
        tone: 'never',
        text: total
          ? `No backup has been made from this phone. ${plural(total, 'record', 'records')} exist only in this app and the cloud.`
          : 'No backup has been made from this phone.',
      };
    }
    const when = new Date(lastBackup.at);
    const days = daysBetween(when, now);
    const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    const dateText = when.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    const changed = changedSince(lastBackup.at, d);
    const tail = changed
      ? ` ${plural(changed, 'record has', 'records have')} changed since.`
      : ' Nothing has changed since.';
    return {
      tone: days > OK_DAYS ? 'due' : 'ok',
      text: `Last backup: ${ago}${days >= 2 ? ` (${dateText})` : ''}.${tail}`,
      days, changed,
    };
  }

  // ---- making one ---------------------------------------------------------
  const isIos = () => !!(window.IosInstallNotice && window.IosInstallNotice.isIOS && window.IosInstallNotice.isIOS());

  function defaultDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Returns { ok, via, data } or { ok: false, cancelled: true, data }. Takes its
  // delivery methods as options so the suite can answer for them: a test cannot
  // press a real share sheet.
  async function exportNow(opts) {
    const o = opts || {};
    const data = await window.DB.exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const name = fileName(new Date());
    const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;

    const useShare = o.useShare != null ? o.useShare : isIos();
    const canShare = o.canShare || ((f) => !!(navigator.canShare && f && navigator.canShare({ files: [f] })));
    const share = o.share || ((f) => navigator.share({ files: [f], title: 'Scope backup' }));
    const download = o.download || defaultDownload;

    if (useShare && file && canShare(file)) {
      try {
        await share(file);
        record(data.counts, 'share');
        return { ok: true, via: 'share', data };
      } catch (e) {
        // Closed without choosing anywhere to put it. Not a backup, and quietly
        // downloading as well would put a file somewhere nobody chose.
        if (e && e.name === 'AbortError') return { ok: false, cancelled: true, data };
        // Anything else (the browser refusing a share started too long after the
        // tap) falls back to a plain download rather than losing the backup.
        if (window.ErrorLog) window.ErrorLog.note(e, 'backup: share sheet');
      }
    }
    download(blob, name);
    record(data.counts, 'download');
    return { ok: true, via: 'download', data };
  }

  // ---- the line on the Archive screen -------------------------------------
  // Built here, beside the button, for the reason every late-added control in this
  // app is: a returning device can pair a fresh script with a stale cached page,
  // and a missing element must mean "no line", never an error.
  const $ = (id) => document.getElementById(id);

  async function render() {
    try {
      const btn = $('export-data-btn');
      if (!btn || !btn.parentNode) return null;
      let line = $('backup-status');
      if (!line) {
        line = document.createElement('p');
        line.id = 'backup-status';
        line.className = 'backup-status';
        line.setAttribute('role', 'status');
        btn.parentNode.insertBefore(line, btn);
      }
      // Only the people who can make a backup are told one is due.
      line.classList.toggle('hidden', btn.classList.contains('hidden'));

      const DB = window.DB;
      const data = {
        jobs: await DB.getJobs(), reports: await DB.getAllReports(), invoices: await DB.getAllInvoices(),
        clients: await DB.getClients(), leads: await DB.getLeads(), swms: await DB.getAllSwms(),
      };
      const said = describe(last(), new Date(), data);
      line.textContent = said.text;
      line.dataset.tone = said.tone;
      return said;
    } catch (e) {
      if (window.ErrorLog) window.ErrorLog.note(e, 'backup status');
      return null;
    }
  }

  window.Backup = {
    exportNow, record, last, render, describe, changedSince, daysBetween, fileName, localDate, KEY, OK_DAYS,
  };

  // Test pages call render() themselves; a line appearing on the Archive screen
  // by itself would change the DOM under every other test.
  if (window.IS_TEST) return;

  function start() {
    const view = $('view-archive');
    if (!view) return;
    let queued = false;
    // The Archive screen is drawn each time it is opened, so look again then. A
    // short delay, because the screen decides whether to show the Export button
    // (it is for admins) while it draws, and the line follows the button.
    new MutationObserver(() => {
      if (queued || view.classList.contains('hidden')) return;
      queued = true;
      setTimeout(() => { queued = false; render(); }, 250);
    }).observe(view, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
