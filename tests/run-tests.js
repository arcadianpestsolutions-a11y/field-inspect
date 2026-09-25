(() => {
  'use strict';
  window.__suiteBuild = 'reset-v2';

  const results = [];
  const resultsList = document.getElementById('results');
  const summaryEl = document.getElementById('summary');
  const runBtn = document.getElementById('run-btn');
  const frame = document.getElementById('app-frame');

  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ---------- assertion helpers ----------
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error(`${msg || 'assertEqual failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }
  function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  // Waits for a condition instead of guessing a duration. A fixed wait() has
  // to be long enough for the slowest machine that will ever run it, and the
  // returning-client tests proved what happens when it is not: a 400ms
  // debounce plus a full-table IndexedDB scan against a 600ms wait passes
  // alone and fails when the machine is busy. Polling turns "probably long
  // enough" into "as long as it actually takes, and no longer".
  async function waitFor(predicate, message, timeoutMs) {
    const limit = timeoutMs || 4000;
    const startedAt = Date.now();
    for (;;) {
      let ok = false;
      try { ok = await predicate(); } catch (e) { ok = false; }
      if (ok) return;
      if (Date.now() - startedAt > limit) {
        throw new Error((message || 'condition never became true') + ` (waited ${limit}ms)`);
      }
      await wait(30);
    }
  }

  // Scheduler tests must not share a day, or one test's bookings show up in
  // another's hour totals. Day-of-month is fixed per test (and kept <= 28 so
  // it is valid in February) rather than offset from today, which would make
  // which tests collide depend on the date the suite happens to run.
  // The rebook test books its follow-up on the source job's due date, which
  // is "yesterday" — so any test that asserts on an exact day cell must avoid
  // both today and yesterday, or it fails once a month. Picks the first quiet
  // day in the 20s that no other test and no relative-date logic can reach.
  function quietDay() {
    const today = new Date().getDate();
    for (const d of [20, 21, 22, 23, 24, 25]) {
      if (d !== today && d !== today - 1) return d;
    }
    return 25;
  }

  function dayThisMonth(n, hour = 9) {
    const d = new Date();
    d.setDate(n);
    d.setHours(hour, 0, 0, 0);
    return d;
  }

  // ---------- setup / teardown ----------
  async function clearServiceWorkerState() {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  }

  function blankFrame() {
    // A stray open connection from the previous run (held by the iframe's own
    // db.js instance) blocks deleteDatabase() below, which then blocks the
    // next indexedDB.open() behind it too — a real deadlock. Navigating away
    // first force-closes that connection before we ever attempt the delete.
    return new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      frame.src = 'about:blank';
    });
  }

  // deleteDatabase() is blocked while ANY connection is still open, and the
  // previous version resolved on 'blocked' — so whenever the iframe still
  // held the database, the reset silently did nothing and the run started on
  // top of the last run's data. That is how hour totals came out doubled and
  // scheduler assertions failed for no visible reason. Clearing the object
  // stores instead cannot be blocked, needs no connection juggling, and is
  // verified below rather than assumed.
  async function resetTestDb() {
    if (DB.__resetConnection) await DB.__resetConnection();

    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('field-inspect-db-test');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const names = Array.from(db.objectStoreNames);
    if (names.length) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(names, 'readwrite');
        names.forEach((n) => tx.objectStore(n).clear());
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('reset aborted'));
      });

      // Prove it actually emptied, so a silent failure can never masquerade
      // as a passing suite again.
      const remaining = await new Promise((resolve) => {
        const tx = db.transaction(names, 'readonly');
        let total = 0, pending = names.length;
        names.forEach((n) => {
          const req = tx.objectStore(n).count();
          req.onsuccess = () => { total += req.result; if (--pending === 0) resolve(total); };
          req.onerror = () => { if (--pending === 0) resolve(total); };
        });
      });
      if (remaining !== 0) {
        db.close();
        throw new Error(`test database did not reset — ${remaining} records survived`);
      }
    }
    db.close();
    // Left visible so a failing reset can be diagnosed from outside the
    // closure instead of by guesswork.
    window.__lastReset = { at: Date.now(), stores: names, verifiedEmpty: true };
  }

  async function reloadFrame() {
    const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    // Cache-bust so re-running the suite without a page refresh still forces
    // a real navigation — an unchanged src doesn't re-fire the load event.
    frame.src = `../index.html?test=1&_r=${Date.now()}`;
    await loaded;
    await wait(300); // let initAuth() settle
    frame.contentWindow.showJobListView(); // bypass login for testing — never touches credentials
    await wait(150);
    installDialogDouble(frame.contentWindow);
  }

  // The app asks its questions through dialog.js now, not window.confirm —
  // native dialogs never render in an installed iOS home-screen app, which
  // is where this actually runs. Driving a real modal (find the button,
  // click it, wait) in every flow test would be a lot of churn to assert
  // the same thing those tests already assert: that the app ASKS before
  // doing something destructive, and honours the answer.
  //
  // So Dialog is doubled here to delegate straight to window.confirm /
  // window.prompt, which keeps every existing `win.confirm = () => true`
  // stub meaningful. The real dialog.js is tested on its own terms further
  // down ("Dialog:" tests) — this double stands in for it, it does not
  // excuse it from being tested.
  function installDialogDouble(win) {
    win.__realDialog = win.Dialog; // the "Dialog:" tests below drive the real one
    // A title and a message are two elements on screen but one piece of text
    // to the person reading it — and that is what assertions here care
    // about. Joining them is what keeps "the prompt names the job it
    // clashes with" true regardless of which of the two carries the name.
    const fullText = (msg, opts) => ((opts && opts.title) ? opts.title + '\n\n' + msg : msg);
    win.Dialog = {
      confirm: (msg, opts) => Promise.resolve(win.confirm(fullText(msg, opts))),
      prompt: (msg, def, opts) => Promise.resolve(win.prompt(fullText(msg, opts), def)),
      alert: (msg, opts) => Promise.resolve(win.alert(fullText(msg, opts))),
    };
  }

  // =====================================================================
  // DB layer tests — exercise db.js directly, no UI involved
  // =====================================================================

  test('DB.addJob creates a job with defaults', async () => {
    const job = await DB.addJob({ name: 'Test Job A', address: '1 Test St' });
    assert(!!job.id, 'job should have an id');
    assertEqual(job.status, 'new');
    assertEqual(job.name, 'Test Job A');
    const fetched = await DB.getJob(job.id);
    assertEqual(fetched.name, 'Test Job A');
  });

  test('DB.addJob assigns a new job to whoever is logged in', async () => {
    // sync.js never initializes in test mode (IS_TEST short-circuits it
    // before window.Sync is ever set) — this doesn't need the real thing,
    // just something with the same currentUser() shape addJob actually
    // reads, standing in for a real session the same way a test double
    // stands in for any other dependency.
    const original = window.Sync;
    window.Sync = { currentUser: () => ({ id: 'u1', email: 'Tech@Example.com' }), pushJob: () => {} };
    try {
      const job = await DB.addJob({ name: 'Auto Assign Job' });
      assertEqual(job.assignedTo, 'Tech@Example.com', 'whoever is logged in owns the job they just created');
    } finally {
      window.Sync = original;
    }
  });

  test('DB.addJob leaves a job unassigned with nobody logged in', async () => {
    // The default, and what every other test in this file already runs
    // under — asserted explicitly so a future change to this fallback
    // doesn't slip by unnoticed.
    const original = window.Sync;
    delete window.Sync;
    try {
      const job = await DB.addJob({ name: 'No Session Job' });
      assertEqual(job.assignedTo, '', 'no session means nobody to assign it to yet');
    } finally {
      window.Sync = original;
    }
  });

  test('DB.getJobs returns newest first', async () => {
    const a = await DB.addJob({ name: 'Older' });
    await wait(5);
    const b = await DB.addJob({ name: 'Newer' });
    const jobs = await DB.getJobs();
    const ai = jobs.findIndex((j) => j.id === a.id);
    const bi = jobs.findIndex((j) => j.id === b.id);
    assert(bi < ai, 'newer job should sort before older job');
  });

  test('DB.updateJob updates status and advances updatedAt', async () => {
    const job = await DB.addJob({ name: 'Status Test' });
    const before = job.updatedAt;
    await wait(5);
    const updated = await DB.updateJob(job.id, { status: 'in_progress' });
    assertEqual(updated.status, 'in_progress');
    assert(updated.updatedAt > before, 'updatedAt should advance');
  });

  test('DB.addCapture + getCaptures + getCaptureCount round-trip', async () => {
    const job = await DB.addJob({ name: 'Capture Test' });
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    await DB.addCapture({ jobId: job.id, zone: 'Attic', type: 'photo', photoBlob: blob });
    await DB.addCapture({ jobId: job.id, zone: 'Garage', type: 'memo', audioBlob: blob });
    const captures = await DB.getCaptures(job.id);
    assertEqual(captures.length, 2);
    assertEqual(await DB.getCaptureCount(job.id), 2);
  });

  test('DB.updateCapture attaches audio to an existing photo', async () => {
    const job = await DB.addJob({ name: 'Attach Test' });
    const photoBlob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    const capture = await DB.addCapture({ jobId: job.id, zone: 'Kitchen', type: 'photo', photoBlob });
    assert(!capture.audioBlob, 'should start with no audio');
    const audioBlob = new Blob([new Uint8Array([2])], { type: 'audio/webm' });
    const updated = await DB.updateCapture(capture.id, { audioBlob });
    assert(!!updated.audioBlob, 'audio should now be attached');
  });

  test('DB.deleteCapture removes only the targeted capture', async () => {
    const job = await DB.addJob({ name: 'Delete Capture Test' });
    const blob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    const c1 = await DB.addCapture({ jobId: job.id, zone: 'A', type: 'photo', photoBlob: blob });
    const c2 = await DB.addCapture({ jobId: job.id, zone: 'B', type: 'photo', photoBlob: blob });
    await DB.deleteCapture(c1.id);
    const remaining = await DB.getCaptures(job.id);
    assertEqual(remaining.length, 1);
    assertEqual(remaining[0].id, c2.id);
  });

  test('DB.addFootage + getFootage round-trip', async () => {
    const job = await DB.addJob({ name: 'Footage Test' });
    const blob = new Blob([new Uint8Array([1])], { type: 'video/webm' });
    await DB.addFootage({ jobId: job.id, zone: 'Roof', source: 'live', kind: 'video', blob });
    const footage = await DB.getFootage(job.id);
    assertEqual(footage.length, 1);
    assertEqual(footage[0].source, 'live');
  });

  test('DB.saveReport + getReport round-trip', async () => {
    const job = await DB.addJob({ name: 'Report Test' });
    await DB.saveReport({ jobId: job.id, sections: { intro: { note: 'hello' } }, finalizedAt: null });
    const fetched = await DB.getReport(job.id);
    assertEqual(fetched.sections.intro.note, 'hello');
  });

  test('DB.getAllReports sorts newest-updated first', async () => {
    const jobA = await DB.addJob({ name: 'Report Sort A' });
    const jobB = await DB.addJob({ name: 'Report Sort B' });
    await DB.saveReport({ jobId: jobA.id, sections: {} });
    await wait(5);
    await DB.saveReport({ jobId: jobB.id, sections: {} });
    const reports = await DB.getAllReports();
    const ai = reports.findIndex((r) => r.jobId === jobA.id);
    const bi = reports.findIndex((r) => r.jobId === jobB.id);
    assert(bi < ai, 'more recently saved report should sort first');
  });

  test('DB.deleteJob cascades captures, footage, and report', async () => {
    const job = await DB.addJob({ name: 'Cascade Test' });
    const blob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    await DB.addCapture({ jobId: job.id, zone: 'A', type: 'photo', photoBlob: blob });
    await DB.addFootage({ jobId: job.id, zone: 'A', source: 'live', kind: 'video', blob });
    await DB.saveReport({ jobId: job.id, sections: {} });

    await DB.deleteJob(job.id);

    assertEqual(await DB.getJob(job.id), undefined);
    assertEqual((await DB.getCaptures(job.id)).length, 0);
    assertEqual((await DB.getFootage(job.id)).length, 0);
    assertEqual(await DB.getReport(job.id), undefined);
  });

  // =====================================================================
  // UI tests — drive the real app.js inside the iframe (login bypassed via
  // the app's own showJobListView() hook, exactly like manual QA does)
  // =====================================================================

  test('UI: create a job through the form and land on its capture view', async () => {
    await reloadFrame();
    const doc = frame.contentDocument;
    doc.getElementById('new-job-btn').click();
    doc.getElementById('job-name').value = 'UI Test Job';
    doc.getElementById('job-address').value = '5 UI St';
    doc.getElementById('job-form-save').click();
    await wait(300);
    assert(!doc.getElementById('view-job').classList.contains('hidden'), 'should navigate to the job capture view');
    assertEqual(doc.getElementById('job-title').textContent, 'UI Test Job');
  });

  test('UI: zone chips appear once 2+ zones exist and filter the gallery', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const jobs = await win.DB.getJobs();
    const job = jobs.find((j) => j.name === 'UI Test Job');
    const blob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    await win.DB.addCapture({ jobId: job.id, zone: 'Attic', type: 'photo', photoBlob: blob });
    await win.DB.addCapture({ jobId: job.id, zone: 'Garage', type: 'photo', photoBlob: blob });

    win.showJobListView();
    await wait(150);
    Array.from(doc.querySelectorAll('.job-item'))
      .find((li) => li.querySelector('.job-item-name').textContent === 'UI Test Job')
      .click();
    await wait(250);

    const chips = doc.querySelectorAll('.zone-chip');
    assert(chips.length >= 3, 'expected an "All" chip plus one per zone');

    const atticChip = Array.from(chips).find((c) => c.textContent.trim().startsWith('Attic'));
    atticChip.click();
    await wait(100);
    assertEqual(doc.querySelectorAll('.capture-tile').length, 1);

    doc.querySelector('.zone-chip').click(); // back to "All" for the next test
    await wait(100);
  });

  test('UI: multi-select bulk delete removes exactly the selected captures', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const beforeCount = doc.querySelectorAll('.capture-tile').length;

    doc.getElementById('gallery-select-toggle').click();
    await wait(100);
    doc.querySelectorAll('.capture-tile')[0].click();
    await wait(50);

    win.confirm = () => true; // local confirm() dialog only, no external side effects
    doc.getElementById('selection-delete-btn').click();
    await wait(300);

    const afterCount = doc.querySelectorAll('.capture-tile').length;
    assertEqual(afterCount, beforeCount - 1);
    assert(doc.getElementById('selection-bar').classList.contains('hidden'), 'should exit select mode after a bulk action');
  });

  test('UI: detail viewer prev/next respects boundaries', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const jobs = await win.DB.getJobs();
    const job = jobs.find((j) => j.name === 'UI Test Job');
    const blob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    await win.DB.addCapture({ jobId: job.id, zone: 'Roof', type: 'photo', photoBlob: blob });
    win.showJobListView();
    await wait(150);
    Array.from(doc.querySelectorAll('.job-item'))
      .find((li) => li.querySelector('.job-item-name').textContent === 'UI Test Job')
      .click();
    await wait(250);

    const tiles = doc.querySelectorAll('.capture-tile');
    assert(tiles.length >= 2, 'need at least 2 captures for this test');
    tiles[0].click();
    await wait(150);
    assert(doc.getElementById('detail-prev').disabled, 'first item: prev should be disabled');
    assert(!doc.getElementById('detail-next').disabled, 'first item: next should be enabled');
    doc.getElementById('detail-close').click();
  });

  test('UI: job list search filters by name/address', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    win.showJobListView();
    await wait(150);
    const search = doc.getElementById('job-search-input');
    search.value = 'ui test';
    search.dispatchEvent(new win.Event('input', { bubbles: true }));
    await wait(100);
    const visible = Array.from(doc.querySelectorAll('.job-item-name')).map((el) => el.textContent);
    assert(visible.includes('UI Test Job'), 'search should surface the matching job');
    assert(visible.every((n) => n.toLowerCase().includes('ui test')), 'non-matching jobs should be filtered out');
    search.value = '';
    search.dispatchEvent(new win.Event('input', { bubbles: true }));
  });

  test('UI: status filter chips narrow the job list', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Filter Status Job' });
    await win.DB.updateJob(job.id, { status: 'completed' });
    win.showJobListView();
    await wait(150);

    doc.querySelector('.status-filter-chip[data-status="completed"]').click();
    await wait(100);
    const visible = Array.from(doc.querySelectorAll('.job-item-name')).map((el) => el.textContent);
    assert(visible.includes('Filter Status Job'), 'completed job should be visible under the Completed filter');
    assert(!visible.includes('UI Test Job'), '"new"-status job should be hidden under the Completed filter');

    doc.querySelector('.status-filter-chip[data-status="all"]').click();
    await wait(100);
  });

  // ---------- Multi-technician support ----------
  // Everything here is "invisible until it matters": a solo business (the
  // only kind this app has ever actually run for) must never see a
  // technician tag, a technician filter, or a reassign button — the moment
  // this section runs, jobs from every earlier test are already sitting in
  // the shared test database with no assignedTo at all, which is exactly
  // the "nobody else exists yet" state these guard against reacting to.

  test('UI: no technician tag or filter appears with fewer than two technicians', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    win.showJobListView();
    await wait(150);
    assert(doc.getElementById('job-technician-filters').classList.contains('hidden'),
      'one technician (or none at all) is not a "whose job is whose" situation yet');
    assert(!doc.querySelector('.job-item-technician'), 'and no row should carry a technician tag either');
  });

  test('UI: a second technician makes the filter and tags appear, and filtering actually narrows the list', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const jobA = await win.DB.addJob({ name: 'Tech A Job' });
    const jobB = await win.DB.addJob({ name: 'Tech B Job' });
    await win.DB.updateJob(jobA.id, { assignedTo: 'alice@example.com' });
    await win.DB.updateJob(jobB.id, { assignedTo: 'bob@example.com' });

    win.showJobListView();
    await wait(150);

    const filterRow = doc.getElementById('job-technician-filters');
    assert(!filterRow.classList.contains('hidden'), 'a second technician must make the filter row appear');
    assert(filterRow.textContent.includes('Everyone'), 'an explicit "everyone" option, not just individual names');
    assert(filterRow.textContent.includes('alice@example.com') || filterRow.textContent.includes('Alice'),
      'each known technician gets their own chip');
    assert(doc.querySelector('.job-item-technician'), 'and rows now carry a technician tag too');

    const aliceChip = Array.from(doc.querySelectorAll('#job-technician-filters .status-filter-chip'))
      .find((b) => b.dataset.technician === 'alice@example.com');
    assert(aliceChip, 'alice has her own filter chip specifically');
    aliceChip.click();
    await wait(150);
    const visible = Array.from(doc.querySelectorAll('.job-item-name')).map((el) => el.textContent);
    assert(visible.includes('Tech A Job'), "alice's own job stays visible under her filter");
    assert(!visible.includes('Tech B Job'), "bob's job must not appear under alice's filter");

    doc.querySelector('#job-technician-filters .status-filter-chip[data-technician="all"]').click();
    await wait(100);
  });

  test('UI: reassigning a job from its detail view updates who it belongs to', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    // Two technicians already need to exist for the reassign button to
    // show at all — same rule as the list view, applied to the job screen.
    const other = await win.DB.addJob({ name: 'Existing Other Tech Job' });
    await win.DB.updateJob(other.id, { assignedTo: 'carol@example.com' });
    const job = await win.DB.addJob({ name: 'Reassign Target Job' });
    await win.DB.updateJob(job.id, { assignedTo: 'dave@example.com' });

    win.showJobViewById(job.id);
    await wait(200);
    const btn = doc.getElementById('assigned-to-btn');
    assert(!btn.classList.contains('hidden'), 'two technicians exist, so the reassign control must be visible');
    assert(btn.textContent.includes('dave@example.com') || /dave/i.test(btn.textContent),
      `should show who it is currently assigned to, got: ${btn.textContent}`);

    const origPrompt = win.prompt;
    win.prompt = () => 'carol@example.com';
    try {
      btn.click();
      await wait(200);
    } finally {
      win.prompt = origPrompt;
    }

    const updated = await win.DB.getJob(job.id);
    assertEqual(updated.assignedTo, 'carol@example.com', 'typing a different email must actually reassign the job');
  });

  // =====================================================================
  // Report schema + completion logic — pure functions, no UI needed.
  // This whole area had no coverage until now, which is exactly where the
  // discard-leak and empty-array bugs were living.
  // =====================================================================

  const U = window.ReportSchemaUtils;
  const sectionById = (schema, id) => schema.find((s) => s.id === id);

  test('Schema: a required field left blank keeps the section yellow', () => {
    const findings = sectionById(window.REPORT_SCHEMA, 'findings');
    assertEqual(U.computeSectionStatus(findings, {}), 'yellow', 'blank findings should be yellow');
  });

  test('Schema: an empty required array counts as empty, not complete', () => {
    // Regression: an untouched multiselect / product list used to pass the
    // completion check and turn a section green with no data in it.
    const section = { id: 't', fields: [{ id: 'list', type: 'multiselect', required: true, options: ['a'] }] };
    assertEqual(U.computeSectionStatus(section, { list: [] }), 'yellow', 'empty array should be incomplete');
    assertEqual(U.computeSectionStatus(section, { list: ['a'] }), 'green', 'populated array should be complete');
  });

  test('Schema: hidden required fields do not block completion', () => {
    const section = {
      id: 't',
      fields: [
        { id: 'gate', type: 'yesno', required: true },
        { id: 'detail', type: 'text', required: true, showIf: { field: 'gate', equals: 'Yes' } },
      ],
    };
    assertEqual(U.computeSectionStatus(section, { gate: 'No' }), 'green', 'hidden dependent field should not block');
    assertEqual(U.computeSectionStatus(section, { gate: 'Yes' }), 'yellow', 'visible dependent field should block');
  });

  test('Schema: softRequired sections still show yellow when incomplete', () => {
    for (const schema of [window.REPORT_SCHEMA, window.PEST_TREATMENT_SCHEMA]) {
      const ack = sectionById(schema, 'acknowledgement');
      assert(ack.softRequired === true, 'acknowledgement should be softRequired');
      assertEqual(U.computeSectionStatus(ack, {}), 'yellow', 'blank acknowledgement should be yellow');
    }
  });

  test('Schema: both report types have unique section and field ids', () => {
    for (const [name, schema] of [['termite', window.REPORT_SCHEMA], ['pest', window.PEST_TREATMENT_SCHEMA]]) {
      const sectionIds = schema.map((s) => s.id);
      assertEqual(new Set(sectionIds).size, sectionIds.length, `${name}: duplicate section id`);
      for (const s of schema) {
        const fieldIds = s.fields.map((f) => f.id);
        assertEqual(new Set(fieldIds).size, fieldIds.length, `${name}/${s.id}: duplicate field id`);
      }
    }
  });

  test('Compliance: termite report covers all four AS 4349.3 timber pest categories', () => {
    const ids = window.REPORT_SCHEMA.flatMap((s) => s.fields.map((f) => f.id));
    for (const required of ['liveTermitesFound', 'workingsFound', 'borersFound', 'fungalDecayFound']) {
      assert(ids.includes(required), `missing timber pest field: ${required}`);
    }
  });

  test('Compliance: pest treatment captures the NSW pesticide record fields', () => {
    const ids = window.PEST_TREATMENT_SCHEMA.flatMap((s) => s.fields.map((f) => f.id));
    // Pesticides Regulation 2017 (NSW) cl 36 — the ones that were missing.
    for (const required of ['inspectionTime', 'applicationFinishTime', 'windSpeed', 'windDirection', 'products', 'equipmentUsed']) {
      assert(ids.includes(required), `missing pesticide record field: ${required}`);
    }
  });

  test('Compliance: wind fields only apply to outdoor spray applications', () => {
    const safety = sectionById(window.PEST_TREATMENT_SCHEMA, 'safety');
    const windSpeed = safety.fields.find((f) => f.id === 'windSpeed');
    assert(!U.isFieldVisible(windSpeed, { appliedOutdoorsWithSpray: 'No' }), 'wind hidden for indoor-only work');
    assert(U.isFieldVisible(windSpeed, { appliedOutdoorsWithSpray: 'Yes' }), 'wind shown for outdoor spraying');
  });

  test('UI: report header names the actual document, not just the job type', async () => {
    // A termite job used to open as "Termite Inspection Report" whatever it
    // really was, conflating AS 4349.3 (timber pest inspection) with AS 3660.2
    // (termite management). They are different documents with different scopes
    // and the header is the technician's only cue for which one they are in.
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const termite = await win.DB.addJob({ name: 'Header Termite' });
    const pest = await win.DB.addJob({ name: 'Header Pest', jobType: 'pest_treatment' });

    await win.ReportUI.openReview(termite.id);
    await wait(150);
    assertEqual(doc.getElementById('report-title').textContent,
      'Timber Pest Inspection Report', 'a termite job defaults to the timber pest inspection');

    await win.ReportUI.openReview(termite.id, 'termite_action_plan');
    await wait(150);
    assertEqual(doc.getElementById('report-title').textContent,
      'Termite Management Action Plan', 'and follows the document actually chosen');

    await win.ReportUI.openReview(pest.id);
    await wait(150);
    assertEqual(doc.getElementById('report-title').textContent, 'General Pest Treatment Report', 'pest header');
  });

  test('UI: discarding a section edit does not leak into the next save', async () => {
    // Regression: pendingSectionValues took a shallow copy, so arrays stayed
    // shared with the saved report. Editing then pressing Back mutated the
    // real record, and the next unrelated section save wrote it to disk.
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Discard Leak Job', jobType: 'pest_treatment' });
    await win.DB.saveReport({
      jobId: job.id,
      sections: { chemicals: { products: [{ id: 'p1', productName: 'KEEP ME' }] } },
      finalizedAt: null,
    });

    await win.ReportUI.openReview(job.id);
    await wait(200);
    const openSection = (label) => {
      const li = Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
        .find((el) => el.textContent.includes(label));
      assert(li, `section not found: ${label}`);
      li.click();
    };

    openSection('Chemicals / Products Used');
    await wait(200);
    const input = doc.querySelector('.product-card input');
    assert(input, 'product name input should render');
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'DISCARD ME');
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    const origConfirm = win.confirm;
    win.confirm = () => true; // confirm the discard — see the back-button confirmation test below
    try {
      doc.getElementById('section-back-btn').click(); // discard
      await wait(200);
    } finally {
      win.confirm = origConfirm;
    }

    openSection('Safety');
    await wait(200);
    doc.getElementById('section-save-btn').click(); // unrelated save
    await wait(300);

    const saved = await win.DB.getReport(job.id);
    assertEqual(saved.sections.chemicals.products[0].productName, 'KEEP ME', 'discarded edit must not persist');
  });

  test('UI: the header back arrow confirms before discarding unsaved photos/changes', async () => {
    // Real report: a technician took photos in a section, tapped the header
    // ← (the single most habitual "go back" tap there is), and lost them
    // with no warning at all. The arrow must not discard silently any more.
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Back Arrow Confirm Job', jobType: 'termite' });
    await win.ReportUI.openReview(job.id);
    await wait(200);
    const openSection = (label) => {
      const li = Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
        .find((el) => el.textContent.includes(label));
      assert(li, `section not found: ${label}`);
      li.click();
    };

    openSection('About the Property Inspected');
    await wait(200);
    const fileInput = doc.querySelector('.photo-field input[type="file"]');
    const file = new win.File(['x'], 'front.jpg', { type: 'image/jpeg' });
    const dt = new win.DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(200);

    const origConfirm = win.confirm;
    let confirmShown = false;
    let confirmMessage = '';
    win.confirm = (msg) => { confirmShown = true; confirmMessage = msg; return false; }; // Cancel
    try {
      doc.getElementById('section-back-btn').click();
      await wait(150);
      assert(confirmShown, 'a confirmation is shown before discarding an unsaved photo');
      assert(/discard/i.test(confirmMessage), 'the confirmation says what will happen');
      assert(!doc.getElementById('view-report-section').classList.contains('hidden'),
        'cancelling the confirmation keeps the editor open, not discarding the photo');
      assertEqual(doc.querySelector('.photo-field-grid').children.length, 1,
        'the photo is still there after cancelling');

      confirmShown = false;
      win.confirm = (msg) => { confirmShown = true; confirmMessage = msg; return true; }; // now actually confirm the discard
      doc.getElementById('section-back-btn').click();
      await wait(150);
      assert(confirmShown, 'confirming again still asks (not a one-time skip)');
      assert(doc.getElementById('view-report-section').classList.contains('hidden'), 'confirming discards and goes back');
    } finally {
      win.confirm = origConfirm;
    }

    // No section was ever saved in this test (only opened, then confirmed
    // away) — the report may not even exist in the DB yet. Either way, the
    // discarded photo must not be in it.
    const saved = await win.DB.getReport(job.id);
    assertEqual(saved ? (saved.sections.property || {}).propertyPhotos : undefined, undefined,
      'the discarded photo never reached the saved report');
  });

  test('AI errors: raw Edge Function strings never reach the technician', async () => {
    // The deployed function answers an un-deployed action with "Unknown
    // action — expected draft-report, trace-building, ...". That is written
    // for whoever is debugging the server, and it was being shown verbatim
    // to a technician standing at a property. Every failure path must say
    // what went wrong and what to do instead.
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'AI Error Copy Job', jobType: 'termite' });
    await win.ReportUI.openReview(job.id);
    await wait(300);
    const li = Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
      .find((el) => el.textContent.includes('Conducive Conditions'));
    li.click();
    await wait(300);

    const treeInput = doc.querySelectorAll('.photo-field input[type="file"]')[1];
    const dt = new win.DataTransfer();
    dt.items.add(new win.File(['x'], 't.jpg', { type: 'image/jpeg' }));
    treeInput.files = dt.files;
    treeInput.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(250);

    const origAI = win.AI;
    win.AI = {
      identifyTree: async () => {
        throw new Error('Unknown action — expected "draft-report", "trace-building", "identify-pest", "identify-tree", or "sort-photos"');
      },
    };
    try {
      Array.from(doc.querySelectorAll('button')).find((b) => b.textContent.includes('Identify Tree')).click();
      await wait(400);
      const toastEl = doc.querySelector('.toast, #toast');
      const shown = toastEl ? toastEl.textContent : '';
      assert(shown, 'a failure must say something, not fail silently');
      assert(!/unknown action|draft-report|trace-building/i.test(shown),
        `raw server wording leaked to the technician: "${shown}"`);
    } finally {
      win.AI = origAI;
    }
  });

  test('UI: the header back arrow does not prompt when there is nothing unsaved', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Back Arrow No-op Job', jobType: 'termite' });
    await win.ReportUI.openReview(job.id);
    await wait(200);
    const li = Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
      .find((el) => el.textContent.includes('About the Property Inspected'));
    li.click();
    await wait(200);

    const origConfirm = win.confirm;
    let confirmCalled = false;
    win.confirm = () => { confirmCalled = true; return true; };
    try {
      doc.getElementById('section-back-btn').click();
      await wait(150);
      assert(!confirmCalled, 'no confirmation when nothing changed in the section');
      assert(doc.getElementById('view-report-section').classList.contains('hidden'), 'back still works with no changes');
    } finally {
      win.confirm = origConfirm;
    }
  });

  test('UI: finalize is not blocked by unsigned softRequired sections', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Finalize Gate Job', address: '1 Test St' });
    const sections = {};
    for (const s of win.REPORT_SCHEMA) {
      const vals = win.ReportSchemaUtils.defaultValuesForSection(s);
      if (!s.softRequired) {
        for (const f of s.fields) {
          if (!f.required) continue;
          if (f.type === 'yesno') vals[f.id] = 'No';
          else if (f.type === 'select') vals[f.id] = f.options[0];
          else if (f.type === 'multiselect') vals[f.id] = [f.options[0]];
          else if (f.type === 'signature') vals[f.id] = 'data:image/png;base64,xx';
          else vals[f.id] = 'filled';
        }
      }
      sections[s.id] = vals;
    }
    await win.DB.saveReport({ jobId: job.id, sections, finalizedAt: null });

    await win.ReportUI.openReview(job.id);
    await wait(250);
    assert(!doc.getElementById('finalize-report-btn').disabled,
      'finalize should be enabled when only softRequired sections are incomplete');
  });

  // Fills every required field in the non-softRequired sections of a schema,
  // so a report can be driven to a finalizable state without hand-listing
  // fields in each test.
  function fillRequired(win, schema) {
    const sections = {};
    for (const s of schema) {
      const vals = win.ReportSchemaUtils.defaultValuesForSection(s);
      if (!s.softRequired) {
        for (const f of s.fields) {
          if (!f.required) continue;
          if (f.type === 'yesno') vals[f.id] = 'No';
          else if (f.type === 'select') vals[f.id] = f.options[0];
          else if (f.type === 'multiselect') vals[f.id] = [f.options[0]];
          else if (f.type === 'signature') vals[f.id] = 'data:image/png;base64,xx';
          else if (f.type === 'productList') vals[f.id] = [{ id: 'p1', productName: 'X' }];
          else vals[f.id] = 'filled';
        }
      }
      sections[s.id] = vals;
    }
    return sections;
  }

  test('Recurring: finalizing sets the next due date from the inspection date', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Recurring Due Job', address: '9 Recur St' });

    const inspected = new Date();
    inspected.setMonth(inspected.getMonth() - 12);
    const iso = inspected.toISOString().slice(0, 10);

    const sections = fillRequired(win, win.REPORT_SCHEMA);
    sections.clientDetails.inspectionDate = iso;
    sections.findings.reinspectionInterval = '12 months';
    await win.DB.saveReport({ jobId: job.id, sections, finalizedAt: null });

    await win.ReportUI.openReview(job.id);
    await wait(200);
    const originalConfirm = win.confirm;
    win.confirm = () => true;
    try {
      doc.getElementById('finalize-report-btn').click();
      await wait(500);
    } finally {
      win.confirm = originalConfirm;
    }

    const after = await win.DB.getJob(job.id);
    assertEqual(after.status, 'completed', 'job should be completed');
    assert(after.nextDueAt, 'nextDueAt should be set on finalize');
    // Inspected 12 months ago + 12 month interval => due about now.
    const daysOut = Math.abs((after.nextDueAt - Date.now()) / 86400000);
    assert(daysOut < 3, `due date should land near today, was ${Math.round(daysOut)} days out`);
    // Which interval produced this date has to survive alongside it — the
    // 9-month reminder / 12-month call-flag rule only applies to a genuine
    // 12-month cycle, and there is no other way to tell a 12-month due date
    // apart from a 6-month one two cycles in once all you have is the date.
    assertEqual(after.reinspectionIntervalMonths, 12, 'the interval that produced this due date is kept alongside it');
  });

  test('Recurring: no interval means no invented due date', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'No Interval Job' });
    const sections = fillRequired(win, win.REPORT_SCHEMA);
    sections.findings.reinspectionInterval = '';
    await win.DB.saveReport({ jobId: job.id, sections, finalizedAt: null });

    await win.ReportUI.openReview(job.id);
    await wait(200);
    const originalConfirm = win.confirm;
    win.confirm = () => true;
    try {
      doc.getElementById('finalize-report-btn').click();
      await wait(500);
    } finally {
      win.confirm = originalConfirm;
    }
    const after = await win.DB.getJob(job.id);
    assert(!after.nextDueAt, 'should not invent a due date with no interval given');
    assert(!after.reinspectionIntervalMonths, 'no interval to record either, for the same reason');
  });

  test('Recurring: rebooking carries the client across and clears the old due date', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const previous = await win.DB.addJob({
      name: 'Rebook Source', address: '3 Repeat Rd', clientPhone: '0400111222', clientEmail: 'c@example.com',
    });
    await win.DB.updateJob(previous.id, { status: 'completed', nextDueAt: Date.now() - 86400000 });

    win.showJobListView();
    await wait(150);
    doc.querySelector('.status-filter-chip[data-status="due"]').click();
    await wait(150);
    const row = Array.from(doc.querySelectorAll('#job-list .job-item'))
      .find((li) => li.textContent.includes('Rebook Source'));
    assert(row, 'overdue job should appear under the Due filter');
    row.click();
    await wait(250);

    assert(!doc.getElementById('due-callout').classList.contains('hidden'), 'due callout should show');
    doc.getElementById('rebook-job-btn').click();
    await wait(500);

    const jobs = await win.DB.getJobs();
    const next = jobs.find((j) => j.recurringFromId === previous.id);
    assert(next, 'a follow-up job should have been created');
    assertEqual(next.clientPhone, '0400111222', 'client phone should carry across');
    assertEqual(next.address, '3 Repeat Rd', 'address should carry across');
    assertEqual(next.status, 'new', 'follow-up job starts as new');
    const old = await win.DB.getJob(previous.id);
    assert(!old.nextDueAt, 'old job should stop nagging once rebooked');

    doc.querySelector('.status-filter-chip[data-status="all"]').click();
    await wait(100);
  });

  test('UI: Start Inspection reports a camera failure instead of doing nothing', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Start Fail Job' });
    win.showJobListView();
    await wait(200);
    const row = Array.from(doc.querySelectorAll('#job-list .job-item'))
      .find((li) => li.textContent.includes('Start Fail Job'));
    row.click();
    await wait(250);

    const btn = doc.getElementById('start-inspection-btn');
    const original = win.navigator.mediaDevices.getUserMedia;
    try {
      win.navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
      // Clear it first, and wait for the RIGHT toast rather than whatever
      // happens to be on screen. Report drafting fires autoPopulateSiteFields
      // without awaiting it, on purpose, so its "Filled ..." toast can land
      // here from a test that finished several steps ago.
      doc.getElementById('toast').textContent = '';
      btn.click();
      await waitFor(() => /blocked|permission/i.test(doc.getElementById('toast').textContent),
        'Start Inspection must say why the camera did not open');
      assert(!btn.disabled, 'button must be usable again after a failed start');
    } finally {
      win.navigator.mediaDevices.getUserMedia = original;
    }
  });

  // =====================================================================
  // Invoicing — money and dates. Both are areas where "looks right" and
  // "is right" diverge quietly, so these assert exact values.
  // =====================================================================

  const INV = window.Invoicing;
  const totalsOf = (lines, gstReg = true) => INV.computeTotals({ lineItems: lines, gstRegistered: gstReg });

  test('Invoicing: money arithmetic does not drift in floating point', () => {
    // 0.1 + 0.1 + 0.1 in dollars is 0.30000000000000004. In cents it is 30.
    const t = totalsOf([
      { quantity: 1, unitAmountCents: 10 },
      { quantity: 1, unitAmountCents: 10 },
      { quantity: 1, unitAmountCents: 10 },
    ]);
    assertEqual(t.subtotalCents, 30, 'three 10c lines must total exactly 30c');
    assertEqual(INV.formatMoney(t.subtotalCents), '$0.30', 'formatted total');
  });

  test('Invoicing: GST is 10% and the invoice adds up', () => {
    const t = totalsOf([
      { quantity: 1, unitAmountCents: 16500 },
      { quantity: 1, unitAmountCents: 8250 },
    ]);
    assertEqual(t.subtotalCents, 24750, 'subtotal');
    assertEqual(t.gstCents, 2475, 'gst');
    assertEqual(t.totalCents, 27225, 'total');
    assertEqual(t.subtotalCents + t.gstCents, t.totalCents, 'total must equal subtotal + gst');
  });

  test('Invoicing: GST rounds per line, matching how Xero rounds', () => {
    // 3333c x 10% = 333.3 -> 333 per line, 999 total. Rounding the 9999c
    // subtotal instead would give 1000 and disagree with Xero by a cent.
    const t = totalsOf([
      { quantity: 1, unitAmountCents: 3333 },
      { quantity: 1, unitAmountCents: 3333 },
      { quantity: 1, unitAmountCents: 3333 },
    ]);
    assertEqual(t.gstCents, 999, 'per-line rounding');
  });

  test('Invoicing: GST-free lines and unregistered businesses carry no GST', () => {
    assertEqual(totalsOf([{ quantity: 1, unitAmountCents: 16500, taxExempt: true }]).gstCents, 0, 'exempt line');
    assertEqual(totalsOf([{ quantity: 1, unitAmountCents: 16500 }], false).gstCents, 0, 'not registered');
  });

  test('Invoicing: amounts typed with symbols and commas parse correctly', () => {
    assertEqual(INV.centsFromInput('165'), 16500, 'plain');
    assertEqual(INV.centsFromInput('$165.50'), 16550, 'dollar sign');
    assertEqual(INV.centsFromInput('1,234.56'), 123456, 'thousands separator');
    assertEqual(INV.centsFromInput(''), 0, 'empty');
    assertEqual(INV.centsFromInput('abc'), 0, 'garbage');
  });

  test('Invoicing: dates are local calendar dates, not UTC instants', () => {
    // Regression: toISOString() converts to UTC first, so anywhere east of
    // Greenwich an invoice raised before ~10am was dated the previous day and
    // a 14-day term landed a day early.
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    assertEqual(INV.todayISO(), expected, "today must match the technician's own calendar date");
    assertEqual(INV.addDaysISO('2026-08-19', 14), '2026-09-02', '14 day term across a month boundary');
    assertEqual(INV.addDaysISO('2026-12-31', 1), '2027-01-01', 'year rollover');
    assertEqual(INV.addDaysISO('2028-02-28', 1), '2028-02-29', 'leap day');
  });

  test('Invoicing: invoice numbers increment within the year', () => {
    const year = new Date().getFullYear();
    assertEqual(INV.nextInvoiceNumber([]), `INV-${year}-0001`, 'first invoice');
    assertEqual(INV.nextInvoiceNumber([{ number: `INV-${year}-0007` }]), `INV-${year}-0008`, 'after 7');
    // A prior year's numbering must not bleed into this year's sequence.
    assertEqual(INV.nextInvoiceNumber([{ number: `INV-${year - 1}-0099` }]), `INV-${year}-0001`, 'ignores last year');
  });

  test('UI: creating an invoice prefills from the job and report', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Invoice Prefill Job', address: '42 Bill St' });
    await win.DB.updateJob(job.id, { status: 'completed' });
    await win.DB.saveReport({
      jobId: job.id,
      sections: { clientDetails: { clientName: 'A Client', clientEmail: 'a@example.com', propertyAddress: '42 Bill St' } },
      finalizedAt: Date.now(),
    });

    await win.InvoiceUI.open(job.id);
    await wait(350);

    assert(!doc.getElementById('view-invoice').classList.contains('hidden'), 'invoice view should be showing');
    assertEqual(doc.getElementById('invoice-client-name').value, 'A Client', 'client name prefilled');
    assertEqual(doc.getElementById('invoice-property').value, '42 Bill St', 'property prefilled');
    assert(doc.querySelectorAll('.invoice-line').length >= 1, 'should start with a default line item');

    const saved = await win.DB.getInvoicesForJob(job.id);
    assertEqual(saved.length, 1, 'invoice should be persisted on open');
    assert(/^INV-\d{4}-\d{4}$/.test(saved[0].number), `unexpected invoice number: ${saved[0].number}`);
  });

  // =====================================================================
  // Scheduler — booking a job into the diary, and the backlog of work that
  // is due or unbooked. The distinction that matters: a job can be DUE
  // without being BOOKED, and a calendar showing only bookings hides
  // exactly the jobs still needing action.
  // =====================================================================

  test('Scheduler: a new job can be booked at creation and persists the time', async () => {
    const win = frame.contentWindow;
    const when = dayThisMonth(3, 14);
    when.setMinutes(30);
    const job = await win.DB.addJob({ name: 'Booked Job', scheduledAt: when.getTime() });
    const saved = await win.DB.getJob(job.id);
    assertEqual(saved.scheduledAt, when.getTime(), 'scheduledAt should persist exactly');
    assertEqual(saved.scheduledDurationMins, 60, 'duration should default to 60 min');
  });

  test('Scheduler: an unbooked job stores null, not a guessed date', async () => {
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Unbooked Job' });
    const saved = await win.DB.getJob(job.id);
    assert(saved.scheduledAt === null, 'unbooked jobs must stay null so the backlog can find them');
  });

  test('Scheduler: the month grid shows how many jobs and hours are in a day', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const gridDay = quietDay();
    const d = dayThisMonth(gridDay, 11);
    // Two jobs totalling 3 hours, so the cell has to report both numbers.
    await win.DB.addJob({ name: 'Grid Load A', scheduledAt: d.getTime(), scheduledDurationMins: 120 });
    const d2 = new Date(d);
    d2.setHours(14, 0, 0, 0);
    await win.DB.addJob({ name: 'Grid Load B', scheduledAt: d2.getTime(), scheduledDurationMins: 60 });

    await win.Scheduler.open();
    await wait(400);
    const cell = Array.from(doc.querySelectorAll('.cal-cell:not(.cal-blank)'))
      .find((c) => c.querySelector('.cal-daynum').textContent === String(gridDay));
    assert(cell, 'the chosen day should be in the grid');
    const load = cell.querySelector('.cal-load');
    assert(load, 'a booked day should show its load');
    assertEqual(load.textContent, '2·3h', 'two jobs totalling three hours');
    assert(cell.querySelector('.cal-bar-fill'), 'a booked day should show a load bar');
    assert(doc.querySelector('.cal-today'), 'today should be marked');
  });

  test('Scheduler: the day view lays out hourly slots and spans long jobs', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const d = dayThisMonth(6, 10);
    await win.DB.addJob({ name: 'Long Job', scheduledAt: d.getTime(), scheduledDurationMins: 120 });

    await win.Scheduler.open();
    await wait(300);
    Array.from(doc.querySelectorAll('.cal-cell:not(.cal-blank)'))
      .find((c) => c.querySelector('.cal-daynum').textContent === String(dayThisMonth(6).getDate())).click();
    await wait(300);

    const rows = Array.from(doc.querySelectorAll('.slot-row')).map((r) => r.textContent);
    assert(rows.length >= 11, `expected a full working day of slots, got ${rows.length}`);
    assert(rows.some((r) => r.includes('10am') && r.includes('Long Job')), 'job appears in its start slot');
    assert(rows.some((r) => r.includes('11am') && /continues/.test(r)), 'a 2h job occupies the next hour too');
    assert(doc.querySelectorAll('.slot-free').length > 0, 'free slots should be visible and bookable');
    assert(/2 hrs/.test(doc.getElementById('scheduler-day-load').textContent),
      `day load should total the hours, got: ${doc.getElementById('scheduler-day-load').textContent}`);
  });

  test('Scheduler: opening a job from the day view leaves the scheduler behind, not stacked underneath', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const d = dayThisMonth(7, 9);
    const job = await win.DB.addJob({ name: 'Jump From Scheduler Job', scheduledAt: d.getTime() });

    await win.Scheduler.open();
    await wait(300);
    Array.from(doc.querySelectorAll('.cal-cell:not(.cal-blank)'))
      .find((c) => c.querySelector('.cal-daynum').textContent === String(dayThisMonth(7).getDate())).click();
    await wait(300);
    Array.from(doc.querySelectorAll('.slot-job'))
      .find((b) => b.textContent.includes('Jump From Scheduler Job')).click();
    await wait(200);

    // showJobView only ever hid viewJobList before this fix — reached from
    // anywhere else (the scheduler's day view, invoice-ui.js's "back to
    // job"), the previous screen stayed visible underneath the job view.
    const visible = Array.from(doc.querySelectorAll('.view'))
      .filter((v) => !v.classList.contains('hidden'));
    assertEqual(visible.length, 1, `exactly one view should be visible, got: ${visible.map((v) => v.id).join(', ')}`);
    assertEqual(visible[0].id, 'view-job', 'the job view should be the one showing');
    assert(job.id, 'sanity: the job was actually created');
  });

  test('Auth: logging out while on the scheduler does not leave it showing behind the login screen', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;

    await win.Scheduler.open();
    await wait(200);
    assert(!doc.getElementById('view-scheduler').classList.contains('hidden'), 'sanity: scheduler is open');

    // showLoginView used a hand-picked list of views to hide that predated
    // the scheduler and invoice screens — logging out (or a session
    // expiring) from either used to leave it showing underneath the login
    // form, which is a client's job/invoice details visible on a device
    // that just signed out, not just a cosmetic glitch.
    win.showLoginView();
    await wait(50);

    const visible = Array.from(doc.querySelectorAll('.view'))
      .filter((v) => !v.classList.contains('hidden'));
    assertEqual(visible.length, 1, `exactly one view should be visible, got: ${visible.map((v) => v.id).join(', ')}`);
    assertEqual(visible[0].id, 'view-login', 'the login view should be the one showing');
  });

  test('Scheduler: booking into a chosen slot uses that hour and duration', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    await win.DB.addJob({ name: 'Slot Pick Job' });

    await win.Scheduler.open();
    await wait(300);
    Array.from(doc.querySelectorAll('.cal-cell:not(.cal-blank)'))
      .find((c) => c.querySelector('.cal-daynum').textContent === String(dayThisMonth(7).getDate())).click();
    await wait(300);

    const pmRow = Array.from(doc.querySelectorAll('.slot-row'))
      .find((r) => r.textContent.startsWith('3pm') && r.querySelector('.slot-free'));
    assert(pmRow, '3pm should be free on the 17th');
    pmRow.querySelector('.slot-free').click();
    await wait(300);

    assert(!doc.getElementById('slot-picker-modal').classList.contains('hidden'), 'picker should open');
    doc.getElementById('slot-picker-duration').value = '90';
    const row = Array.from(doc.querySelectorAll('.picker-row')).find((r) => r.textContent.includes('Slot Pick Job'));
    assert(row, 'the unbooked job should be offered');
    row.click();
    await wait(600);

    const saved = (await win.DB.getJobs()).find((j) => j.name === 'Slot Pick Job');
    assertEqual(new Date(saved.scheduledAt).getHours(), 15, 'booked into the 3pm slot');
    assertEqual(new Date(saved.scheduledAt).getDate(), 7, 'booked onto the selected day');
    assertEqual(saved.scheduledDurationMins, 90, 'duration from the picker');
    assert(doc.getElementById('slot-picker-modal').classList.contains('hidden'), 'picker should close');
  });

  test('Scheduler: booking from the backlog fills the selected day and avoids a clash', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    await win.DB.addJob({ name: 'Backlog A' });
    await win.DB.addJob({ name: 'Backlog B' });

    await win.Scheduler.open();
    await wait(400);

    // Pick a day well clear of the seeded bookings.
    const cell = Array.from(doc.querySelectorAll('.cal-cell:not(.cal-blank)'))
      .find((c) => c.querySelector('.cal-daynum').textContent === String(dayThisMonth(8).getDate()));
    cell.click();
    await wait(200);

    const rowFor = (name) => Array.from(doc.querySelectorAll('#scheduler-backlog .backlog-row'))
      .find((r) => r.textContent.includes(name));

    assert(rowFor('Backlog A'), 'unbooked job should appear in the backlog');
    rowFor('Backlog A').querySelector('.backlog-book').click();
    await wait(500);
    rowFor('Backlog B').querySelector('.backlog-book').click();
    await wait(500);

    const jobs = await win.DB.getJobs();
    const a = jobs.find((j) => j.name === 'Backlog A');
    const b = jobs.find((j) => j.name === 'Backlog B');
    assert(a.scheduledAt, 'Backlog A should now be booked');
    assert(b.scheduledAt, 'Backlog B should now be booked');
    assertEqual(new Date(a.scheduledAt).getDate(), 8, 'booked onto the selected day');
    // One-tap Book starts from 8am rather than the 7am start of the grid, so
    // an empty day does not put a client in at 7 just because the slot exists.
    assertEqual(new Date(a.scheduledAt).getHours(), 8, 'first booking takes the default start hour');
    assertEqual(new Date(b.scheduledAt).getHours(), 9, 'second booking steps past the clash');

    assert(!rowFor('Backlog A'), 'a booked job should leave the backlog');
  });

  test('Scheduler: booked jobs drop out of the backlog', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const d = dayThisMonth(9);
    await win.DB.addJob({ name: 'Already Booked', scheduledAt: d.getTime() });
    await win.Scheduler.open();
    await wait(400);
    const inBacklog = Array.from(doc.querySelectorAll('#scheduler-backlog .backlog-row'))
      .some((r) => r.textContent.includes('Already Booked'));
    assert(!inBacklog, 'a job with a booking is not waiting to be booked');
  });

  test('Scheduler: an overdue job the reminder email did not fix reads as "call to rebook"', async () => {
    // The two-stage policy: an email goes out automatically, but the moment
    // it demonstrably didn't work (the due date has now passed anyway),
    // this becomes a human's job to chase, not the software's.
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const dueAt = Date.now() - 5 * 86400000; // 5 days overdue
    // addJob's parameter list is an explicit whitelist that doesn't include
    // nextDueAt/reminderSentForDueAt (real jobs only ever get these via
    // updateJob, from finalizing a report or send-due-reminders) — set them
    // the same way here rather than relying on addJob silently accepting them.
    const job = await win.DB.addJob({ name: 'Needs A Call Job' });
    await win.DB.updateJob(job.id, { nextDueAt: dueAt, reminderSentForDueAt: dueAt });

    await win.Scheduler.open();
    await wait(400);
    const row = Array.from(doc.querySelectorAll('#scheduler-backlog .backlog-row'))
      .find((r) => r.textContent.includes('Needs A Call Job'));
    assert(row, 'an overdue, unrebooked job still belongs in the backlog');
    assert(/call to rebook/i.test(row.textContent), 'the email having already gone out and failed must read differently to plain overdue');
    assert(row.querySelector('.backlog-needs-call'), 'and get the stronger visual treatment, not just different words');
  });

  test('Scheduler: overdue with no reminder sent yet still reads as plain overdue', async () => {
    // Guards the other side of the same rule: a job must not read as
    // "call to rebook" just because it's overdue — only once the email
    // path has actually been tried and failed.
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const dueAt = Date.now() - 5 * 86400000;
    const job = await win.DB.addJob({ name: 'Plain Overdue Job' });
    await win.DB.updateJob(job.id, { nextDueAt: dueAt });

    await win.Scheduler.open();
    await wait(400);
    const row = Array.from(doc.querySelectorAll('#scheduler-backlog .backlog-row'))
      .find((r) => r.textContent.includes('Plain Overdue Job'));
    assert(row, 'sanity check: it is in the backlog at all');
    assert(!/call to rebook/i.test(row.textContent), 'no reminder was ever sent for this due date, so nothing has "failed" yet');
    assert(!row.querySelector('.backlog-needs-call'), 'and it must not get the escalated styling either');
  });

  // =====================================================================
  // Booking assistant. The model runs server-side but every tool executes
  // here against the local database, so these stub the transport and assert
  // on what the client actually computes and writes.
  // =====================================================================

  // Supabase exposes `functions` as a lazily-created property, so replacing
  // the whole property is what actually intercepts the call.
  function stubAgentTransport(win, script) {
    // Test mode deliberately has no Supabase client (sync is off so the suite
    // can never touch production), so provide a bare object to hang the stub
    // on. The assistant resolves its client lazily for exactly this reason.
    if (!win.supabaseClient) win.supabaseClient = {};
    const original = Object.getOwnPropertyDescriptor(win.supabaseClient, 'functions');
    const captured = [];
    let round = 0;
    Object.defineProperty(win.supabaseClient, 'functions', {
      configurable: true,
      value: {
        invoke: async (fn, opts) => {
          captured.push(opts.body.messages);
          return { data: script(++round) };
        },
      },
    });
    return {
      captured,
      restore: () => { if (original) Object.defineProperty(win.supabaseClient, 'functions', original); },
      toolResults: () => {
        const last = captured[captured.length - 1] || [];
        const out = [];
        for (const m of last) {
          if (m.role === 'user' && Array.isArray(m.content)) {
            for (const c of m.content) if (c.type === 'tool_result') out.push(JSON.parse(c.content));
          }
        }
        return out;
      },
    };
  }

  const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  async function askAgent(win, doc, text) {
    doc.getElementById('agent-input').value = text;
    doc.getElementById('agent-send').click();
    await wait(1100);
  }

  test('Assistant: reading free slots excludes the hours a long job occupies', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    assert(win.ScheduleAgent, 'the booking assistant should be loaded');

    const day = dayThisMonth(10);
    const job = await win.DB.addJob({ name: 'Agent Slot Job', address: '1 Agent St' });
    await win.DB.updateJob(job.id, { scheduledAt: day.getTime(), scheduledDurationMins: 120 });

    await win.Scheduler.open();
    await wait(250);
    doc.getElementById('agent-open').click();
    win.ScheduleAgent.reset();

    const iso = localISO(day);
    const stub = stubAgentTransport(win, (round) => round === 1
      ? { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'x1', name: 'find_free_slots', input: { date: iso, durationMins: 60 } }] }
      : { stopReason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });
    try {
      await askAgent(win, doc, 'when am I free that day');
      const [slots] = stub.toolResults();
      assert(slots, 'find_free_slots should have run');
      assert(!slots.freeStartTimes.includes('9am'), '9am is taken by the job itself');
      assert(!slots.freeStartTimes.includes('10am'), '10am is taken by the 2nd hour of a 2h job');
      assert(slots.freeStartTimes.includes('11am'), '11am should be offered');
      assertEqual(slots.alreadyBookedHours, 2, 'hours already booked');
    } finally { stub.restore(); }
  });

  test('Assistant: a proposed booking writes nothing until it is confirmed', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Agent Confirm Job', address: '2 Agent St' });
    const day = dayThisMonth(11);

    await win.Scheduler.open();
    await wait(250);
    doc.getElementById('agent-open').click();
    win.ScheduleAgent.reset();

    const stub = stubAgentTransport(win, (round) => round === 1
      ? { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'b1', name: 'book_job',
          input: { jobId: job.id, dateTime: `${localISO(day)}T14:00`, durationMins: 90 } }] }
      : { stopReason: 'end_turn', content: [{ type: 'text', text: 'done' }] });
    try {
      await askAgent(win, doc, 'book it');
      assert(doc.querySelector('.agent-confirm'), 'a confirmation card should be shown');
      const before = await win.DB.getJob(job.id);
      assert(!before.scheduledAt, 'nothing may be written before the technician answers');

      doc.querySelector('.agent-confirm .btn-primary').click();
      await wait(900);

      const after = await win.DB.getJob(job.id);
      assert(after.scheduledAt, 'confirming should book it');
      assertEqual(new Date(after.scheduledAt).getHours(), 14, 'booked at the proposed hour');
      assertEqual(after.scheduledDurationMins, 90, 'booked for the proposed duration');
    } finally { stub.restore(); }
  });

  test('Assistant: declining leaves the job unbooked and says so to the model', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Agent Decline Job' });
    const day = dayThisMonth(12);

    await win.Scheduler.open();
    await wait(250);
    doc.getElementById('agent-open').click();
    win.ScheduleAgent.reset();

    const stub = stubAgentTransport(win, (round) => round === 1
      ? { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 'b2', name: 'book_job',
          input: { jobId: job.id, dateTime: `${localISO(day)}T10:00`, durationMins: 60 } }] }
      : { stopReason: 'end_turn', content: [{ type: 'text', text: 'no worries' }] });
    try {
      await askAgent(win, doc, 'book it');
      doc.querySelector('.agent-confirm .btn-secondary').click();
      await wait(900);

      const after = await win.DB.getJob(job.id);
      assert(!after.scheduledAt, 'declining must not book anything');
      const results = stub.toolResults();
      const declined = results.find((r) => r && r.booked === false);
      assert(declined, 'the model must be told the booking did not happen');
      assert(/declined/i.test(declined.reason), `reason should say it was declined, got: ${declined.reason}`);
    } finally { stub.restore(); }
  });

  test('Assistant: search finds a job by address, not just by name', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    await win.DB.addJob({ name: 'Zzz Unrelated Name', address: '99 Findme Parade, Leumeah' });

    await win.Scheduler.open();
    await wait(250);
    doc.getElementById('agent-open').click();
    win.ScheduleAgent.reset();

    const stub = stubAgentTransport(win, (round) => round === 1
      ? { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 's1', name: 'search_jobs', input: { query: 'findme parade' } }] }
      : { stopReason: 'end_turn', content: [{ type: 'text', text: 'found it' }] });
    try {
      await askAgent(win, doc, 'find the findme parade job');
      const [res] = stub.toolResults();
      assert(res && res.matches.length, 'should match on address');
      assertEqual(res.matches[0].name, 'Zzz Unrelated Name', 'returns the right job');
      assert(res.matches[0].jobId, 'returns an id the model can book with');
    } finally { stub.restore(); }
  });

  // =====================================================================
  // Navigation and the inspection controls — the things a technician taps
  // most, and where "nothing happened" was reported from the field.
  // =====================================================================

  test('Navigation: exactly one view is ever on screen', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Nav Job' });
    await win.DB.updateJob(job.id, { status: 'review' });

    const visible = () => Array.from(doc.querySelectorAll('.view'))
      .filter((v) => !v.classList.contains('hidden')).map((v) => v.id);

    // Regression: report.js hid a hardcoded list of views that never gained
    // the scheduler or invoice screens, so opening the archive from the
    // scheduler left the scheduler on screen underneath.
    const hops = [
      ['scheduler', () => win.Scheduler.open()],
      ['archive', () => win.ReportUI.openArchive()],
      ['scheduler', () => win.Scheduler.open()],
      ['report', () => win.ReportUI.openReview(job.id)],
      ['invoice', () => win.InvoiceUI.open(job.id)],
      ['archive', () => win.ReportUI.openArchive()],
      ['job list', () => win.showJobListView()],
    ];
    for (const [label, go] of hops) {
      await go();
      await wait(250);
      const open = visible();
      assertEqual(open.length, 1, `after opening ${label}, expected one visible view, got [${open.join(', ')}]`);
    }
  });

  test('Start Inspection: blocked camera permission is reported without asking', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Perm Blocked Job' });
    await win.showJobViewById(job.id);
    await wait(300);

    const origPerm = win.navigator.permissions.query;
    const origGum = win.navigator.mediaDevices.getUserMedia;
    let askedForCamera = false;
    try {
      win.navigator.permissions.query = async () => ({ state: 'denied' });
      win.navigator.mediaDevices.getUserMedia = async () => { askedForCamera = true; return new win.MediaStream(); };

      doc.getElementById('start-inspection-btn').click();
      await wait(500);

      assert(!askedForCamera, 'should not request a camera it already knows is blocked');
      assert(/blocked|settings/i.test(doc.getElementById('toast').textContent),
        `expected an actionable permission message, got: "${doc.getElementById('toast').textContent}"`);
      assert(!doc.getElementById('start-inspection-btn').disabled, 'the button must stay usable');
    } finally {
      win.navigator.permissions.query = origPerm;
      win.navigator.mediaDevices.getUserMedia = origGum;
    }
  });

  test('Start Inspection: a slow permission prompt can be cancelled, not just endured', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Slow Prompt Cancel Job' });
    await win.showJobViewById(job.id);
    await wait(300);

    const origPerm = win.navigator.permissions.query;
    const origGum = win.navigator.mediaDevices.getUserMedia;
    const btn = doc.getElementById('start-inspection-btn');
    try {
      // The technician is still reading the OS permission sheet: the request
      // never settles. A fixed 15s deadline used to fail a camera that was
      // about to work, so the wait is now long AND escapable.
      win.navigator.permissions.query = async () => ({ state: 'prompt' });
      win.navigator.mediaDevices.getUserMedia = () => new Promise(() => {});

      btn.click();
      await wait(600);
      assert(!btn.disabled, 'the button must stay tappable while waiting');
      assert(/cancel/i.test(btn.textContent), `button should offer a way out, got: "${btn.textContent}"`);

      btn.click(); // second tap cancels
      await wait(700);
      assertEqual(btn.textContent, '▶ Start Inspection', 'cancelling restores the button');
      assert(!btn.disabled, 'button usable again after cancelling');
      assert(doc.getElementById('inspection-modal').classList.contains('hidden'), 'no recording modal left open');
    } finally {
      win.navigator.permissions.query = origPerm;
      win.navigator.mediaDevices.getUserMedia = origGum;
    }
  });

  test('Inspection: a full start-to-finish run captures photos and opens the report', async () => {
    // Inspections are photo-only: no MediaRecorder, no footage row. What has
    // to hold is that the camera opens, each still is saved against the zone
    // the technician typed, and Finish moves the job to review and opens the
    // report — with the camera actually released rather than left running.
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Full Run Job' });
    await win.showJobViewById(job.id);
    await wait(300);

    // A genuine MediaStream from a canvas, so the real capture path runs and
    // the still button has actual pixels to grab — no camera required.
    function realishStream() {
      const c = win.document.createElement('canvas');
      c.width = 320; c.height = 240;
      const ctx = c.getContext('2d');
      let f = 0;
      const t = win.setInterval(() => { ctx.fillStyle = `hsl(${f++ % 360},70%,45%)`; ctx.fillRect(0, 0, 320, 240); }, 50);
      const s = c.captureStream(15);
      s.__cleanup = () => win.clearInterval(t);
      return s;
    }

    const origPerm = win.navigator.permissions.query;
    const origGum = win.navigator.mediaDevices.getUserMedia;
    let made = null;
    let askedForAudio = null;
    try {
      win.navigator.permissions.query = async () => ({ state: 'granted' });
      win.navigator.mediaDevices.getUserMedia = async (constraints) => {
        askedForAudio = constraints && constraints.audio;
        made = realishStream();
        return made;
      };

      doc.getElementById('start-inspection-btn').click();
      await wait(2200);
      assert(!doc.getElementById('inspection-modal').classList.contains('hidden'), 'camera modal should open');
      assertEqual((await win.DB.getJob(job.id)).status, 'in_progress', 'job goes in_progress');
      // Photo capture has no use for the microphone, and not asking for it is
      // one less permission prompt inside a client's home.
      assertEqual(askedForAudio, false, 'the microphone is not requested');
      // Zone tagging for the photos taken after the cover shot.
      // Photograph two subjects, tagging the zone for each.
      const zoneInput = doc.getElementById('inspection-zone-input');
      const setValue = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new win.Event('input', { bubbles: true }));
      };

      // The job now opens on one instruction: photograph the front of the
      // property. That first shot is the cover, so it takes its own zone and
      // the zone box only matters from the second shot on.
      assert(!doc.getElementById('inspection-prompt').classList.contains('hidden'),
        'the front-of-property prompt is showing');
      doc.getElementById('inspection-still-btn').click();
      await wait(1200);
      assert(doc.getElementById('inspection-prompt').classList.contains('hidden'),
        'and it clears once that photo is taken');

      // Then photograph two subjects, tagging the zone for each.
      setValue(zoneInput, 'Subfloor');
      doc.getElementById('inspection-still-btn').click();
      await wait(1500);
      setValue(zoneInput, 'Roof Void');
      doc.getElementById('inspection-still-btn').click();
      await wait(1800);

      const shots = await win.DB.getCaptures(job.id);
      assertEqual(shots.length, 3, 'all three photos are saved');
      const zones = shots.map((c) => c.zone).sort();
      assertEqual(zones.join(','), 'Front Elevation,Roof Void,Subfloor',
        'each photo keeps the zone it was taken in');
      assertEqual(shots.filter((c) => c.isFrontElevation).length, 1,
        'exactly one shot is marked as the front elevation');
      assert(shots.every((c) => c.photoBlob && c.photoBlob.size > 0), 'photos are not empty');

      doc.getElementById('inspection-finish-btn').click();
      await wait(4000);

      const after = await win.DB.getJob(job.id);
      assertEqual(after.status, 'review', 'job moves to review');
      assert(after.inspectionEndedAt, 'the finish time is recorded');
      assertEqual((await win.DB.getFootage(job.id)).length, 0, 'no video is recorded any more');
      assert(doc.getElementById('inspection-modal').classList.contains('hidden'), 'modal closes');
      assert(!doc.getElementById('finish-inspection-btn').disabled, 'finish button is usable again');
      assert(made.getTracks().every((t) => t.readyState === 'ended'), 'the camera is released, not left running');
    } finally {
      if (made && made.__cleanup) made.__cleanup();
      win.navigator.permissions.query = origPerm;
      win.navigator.mediaDevices.getUserMedia = origGum;
    }
  });

  test('Inspection: the photo checklist tags captures and files them into the report', async () => {
    // Replaces the old live-video walkthrough with a per-job-type checklist
    // (photo-checklists.js). Tapping a chip should behave exactly like typing
    // that label into the zone box, and a checklist item naming a schema
    // field should end up in the report once the inspection finishes.
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Checklist Run Job', jobType: 'termite' });
    await win.showJobViewById(job.id);
    await wait(300);

    function realishStream() {
      const c = win.document.createElement('canvas');
      c.width = 320; c.height = 240;
      const ctx = c.getContext('2d');
      let f = 0;
      const t = win.setInterval(() => { ctx.fillStyle = `hsl(${f++ % 360},70%,45%)`; ctx.fillRect(0, 0, 320, 240); }, 50);
      const s = c.captureStream(15);
      s.__cleanup = () => win.clearInterval(t);
      return s;
    }

    const origPerm = win.navigator.permissions.query;
    const origGum = win.navigator.mediaDevices.getUserMedia;
    let made = null;
    try {
      win.navigator.permissions.query = async () => ({ state: 'granted' });
      win.navigator.mediaDevices.getUserMedia = async () => { made = realishStream(); return made; };

      doc.getElementById('start-inspection-btn').click();
      await wait(2200);

      // Front photo first, same as every inspection.
      doc.getElementById('inspection-still-btn').click();
      await wait(1200);

      const row = doc.getElementById('inspection-checklist-row');
      assert(!row.classList.contains('hidden'), 'the checklist row shows for a termite job');
      const meterBoxChip = Array.from(row.querySelectorAll('.inspection-checklist-chip'))
        .find((c) => /Meter Box/.test(c.textContent));
      assert(meterBoxChip, 'Meter Box is one of the termite checklist items');
      assert(!meterBoxChip.classList.contains('done'), 'not done before any photo is taken against it');

      meterBoxChip.click();
      assertEqual(doc.getElementById('inspection-zone-input').value, 'Meter Box',
        'tapping a checklist chip fills the zone box exactly like typing it');
      doc.getElementById('inspection-still-btn').click();
      await wait(1500);

      const chipAfter = Array.from(row.querySelectorAll('.inspection-checklist-chip'))
        .find((c) => /Meter Box/.test(c.textContent));
      assert(chipAfter.classList.contains('done'), 'the chip marks itself done once a photo exists for it');

      doc.getElementById('inspection-finish-btn').click();
      await wait(4000);

      const report = await win.DB.getReport(job.id);
      const photos = report.sections.findings.durableNoticePhotos;
      assert(Array.isArray(photos) && photos.length === 1,
        'the Meter Box checklist photo is filed into findings.durableNoticePhotos');
    } finally {
      if (made && made.__cleanup) made.__cleanup();
      win.navigator.permissions.query = origPerm;
      win.navigator.mediaDevices.getUserMedia = origGum;
    }
  });

  test('AI Draft: applyAiDraft merges per section instead of replacing the whole draft', async () => {
    // The real bug this guards: attachChecklistPhotos calls applyAiDraft once
    // per section (each analyzed against only its own photos). If a later
    // call replaced report.aiDraft wholesale instead of merging, section two's
    // suggestions would silently erase section one's.
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'AI Merge Job', jobType: 'termite' });

    await win.ReportUI.applyAiDraft(job.id, {
      draftFields: { findings: { durableNoticeFound: 'Yes' } },
      fieldReasons: { findings: { durableNoticeFound: 'sticker visible in meter box photo' } },
    });
    await win.ReportUI.applyAiDraft(job.id, {
      draftFields: { conducive: { siteDrainage: 'Adequate' } },
      fieldReasons: { conducive: { siteDrainage: 'visible fall away from the slab' } },
    });

    const report = await win.DB.getReport(job.id);
    assertEqual(report.aiDraft.draftFields.findings.durableNoticeFound, 'Yes',
      'the first section\'s suggestion survives a later call for a different section');
    assertEqual(report.aiDraft.draftFields.conducive.siteDrainage, 'Adequate',
      'the second section\'s suggestion is also present');
    assert(report.aiDraft.fieldReasons.findings.durableNoticeFound, 'reasons merge the same way as draftFields');
  });

  test('AI Draft: attachChecklistPhotos files photos without calling AI (whole-report Generate Form does that)', async () => {
    // Photo organization and AI drafting are deliberately separate now:
    // attachChecklistPhotos only routes a checklist item's photos into the
    // report field it names (photo-checklists.js's schemaSection/schemaField).
    // Drafting the report from photos is a single whole-report pass, wired to
    // the "Generate Form" button (finishInspection in app.js) via
    // window.AI.analyzeInspectionPhotos + applyAiDraft — not called from here.
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Checklist Filing Job', jobType: 'termite' });
    const blob = new win.Blob(['x'], { type: 'image/jpeg' });
    await win.DB.addCapture({ jobId: job.id, zone: 'Meter Box', type: 'photo', photoBlob: blob });

    let sectionAiCalled = false;
    const origAI = win.AI;
    win.AI = { analyzeSectionPhotos: async () => { sectionAiCalled = true; return {}; } };
    try {
      await win.ReportUI.attachChecklistPhotos(job.id);
    } finally {
      win.AI = origAI;
    }

    assert(!sectionAiCalled, 'attachChecklistPhotos must not call analyzeSectionPhotos any more');
    const report = await win.DB.getReport(job.id);
    const photos = report.sections.findings.durableNoticePhotos;
    assert(Array.isArray(photos) && photos.length === 1,
      'the Meter Box photo is still filed into findings.durableNoticePhotos');
    assert(!report.aiDraft, 'no AI draft is produced by filing alone');
  });

  test('AI Draft: Identify Pest button reads photos and offers to apply a matched category', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Identify Pest Job', jobType: 'pest_treatment' });
    await win.ReportUI.openReview(job.id);
    await wait(200);
    openReportSection(doc, 'Pest Identification');
    await wait(200);

    const fileInput = doc.querySelector('.photo-field input[type="file"]');
    assert(fileInput, 'photo field file input should render');
    const file = new win.File(['x'], 'bug.jpg', { type: 'image/jpeg' });
    const dt = new win.DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(200);

    let calledWith = null;
    const origAI = win.AI;
    win.AI = {
      identifyPest: async (blobs, options) => {
        calledWith = { count: blobs.length, options };
        return {
          identifications: [{
            commonName: 'German Cockroach', scientificName: 'Blattella germanica',
            confidence: 'high', reasoning: 'test', matchedCategory: 'German Cockroaches',
          }],
        };
      },
    };
    try {
      const identifyBtn = Array.from(doc.querySelectorAll('button')).find((b) => b.textContent.includes('Identify Pest'));
      assert(identifyBtn, 'Identify Pest button should render for pestPhotos');
      identifyBtn.click();
      await wait(200);

      assert(calledWith, 'window.AI.identifyPest was called');
      assertEqual(calledWith.count, 1, 'the one added photo is sent');
      assert(calledWith.options.includes('German Cockroaches'), 'targetPests options are passed through');

      const card = doc.querySelector('.identify-pest-card');
      assert(card && card.textContent.includes('German Cockroach'), 'the identification renders');

      const applyBtn = doc.querySelector('.identify-pest-apply');
      assert(applyBtn, 'an apply button renders for the matched category');
      applyBtn.click();
      await wait(200);

      const checked = Array.from(doc.querySelectorAll('.checkbox-chip'))
        .find((chip) => chip.textContent.includes('German Cockroaches'))
        .querySelector('input[type="checkbox"]');
      assert(checked && checked.checked, 'German Cockroaches is ticked in Target Pest(s) after applying');
    } finally {
      win.AI = origAI;
    }
  });

  test('AI Draft: Identify Tree button reads tree photos and adds findings to the notes field', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Identify Tree Job', jobType: 'termite' });
    await win.ReportUI.openReview(job.id);
    await wait(200);
    const li = Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
      .find((el) => el.textContent.includes('Conducive Conditions'));
    assert(li, 'Conducive Conditions section should be in the list');
    li.click();
    await wait(200);

    const fileInputs = doc.querySelectorAll('.photo-field input[type="file"]');
    const treeFileInput = fileInputs[1]; // conducivePhotos is first, treePhotos second
    assert(treeFileInput, 'tree photo field should render');
    const file = new win.File(['x'], 'tree.jpg', { type: 'image/jpeg' });
    const dt = new win.DataTransfer();
    dt.items.add(file);
    treeFileInput.files = dt.files;
    treeFileInput.dispatchEvent(new win.Event('change', { bubbles: true }));
    await wait(200);

    let calledCount = null;
    const origAI = win.AI;
    win.AI = {
      identifyTree: async (blobs) => {
        calledCount = blobs.length;
        return {
          trees: [{
            species: 'Sydney Blue Gum (Eucalyptus saligna)', susceptibility: 'high',
            confidence: 'medium', reasoning: 'Visible trunk hollowing and dead limbs.', recommendDrilling: true,
          }],
        };
      },
    };
    try {
      const identifyBtn = Array.from(doc.querySelectorAll('button')).find((b) => b.textContent.includes('Identify Tree'));
      assert(identifyBtn, 'Identify Tree button should render for treePhotos');
      identifyBtn.click();
      await wait(400);

      assertEqual(calledCount, 1, 'the one added tree photo is sent');
      const card = doc.querySelector('.identify-pest-card');
      assert(card, 'the tree identification card renders');
      assert(card && card.textContent.includes('Sydney Blue Gum'), 'the tree identification renders');
      assert(card && card.textContent.includes('drilling'), 'the drilling recommendation shows when flagged');

      const applyBtn = doc.querySelector('.identify-pest-apply');
      applyBtn.click();
      await wait(300);

      const notesTextarea = Array.from(doc.querySelectorAll('textarea'))
        .find((ta) => (ta.closest('.field-row') || {}).textContent?.includes('Tree Species'));
      assert(notesTextarea, 'the tree assessment notes field should render');
      assert(notesTextarea.value.includes('Sydney Blue Gum'), 'the finding is added to the notes field');
      assert(notesTextarea.value.includes('high termite susceptibility'), 'the susceptibility is recorded in the notes');
    } finally {
      win.AI = origAI;
    }
  });

  test('Site sketch: pest stamps number themselves and survive a save/reopen as data', async () => {
    // The markers are the part a client actually reads, so two things have to
    // hold: numbering is automatic (a technician must never have to think
    // about it), and reopening the section gives back live markers to move,
    // not a flat picture of them.
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Sketch Stamp Job', jobType: 'termite' });
    await win.ReportUI.openReview(job.id);
    await wait(300);
    const openSketch = () => {
      const li = Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
        .find((el) => el.textContent.includes('Site Sketch'));
      assert(li, 'Site Sketch section should be listed');
      li.click();
    };
    openSketch();
    await wait(700);

    assert(doc.querySelector('.sketch-canvas'), 'sketch canvas should render');
    const stampBtn = (text) => Array.from(doc.querySelectorAll('button'))
      .find((b) => b.textContent.trim() === text);
    // Re-queried every tap: reopening the section builds a brand new canvas,
    // and a captured reference would be clicking a detached node.
    const tap = (fx, fy) => {
      const canvas = doc.querySelector('.sketch-canvas');
      const r = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new win.MouseEvent('click', {
        bubbles: true,
        clientX: r.left + r.width * fx,
        clientY: r.top + r.height * fy,
      }));
    };

    assert(stampBtn('Drill point'), 'the drill point stamp is offered');
    assert(stampBtn('Hot water'), 'the hot water system stamp is offered');
    assert(stampBtn('Air con'), 'the air conditioner stamp is offered');

    stampBtn('Drill point').click();
    await wait(80);
    tap(0.2, 0.2); await wait(60);
    tap(0.5, 0.2); await wait(60);
    tap(0.8, 0.2); await wait(120);
    stampBtn('Bait station').click();
    await wait(80);
    tap(0.2, 0.5); await wait(60);
    tap(0.5, 0.5); await wait(150);

    doc.getElementById('section-save-btn').click();
    await wait(600);

    const saved = await win.DB.getReport(job.id);
    const raw = saved.sections.siteSketch.sketchData;
    assert(raw, 'marker data is saved alongside the flattened image');
    const parsed = JSON.parse(raw);
    assertEqual(parsed.markers.length, 5, 'all five markers persisted');
    assertEqual(
      parsed.markers.filter((m) => m.kind === 'drill').map((m) => m.n).join(','),
      '1,2,3',
      'drill points number themselves 1,2,3 without the technician doing anything'
    );
    assertEqual(
      parsed.markers.filter((m) => m.kind === 'bait').map((m) => m.n).join(','),
      '1,2',
      'bait stations number independently of drill points'
    );
    assert(String(saved.sections.siteSketch.sketchImage || '').startsWith('data:image/png'),
      'the flattened image the PDF prints is still saved');

    // Reopen: markers must come back as data, proven by tapping one and
    // getting the edit prompt rather than nothing.
    openSketch();
    await wait(1000);
    stampBtn('Drill point').click();
    await wait(80);
    const origPrompt = win.prompt;
    let promptedWith = null;
    win.prompt = (msg) => { promptedWith = msg; return null; };
    try {
      tap(0.2, 0.2);
      await wait(200);
    } finally {
      win.prompt = origPrompt;
    }
    assert(promptedWith && /Drill \/ rod point 1/.test(promptedWith),
      `reopened markers must be live and editable, got: ${promptedWith}`);
  });

  test('Site sketch: marker data never reaches the printed report', async () => {
    // sketchData is a JSON blob living in a report section. It must stay out
    // of the PDF — printing it would drop a wall of raw JSON into a client's
    // compliance document.
    const win = frame.contentWindow;
    const sketchSection = win.REPORT_SCHEMA.find((s) => s.id === 'siteSketch');
    const dataField = sketchSection.fields.find((f) => f.id === 'sketchData');
    assert(dataField, 'sketchData field exists on the sketch section');
    assertEqual(dataField.type, 'sketchData', 'it uses its own type so renderers can skip it');
    assert(!dataField.required, 'it is never required — it is machine data, not an answer');
  });

  test('AI Draft: sortGeneralPhotos routes generalPhotos and unmatched captures into the right fields', async () => {
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Sort General Photos Job', jobType: 'termite' });

    // One photo added straight to the report's generalPhotos bucket...
    const generalBlob = new win.Blob(['g'], { type: 'image/jpeg' });
    await win.DB.saveReport({
      jobId: job.id,
      sections: { clientDetails: { generalPhotos: [{ id: 'gp1', blob: generalBlob }] } },
      finalizedAt: null,
    });
    // ...and one capture taken live with a zone that matches no checklist
    // item (an "Other" shot), which should be swept in too.
    const captureBlob = new win.Blob(['c'], { type: 'image/jpeg' });
    await win.DB.addCapture({ jobId: job.id, zone: 'Something Unplanned', type: 'photo', photoBlob: captureBlob });
    // A capture whose zone DOES match a checklist item must be left out of
    // the pool — that one is already handled by attachChecklistPhotos.
    const checklistBlob = new win.Blob(['k'], { type: 'image/jpeg' });
    await win.DB.addCapture({ jobId: job.id, zone: 'Meter Box', type: 'photo', photoBlob: checklistBlob });

    let sentCount = null;
    let sentTargets = null;
    const origAI = win.AI;
    win.AI = {
      sortGeneralPhotos: async (blobs, targets) => {
        sentCount = blobs.length;
        sentTargets = targets;
        // Assign photo 1 (generalPhotos) to obstructionPhotos, photo 2 (the
        // unmatched capture) to conducivePhotos.
        return {
          assignments: [
            { photoIndex: 1, sectionId: 'access', fieldId: 'obstructionPhotos', reasoning: 'test' },
            { photoIndex: 2, sectionId: 'conducive', fieldId: 'conducivePhotos', reasoning: 'test' },
          ],
        };
      },
    };
    try {
      await win.ReportUI.sortGeneralPhotos(job.id);
    } finally {
      win.AI = origAI;
    }

    assertEqual(sentCount, 2, 'only the generalPhotos entry and the unmatched capture are sent — not the checklist-matched one');
    assert(!sentTargets.some((t) => t.fieldId === 'propertyPhotos' || t.fieldId === 'coverPhoto'),
      'the cover/property photo fields are excluded as sort targets');
    assert(!sentTargets.some((t) => t.fieldId === 'treePhotos'), 'the specialized tree field is excluded as a sort target');

    const report = await win.DB.getReport(job.id);
    assertEqual((report.sections.access.obstructionPhotos || []).length, 1, 'the general-bucket photo lands in obstructionPhotos');
    assertEqual((report.sections.conducive.conducivePhotos || []).length, 1, 'the unmatched capture lands in conducivePhotos');
  });

  // ---------- rendering ----------
  function renderResults() {
    resultsList.innerHTML = '';
    for (const r of results) {
      const li = document.createElement('li');
      li.className = r.pass ? 'pass' : 'fail';
      const nameEl = document.createElement('div');
      nameEl.className = 'result-name';
      nameEl.innerHTML = `<span class="mark">${r.pass ? '✓' : '✗'}</span>${r.name}`;
      li.appendChild(nameEl);
      if (!r.pass) {
        const errEl = document.createElement('div');
        errEl.className = 'result-error';
        errEl.textContent = r.error;
        li.appendChild(errEl);
      }
      resultsList.appendChild(li);
    }
    const passed = results.filter((r) => r.pass).length;
    const failed = results.length - passed;
    summaryEl.textContent = results.length ? `${passed} passed, ${failed} failed (of ${results.length})` : '';
    summaryEl.className = failed === 0 ? 'pass' : 'fail';
    console.log(`[tests] ${passed} passed, ${failed} failed`);
  }

  // ---------- runner ----------
  let running = false;

  // ---------- Audit trail ----------
  // These drive the real save path rather than calling internals, because the
  // thing under test is a compliance guarantee: that a change to a signed-off
  // report cannot happen without leaving a record and a reason.

  function openReportSection(doc, label) {
    const li = Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
      .find((el) => el.textContent.includes(label));
    assert(li, `section not found: ${label}`);
    li.click();
  }

  function setTextInput(win, input, value) {
    const proto = input.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
  }

  // Fakes the tab being backgrounded/foregrounded inside the test iframe's
  // own window — the real trigger for both autosave features below, since
  // neither can wait for a real OS to actually lock the phone.
  function fireVisibility(win, hidden) {
    Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => hidden });
    win.document.dispatchEvent(new win.Event('visibilitychange'));
  }

  test('Audit: a new report is stamped with the schema version', async () => {
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Audit Stamp Job' });
    await win.ReportUI.openReview(job.id);
    await wait(200);
    // The report is only persisted once something is saved, so save a section.
    const doc = frame.contentDocument;
    openReportSection(doc, 'Client Details');
    await wait(200);
    doc.getElementById('section-save-btn').click();
    await wait(300);

    const saved = await win.DB.getReport(job.id);
    assert(saved, 'report should exist after a section save');
    assertEqual(saved.schemaVersion, win.REPORT_SCHEMA_VERSION, 'schema version stamped on the report');
    assert(Array.isArray(saved.auditLog), 'report carries an audit log');
    assert(saved.auditLog.some((e) => e.event === 'created'), 'creation is recorded');
  });

  test('Audit: changing an answer records the old and new value', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Audit Change Job' });
    await win.ReportUI.openReview(job.id);
    await wait(200);

    openReportSection(doc, 'Client Details');
    await wait(200);
    const input = doc.querySelector('#report-section-fields input[type="text"]');
    assert(input, 'a text input should render');
    setTextInput(win, input, 'Audited Client Name');
    doc.getElementById('section-save-btn').click();
    await wait(300);

    const saved = await win.DB.getReport(job.id);
    const changes = saved.auditLog.filter((e) => e.event === 'field-changed');
    assert(changes.length >= 1, 'a field change is recorded');
    const entry = changes.find((e) => e.to === 'Audited Client Name');
    assert(entry, 'the new value is recorded');
    assert(entry.label, 'the change records a human-readable field label');
    assertEqual(entry.afterFinalize, false, 'change before finalizing is not flagged as an amendment');
    assert(!entry.reason, 'no reason is demanded before finalizing');
  });

  test('Audit: re-saving a section unchanged records nothing', async () => {
    // A log full of "changed X from blank to blank" every time someone opens a
    // section is a log nobody reads, which defeats the point of having one.
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Audit Noise Job' });
    await win.ReportUI.openReview(job.id);
    await wait(200);

    openReportSection(doc, 'Client Details');
    await wait(200);
    doc.getElementById('section-save-btn').click();
    await wait(300);
    const first = (await win.DB.getReport(job.id)).auditLog.length;

    openReportSection(doc, 'Client Details');
    await wait(200);
    doc.getElementById('section-save-btn').click();
    await wait(300);
    const second = (await win.DB.getReport(job.id)).auditLog.length;

    assertEqual(second, first, 'saving an unchanged section adds no audit events');
  });

  test('Audit: amending a finalized report is refused without a reason', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Audit Refuse Job' });
    await win.ReportUI.openReview(job.id);
    await wait(200);
    openReportSection(doc, 'Client Details');
    await wait(200);
    doc.getElementById('section-save-btn').click();
    await wait(300);

    // Finalize directly — the button is gated on every section being green,
    // which is not what this test is about.
    const report = await win.DB.getReport(job.id);
    report.finalizedAt = Date.now();
    await win.DB.saveReport(report);

    await win.ReportUI.openReview(job.id);
    await wait(250);
    openReportSection(doc, 'Client Details');
    await wait(200);
    const input = doc.querySelector('#report-section-fields input[type="text"]');
    setTextInput(win, input, 'SNEAKY EDIT');

    const realPrompt = win.prompt;
    win.prompt = () => null; // technician cancels the reason dialog
    try {
      doc.getElementById('section-save-btn').click();
      await wait(300);
    } finally {
      win.prompt = realPrompt;
    }

    const after = await win.DB.getReport(job.id);
    const sneaky = JSON.stringify(after.sections).includes('SNEAKY EDIT');
    assert(!sneaky, 'a cancelled amendment must not be written to the report');
    assert(!after.auditLog.some((e) => e.to === 'SNEAKY EDIT'), 'a cancelled amendment is not logged as happening');
  });

  test('Audit: an amendment after finalizing is flagged and carries its reason', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Audit Amend Job' });
    await win.ReportUI.openReview(job.id);
    await wait(200);
    openReportSection(doc, 'Client Details');
    await wait(200);
    doc.getElementById('section-save-btn').click();
    await wait(300);

    const report = await win.DB.getReport(job.id);
    report.finalizedAt = Date.now();
    await win.DB.saveReport(report);

    await win.ReportUI.openReview(job.id);
    await wait(250);
    openReportSection(doc, 'Client Details');
    await wait(200);
    const input = doc.querySelector('#report-section-fields input[type="text"]');
    setTextInput(win, input, 'Corrected Name');

    const realPrompt = win.prompt;
    win.prompt = () => 'Client advised the spelling was wrong';
    try {
      doc.getElementById('section-save-btn').click();
      await wait(300);
    } finally {
      win.prompt = realPrompt;
    }

    const after = await win.DB.getReport(job.id);
    const amendment = after.auditLog.find((e) => e.to === 'Corrected Name');
    assert(amendment, 'the amendment is recorded');
    assertEqual(amendment.afterFinalize, true, 'it is flagged as post-finalization');
    assertEqual(amendment.reason, 'Client advised the spelling was wrong', 'the reason is preserved');
    assert(JSON.stringify(after.sections).includes('Corrected Name'), 'the amendment is actually applied');
  });

  test('Audit: image values are summarised, never stored in the log', async () => {
    // A signature or mud map is a data URL hundreds of kilobytes long. Copying
    // those into an append-only log would bloat every report sync indefinitely.
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Audit Image Job' });
    const bigDataUrl = 'data:image/png;base64,' + 'A'.repeat(5000);

    await win.DB.saveReport({ jobId: job.id, sections: {}, finalizedAt: null, auditLog: [], schemaVersion: win.REPORT_SCHEMA_VERSION });
    await win.ReportUI.openReview(job.id);
    await wait(200);

    const doc = frame.contentDocument;
    openReportSection(doc, 'Site Sketch (Mud Map)');
    await wait(400);
    doc.getElementById('section-save-btn').click();
    await wait(400);

    const saved = await win.DB.getReport(job.id);
    const serialised = JSON.stringify(saved.auditLog);
    assert(!serialised.includes('A'.repeat(200)), 'no raw image payload lands in the audit log');
    assert(serialised.length < 20000, `audit log stays small (was ${serialised.length} bytes)`);
    void bigDataUrl;
  });

  // ---------- Email delivery confirmation ----------
  // "Did they actually receive it?" reads the status back from Resend on
  // demand, using the id saved on the report when it was sent — see
  // check-email-status's own header for why this is pull, not push.

  test('Delivery: the status row stays hidden until a report has actually been emailed', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Never Emailed Job' });
    await win.DB.saveReport({ jobId: job.id, sections: {}, finalizedAt: null });
    await win.ReportUI.openReview(job.id);
    await wait(200);
    assert(doc.getElementById('email-status-row').classList.contains('hidden'),
      'a report that has never been sent has nothing to report delivery status about');
  });

  test('Delivery: a sent report shows its status and when it went out', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Sent Report Job' });
    const sentAt = Date.now() - 60000;
    await win.DB.saveReport({
      jobId: job.id, sections: {}, finalizedAt: Date.now(),
      emailProviderId: 'resend_abc123', emailedAt: sentAt, emailStatus: 'delivered',
    });
    await win.ReportUI.openReview(job.id);
    await wait(200);

    const row = doc.getElementById('email-status-row');
    assert(!row.classList.contains('hidden'), 'a sent report must show the row');
    assert(/Delivered/.test(doc.getElementById('email-status-text').textContent),
      `the human label for "delivered" must actually be shown, got: ${doc.getElementById('email-status-text').textContent}`);
  });

  test('Delivery: checking status calls Resend by the saved id and persists what comes back', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Check Status Job' });
    await win.DB.saveReport({
      jobId: job.id, sections: {}, finalizedAt: Date.now(),
      emailProviderId: 'resend_xyz789', emailedAt: Date.now(), emailStatus: 'sent',
    });
    await win.ReportUI.openReview(job.id);
    await wait(200);

    let calledWith = null;
    const originalService = win.EmailService;
    win.EmailService = {
      checkEmailStatus: async (emailId) => { calledWith = emailId; return { status: 'bounced' }; },
    };
    try {
      doc.getElementById('email-status-check-btn').click();
      await wait(300);
    } finally {
      win.EmailService = originalService;
    }

    assertEqual(calledWith, 'resend_xyz789', 'must check the actual id this report was sent under, not a placeholder');
    assert(/Bounced/i.test(doc.getElementById('email-status-text').textContent),
      'the fresh status from Resend must actually reach the screen');
    const saved = await win.DB.getReport(job.id);
    assertEqual(saved.emailStatus, 'bounced', 'and persist, so it survives closing and reopening the report');
  });

  // ---------- Form validation ----------
  // Each of these is a real defect found in a submitted Formitize report that
  // went to a client. The test is the record of what happened and the proof it
  // can't happen again — if one starts failing, that error is back.

  function pestSection(id) {
    const section = window.PEST_TREATMENT_SCHEMA.find((s) => s.id === id);
    assert(section, 'pest schema section not found: ' + id);
    return section;
  }

  const SAFE_SAFETY = {
    risksPresent: ['People / children'],
    ppeUsed: ['Gloves'],
    safeToCommence: 'Yes',
    reEntryPeriod: '2 hours',
    appliedOutdoorsWithSpray: 'No',
  };

  test('Validation: an impossible temperature is rejected', () => {
    // A service report went to a client reading "Temperature: 222".
    const U = window.ReportSchemaUtils;
    const safety = pestSection('safety');
    const withBadTemp = { ...SAFE_SAFETY, appliedOutdoorsWithSpray: 'Yes', windSpeed: '9', windDirection: 'NE', temperature: '222' };
    const errors = U.sectionValidationErrors(safety, withBadTemp);
    assert(errors.some((e) => e.kind === 'range' && /222/.test(e.message)), 'a temperature of 222 must be caught');

    const withGoodTemp = { ...withBadTemp, temperature: '22' };
    assertEqual(U.sectionValidationErrors(safety, withGoodTemp).length, 0, 'a real temperature passes');
  });

  test('Validation: wind speed is range-checked too', () => {
    const U = window.ReportSchemaUtils;
    const safety = pestSection('safety');
    const base = { ...SAFE_SAFETY, appliedOutdoorsWithSpray: 'Yes', windDirection: 'NE', temperature: '22' };
    assert(U.sectionValidationErrors(safety, { ...base, windSpeed: '900' }).some((e) => e.kind === 'range'),
      '900 km/h is not a wind speed');
    assertEqual(U.sectionValidationErrors(safety, { ...base, windSpeed: '12' }).length, 0, '12 km/h is fine');
  });

  test('Validation: an action taken against a risk that was never recorded', () => {
    // Seen in a real report: "Informed people/children to vacate the area"
    // with the risks-present list empty.
    const U = window.ReportSchemaUtils;
    const safety = pestSection('safety');
    const errors = U.sectionValidationErrors(safety, {
      ...SAFE_SAFETY,
      risksPresent: [],
      riskActions: ['Informed people/children to vacate the area'],
    });
    assert(errors.some((e) => e.kind === 'companion'), 'the contradiction must be flagged');
    assert(errors.some((e) => /Nothing of concern/.test(e.message)), 'and it must say how to resolve it honestly');
  });

  test('Validation: a diluted product needs its concentrate figure', () => {
    // Blank on every product row of every report examined.
    const U = window.ReportSchemaUtils;
    const chemicals = pestSection('chemicals');
    const errors = U.sectionValidationErrors(chemicals, {
      products: [{ id: 'p1', productName: 'Temprid 75', areaApplied: ['Internal'], totalMixApplied: '8 L' }],
    });
    assert(errors.some((e) => /concentrate used is blank/.test(e.message)), 'a diluted product without concentrate is incomplete');
  });

  test('Validation: a ready-to-use product is not asked for a concentrate figure', () => {
    // The reason the field was being skipped: it was shown for gels and baits
    // too, where the honest answer does not exist.
    const U = window.ReportSchemaUtils;
    const chemicals = pestSection('chemicals');
    const errors = U.sectionValidationErrors(chemicals, {
      products: [{ id: 'p1', productName: 'Contrac Blox', areaApplied: ['External'], totalMixApplied: '350 g' }],
    });
    assertEqual(errors.length, 0, 'a bait recorded with an amount applied is complete');
  });

  test('Validation: a product row with no area recorded is incomplete', () => {
    const U = window.ReportSchemaUtils;
    const errors = U.sectionValidationErrors(pestSection('chemicals'), {
      products: [{ id: 'p1', productName: 'Contrac Blox', areaApplied: [], totalMixApplied: '350 g' }],
    });
    assert(errors.some((e) => /no area recorded/.test(e.message)), 'an area is required');
  });

  test('Validation: the cover photo is required', () => {
    // Reports were going out with an empty band where the cover image belongs.
    const U = window.ReportSchemaUtils;
    const errors = U.sectionValidationErrors(pestSection('clientDetails'), {
      clientName: 'A Client', clientPhone: '0400 000 000', propertyAddress: '1 Test St',
      propertyType: 'Residential', inspectionDate: '2026-08-23',
      inspectionTime: '09:00', applicationFinishTime: '09:45',
    });
    assert(errors.some((e) => e.fieldId === 'coverPhoto'), 'no cover photo must block the report');
  });

  test('Validation: every product in the picker carries its active constituent', () => {
    // The whole point of the picklist — the chemistry is never typed.
    assert(Array.isArray(window.PEST_PRODUCTS) && window.PEST_PRODUCTS.length > 30, 'the product library is loaded');
    for (const product of window.PEST_PRODUCTS) {
      assert(product.name && product.name.length > 2, 'product has a name');
      assert(product.active && /\d/.test(product.active), `${product.name} has a concentration in its active constituent`);
      assert(product.form, `${product.name} declares a formulation`);
    }
    assertEqual(window.PestProducts.activeFor('Temprid 75'), 'Beta-cyfluthrin 25 g/L, Imidacloprid 50 g/L', 'lookup returns the chemistry');
    assertEqual(window.PestProducts.isReadyToUse('Contrac Blox'), true, 'a bait is ready to use');
    assertEqual(window.PestProducts.isReadyToUse('Temprid 75'), false, 'a concentrate is not');
  });

  test('Validation: a clean report reports nothing outstanding', () => {
    const U = window.ReportSchemaUtils;
    const errors = U.sectionValidationErrors(pestSection('safety'), SAFE_SAFETY);
    assertEqual(errors.length, 0, 'a properly filled safety section is clean');
  });

  // ---------- Document types ----------
  // Termite work is five documents, not one. 215 of Arcadian's last 1,400
  // submissions were action plans, certificates and service records — none of
  // which the app could produce. These check the registry keeps them distinct
  // and that a report never forgets which one it is.

  test('Documents: a termite job offers all four termite documents', () => {
    const win = frame.contentWindow;
    const ids = win.ReportUI.documentTypesFor('termite').map((d) => d.id).sort();
    assertEqual(ids.join(','),
      'termite_action_plan,termite_certificate,termite_service_record,timber_pest_inspection',
      'all four termite documents are offered');
    const pest = win.ReportUI.documentTypesFor('pest_treatment').map((d) => d.id);
    assertEqual(pest.join(','), 'general_pest', 'a general pest job offers only its own document');
  });

  // ---------- Guided capture per document type ----------
  // A termite job's single report can be any one of four document types,
  // but until now every one of them got the same inspection-focused
  // checklist — a technician on site to install a barrier system was being
  // prompted for "Weep Holes" instead of anything the certificate's own
  // schema actually needs evidence of. These pin forJob's branching
  // directly, since a wrong checklist here means a technician either gets
  // asked for photos with nowhere to go, or never asked for the ones a
  // document actually requires.

  test('Checklist: an inspection (or no document type yet) gets the standard inspection checklist', () => {
    const win = frame.contentWindow;
    const withNone = win.PhotoChecklists.forJob({ jobType: 'termite' }, null, undefined);
    const withInspection = win.PhotoChecklists.forJob({ jobType: 'termite' }, null, 'timber_pest_inspection');
    assert(withNone.some((i) => i.id === 'weepHoles'), 'a brand new job with no report yet defaults to the inspection checklist');
    assert(withInspection.some((i) => i.id === 'weepHoles'), 'and naming the inspection explicitly gives the same list');
  });

  test('Checklist: a certificate asks for the installed system and the durable notice, not inspection findings', () => {
    const win = frame.contentWindow;
    const items = win.PhotoChecklists.forJob({ jobType: 'termite' }, null, 'termite_certificate');
    const ids = items.map((i) => i.id);
    assert(ids.includes('installedSystem'), 'the certificate exists to prove what was installed');
    assert(ids.includes('durableNotice'), 'and that a durable notice was fixed — both required by TERMITE_CERTIFICATE_SCHEMA');
    assert(!ids.includes('weepHoles') && !ids.includes('antCapping'),
      'inspection-only items must not leak into a document that never asked an inspection question');
    const notice = items.find((i) => i.id === 'durableNotice');
    assertEqual(notice.schemaSection, 'durableNotice');
    assertEqual(notice.schemaField, 'noticePhoto', 'must route into the field the schema actually named it');
  });

  test('Checklist: a service record asks about the stations being serviced, not what a fresh inspection found', () => {
    const win = frame.contentWindow;
    const items = win.PhotoChecklists.forJob({ jobType: 'termite' }, null, 'termite_service_record');
    assert(items.length > 1, 'a real checklist, not an empty one');
    assert(!items.some((i) => i.id === 'weepHoles'), 'this is a periodic visit to an existing system, not a fresh inspection');
    assert(items.every((i) => !i.schemaField || i.schemaField === 'servicePhotos'),
      'every routed item lands in the one photo field TERMITE_SERVICE_RECORD_SCHEMA actually has');
  });

  test('Checklist: an action plan gets no checklist at all — there is nowhere for a photo to go', () => {
    // TERMITE_ACTION_PLAN_SCHEMA has no photo field anywhere in it — it's a
    // proposal written from an inspection that already happened, not a
    // document needing its own fresh evidence.
    const win = frame.contentWindow;
    const items = win.PhotoChecklists.forJob({ jobType: 'termite' }, null, 'termite_action_plan');
    assertEqual(items.length, 0, 'sending a technician out with a checklist for a document with no photo field is pure busywork');
  });

  test('Checklist: which document is active on the job is what decides the checklist, end to end', async () => {
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Certificate Checklist Job', jobType: 'termite' });
    // A brand-new report lives purely in memory until something real is
    // saved (see loadOrCreateReport) — openReview alone would never leave
    // anything for DB.getReport to find. Seeding one directly is what
    // actually proves attachChecklistPhotos reads a real persisted
    // documentType, which is the thing under test here.
    await win.DB.saveReport({ jobId: job.id, sections: {}, documentType: 'termite_certificate', finalizedAt: null });

    await win.DB.addCapture({ jobId: job.id, zone: 'Installed System', type: 'photo', photoBlob: new win.Blob(['x'], { type: 'image/jpeg' }) });
    await win.ReportUI.attachChecklistPhotos(job.id);
    const after = await win.DB.getReport(job.id);
    assertEqual((after.sections.installation.installationPhotos || []).length, 1,
      'a photo taken against the certificate\'s own checklist label must land in the certificate\'s own schema field');
  });

  test('Documents: picking a different document type on a legacy report (no documentType stamp) still blocks with an explanation', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Legacy Report Job', jobType: 'termite' });
    await win.DB.updateJob(job.id, { status: 'review' });
    // No documentType at all — exactly what every report saved before this
    // field existed looks like. Before the fix, documentTypeOf()'s "missing
    // means inspection" fallback was applied when deciding which card LOOKS
    // active but not when deciding whether a click should be blocked, so
    // every card silently reopened this same report instead of explaining
    // that a different job is needed.
    await win.DB.saveReport({ jobId: job.id, sections: {}, finalizedAt: null });

    await win.showJobViewById(job.id);
    await wait(200);
    const cards = doc.querySelectorAll('.doc-type-card');
    const certificateCard = Array.from(cards).find((c) => /Certificate of Installation/.test(c.textContent));
    assert(certificateCard, 'the certificate option should be offered on a termite job');
    certificateCard.click();
    await wait(100);

    assert(!doc.getElementById('view-job').classList.contains('hidden'),
      'clicking a different document type must not navigate away from the job');
    assert(doc.getElementById('view-report').classList.contains('hidden'),
      'and must not silently open the existing report under the wrong pretence');
    assertEqual(doc.getElementById('toast').textContent,
      'This job already has an Inspection. Create a separate job for the Certificate.',
      'the technician needs to be told why nothing happened, not left guessing');
  });

  // ---------- Self-service backup ----------

  test('Backup: exportAllData bundles jobs, reports and invoices, with no photo blobs bloating it', async () => {
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Export Test Job' });
    await win.DB.saveReport({
      jobId: job.id, sections: {}, finalizedAt: Date.now(),
      auditLog: [{ event: 'created', at: Date.now() }],
    });
    await win.DB.saveInvoice({
      id: 'export-test-invoice-' + job.id, jobId: job.id, number: 'INV-TEST',
      lineItems: [{ description: 'Test line', qty: 1, unitPriceCents: 1000 }],
      status: 'draft', createdAt: Date.now(),
    });

    const data = await win.DB.exportAllData();

    assert(data.jobs.some((j) => j.id === job.id), 'export must include a job just created');
    assert(data.reports.some((r) => r.jobId === job.id && Array.isArray(r.auditLog)),
      'and its report, audit trail intact');
    assert(data.invoices.some((i) => i.jobId === job.id), 'and its invoice');
    assertEqual(data.counts.jobs, data.jobs.length, 'counts must match the actual arrays');
    assertEqual(data.counts.reports, data.reports.length, 'counts must match the actual arrays');
    assertEqual(data.counts.invoices, data.invoices.length, 'counts must match the actual arrays');
    // Not "no report ever carries a data:image string" — a signature or a
    // sketch canvas legitimately does, and both are small. What must never
    // happen is the bulky captures/footage stores (raw inspection photos)
    // riding along and turning a quick download into a multi-hundred-MB file.
    assert(!('captures' in data) && !('footage' in data),
      'a backup meant to be quick to generate and download on a phone must not carry the raw photo/video stores');
  });

  test('Documents: each schema is structurally sound', () => {
    const win = frame.contentWindow;
    const VALID = new Set(['text', 'textarea', 'select', 'yesno', 'multiselect', 'date', 'time',
      'photos', 'signature', 'static', 'productList', 'stationList', 'sketch', 'number']);
    const schemas = [
      ['action plan', win.TERMITE_ACTION_PLAN_SCHEMA],
      ['certificate', win.TERMITE_CERTIFICATE_SCHEMA],
      ['service record', win.TERMITE_SERVICE_RECORD_SCHEMA],
    ];
    for (const [name, schema] of schemas) {
      assert(Array.isArray(schema) && schema.length >= 6, `${name} has its sections`);
      const seen = new Set();
      for (const section of schema) {
        assert(!seen.has(section.id), `${name}: section ${section.id} is not duplicated`);
        seen.add(section.id);
        const fieldIds = new Set();
        for (const field of section.fields || []) {
          assert(!fieldIds.has(field.id), `${name}: ${section.id}.${field.id} is not duplicated`);
          fieldIds.add(field.id);
          assert(VALID.has(field.type), `${name}: ${section.id}.${field.id} has a known type`);
          // A showIf pointing at a field that isn't there hides the field
          // forever, and nothing says why.
          if (field.showIf) {
            assert((section.fields || []).some((f) => f.id === field.showIf.field),
              `${name}: ${section.id}.${field.id} showIf targets a real field`);
          }
        }
      }
    }
  });

  test('Documents: a report remembers which document it is', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Doc Type Memory', jobType: 'termite' });

    await win.ReportUI.openReview(job.id, 'termite_service_record');
    await wait(250);
    assertEqual(doc.getElementById('report-title').textContent,
      'Termite Management Plan Service Record', 'the service record opens under its own title');

    // Persist it, then reopen with no hint at all — it must still be a service
    // record and not fall back to the inspection.
    const li = Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
      .find((el) => /System Being Serviced/.test(el.textContent));
    assert(li, 'the service record has its own sections');
    li.click();
    await wait(250);
    doc.getElementById('section-save-btn').click();
    await wait(350);

    const saved = await win.DB.getReport(job.id);
    assertEqual(saved.documentType, 'termite_service_record', 'the document type is stamped on the report');

    await win.ReportUI.openReview(job.id);
    await wait(250);
    assertEqual(doc.getElementById('report-title').textContent,
      'Termite Management Plan Service Record', 'reopening without a hint keeps the same document');
  });

  test('Documents: a report written before document types still opens', async () => {
    // Every existing report has no documentType stamp. They must keep
    // resolving to the schema they were answered against, not blank out.
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Legacy Report', jobType: 'termite' });
    await win.DB.saveReport({ jobId: job.id, sections: { findings: { liveTermitesFound: 'No' } }, finalizedAt: null });

    await win.ReportUI.openReview(job.id);
    await wait(300);
    assertEqual(doc.getElementById('report-title').textContent,
      'Timber Pest Inspection Report', 'an unstamped termite report falls back to the inspection');
    assert(doc.querySelectorAll('#report-section-list .report-section-item').length > 5,
      'and its sections still render');
  });

  test('Documents: the service record demands a per-station result', () => {
    // A service record without per-station results is just an assertion that
    // somebody attended.
    const win = frame.contentWindow;
    const U = win.ReportSchemaUtils;
    const stations = win.TERMITE_SERVICE_RECORD_SCHEMA.find((s) => s.id === 'stations');
    const empty = U.sectionValidationErrors(stations, {
      systemCondition: 'Intact and functioning', stationsDamaged: 'No',
    });
    assert(empty.some((e) => e.fieldId === 'stationRecords'), 'no stations recorded is incomplete');

    const filled = U.sectionValidationErrors(stations, {
      stationRecords: [{ id: 's1', stationNumber: '1', status: 'No activity', action: 'Nothing required' }],
      systemCondition: 'Intact and functioning', stationsDamaged: 'No',
    });
    assertEqual(filled.length, 0, 'one recorded station satisfies it');
  });

  test('Documents: the action plan requires what cannot be treated', () => {
    // A management plan that quietly omits its own gaps is the one that gets
    // argued about later.
    const win = frame.contentWindow;
    const U = win.ReportSchemaUtils;
    const works = win.TERMITE_ACTION_PLAN_SCHEMA.find((s) => s.id === 'proposedWorks');
    const errors = U.sectionValidationErrors(works, {
      managementMethod: ['Chemical soil treated zone (AS 3660.2)'],
      treatmentExtent: 'Complete perimeter',
      areasToTreat: ['External perimeter'],
      drillingRequired: 'No',
      productsProposed: [{ id: 'p1', productName: 'Termidor HE Residual Termiticide', areaApplied: ['External'], concentrateUsed: '300 mL', totalMixApplied: '50 L' }],
    });
    assert(errors.some((e) => e.fieldId === 'untreatableAreas'),
      'the plan must state what it cannot cover');
  });

  test('Documents: the certificate requires the durable notice to be evidenced', () => {
    const win = frame.contentWindow;
    const U = win.ReportSchemaUtils;
    const notice = win.TERMITE_CERTIFICATE_SCHEMA.find((s) => s.id === 'durableNotice');
    const claimed = U.sectionValidationErrors(notice, { noticeInstalled: 'Yes' });
    assert(claimed.some((e) => e.fieldId === 'noticeLocation'), 'where it was fixed is required');
    assert(claimed.some((e) => e.fieldId === 'noticePhoto'), 'a photo of it is required');

    const omitted = U.sectionValidationErrors(notice, { noticeInstalled: 'No' });
    assert(omitted.some((e) => e.fieldId === 'noticeOmittedReason'),
      'and if none was fixed, that needs explaining');
  });

  // ---------- Reading a whole table (pagination) ----------
  // PostgREST truncates a select('*') at max-rows (1000 by default) without
  // saying so. On a two-way sync that is not "some rows missing": every row
  // past the cap looks absent from the server, so the push-back branch
  // re-uploads it forever, and a tombstone past the cap never gets read, so
  // the record it condemns comes back. These tests exist because that failure
  // is completely silent — no error, no warning, just quietly wrong.

  // Stands in for supabase-js's query builder. Records every page window it
  // was asked for, so a test can assert the windows are contiguous rather
  // than only that the row count came out right.
  function fakeSupabase(rowsByTable, opts = {}) {
    const calls = [];
    const client = {
      calls,
      from(table) {
        const orders = [];
        const q = {
          select: () => q,
          order: (col) => { orders.push(col); return q; },
          async range(from, to) {
            calls.push({ table, from, to, orders: orders.slice() });
            if (opts.error) return { data: null, error: opts.error };
            const all = rowsByTable[table] || [];
            // A server that ignores range: always answers with a full page.
            if (opts.ignoreRange) return { data: all.slice(0, opts.ignoreRange), error: null };
            return { data: all.slice(from, to + 1), error: null };
          },
        };
        return q;
      },
    };
    return client;
  }

  function fakeRows(n, key = 'id') {
    // Padded so a lexical sort and a numeric one agree — the double slices in
    // insertion order, and a test should not depend on which that is.
    return Array.from({ length: n }, (_, i) => ({ [key]: `r${String(i).padStart(6, '0')}` }));
  }

  test('Sync: a table larger than one page is read completely, not truncated', async () => {
    const win = frame.contentWindow;
    const { fetchAllRows, PAGE_ROWS } = win.SyncPaging;
    const total = PAGE_ROWS * 2 + 500;
    const client = fakeSupabase({ jobs: fakeRows(total) });

    const rows = await fetchAllRows(client, 'jobs');
    assert(rows.length === total,
      `every row must come back, not just the first page — got ${rows.length} of ${total}`);

    const ids = new Set(rows.map((r) => r.id));
    assert(ids.size === total, 'no row is fetched twice by overlapping pages');
    assert(client.calls.length === 3, `three pages for ${total} rows, got ${client.calls.length}`);
  });

  test('Sync: page windows are contiguous, so no row falls between them', async () => {
    const win = frame.contentWindow;
    const { fetchAllRows, PAGE_ROWS } = win.SyncPaging;
    const client = fakeSupabase({ jobs: fakeRows(PAGE_ROWS * 2 + 1) });
    await fetchAllRows(client, 'jobs');

    // range() is inclusive at both ends. An off-by-one here drops exactly one
    // record per page, which is the kind of loss nobody notices for months.
    client.calls.forEach((call, i) => {
      assert(call.from === i * PAGE_ROWS, `page ${i} starts at ${i * PAGE_ROWS}, got ${call.from}`);
      assert(call.to === (i + 1) * PAGE_ROWS - 1,
        `page ${i} ends at ${(i + 1) * PAGE_ROWS - 1}, got ${call.to}`);
    });
  });

  test('Sync: a table of exactly one page is read without losing the last page', async () => {
    // The boundary case. A full page cannot be assumed to be the last one, so
    // this must ask again and get nothing, rather than stopping at a full page
    // and missing a real second page.
    const win = frame.contentWindow;
    const { fetchAllRows, PAGE_ROWS } = win.SyncPaging;
    const client = fakeSupabase({ jobs: fakeRows(PAGE_ROWS) });

    const rows = await fetchAllRows(client, 'jobs');
    assert(rows.length === PAGE_ROWS, `exactly one page of rows, got ${rows.length}`);
    assert(client.calls.length === 2, 'a full page is followed by one more request, which comes back empty');
  });

  test('Sync: an empty table costs one request and returns nothing', async () => {
    const win = frame.contentWindow;
    const { fetchAllRows } = win.SyncPaging;
    const client = fakeSupabase({ jobs: [] });

    const rows = await fetchAllRows(client, 'jobs');
    assert(rows.length === 0, 'no rows');
    assert(client.calls.length === 1, 'and it does not keep asking');
  });

  test('Sync: every table is paged by a unique key, never by updated_at', async () => {
    // Paging without a deterministic order lets pages overlap and skip rows.
    // updated_at is not unique, so ordering by it would reintroduce the exact
    // silent loss this whole helper exists to prevent.
    const win = frame.contentWindow;
    const { fetchAllRows, TABLE_KEYS } = win.SyncPaging;

    for (const [table, keys] of Object.entries(TABLE_KEYS)) {
      const client = fakeSupabase({ [table]: fakeRows(3, keys[0]) });
      await fetchAllRows(client, table);
      const ordered = client.calls[0].orders;
      assert(ordered.join(',') === keys.join(','),
        `${table} must be ordered by ${keys.join(' + ')}, got ${ordered.join(' + ') || 'nothing'}`);
      assert(!ordered.includes('updated_at'), `${table} must not be paged by a non-unique column`);
    }
    assert(TABLE_KEYS.reports[0] === 'job_id', 'reports are keyed by job_id, not id');
    assert(TABLE_KEYS.deletions.length === 2, 'deletions have a composite key, so both halves order it');
  });

  test('Sync: a failed page throws instead of passing off a half-read table as complete', async () => {
    // The dangerous shape: swallow the error, return the rows fetched so far,
    // and pullAll treats every missing row as "the server does not have this"
    // and uploads it back. Better to fail the sync loudly.
    const win = frame.contentWindow;
    const { fetchAllRows } = win.SyncPaging;
    const client = fakeSupabase({ jobs: fakeRows(10) }, { error: { message: 'permission denied' } });

    let threw = null;
    try { await fetchAllRows(client, 'jobs'); } catch (e) { threw = e; }
    assert(threw, 'the error is raised, not absorbed into a short page');
    assert(/permission denied/.test(threw.message || ''), 'and it carries the real reason');
  });

  test('Sync: a server that ignores paging cannot spin forever', async () => {
    const win = frame.contentWindow;
    const { fetchAllRows, PAGE_ROWS, MAX_PAGES } = win.SyncPaging;
    const client = fakeSupabase({ jobs: fakeRows(PAGE_ROWS) }, { ignoreRange: PAGE_ROWS });

    const rows = await fetchAllRows(client, 'jobs');
    assert(client.calls.length === MAX_PAGES, `it stops at ${MAX_PAGES} pages, not never`);
    assert(rows.length === PAGE_ROWS * MAX_PAGES, 'and hands back what it did read');
  });

  // ---------- Sync failure wording ----------
  // These lock in a promise to the person holding the phone, not an
  // implementation detail: whatever went wrong upstream, the message must
  // say the work is still on the device. A technician who reads "permission
  // denied" at the end of a job reasonably concludes the photos are gone and
  // reshoots — or worse, doesn't.

  test('Sync: a permissions failure says the work is safe and names what to fix', () => {
    const win = frame.contentWindow;
    const msg = win.SyncMessages.syncFailureText([
      { table: 'captures', error: { code: '42501', message: 'permission denied for table captures' } },
      { table: 'invoices', error: { code: '42501', message: 'permission denied for table invoices' } },
    ]);
    assert(/saved on this device/i.test(msg), 'it states plainly that nothing was lost');
    assert(/photos/.test(msg), 'it names captures in the technician\u2019s words, not the table name');
    assert(/invoices/.test(msg), 'every failing collection is named, not just the first');
    assert(/42501/.test(msg), 'the code is kept for whoever has to fix the server');
    assert(!/permission denied for table/.test(msg),
      'the raw Postgres string never reaches the technician');
  });

  test('Sync: no failure message ever implies data was lost', () => {
    const win = frame.contentWindow;
    const cases = [
      win.SyncMessages.syncFailureText([{ table: 'captures', error: { code: '42501', message: 'x' } }]),
      win.SyncMessages.syncFailureText([{ table: 'footage', error: { message: 'Failed to fetch' } }]),
      win.SyncMessages.syncFailureText([{ table: 'invoices', error: { message: 'something odd' } }]),
      win.SyncMessages.fatalSyncText({ code: '42501', message: 'permission denied for table jobs' }),
      win.SyncMessages.fatalSyncText({ message: 'Failed to fetch' }),
      win.SyncMessages.fatalSyncText({ message: 'JWT expired' }),
      win.SyncMessages.fatalSyncText({}),
    ];
    for (const msg of cases) {
      assert(msg && msg.length > 20, `every path produces a real message, got: ${msg}`);
      // A message may legitimately say "nothing is lost" — that is the
      // reassurance, and the whole point. What it must never do is make a
      // loss claim. Drop the clauses that are explicit negations, then scan
      // whatever is left.
      const claim = msg
        .split(/[.\u2014;]/)
        .filter((clause) => !/\bnothing\b/i.test(clause))
        .join(' ');
      assert(!/\blost\b|\bgone\b|\bdeleted\b|\bfailed\b/i.test(claim),
        `message must not read as data loss: ${msg}`);
      assert(/device|signal/i.test(msg),
        `message must tell them where their work is: ${msg}`);
    }
  });

  test('Sync: an expired login is explained as a login problem, not a backup problem', () => {
    const win = frame.contentWindow;
    const msg = win.SyncMessages.fatalSyncText({ message: 'JWT expired' });
    assert(/log out and back in/i.test(msg), 'it says the one thing that actually fixes it');
  });

  test('Sync: the status bar never reads "Synced" when something did not back up', () => {
    // The bug this guards: a partial sync used to be indistinguishable from a
    // clean one, so photos silently stayed on the phone while the bar said
    // everything was away.
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const detail = doc.getElementById('sync-detail');
    assert(detail, 'the app has somewhere to explain a partial sync');
    assert(detail.classList.contains('hidden'), 'and it stays out of the way when there is nothing to say');
  });

  // ---------- Booking overlap ----------
  // Five separate places in this app write scheduledAt/scheduledDurationMins
  // (the day grid, the backlog's one-tap book, the AI scheduling assistant,
  // auto-rebook, and the new-job form). Before this, none of them checked
  // whether the slot they were about to write into already belonged to
  // another job — two jobs could be booked into the same hour with nothing
  // ever telling anyone. These pin the shared check itself; the confirm-based
  // UI wiring at each call site is exercised live rather than re-mocked five
  // times over.

  test('Overlap: two jobs booked into the same window are detected', async () => {
    const win = frame.contentWindow;
    const base = Date.parse('2026-10-12T09:00:00');
    const a = await win.DB.addJob({ name: 'Overlap A', scheduledAt: base, scheduledDurationMins: 120 });
    const b = await win.DB.addJob({ name: 'Overlap B' });
    const clashes = await win.DB.getOverlappingJobs(base + 60 * 60000, 60, b.id);
    assertEqual(clashes.length, 1, 'a job starting inside another job\'s window is a clash');
    assertEqual(clashes[0].id, a.id, 'and it names the actual job it clashes with');
  });

  test('Overlap: back-to-back bookings do not clash', async () => {
    // 9:00-10:00 followed by 10:00-11:00 is a full diary, not a double-booking
    // — the boundary itself must not count as overlapping, or a technician
    // could never book two jobs back to back without a false warning.
    const win = frame.contentWindow;
    const base = Date.parse('2026-10-13T09:00:00');
    const a = await win.DB.addJob({ name: 'Back-to-back A', scheduledAt: base, scheduledDurationMins: 60 });
    const clashes = await win.DB.getOverlappingJobs(base + 60 * 60000, 60, null);
    assertEqual(clashes.length, 0, 'a job starting exactly when another ends is not a clash');
  });

  test('Overlap: a job never clashes with itself', async () => {
    const win = frame.contentWindow;
    const base = Date.parse('2026-10-14T09:00:00');
    const a = await win.DB.addJob({ name: 'Self Job', scheduledAt: base, scheduledDurationMins: 90 });
    const clashes = await win.DB.getOverlappingJobs(base, 90, a.id);
    assertEqual(clashes.length, 0, 'moving a job or re-saving it at the same time must not flag against itself');
  });

  test('Overlap: an unscheduled candidate has nothing to check', async () => {
    const win = frame.contentWindow;
    const clashes = await win.DB.getOverlappingJobs(null, 60, null);
    assertEqual(clashes.length, 0, 'no time means no conflict is possible');
  });

  test('Overlap: a long job that runs into a later booking is caught, not just the start hour', async () => {
    // This is the exact bug found in bookInto: the day grid only shows the
    // tapped hour as free. A 3pm job that runs 3 hours reaches 6pm even
    // though 3pm itself was clear.
    const win = frame.contentWindow;
    const base = Date.parse('2026-10-15T17:00:00'); // 5pm
    const later = await win.DB.addJob({ name: 'Late Job', scheduledAt: base, scheduledDurationMins: 60 });
    const candidateStart = Date.parse('2026-10-15T15:00:00'); // 3pm, itself free
    const clashes = await win.DB.getOverlappingJobs(candidateStart, 180, null); // runs to 6pm
    assertEqual(clashes.length, 1, 'the 5pm job is caught even though 3pm itself was empty');
  });

  test('Overlap: the confirm prompt names the job it clashes with', async () => {
    const win = frame.contentWindow;
    const base = Date.parse('2026-10-16T10:00:00');
    await win.DB.addJob({ name: 'Existing Slot Job', scheduledAt: base, scheduledDurationMins: 60 });
    const mover = await win.DB.addJob({ name: 'Mover Job' });

    const origConfirm = win.confirm;
    let confirmMessage = null;
    win.confirm = (msg) => { confirmMessage = msg; return false; }; // decline the clash
    try {
      const clear = await win.Scheduler.confirmNoOverlap(mover.id, base, 60);
      assert(!clear, 'declining the clash must not clear the booking');
      assert(confirmMessage && /Existing Slot Job/.test(confirmMessage),
        `the prompt must name the job it clashes with, got: ${confirmMessage}`);
    } finally {
      win.confirm = origConfirm;
    }
  });

  test('Scheduler: declining a clash leaves the picker open and books nothing; accepting books it', async () => {
    // The real bug, end to end: 3pm is genuinely free, so the grid offers it.
    // A 90-minute job booked there runs to 4:30pm, reaching into a job
    // already sitting at 4pm — a clash the grid itself has no way to show,
    // because it only ever looks one hour ahead of the tap.
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const day = dayThisMonth(14);
    await win.DB.addJob({ name: 'Four PM Job', scheduledAt: new Date(day).setHours(16, 0, 0, 0), scheduledDurationMins: 60 });
    await win.DB.addJob({ name: 'Long Mover Job' });

    await win.Scheduler.open();
    await wait(300);
    Array.from(doc.querySelectorAll('.cal-cell:not(.cal-blank)'))
      .find((c) => c.querySelector('.cal-daynum').textContent === String(dayThisMonth(14).getDate())).click();
    await wait(300);

    const pmRow = Array.from(doc.querySelectorAll('.slot-row'))
      .find((r) => r.textContent.startsWith('3pm') && r.querySelector('.slot-free'));
    assert(pmRow, '3pm itself is free — the clash only exists once the duration is applied');
    pmRow.querySelector('.slot-free').click();
    await wait(300);
    doc.getElementById('slot-picker-duration').value = '90';
    const row = Array.from(doc.querySelectorAll('.picker-row')).find((r) => r.textContent.includes('Long Mover Job'));

    const origConfirm = win.confirm;
    win.confirm = () => false; // decline
    try {
      row.click();
      await wait(400);
    } finally {
      win.confirm = origConfirm;
    }
    assert(!doc.getElementById('slot-picker-modal').classList.contains('hidden'),
      'declining leaves the picker open so a different time can be chosen');
    let saved = (await win.DB.getJobs()).find((j) => j.name === 'Long Mover Job');
    assertEqual(saved.scheduledAt, null, 'nothing is written when the clash is declined');

    win.confirm = () => true; // now accept the same clash
    try {
      row.click();
      await wait(400);
    } finally {
      win.confirm = origConfirm;
    }
    saved = (await win.DB.getJobs()).find((j) => j.name === 'Long Mover Job');
    assert(saved.scheduledAt, 'accepting the clash books it anyway — this is a warning, not a hard block');
    assert(doc.getElementById('slot-picker-modal').classList.contains('hidden'), 'and the picker closes as normal');
  });

  // ---------- Section autosave ----------
  // Save/discard is deliberate — a report answer shouldn't change until a
  // technician chooses to commit it — but that model did nothing for the
  // far more common way work actually gets lost: a phone lock, a call
  // coming in, the OS reclaiming a backgrounded tab. None of those go
  // through the back arrow, so the discard-confirm never fires and nothing
  // was ever written anywhere. These drive the real trigger (a faked
  // visibilitychange, since nothing here can lock a real phone) rather than
  // reaching into the module's internals.

  test('Autosave: backgrounding the tab mid-edit writes a recoverable draft', async () => {
    // A fresh frame per test: this test deliberately leaves its autosave
    // timer running (neither Save nor Back-discard is ever tapped, which is
    // the whole point — it's simulating an interruption), so without a
    // reload it keeps ticking into whichever test runs next.
    await reloadFrame();
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Autosave Draft Job', jobType: 'termite' });
    await win.ReportUI.openReview(job.id);
    await wait(300);
    Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
      .find((el) => el.textContent.includes('Conducive Conditions')).click();
    await wait(300);

    const ta = doc.querySelectorAll('#view-report-section textarea')[0];
    setTextInput(win, ta, 'Typed but never saved — interrupted here');

    fireVisibility(win, true);
    await wait(200);
    fireVisibility(win, false);

    const draft = await win.DB.getSectionDraft(job.id, 'conducive');
    assert(draft, 'backgrounding the tab must persist a draft, not wait for the next timer tick');
    assertEqual(Object.values(draft.values).find((v) => v === 'Typed but never saved — interrupted here'),
      'Typed but never saved — interrupted here', 'the actual typed text is what gets recovered');

    // A brand-new report lives purely in memory until something real is
    // saved (see loadOrCreateReport) — so DB.getReport can genuinely still
    // be undefined here, and that itself is part of what this proves:
    // nothing about backgrounding the tab caused a premature commit.
    const saved = await win.DB.getReport(job.id);
    assert(!saved || !saved.sections.conducive || saved.sections.conducive.treeAssessmentNotes !== ta.value,
      'critically, the draft must NOT have touched the real committed report — only Save does that');
  });

  test('Autosave: reopening a section with a newer draft offers to restore it', async () => {
    await reloadFrame(); // this test also opens a section and never saves or backs out of it
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Autosave Restore Job', jobType: 'termite' });
    await win.DB.saveSectionDraft(job.id, 'conducive', { treeAssessmentNotes: 'Recovered from an interruption' });

    let confirmMessage = null;
    const origConfirm = win.confirm;
    win.confirm = (msg) => { confirmMessage = msg; return true; };
    try {
      await win.ReportUI.openReview(job.id);
      await wait(300);
      Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
        .find((el) => el.textContent.includes('Conducive Conditions')).click();
      await wait(300);
    } finally {
      win.confirm = origConfirm;
    }

    assert(confirmMessage && /unsaved work/i.test(confirmMessage), 'must ask before restoring, not do it silently');
    const ta = doc.querySelectorAll('#view-report-section textarea')[0];
    assertEqual(ta.value, 'Recovered from an interruption', 'accepting restores the actual interrupted text into the editor');
  });

  test('Autosave: declining the restore discards the draft for good', async () => {
    await reloadFrame();
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Autosave Decline Job', jobType: 'termite' });
    await win.DB.saveSectionDraft(job.id, 'conducive', { treeAssessmentNotes: 'Should be thrown away' });

    const origConfirm = win.confirm;
    win.confirm = () => false;
    try {
      await win.ReportUI.openReview(job.id);
      await wait(300);
      Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
        .find((el) => el.textContent.includes('Conducive Conditions')).click();
      await wait(300);
    } finally {
      win.confirm = origConfirm;
    }

    const ta = doc.querySelectorAll('#view-report-section textarea')[0];
    assertEqual(ta.value, '', 'declining must not leave the discarded draft visible');
    assert(!(await win.DB.getSectionDraft(job.id, 'conducive')), 'and the draft itself must actually be gone, not just hidden');
  });

  test('Autosave: saving the section for real clears the draft behind it', async () => {
    // Otherwise the next person to open this section gets asked to "restore"
    // work that was already saved minutes ago.
    await reloadFrame();
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Autosave Clear On Save Job', jobType: 'termite' });
    await win.ReportUI.openReview(job.id);
    await wait(300);
    Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
      .find((el) => el.textContent.includes('Conducive Conditions')).click();
    await wait(300);

    setTextInput(win, doc.querySelectorAll('#view-report-section textarea')[0], 'Finished and saved properly');
    fireVisibility(win, true);
    await wait(200);
    fireVisibility(win, false);
    assert(await win.DB.getSectionDraft(job.id, 'conducive'), 'sanity check: the draft exists before saving');

    doc.getElementById('section-save-btn').click();
    await wait(400);

    assert(!(await win.DB.getSectionDraft(job.id, 'conducive')), 'a real save must clear the safety-net draft behind it');
  });

  test('Autosave: a draft that matches what is already saved is not offered back', async () => {
    // Opening a section, looking at it, and leaving without touching
    // anything is not "unsaved work" — nagging about it every time trains
    // technicians to reflexively tap through the real warning too.
    await reloadFrame();
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Autosave No Noise Job', jobType: 'termite' });
    await win.ReportUI.openReview(job.id);
    await wait(300);
    Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
      .find((el) => el.textContent.includes('Conducive Conditions')).click();
    await wait(300);
    fireVisibility(win, true);
    await wait(200);
    fireVisibility(win, false);

    let confirmCalled = false;
    const origConfirm = win.confirm;
    win.confirm = () => { confirmCalled = true; return true; };
    try {
      Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
        .find((el) => el.textContent.includes('Conducive Conditions')).click();
      await wait(300);
    } finally {
      win.confirm = origConfirm;
    }
    assert(!confirmCalled, 'a draft identical to the committed data must not prompt anything');
  });

  test('Invoicing: backgrounding the tab mid-edit autosaves the invoice itself', async () => {
    // Unlike a report section, an invoice is already a real saved row from
    // the moment it's opened — there is no separate draft store here, so
    // recovering from an interruption just means writing more often, not
    // restoring anything on reopen.
    await reloadFrame();
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Invoice Autosave Job', jobType: 'pest_treatment' });
    await win.InvoiceUI.open(job.id);
    await wait(300);

    setTextInput(win, doc.getElementById('invoice-client-name'), 'Interrupted Client Pty Ltd');
    fireVisibility(win, true);
    await wait(250);
    fireVisibility(win, false);

    const invoices = await win.DB.getInvoicesForJob(job.id);
    assertEqual(invoices[0].clientName, 'Interrupted Client Pty Ltd',
      'the client name typed just before the tab was backgrounded must already be on disk');
  });

  // ---------- Calendar feed ----------
  // The feed itself is served by an Edge Function nothing here can reach
  // (it needs a live deploy), so these pin what's testable without one: the
  // markup exists, and a Postgres error a technician would never understand
  // gets translated into one they can act on — the same discipline sync.js's
  // message tests hold it to.

  test('Overlap: creating a job through the new-job form checks the diary too', async () => {
    // The fifth booking path, and the easiest to forget precisely because it
    // isn't in the scheduler at all — a technician adding a job straight
    // from the job list, giving it a time on the spot.
    await reloadFrame();
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const day = dayThisMonth(18);
    await win.DB.addJob({ name: 'Form Clash Existing', scheduledAt: new Date(day).setHours(10, 0, 0, 0), scheduledDurationMins: 60 });

    doc.getElementById('new-job-btn').click();
    doc.getElementById('job-name').value = 'Form Clash New';
    doc.getElementById('job-scheduled-date').value = localISO(dayThisMonth(18));
    doc.getElementById('job-scheduled-time').value = '10:00';

    const origConfirm = win.confirm;
    let confirmMessage = null;
    win.confirm = (msg) => { confirmMessage = msg; return false; }; // decline
    try {
      doc.getElementById('job-form-save').click();
      await wait(300);
    } finally {
      win.confirm = origConfirm;
    }
    assert(confirmMessage && /Form Clash Existing/i.test(confirmMessage),
      `the new-job form must ask before booking over an existing job, got: ${confirmMessage}`);
    assert(!(await win.DB.getJobs()).some((j) => j.name === 'Form Clash New'),
      'declining must stop the job being created at all, not just leave it unscheduled');
  });

  // ---------- In-app dialogs (dialog.js) ----------
  // The real thing, not the test double installed by installDialogDouble —
  // these are what stop "the app asks before deleting" from quietly meaning
  // "the app calls a function that no longer shows anything on iOS".

  function dialogCard(doc) { return doc.querySelector('.app-dialog .app-dialog-card'); }
  function dialogButton(doc, label) {
    return Array.from(doc.querySelectorAll('.app-dialog .app-dialog-actions button'))
      .find((b) => b.textContent.trim() === label);
  }

  test('Dialog: confirm puts a real element on screen and resolves true when accepted', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const answer = win.__realDialog.confirm('Delete the thing?', { okLabel: 'Delete', danger: true });
    await wait(50);

    assert(dialogCard(doc), 'a confirm must actually render — this is the whole point of not using window.confirm');
    assert(/Delete the thing\?/.test(dialogCard(doc).textContent), 'the question must be readable on screen');
    const okBtn = dialogButton(doc, 'Delete');
    assert(okBtn, 'the accepting button uses the label it was given, not a generic OK');
    assert(okBtn.classList.contains('btn-danger'), 'a destructive confirm should look destructive');

    okBtn.click();
    assertEqual(await answer, true, 'accepting resolves true, same contract as window.confirm');
    await wait(50);
    assert(!dialogCard(doc), 'and the dialog is gone afterwards');
  });

  test('Dialog: confirm resolves false when cancelled, and on Escape', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;

    const cancelled = win.__realDialog.confirm('Sure?');
    await wait(50);
    dialogButton(doc, 'Cancel').click();
    assertEqual(await cancelled, false, 'Cancel resolves false');

    const escaped = win.__realDialog.confirm('Sure?');
    await wait(50);
    doc.querySelector('.app-dialog').dispatchEvent(
      new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assertEqual(await escaped, false, 'Escape means no, the same as Cancel');
    await wait(50);
    assert(!dialogCard(doc), 'Escape also closes it');
  });

  test('Dialog: prompt returns what was typed, and null when cancelled', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;

    const typed = win.__realDialog.prompt('Reason?', 'starting value');
    await wait(50);
    const input = doc.querySelector('.app-dialog .app-dialog-input');
    assert(input, 'a prompt needs somewhere to type');
    assertEqual(input.value, 'starting value', 'the default value is prefilled, same as window.prompt');
    input.value = 'Corrected after the client called';
    dialogButton(doc, 'OK').click();
    assertEqual(await typed, 'Corrected after the client called', 'resolves the entered text');

    const cancelled = win.__realDialog.prompt('Reason?', '');
    await wait(50);
    dialogButton(doc, 'Cancel').click();
    assertEqual(await cancelled, null,
      'cancelling resolves null, not empty string — callers distinguish "no reason given" from "cancelled"');
  });

  test('Dialog: message text is never treated as markup', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    // These strings interpolate client and job names straight off the record.
    const answer = win.__realDialog.confirm('Delete "<img src=x onerror=alert(1)>"?');
    await wait(50);
    const card = dialogCard(doc);
    assert(!card.querySelector('img'), 'a job name containing markup must not become markup');
    assert(/<img src=x/.test(card.textContent), 'it shows as the literal text it is');
    dialogButton(doc, 'Cancel').click();
    await answer;
  });

  // ---------- iOS "add to home screen" notice (ios-install.js) ----------

  test('iOS notice: stays out of the way when the app is already installed, or not on iOS', () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    // The suite runs in a desktop test browser, so this is the real answer
    // to both questions rather than a stubbed one.
    assertEqual(win.IosInstallNotice.isIOS(), false, 'a desktop test browser is not an iPhone');
    assertEqual(win.IosInstallNotice.isStandalone(), false, 'and the test frame is not an installed app');
    win.IosInstallNotice.maybeShow();
    assert(!doc.getElementById('ios-install-notice'),
      'maybeShow must render nothing when the platform checks say it does not apply');
  });

  test('iOS notice: explains that uninstalled means iPhone can delete saved work', () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    try {
      win.IosInstallNotice.render();
      const bar = doc.getElementById('ios-install-notice');
      assert(bar, 'the notice renders when asked to');
      assert(/Home Screen/i.test(bar.textContent), 'it says what to do');
      assert(/7 days/.test(bar.textContent) && /delete/i.test(bar.textContent),
        'and why it matters — without the consequence it reads as an ad for installing the app');
    } finally {
      const bar = doc.getElementById('ios-install-notice');
      if (bar) bar.remove();
    }
  });

  test('iOS notice: dismissing it sticks, so it never becomes a nag', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    try {
      win.localStorage.removeItem(win.IosInstallNotice.DISMISS_KEY);
      win.IosInstallNotice.render();
      Array.from(doc.querySelectorAll('#ios-install-notice button'))
        .find((b) => /dismiss/i.test(b.textContent)).click();
      await wait(50);
      assert(!doc.getElementById('ios-install-notice'), 'dismissing removes it right away');
      assertEqual(win.localStorage.getItem(win.IosInstallNotice.DISMISS_KEY), '1',
        'and it is remembered, so the next launch does not ask again');
    } finally {
      win.localStorage.removeItem(win.IosInstallNotice.DISMISS_KEY);
      const bar = doc.getElementById('ios-install-notice');
      if (bar) bar.remove();
    }
  });

  test('Calendar feed: the panel exists and starts hidden', () => {
    const doc = frame.contentDocument;
    assert(doc.getElementById('calendar-feed-open'), 'the scheduler offers a way to open the feed panel');
    assert(doc.getElementById('calendar-feed-panel').classList.contains('hidden'), 'closed until asked for');
  });

  test('Scheduler: opening the calendar feed and the booking assistant never leaves both showing at once', async () => {
    const doc = frame.contentDocument;
    doc.getElementById('calendar-feed-open').click();
    doc.getElementById('agent-open').click();
    await wait(100);
    assert(doc.getElementById('calendar-feed-panel').classList.contains('hidden'),
      'opening the assistant after the feed panel must close the feed panel');
    assert(!doc.getElementById('agent-panel').classList.contains('hidden'), 'the assistant should be the one showing');

    doc.getElementById('calendar-feed-open').click();
    await wait(100);
    assert(doc.getElementById('agent-panel').classList.contains('hidden'),
      'and going back the other way must close the assistant in turn');
    assert(!doc.getElementById('calendar-feed-panel').classList.contains('hidden'), 'the feed panel should be the one showing');
  });

  // ---------- Deletions that stick (tombstones) ----------
  // The bug these exist to stop: sync pushes any local record the cloud does
  // not have, which cannot tell "deleted" from "not uploaded yet". A job
  // deleted on the phone came back from the laptop, and 64 rows from a test
  // run five weeks earlier reappeared minutes after the table was cleared.

  test('Deletions: deleting a job leaves a tombstone for it and everything under it', async () => {
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Tombstone Job' });
    await win.DB.addCapture({ jobId: job.id, zone: 'Front', type: 'photo', photoBlob: new win.Blob(['x'], { type: 'image/jpeg' }) });
    await win.DB.saveReport({ jobId: job.id, sections: {}, finalizedAt: null });

    await win.DB.deleteJob(job.id);

    assert(await win.DB.isDeleted('jobs', job.id), 'the job itself');
    assert(await win.DB.isDeleted('reports', job.id),
      'and its report — another device holds its own copy and would push it back as an orphan');
  });

  test('Deletions: a tombstone is what stops a delete being undone by the next sync', async () => {
    const win = frame.contentWindow;
    // This is the exact shape of the bug. A record exists locally and not on
    // the server. Without a tombstone that reads as "needs uploading".
    const job = await win.DB.addJob({ name: 'Resurrection Job' });
    assert(!(await win.DB.isDeleted('jobs', job.id)),
      'a brand new job must be pushable — it is absent from the server because it is new');

    await win.DB.deleteJob(job.id);
    assert(await win.DB.isDeleted('jobs', job.id),
      'once deleted, the same absence must read as deliberate instead');
  });

  test('Deletions: a delete made with no signal is remembered until it can be sent', async () => {
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Offline Delete Job' });
    await win.DB.deleteJob(job.id);

    // Sync never runs in test mode, so nothing has been able to tell the
    // server — which is exactly the offline case.
    const pending = await win.DB.getUnsyncedDeletions();
    assert(pending.some((d) => d.recordId === job.id && d.table === 'jobs'),
      'an unsent deletion has to stay queued, or the next pull downloads the job again');

    await win.DB.markDeletionSynced('jobs:' + job.id);
    const after = await win.DB.getUnsyncedDeletions();
    assert(!after.some((d) => d.recordId === job.id && d.table === 'jobs'),
      'and stop being queued once it has actually been sent');
  });

  test('Deletions: a tombstone from another device is not echoed back as a new one', async () => {
    const win = frame.contentWindow;
    // Applying a deletion that arrived from the server must not queue it for
    // re-sending — two devices would bounce it between them forever.
    await win.DB.recordRemoteDeletion('jobs', 'came-from-elsewhere', Date.now());
    const pending = await win.DB.getUnsyncedDeletions();
    assert(!pending.some((d) => d.recordId === 'came-from-elsewhere'),
      'a deletion the server told us about is already synced by definition');
    assert(await win.DB.isDeleted('jobs', 'came-from-elsewhere'), 'but it still counts as deleted here');
  });

  test('Deletions: applying one removes the local copy without re-triggering a delete', async () => {
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Remote Delete Target' });
    await win.DB.addCapture({ jobId: job.id, zone: 'Rear', type: 'photo', photoBlob: new win.Blob(['x'], { type: 'image/jpeg' }) });

    await win.DB.deleteJobLocalOnly(job.id);

    assert(!(await win.DB.getJob(job.id)), 'the job is gone locally');
    assertEqual((await win.DB.getCaptures(job.id)).length, 0, 'and so are its photos');
    // The local-only path must not manufacture a tombstone: the deletion
    // already has one, and this device did not make the decision.
    const pending = await win.DB.getUnsyncedDeletions();
    assert(!pending.some((d) => d.recordId === job.id),
      'applying somebody else\u2019s deletion must not queue it for sending back');
  });

  test('Deletions: a tombstone keeps the exact time, so newer work can outrank it', async () => {
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Tombstone Timing Job' });
    await win.DB.deleteJob(job.id);

    const tomb = await win.DB.getDeletionRecord('jobs', job.id);
    assert(tomb, 'the tombstone is retrievable, not just a yes/no');
    assert(typeof tomb.deletedAt === 'number' && tomb.deletedAt > 0,
      'and carries when — enforcement compares it against the row\u2019s updated_at, so a '
      + 'record deliberately recreated later is left alone instead of being deleted again');
    assertEqual(tomb.table, 'jobs');
    assertEqual(tomb.recordId, job.id);

    assertEqual(await win.DB.getDeletionRecord('jobs', 'never-deleted-id'), undefined,
      'and nothing is invented for a record that was never deleted');
  });

  // ---------- Recurring service plans ----------
  // The failure these exist to stop: a property that quietly leaves the
  // schedule forever because one visit's paperwork never got finished.

  test('Plans: a visit that finished with no paperwork still brings the client back', async () => {
    const win = frame.contentWindow;
    // The case that used to lose a property permanently: completed, but no
    // report was finalized, so nothing ever set a due date and nothing
    // anywhere remembered it existed.
    const job = await win.DB.addJob({
      name: 'Plan Source', address: '1 Plan St', clientPhone: '0400000111', clientEmail: 'plan@example.com',
    });
    await win.DB.updateJob(job.id, { status: 'completed', recurrenceMonths: 12, inspectionEndedAt: Date.now() });

    const next = await win.DB.ensureNextOccurrence(await win.DB.getJob(job.id));
    assert(next, 'a planned property must raise its own next visit');
    assertEqual(next.recurringFromId, job.id, 'the new visit knows where it came from');
    assertEqual(next.recurrenceMonths, 12, 'and carries the plan, or the series would last one hop');
    assertEqual(next.clientPhone, '0400000111', 'the client comes with it');
    assert(next.nextDueAt > Date.now(), 'it is due in the future');
    assert(!next.scheduledAt, 'due, not booked — which morning it lands on is a decision for that week');
  });

  test('Plans: raising the next visit twice does not double-book the client', async () => {
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Plan Idempotent' });
    await win.DB.updateJob(job.id, { status: 'completed', recurrenceMonths: 6, inspectionEndedAt: Date.now() });

    const first = await win.DB.ensureNextOccurrence(await win.DB.getJob(job.id));
    const second = await win.DB.ensureNextOccurrence(await win.DB.getJob(job.id));
    assertEqual(first.id, second.id,
      'two devices completing the same job offline must not each raise a visit');
    const all = await win.DB.getJobs();
    assertEqual(all.filter((j) => j.recurringFromId === job.id).length, 1);
  });

  test('Plans: a job with no plan raises nothing', async () => {
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Plan Absent' });
    await win.DB.updateJob(job.id, { status: 'completed' });
    assertEqual(await win.DB.ensureNextOccurrence(await win.DB.getJob(job.id)), null,
      'a one-off job must not silently become a subscription');
  });

  test('Plans: the normal report-driven flow is left alone', async () => {
    const win = frame.contentWindow;
    // A finalized report already set a due date, so the backlog and the
    // rebook button have this property covered. Raising a second job here
    // would show the same client twice — the plan is a safety net for when
    // that flow never ran, not a replacement for it.
    const job = await win.DB.addJob({ name: 'Plan Already Handled' });
    await win.DB.updateJob(job.id, {
      status: 'completed', recurrenceMonths: 12,
      nextDueAt: Date.now() + 86400000 * 300, inspectionEndedAt: Date.now(),
    });
    assertEqual(await win.DB.ensureNextOccurrence(await win.DB.getJob(job.id)), null,
      'a property already carrying a due date must not be raised a second time');
  });

  test('Plans: a series that stopped repairs itself on the next sweep', async () => {
    const win = frame.contentWindow;
    // Exactly the historical case: completed months ago, on a plan, and the
    // next visit was never raised because the completion predates plans.
    const stranded = await win.DB.addJob({ name: 'Plan Stranded' });
    await win.DB.updateJob(stranded.id, {
      status: 'completed', recurrenceMonths: 12, inspectionEndedAt: Date.now() - 86400000 * 40,
    });

    const raised = await win.DB.catchUpRecurringPlans();
    assert(raised.some((j) => j.recurringFromId === stranded.id),
      'a plan that stopped must come back on its own, not stay stopped forever');

    // And a second sweep must be quiet, or every load would add another.
    const again = await win.DB.catchUpRecurringPlans();
    assert(!again.some((j) => j.recurringFromId === stranded.id), 'the sweep is not a duplicator');
  });

  test('Plans: the next visit is due from when the work happened, not from now', async () => {
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Plan Timing' });
    // Finished a month ago. A 12-month plan means eleven months from today,
    // not twelve — otherwise every late-entered completion quietly pushes
    // the whole series further out.
    const endedAt = Date.now() - 86400000 * 30;
    await win.DB.updateJob(job.id, { status: 'completed', recurrenceMonths: 12, inspectionEndedAt: endedAt });

    const next = await win.DB.ensureNextOccurrence(await win.DB.getJob(job.id));
    const expected = new Date(endedAt);
    expected.setMonth(expected.getMonth() + 12);
    const driftDays = Math.abs(next.nextDueAt - expected.getTime()) / 86400000;
    assert(driftDays < 1, `due date should follow the visit, drifted ${driftDays.toFixed(1)} days`);
  });

  // ---------- Travel time between jobs ----------

  test('Travel: the estimate is in the right ballpark for a real Macarthur run', () => {
    const win = frame.contentWindow;
    // Campbelltown to Camden — about 12km by road, a known quantity.
    const campbelltown = { addressLat: -34.0650, addressLng: 150.8140 };
    const camden = { addressLat: -34.0547, addressLng: 150.6967 };
    const mins = win.Scheduler.travelMinutesBetween(campbelltown, camden);
    assert(mins >= 15 && mins <= 45,
      `a cross-Macarthur drive should read as a real trip, got ${mins} min`);

    // Two jobs in the same street are still a trip — gear in, gear out.
    const nextDoor = { addressLat: -34.0650, addressLng: 150.8142 };
    const short = win.Scheduler.travelMinutesBetween(campbelltown, nextDoor);
    assert(short > 0 && short < mins, `next door must be quicker than across the region, got ${short}`);
  });

  test('Travel: no coordinates means no estimate, never a zero', () => {
    const win = frame.contentWindow;
    const withCoords = { addressLat: -34.06, addressLng: 150.81 };
    // Coordinates are only saved when the address was picked from the
    // suggestion list, so plenty of real jobs have none. Returning 0 would
    // read as "no travel needed" and quietly approve an impossible day.
    assertEqual(win.Scheduler.travelMinutesBetween(withCoords, { address: '1 Typed St' }), null);
    assertEqual(win.Scheduler.travelMinutesBetween({ address: '2 Typed St' }, withCoords), null);
    assertEqual(win.Scheduler.travelMinutesBetween(null, withCoords), null);
  });

  test('Travel: booking somewhere unreachable in the gap asks before accepting it', async () => {
    const win = frame.contentWindow;
    const day = dayThisMonth(11, 9);
    // Campbelltown at 9am for an hour, then Camden at 10:05 — five minutes
    // to cover a drive of roughly half an hour. Nothing overlaps, so no
    // clash check would ever have caught this.
    await win.DB.addJob({
      name: 'Travel First Job', scheduledAt: day.getTime(), scheduledDurationMins: 60,
      addressLat: -34.0650, addressLng: 150.8140,
    });
    const second = await win.DB.addJob({
      name: 'Travel Second Job', addressLat: -34.0547, addressLng: 150.6967,
    });

    const tooSoon = new Date(day);
    tooSoon.setHours(10, 5, 0, 0);
    let asked = null;
    const origConfirm = win.confirm;
    win.confirm = (msg) => { asked = msg; return false; };
    let allowed;
    try {
      allowed = await win.Scheduler.confirmNoOverlap(second.id, tooSoon.getTime(), 60);
    } finally {
      win.confirm = origConfirm;
    }

    assert(asked, 'a day that cannot physically be driven must be questioned');
    assert(/Travel First Job/.test(asked), `it names the job you would be coming from, got: ${asked}`);
    assert(/estimate/i.test(asked), 'and is honest that it is an estimate, not live traffic');
    assertEqual(allowed, false, 'declining must stop the booking');
  });

  test('Travel: a job that does not exist yet is not blocked by a travel estimate', async () => {
    const win = frame.contentWindow;
    // Rebooking calls the gate with a null id, because the follow-up job is
    // created only after the time is agreed. A travel estimate is advisory;
    // it must never be the thing that stops a real booking being made.
    const day = dayThisMonth(13, 9);
    const clear = await win.Scheduler.confirmNoOverlap(null, day.getTime(), 60);
    assertEqual(clear, true, 'no job yet means nothing to estimate from, so nothing to warn about');
  });

  test('Travel: a sensible gap books without comment', async () => {
    const win = frame.contentWindow;
    const day = dayThisMonth(12, 9);
    await win.DB.addJob({
      name: 'Roomy First Job', scheduledAt: day.getTime(), scheduledDurationMins: 60,
      addressLat: -34.0650, addressLng: 150.8140,
    });
    const second = await win.DB.addJob({
      name: 'Roomy Second Job', addressLat: -34.0547, addressLng: 150.6967,
    });

    const later = new Date(day);
    later.setHours(12, 0, 0, 0); // two hours after the first ends — ample
    let asked = false;
    const origConfirm = win.confirm;
    win.confirm = () => { asked = true; return true; };
    let allowed;
    try {
      allowed = await win.Scheduler.confirmNoOverlap(second.id, later.getTime(), 60);
    } finally {
      win.confirm = origConfirm;
    }
    assert(!asked, 'a day that works must not be second-guessed');
    assertEqual(allowed, true);
  });

  // ---------- Roles and permissions ----------
  // The database is what actually enforces this (migration 016). These cover
  // the app's side: that it does not offer a technician buttons the server
  // will refuse, and that a refused write is never mistaken for a saved one.

  // Puts the app into "signed in as a technician" for the duration of one
  // test. Sync does not exist in test mode (sync.js short-circuits before
  // defining it), so this is a stand-in with the same shape app.js reads.
  async function asTechnician(win, email, fn) {
    const original = win.Sync;
    win.Sync = {
      isAdmin: () => false,
      role: () => 'technician',
      currentUser: () => ({ id: 'tech-1', email }),
      pushJob: () => {}, pushReport: () => {}, pushCapture: () => {},
    };
    try { await fn(); } finally { win.Sync = original; }
  }

  test('Permissions: a technician is not offered delete, or the whole-business export', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Perms Own Job' });
    await win.DB.updateJob(job.id, { assignedTo: 'tech@example.com' });

    await asTechnician(win, 'tech@example.com', async () => {
      await win.showJobViewById(job.id);
      await wait(200);
      assert(doc.getElementById('delete-job-btn').classList.contains('hidden'),
        'deleting a job takes its photos with it and cannot be undone — admin only');

      await win.ReportUI.openArchive();
      await wait(250);
      assert(doc.getElementById('export-data-btn').classList.contains('hidden'),
        'one tap on export hands over every job, report and invoice in the business');
    });
  });

  test('Permissions: a technician can still open and read a job that belongs to someone else', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Perms Other Job' });
    await win.DB.updateJob(job.id, { assignedTo: 'someone.else@example.com' });

    await asTechnician(win, 'tech@example.com', async () => {
      await win.showJobViewById(job.id);
      await wait(200);
      // Reading stays open on purpose: covering a job, or answering a client
      // who rang, should not require a reassignment first.
      assert(!doc.getElementById('view-job').classList.contains('hidden'), 'the job still opens');
      const notice = doc.getElementById('job-readonly-notice');
      assert(notice, 'but it must say plainly that edits will not be kept');
      assert(/read only/i.test(notice.textContent), `got: ${notice && notice.textContent}`);
      assert(/reassign/i.test(notice.textContent), 'and what to do about it');
    });
  });

  test('Permissions: an unassigned job is editable, so historical work does not lock up', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    // Every job created before migration 013 has no assigned_to, which is
    // most of the existing database. Treating those as off-limits would make
    // a technician's app refuse to save against years of real work.
    const job = await win.DB.addJob({ name: 'Perms Unassigned Job' });
    await win.DB.updateJob(job.id, { assignedTo: '' });

    await asTechnician(win, 'tech@example.com', async () => {
      await win.showJobViewById(job.id);
      await wait(200);
      assert(!doc.getElementById('job-readonly-notice'),
        'an unassigned job belongs to nobody yet, so anyone may take it');
    });
  });

  test('Permissions: an admin sees everything, on any job', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Perms Admin Job' });
    await win.DB.updateJob(job.id, { assignedTo: 'someone.else@example.com' });

    await win.showJobViewById(job.id); // no Sync stub: test mode reads as admin
    await wait(200);
    assert(!doc.getElementById('job-readonly-notice'), 'an admin is never read-only');
    assert(!doc.getElementById('delete-job-btn').classList.contains('hidden'), 'and keeps delete');
  });

  // ---------- Is the AI any good? (report.js aiReview) ----------

  test('AI accuracy: counts nothing until the AI has actually been used', () => {
    const win = frame.contentWindow;
    const summary = win.ReportUI.aiAccuracySummary([
      { jobId: 'a', sections: {} },
      { jobId: 'b', sections: {}, aiReview: { kept: 0, corrected: 0, fields: {} } },
    ]);
    assertEqual(summary.total, 0, 'reports that predate this, or never used AI, are not evidence either way');
    assertEqual(summary.keptPercent, null, 'and no percentage is invented out of no data');
  });

  test('AI accuracy: a kept suggestion and a corrected one are told apart', () => {
    const win = frame.contentWindow;
    const summary = win.ReportUI.aiAccuracySummary([
      { jobId: 'a', aiReview: { kept: 3, corrected: 1, fields: { 'findings.liveTermitesFound': { kept: 3, corrected: 1 } } } },
      { jobId: 'b', aiReview: { kept: 1, corrected: 3, fields: { 'conducive.moisture': { kept: 1, corrected: 3 } } } },
    ]);
    assertEqual(summary.kept, 4);
    assertEqual(summary.corrected, 4);
    assertEqual(summary.total, 8);
    assertEqual(summary.keptPercent, 50);
    assertEqual(summary.reportsWithAi, 2);
    // The per-field split is the point: one prompt being reliable and
    // another being useless must not average into a meaningless number.
    assertEqual(summary.fields['findings.liveTermitesFound'].kept, 3);
    assertEqual(summary.fields['conducive.moisture'].corrected, 3);
  });

  test('AI accuracy: a technician editing an AI-filled field is recorded as a correction', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'AI Review Job', jobType: 'termite' });
    // A saved AI draft is what makes openSectionEditor pre-fill a field and
    // mark it as a suggestion — the same path a real draft takes.
    await win.DB.saveReport({
      jobId: job.id,
      sections: {},
      finalizedAt: null,
      aiDraft: { draftFields: { clientDetails: { clientName: 'AI Guessed This Name' } } },
    });
    await win.ReportUI.openReview(job.id);
    await wait(250);
    Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
      .find((li) => /Client Details/.test(li.textContent)).click();
    await wait(250);

    const input = Array.from(doc.querySelectorAll('#report-section-fields input'))
      .find((i) => i.value === 'AI Guessed This Name');
    assert(input, 'the AI value should be pre-filled into the field');
    setTextInput(win, input, 'What The Technician Actually Found');
    doc.getElementById('section-save-btn').click();
    await wait(400);

    const saved = await win.DB.getReport(job.id);
    assert(saved.aiReview, 'using an AI suggestion must leave a record of how it went');
    assertEqual(saved.aiReview.corrected, 1, 'a value the technician rewrote counts as corrected');
    assertEqual(saved.aiReview.kept, 0, 'and not as kept');
  });

  test('AI accuracy: a suggestion left alone is recorded as kept, and only counted once', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'AI Kept Job', jobType: 'termite' });
    await win.DB.saveReport({
      jobId: job.id,
      sections: {},
      finalizedAt: null,
      aiDraft: { draftFields: { clientDetails: { clientName: 'Name The AI Got Right' } } },
    });

    // Save the same section twice. The technician was only ever offered that
    // suggestion once, so it must not count twice.
    for (let i = 0; i < 2; i++) {
      await win.ReportUI.openReview(job.id);
      await wait(250);
      Array.from(doc.querySelectorAll('#report-section-list .report-section-item'))
        .find((li) => /Client Details/.test(li.textContent)).click();
      await wait(250);
      doc.getElementById('section-save-btn').click();
      await wait(400);
    }

    const saved = await win.DB.getReport(job.id);
    assertEqual(saved.aiReview.kept, 1, 'kept once, counted once — not once per save');
    assertEqual(saved.aiReview.corrected, 0);
  });

  // ---------- AI error wording (ai.js) ----------
  // The AI is the feature Tal is least able to verify by eye, so when it
  // fails the message is the whole product. These guard the translation
  // from "what the server said" to "what the technician should do".

  // Stands in for supabase-js's FunctionsHttpError: a generic message, with
  // the real response kept on .context. Reproducing that shape is the only
  // way to prove the recovery works without a live backend.
  function functionsHttpError(win, status, bodyObject) {
    const err = new Error('Edge Function returned a non-2xx status code');
    err.context = new win.Response(JSON.stringify(bodyObject), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
    return err;
  }

  test('AI errors: the message the function actually sent is recovered, not the HTTP status', async () => {
    const win = frame.contentWindow;
    const M = win.AIMessages;
    // This is the real case: the app ships a feature before the Edge
    // Function is redeployed, so the server rejects the action it has never
    // heard of. The status code made supabase-js throw the explanation away.
    const err = functionsHttpError(win, 400, {
      error: 'Unknown action — expected "draft-report", "trace-building", "identify-pest", "identify-tree", or "sort-photos"',
    });
    const recovered = await M.edgeErrorMessage(err);
    assert(/unknown action/i.test(recovered),
      `the function's own words must survive the status code, got: ${recovered}`);
    const shown = M.humanError(new Error(recovered));
    assert(/not switched on yet/i.test(shown),
      `and then read as something actionable, got: ${shown}`);
    assert(!/non-2xx|status code/i.test(shown), 'no HTTP vocabulary reaches the technician');
  });

  test('AI errors: a signed-out session is recovered as sign-in advice', async () => {
    const win = frame.contentWindow;
    const M = win.AIMessages;
    const err = functionsHttpError(win, 401, { error: 'Not authenticated' });
    const shown = M.humanError(new Error(await M.edgeErrorMessage(err)));
    assert(/sign|log/i.test(shown), `should tell them to sign in again, got: ${shown}`);
  });

  test('AI errors: an unreadable failure still never shows raw supabase wording', async () => {
    const win = frame.contentWindow;
    const M = win.AIMessages;
    // No context at all — the recovery has nothing to work with, which is
    // exactly when the old code leaked "non-2xx status code" to the screen.
    const bare = new Error('Edge Function returned a non-2xx status code');
    const shown = M.humanError(new Error(await M.edgeErrorMessage(bare)));
    assert(!/non-2xx|status code/i.test(shown), `got: ${shown}`);
    assert(shown.length > 20, 'and it still says something useful rather than going blank');
  });

  test('AI errors: an unrecognised message is passed through rather than swallowed', () => {
    const win = frame.contentWindow;
    const shown = win.AIMessages.humanError(new Error('Anthropic returned 529 overloaded_error'));
    assert(shown.length > 0, 'a mystery message still beats no message');
    assert(/busy|overload/i.test(shown), `an overload should be recognised as busy, got: ${shown}`);
  });

  test('Calendar feed: a missing migration reads as a setup problem, not raw Postgres', () => {
    const win = frame.contentWindow;
    const msg = win.CalendarFeedMessages.feedErrorText(
      new Error("Could not find the table 'public.calendar_feed' in the schema cache"));
    assert(/migration/i.test(msg), 'it names the actual fix, not just that something went wrong');
    assert(!/schema cache/i.test(msg), 'the raw Postgres string never reaches the technician');
  });

  test('Calendar feed: every error path names where the work still is or how to fix it', () => {
    const win = frame.contentWindow;
    const cases = [
      win.CalendarFeedMessages.feedErrorText(new Error('permission denied for table calendar_feed')),
      win.CalendarFeedMessages.feedErrorText(new Error('Failed to fetch')),
      win.CalendarFeedMessages.feedErrorText(new Error('something odd')),
    ];
    for (const msg of cases) assert(msg && msg.length > 10, `every path produces a real message, got: ${msg}`);
  });

  test('Calendar feed: the link embeds the token and points at the functions endpoint', () => {
    const win = frame.contentWindow;
    const url = win.CalendarFeedMessages.feedUrlFor('abc123');
    assert(url && url.includes('/functions/v1/calendar-feed'), `expected the functions endpoint, got: ${url}`);
    assert(url.includes('token=abc123'), 'the token must actually be in the link a calendar app is given');
  });

  test('Calendar feed: each generated token is long and does not repeat', () => {
    const win = frame.contentWindow;
    const a = win.CalendarFeedMessages.randomToken();
    const b = win.CalendarFeedMessages.randomToken();
    assert(a.length >= 48, 'short enough to guess is the one thing this token must never be');
    assert(a !== b, 'two calls must not hand back the same secret');
  });

  // ---------- Returning-client detection ----------
  // There is no clients table — a returning customer is recognised by
  // matching the phone/email being typed against every existing job's own
  // contact fields. These pin the matching rules themselves, since a wrong
  // match here means telling a technician a stranger is a repeat customer,
  // and a missed match means the opposite — the whole point silently failing.

  test('Client history: the same phone in different formats still matches', async () => {
    const win = frame.contentWindow;
    await win.DB.addJob({ name: 'Format Test Job', clientPhone: '0412 345 678' });
    const history = await win.DB.findClientHistory({ phone: '(04) 1234-5678' });
    assert(history.some((j) => j.name === 'Format Test Job'),
      'digits are the same person regardless of spaces, dashes or brackets');
  });

  test('Client history: email match is case-insensitive', async () => {
    const win = frame.contentWindow;
    await win.DB.addJob({ name: 'Case Test Job', clientEmail: 'Jane@Example.com' });
    const history = await win.DB.findClientHistory({ email: 'jane@example.com' });
    assert(history.some((j) => j.name === 'Case Test Job'), 'an inbox does not care about letter case');
  });

  test('Client history: either phone or email matching is enough', async () => {
    // A returning customer often keeps one contact detail and changes the
    // other — a new phone, the same email, or vice versa.
    const win = frame.contentWindow;
    await win.DB.addJob({ name: 'Either Match Job', clientPhone: '0400 111 222', clientEmail: 'old@example.com' });
    const byPhoneOnly = await win.DB.findClientHistory({ phone: '0400 111 222', email: 'different@example.com' });
    const byEmailOnly = await win.DB.findClientHistory({ phone: '0499 999 999', email: 'old@example.com' });
    assert(byPhoneOnly.some((j) => j.name === 'Either Match Job'), 'a phone match alone is enough');
    assert(byEmailOnly.some((j) => j.name === 'Either Match Job'), 'an email match alone is enough');
  });

  test('Client history: a job never matches itself, and unrelated jobs never match', async () => {
    const win = frame.contentWindow;
    const job = await win.DB.addJob({ name: 'Self Match Job', clientPhone: '0455 555 555' });
    const excludingSelf = await win.DB.findClientHistory({ phone: '0455 555 555', excludeJobId: job.id });
    assert(!excludingSelf.some((j) => j.id === job.id), 'the job being created is never its own history');

    const noMatch = await win.DB.findClientHistory({ phone: '0400 000 000', email: 'nobody@nowhere.test' });
    assert(!noMatch.length || !noMatch.some((j) => j.name === 'Self Match Job'),
      'a phone/email that matches nothing must not return unrelated jobs');
  });

  test('Client history: blank phone and email return nothing, never every job', async () => {
    const win = frame.contentWindow;
    const history = await win.DB.findClientHistory({ phone: '', email: '' });
    assertEqual(history.length, 0,
      'two blank fields must never be treated as a match against every job\'s own blank fields');
  });

  test('UI: typing a matching phone into the new-job form shows the returning-client panel', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    await win.DB.addJob({ name: 'Panel Test Prior Job', clientPhone: '0433 222 111', address: '9 Panel St' });

    doc.getElementById('new-job-btn').click();
    await wait(200);
    setTextInput(win, doc.getElementById('job-phone'), '0433222111');

    const panel = doc.getElementById('returning-client-panel');
    await waitFor(() => !panel.classList.contains('hidden'),
      'a matching phone must surface the panel, not stay hidden');
    assert(panel.textContent.includes('Panel Test Prior Job'), 'it names the actual previous job, not just a count');
  });

  test('UI: the returning-client panel clears when the field is emptied', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    await win.DB.addJob({ name: 'Clear Test Prior Job', clientPhone: '0477 888 999' });

    doc.getElementById('new-job-btn').click();
    await wait(200);
    const phoneInput = doc.getElementById('job-phone');
    const panel = doc.getElementById('returning-client-panel');
    setTextInput(win, phoneInput, '0477888999');
    await waitFor(() => !panel.classList.contains('hidden'), 'sanity check: it showed up first');

    setTextInput(win, phoneInput, '');
    await waitFor(() => panel.classList.contains('hidden'),
      'clearing the field must hide it again, not leave a stale match showing');
  });

  async function runAll() {
    // Two concurrent runs share `results` and the test database, so they
    // interleave into nonsense: counts drift mid-run and every scheduler
    // assertion sees double the bookings. Tapping the button twice, or
    // driving the suite from outside while a run is in flight, both do it.
    if (running) return;
    running = true;
    runBtn.disabled = true;
    results.length = 0;
    renderResults();
    try {
      await blankFrame();
      await clearServiceWorkerState();
      await resetTestDb();

      for (const t of tests) {
        try {
          await t.fn();
          results.push({ name: t.name, pass: true });
        } catch (err) {
          results.push({ name: t.name, pass: false, error: err.message || String(err) });
        }
        renderResults();
      }
    } finally {
      running = false;
      runBtn.disabled = false;
    }
  }

  runBtn.addEventListener('click', runAll);
  window.runAllTests = runAll; // lets the suite be driven programmatically, e.g. from outside the page
})();
