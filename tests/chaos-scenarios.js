// Specific mistakes a person makes, one at a time, with a pass/fail for each.
// The partner to chaos.js: that one wanders at random, this one does the
// deliberate out-of-order things random tapping is very unlikely to string
// together - typing a name that is HTML, saving an empty form, deleting a job
// while its report is open, tapping Convert twice, backing out while the camera
// is still starting.
//
// A scenario that cannot set itself up FAILS. It does not quietly skip: a first
// draft of this file "passed" four scenarios that had in fact done nothing,
// because the button they were meant to tap is hidden until a job is in review.
//
// DEMO MODE ONLY, same as chaos.js and for the same reasons. Load after it:
//
//     const s = document.createElement('script'); s.src = '/tests/chaos-scenarios.js';
//     document.head.appendChild(s);
//     ChaosScenarios.run().then((r) => { window.__scn = r; });
(() => {
  'use strict';
  if (!window.IS_DEMO || window.IS_TEST) {
    throw new Error('chaos-scenarios.js refuses to run outside ?demo=1.');
  }
  if (window.ChaosScenarios) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const viewId = () => (Array.from(document.querySelectorAll('section.view')).find((v) => !v.classList.contains('hidden')) || {}).id;
  const visible = (el) => !!el && el.getBoundingClientRect().width > 1 && !el.closest('.hidden');
  const must = (cond, msg) => { if (!cond) throw new Error(msg); };

  // A finger: lands on whatever is on top at that point, so tapping a hidden
  // button hits the page behind it and does nothing, as it would for a person.
  async function tap(el, label) {
    must(el, 'nothing to tap' + (label ? ' (' + label + ')' : ''));
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y) || el;
    const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
    for (const t of ['mousedown', 'mouseup', 'click']) hit.dispatchEvent(new MouseEvent(t, init));
    await sleep(30);
    return hit;
  }
  // Like tap(), but fails if the control is not actually showing: a scenario
  // that taps something a person could not see has proved nothing.
  async function tapVisible(el, label) {
    must(visible(el), (label || 'control') + ' is not visible, so a person could not tap it');
    return tap(el, label);
  }
  function type(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const byText = (sel, re, root) => Array.from((root || document).querySelectorAll(sel)).find((e) => re.test(e.textContent) && visible(e));
  async function home() {
    for (let i = 0; i < 8 && viewId() !== 'view-joblist'; i++) {
      const dlg = document.querySelector('body > .app-dialog');
      // To get OUT, agree with whatever is asked ("discard", "leave"). Taking
      // the first button picks Cancel, which keeps you where you are, and the
      // helper then circled for ever and failed every scenario after it.
      if (dlg) { (dlg.querySelector('.btn-primary, .btn-danger') || dlg.querySelector('button')).click(); await sleep(80); }
      const back = Array.from(document.querySelectorAll('button[id*="back"]')).filter(visible);
      if (back.length) await tap(back[back.length - 1]);
      await sleep(120);
    }
    return viewId() === 'view-joblist';
  }
  async function makeJob(fields) {
    must(await home(), 'could not get to the job list');
    await tapVisible($('new-job-btn'), 'New Job'); await sleep(150);
    for (const [id, v] of Object.entries(fields)) if ($(id)) type($(id), v);
    await tapVisible($('job-form-save'), 'Create Job'); await sleep(250);
  }
  const findJob = async (name) => (await DB.getJobs()).find((j) => j.name === name);
  // A job at the stage Generate Form leaves it in: this is what makes Open
  // Report and the document picker appear.
  async function makeReviewJob(name, address) {
    await makeJob({ 'job-name': name, 'job-address': address });
    const job = await findJob(name);
    must(job, 'job was not created: ' + name);
    await DB.updateJob(job.id, { status: 'review' });
    return job;
  }
  async function openReportFor(job) {
    await home(); await window.showJobViewById(job.id); await sleep(450);
    await tapVisible($('view-report-btn'), 'Open Report'); await sleep(700);
    must(viewId() === 'view-report', 'Open Report did not open the report; showing ' + viewId());
  }
  // A camera that answers after a delay, and keeps count of what is still on.
  function trackedCamera(delayMs) {
    const created = [];
    const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    // Without this the camera code asks the browser for permission state first
    // and gives up on "denied" before it ever requests a stream, which in this
    // pane means the race below is never actually run.
    const realPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state: 'prompt' }) },
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => new Promise((resolve) => setTimeout(() => {
          const c = document.createElement('canvas'); c.width = 320; c.height = 240;
          c.getContext('2d').fillRect(0, 0, 320, 240);
          const stream = c.captureStream(5);
          for (const track of stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.__live = true;
            track.stop = () => { track.__live = false; stop(); };
          }
          created.push(stream);
          resolve(stream);
        }, delayMs)),
      },
    });
    return {
      created,
      live: () => created.flatMap((s) => s.getTracks()).filter((t) => t.__live).length,
      restore: () => {
        if (original) Object.defineProperty(navigator, 'mediaDevices', original);
        if (realPermissions) Object.defineProperty(navigator, 'permissions', realPermissions);
        else { try { delete navigator.permissions; } catch (e) { /* prototype getter remains */ } }
      },
    };
  }

  const PAYLOAD_A = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
  const PAYLOAD_B = '"><svg onload=window.__xss=(window.__xss||0)+1>';

  const SCENARIOS = [
    ['Hostile text: a job named after HTML is shown as text on every screen, and runs nothing', async (n) => {
      window.__xss = 0;
      await makeJob({ 'job-name': PAYLOAD_A, 'job-address': PAYLOAD_B + ' 1 Test St', 'job-phone': '0412 345 678', 'job-email': 'a@b.co', 'job-notes': PAYLOAD_A });
      const job = await findJob(PAYLOAD_A);
      must(job, 'the job was not saved with its name intact');
      // Booked for today, so it also shows on the Today screen, which is where the app opens.
      const noon = new Date(); noon.setHours(12, 0, 0, 0);
      await DB.updateJob(job.id, { status: 'review', scheduledAt: noon.getTime() });
      window.TodayUI.setTab('today');
      await home(); await sleep(500);
      must(($('today-panel').innerText || '').includes('<img src=x'), 'the markup should be visible as literal text on the Today screen');
      window.TodayUI.setTab('all');
      await home(); await sleep(300);
      must(document.body.innerText.includes('<img src=x'), 'the markup should be visible as literal text on the job list');
      await window.showJobViewById(job.id); await sleep(300);
      await openReportFor(job);
      await home();
      for (const id of ['open-scheduler-btn', 'open-leads-btn', 'open-clients-btn', 'open-archive-btn']) {
        await home();
        // Header icons moved into the bottom tab bar (Diary, Enquiries; the rest behind More).
        const viaTab = { 'open-scheduler-btn': 'tab-diary', 'open-leads-btn': 'tab-leads' }[id];
        let b = $(viaTab || id);
        if (!viaTab && !visible(b) && visible($('tab-more'))) { await tap($('tab-more')); await sleep(100); b = $(id); }
        await tapVisible(b, id); await sleep(300);
        n.push(id + ' -> ' + viewId());
      }
      must(!window.__xss, 'typed markup RAN ' + window.__xss + ' time(s)');
    }],

    ['Empty form: saving a new job with nothing filled in does not create a blank job', async (n) => {
      const before = (await DB.getJobs()).length;
      await home(); await tapVisible($('new-job-btn'), 'New Job'); await sleep(150);
      await tapVisible($('job-form-save'), 'Create Job'); await sleep(300);
      const after = (await DB.getJobs()).length;
      n.push('jobs ' + before + ' -> ' + after);
      must(after === before, 'a job with no details was created');
      if (visible($('job-form-cancel'))) await tap($('job-form-cancel'));
    }],

    ['Name only: a job with no address gets a report that opens', async (n) => {
      const job = await makeReviewJob('Scenario NoAddress', '');
      await openReportFor(job);
      const names = Array.from(document.querySelectorAll('#report-section-list .section-name')).map((e) => e.textContent.trim());
      n.push(names.length + ' sections listed');
      must(names.length >= 8, 'the report listed only ' + names.length + ' sections');
      const site = byText('li.report-section-item', /Site Sketch/i);
      must(site, 'no Site Sketch section');
      await tap(site); await sleep(600);
      n.push('opened Site Sketch: ' + viewId());
      must(viewId() === 'view-report-section', 'the Site Sketch section did not open');
      n.push('text shown: ' + (($('view-report-section').innerText || '').replace(/\s+/g, ' ').slice(0, 140)));
    }],

    ['Back without saving: typed text is kept as a draft, and declining to discard keeps you in the section', async (n) => {
      const job = await makeReviewJob('Scenario Draft', '2 Draft St');
      await openReportFor(job);
      await tap(byText('li.report-section-item', /Findings/i), 'Findings'); await sleep(600);
      const field = document.querySelector('#view-report-section [data-field-row] textarea');
      must(field, 'no text field in Findings to type into');
      type(field, 'half a sentence the technician typed before the phone rang');
      // Drafts are written every 20 seconds, and at once when the app is sent to
      // the background - which is what happens when the phone rings. So the
      // realistic mistake is: type, get interrupted, switch away.
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await sleep(400);
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      const draft = await DB.getSectionDraft(job.id, 'findings');
      must(draft, 'switching away mid-sentence did not keep the typed text as a draft');
      n.push('draft kept when the app was backgrounded');
      await tapVisible($('section-back-btn'), 'back'); await sleep(250);
      const dlg = document.querySelector('body > .app-dialog');
      must(dlg, 'leaving with unsaved text must ask first');
      dlg.querySelector('.btn-secondary').click(); await sleep(200);
      must(viewId() === 'view-report-section', 'declining "discard" still left the screen: ' + viewId());
      n.push('asked, declined, stayed; draft intact: ' + !!(await DB.getSectionDraft(job.id, 'findings')));
    }],

    ['Finalize before anything is filled in cannot be done, however often it is tapped', async (n) => {
      const job = await makeReviewJob('Scenario Early Finalize', '3 Early St');
      await openReportFor(job);
      const fin = $('finalize-report-btn');
      must(fin.disabled, 'Finalize is enabled on an empty report');
      for (let i = 0; i < 4; i++) { await tap(fin); await sleep(20); }
      await sleep(300);
      must(!document.querySelector('body > .app-dialog'), 'a confirmation opened for an incomplete report');
      const report = await DB.getReport(job.id);
      must(!(report && report.finalizedAt), 'an empty report was finalized');
      n.push('finalize stayed disabled');
    }],

    ['Wrong document: choosing a different kind once a report exists is refused and changes nothing', async (n) => {
      // A report only exists in the database once something has been SAVED in
      // it; opening it is not enough. So do what a person does: open it, write
      // something in a section, and save.
      const job = await makeReviewJob('Scenario Wrong Doc', '7 Mixup Ave');
      await openReportFor(job);
      await tap(byText('li.report-section-item', /Findings/i), 'Findings'); await sleep(600);
      const field = document.querySelector('#view-report-section [data-field-row] textarea');
      must(field, 'no text field to write in');
      type(field, 'some findings');
      await tapVisible($('section-save-btn'), 'Save & Back to Report'); await sleep(700);
      const before = await DB.getReport(job.id);
      must(before, 'saving a section did not create a report');
      await home(); await window.showJobViewById(job.id); await sleep(500);
      const cards = Array.from(document.querySelectorAll('.doc-type-card')).filter(visible);
      must(cards.length >= 2, 'the document picker should be showing on a job in review; found ' + cards.length + ' cards');
      n.push('cards: ' + cards.length);
      const other = cards.find((c) => !c.classList.contains('active'));
      await tap(other); await sleep(350);
      const after = await DB.getReport(job.id);
      must(after.documentType === before.documentType, 'document type changed from ' + before.documentType + ' to ' + after.documentType);
      n.push('toast: ' + ($('toast').textContent || '').slice(0, 90));
      must(/already has/i.test($('toast').textContent), 'it should explain why nothing happened');
    }],

    ['Job deleted from under an open report: Back lands somewhere sane', async (n) => {
      const job = await makeReviewJob('Scenario Vanishing', '4 Gone St');
      await openReportFor(job);
      await DB.deleteJob(job.id); // what a sync from another phone does
      await tapVisible($('report-back-btn'), 'report back'); await sleep(600);
      n.push('landed on ' + viewId());
      must(viewId(), 'no screen is showing');
      const stillThere = await findJob('Scenario Vanishing');
      must(!stillThere, 'deleted job came back');
    }],

    ['Convert an enquiry to a job with two quick taps: exactly one job is made', async (n) => {
      await DB.addLead({ name: 'Scenario Lead', phone: '0455 000 111', address: '9 Lead Rd', source: 'Google' });
      await home();
      const btn = $('tab-leads');
      await tapVisible(btn, 'Leads'); await sleep(500);
      const card = byText('#view-leads .lead-card', /Scenario Lead/);
      must(card, 'the enquiry is not on the board');
      await tap(card); await sleep(500);
      const convert = $('lead-convert-btn');
      const before = (await DB.getJobs()).length;
      // (a) A finger, twice. The first tap opens the question; the second lands
      // on the dim area around it, which dismisses it - so there is nothing left
      // to confirm, which is the right outcome.
      await tapVisible(convert, 'convert'); await sleep(50);
      await tap(convert); await sleep(200);
      const afterFinger = document.querySelectorAll('body > .app-dialog').length;
      n.push('finger double-tap: dialogs left open = ' + afterFinger);
      must(afterFinger <= 1, 'a double-tap stacked ' + afterFinger + ' dialogs');
      if (afterFinger) { document.querySelector('body > .app-dialog .btn-secondary').click(); await sleep(150); }
      must((await DB.getJobs()).length === before, 'a job was made without anyone confirming');

      // (b) A keyboard, twice: two Enter presses on the focused button arrive
      // before focus has moved into the dialog, so BOTH reach the button. This is
      // the case that used to open two dialogs and make two jobs.
      convert.click(); convert.click(); await sleep(250);
      const afterKeys = document.querySelectorAll('body > .app-dialog').length;
      n.push('double Enter: dialogs open = ' + afterKeys);
      must(afterKeys === 1, 'expected exactly one confirmation, found ' + afterKeys);
      document.querySelector('body > .app-dialog .btn-primary').click(); await sleep(800);
      const made = (await DB.getJobs()).length - before;
      n.push('jobs made: ' + made);
      must(made === 1, made + ' jobs were made from one enquiry');
    }],

    ['Invoice screen: hostile numbers never show NaN or Infinity', async (n) => {
      const invoice = (await DB.getAllInvoices())[0];
      must(invoice, 'the demo should have invoices');
      await home(); await window.showJobViewById(invoice.jobId); await sleep(500);
      const inv = $('view-invoice-btn');
      await tapVisible(inv, 'Invoice'); await sleep(600);
      must(viewId() === 'view-invoice', 'the invoice screen did not open: ' + viewId());
      // Quantity is a number input and price a decimal-keyboard one; neither has
      // an id, so they are found by what they are.
      const inputs = Array.from(document.querySelectorAll('#view-invoice input[type="number"], #view-invoice input[inputmode="decimal"]')).filter(visible);
      n.push('quantity/price inputs found: ' + inputs.length);
      must(inputs.length > 0, 'could not find a quantity or price field to try numbers in');
      for (const v of ['-5', '0', '1e309', '99999999999', '0.001', '', 'abc', '1.999999']) {
        for (const el of inputs) type(el, v);
        await sleep(100);
        const text = $('view-invoice').innerText || '';
        const bad = text.match(/.{0,30}(NaN|Infinity|undefined|\[object).{0,20}/);
        must(!bad, 'invoice shows garbage after entering "' + v + '": ' + (bad && bad[0]));
      }
    }],

    ['Start Inspection, then Back before the camera answers: no camera is left running', async (n) => {
      await makeJob({ 'job-name': 'Scenario Camera Race', 'job-address': '6 Lens St' });
      const job = await findJob('Scenario Camera Race');
      must(job, 'job not created');
      const cam = trackedCamera(700);
      try {
        await home(); await window.showJobViewById(job.id); await sleep(450);
        await tapVisible($('start-inspection-btn'), 'Start Inspection');
        await sleep(120); // the camera has NOT answered yet (700ms)
        const back = Array.from(document.querySelectorAll('button[id*="back"]')).filter(visible).pop();
        must(back, 'no Back button to reach for');
        await tap(back);
        await sleep(2200); // long enough for the camera to answer after being abandoned
        n.push('streams opened: ' + cam.created.length + ', still live: ' + cam.live());
        must(cam.created.length >= 1, 'the app never asked for the camera, so the race was never run');
        must(cam.live() === 0, cam.live() + ' camera track(s) still live after backing out - the camera light stays on');
        const after = await DB.getJob(job.id);
        n.push('job status after: ' + after.status);
        must(after.status !== 'inspecting' && after.status !== 'in-progress' && after.status !== 'recording',
          'backing out left the job marked as mid-inspection: ' + after.status);
      } finally { cam.restore(); }
    }],

    ['Start Inspection twice, fast: only one camera is held', async (n) => {
      const job = await findJob('Scenario Camera Race');
      must(job, 'depends on the previous scenario');
      const cam = trackedCamera(300);
      try {
        await home(); await window.showJobViewById(job.id); await sleep(450);
        const start = $('start-inspection-btn');
        await tapVisible(start, 'Start Inspection'); await sleep(40); await tap(start);
        await sleep(1800);
        n.push('streams opened: ' + cam.created.length + ', live: ' + cam.live());
        must(cam.created.length >= 1, 'the app never asked for the camera, so nothing was tested');
        must(cam.live() <= 1, cam.live() + ' cameras are running at once');
        // Leave properly and make sure nothing is left on.
        const back = Array.from(document.querySelectorAll('button[id*="back"]')).filter(visible).pop();
        if (back) await tap(back);
        const fin = $('inspection-finish-btn');
        await sleep(600);
      } finally { cam.restore(); }
    }],

    ['System Back: it walks back one screen at a time, and the app is still there at the end', async (n) => {
      const job = await makeReviewJob('Scenario System Back', '8 Gesture Rd');
      await openReportFor(job);
      await tap(byText('li.report-section-item', /Client Details/i), 'Client Details'); await sleep(600);
      must(viewId() === 'view-report-section', 'could not open a section');
      must(window.NavHistory && window.NavHistory.hasSentinel(), 'no Back entry is armed while a section is open');
      const path = [viewId()];
      for (let i = 0; i < 3; i++) { history.back(); await sleep(800); path.push(viewId()); }
      n.push('path: ' + path.join(' > '));
      must(path.join('>') === 'view-report-section>view-report>view-job>view-joblist',
        'Back should climb one screen per press, got ' + path.join(' > '));
      must(!window.NavHistory.hasSentinel(), 'the entry should be gone at the job list, so the next press leaves');
      must(location.search.includes('demo=1'), 'the page itself must not have moved');
    }],

    ['System Back: with a question open, it answers the question and stays on the screen', async (n) => {
      const job = await makeReviewJob('Scenario Back Dialog', '9 Gesture Rd');
      await home(); await window.showJobViewById(job.id); await sleep(450);
      const del = $('delete-job-btn');
      await tapVisible(del, 'Delete job'); await sleep(250);
      must(document.querySelector('body > .app-dialog'), 'the delete question did not open');
      history.back(); await sleep(600);
      must(!document.querySelector('body > .app-dialog'), 'Back should have dismissed the question');
      must(viewId() === 'view-job', 'it should stay on the job, got ' + viewId());
      must(await findJob('Scenario Back Dialog'), 'the job must not have been deleted');
      n.push('dismissed the delete question; job kept');
    }],

    ['Offline mid-edit: the work is kept on the device', async (n) => {
      await makeJob({ 'job-name': 'Scenario Offline', 'job-address': '5 Dark St' });
      const job = await findJob('Scenario Offline');
      must(job, 'job not created');
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      window.dispatchEvent(new Event('offline'));
      await DB.updateJob(job.id, { notes: 'written with no signal' });
      const back = await DB.getJob(job.id);
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      window.dispatchEvent(new Event('online'));
      must(back.notes === 'written with no signal', 'an offline edit was not stored');
    }],
  ];

  const S = {
    list: SCENARIOS.map((s) => s[0]),
    async run(only) {
      const out = [];
      for (let i = 0; i < SCENARIOS.length; i++) {
        if (only != null && only !== i) continue;
        const [name, fn] = SCENARIOS[i];
        const notes = [];
        const seen = window.ErrorLog ? window.ErrorLog.list().length : 0;
        let ok = true, error = '';
        try { await fn(notes); } catch (e) { ok = false; error = String((e && e.message) || e); }
        if (window.ErrorLog) {
          const fresh = window.ErrorLog.list().slice(seen).filter((e) => e.kind !== 'handled');
          if (fresh.length) { ok = false; error += (error ? ' | ' : '') + 'uncaught: ' + fresh.map((e) => e.message).slice(0, 2).join('; '); }
        }
        out.push({ n: i, name, ok, error, notes });
        await home();
      }
      return out;
    },
  };
  window.ChaosScenarios = S;
})();
