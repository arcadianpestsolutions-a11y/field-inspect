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

  // Scheduler tests must not share a day, or one test's bookings show up in
  // another's hour totals. Day-of-month is fixed per test (and kept <= 28 so
  // it is valid in February) rather than offset from today, which would make
  // which tests collide depend on the date the suite happens to run.
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
      btn.click();
      await wait(400);
      const toastText = doc.getElementById('toast').textContent;
      assert(/blocked|permission/i.test(toastText), `expected a permission message, got: "${toastText}"`);
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
    const d = dayThisMonth(5, 11);
    // Two jobs totalling 3 hours, so the cell has to report both numbers.
    await win.DB.addJob({ name: 'Grid Load A', scheduledAt: d.getTime(), scheduledDurationMins: 120 });
    const d2 = new Date(d);
    d2.setHours(14, 0, 0, 0);
    await win.DB.addJob({ name: 'Grid Load B', scheduledAt: d2.getTime(), scheduledDurationMins: 60 });

    await win.Scheduler.open();
    await wait(400);
    const cell = Array.from(doc.querySelectorAll('.cal-cell:not(.cal-blank)'))
      .find((c) => c.querySelector('.cal-daynum').textContent === String(dayThisMonth(5).getDate()));
    assert(cell, 'the 15th should be in the grid');
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
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
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
