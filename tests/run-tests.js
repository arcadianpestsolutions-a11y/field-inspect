(() => {
  'use strict';

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

  async function resetTestDb() {
    if (DB.__resetConnection) await DB.__resetConnection();
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('field-inspect-db-test');
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve; // best-effort; tests are written to be self-isolating either way
    });
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

  test('UI: report header follows the job type', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const termite = await win.DB.addJob({ name: 'Header Termite' });
    const pest = await win.DB.addJob({ name: 'Header Pest', jobType: 'pest_treatment' });

    await win.ReportUI.openReview(termite.id);
    await wait(150);
    assertEqual(doc.getElementById('report-title').textContent, 'Termite Inspection Report', 'termite header');

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

    openSection('Chemicals');
    await wait(200);
    const input = doc.querySelector('.product-card input');
    assert(input, 'product name input should render');
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'DISCARD ME');
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    doc.getElementById('section-back-btn').click(); // discard
    await wait(200);

    openSection('Safety');
    await wait(200);
    doc.getElementById('section-save-btn').click(); // unrelated save
    await wait(300);

    const saved = await win.DB.getReport(job.id);
    assertEqual(saved.sections.chemicals.products[0].productName, 'KEEP ME', 'discarded edit must not persist');
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
  async function runAll() {
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
      runBtn.disabled = false;
    }
  }

  runBtn.addEventListener('click', runAll);
  window.runAllTests = runAll; // lets the suite be driven programmatically, e.g. from outside the page
})();
