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

  test('UI: a hanging camera prompt still recovers the Start button', async () => {
    // The reported field bug: getUserMedia neither resolves nor rejects when
    // the OS permission sheet is dismissed, so the tap produced no recording
    // and no message. The button must at minimum show it registered the tap.
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const job = await win.DB.addJob({ name: 'Start Hang Job' });
    win.showJobListView();
    await wait(200);
    Array.from(doc.querySelectorAll('#job-list .job-item'))
      .find((li) => li.textContent.includes('Start Hang Job')).click();
    await wait(250);

    const btn = doc.getElementById('start-inspection-btn');
    const original = win.navigator.mediaDevices.getUserMedia;
    try {
      win.navigator.mediaDevices.getUserMedia = () => new Promise(() => {}); // never settles
      btn.click();
      await wait(400);
      assert(btn.disabled, 'button should be disabled while starting');
      assert(/starting/i.test(btn.textContent), `button should show progress, got: "${btn.textContent}"`);
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
    const when = new Date();
    when.setDate(when.getDate() + 3);
    when.setHours(14, 30, 0, 0);
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
    const d = new Date();
    d.setDate(15);
    d.setHours(11, 0, 0, 0);
    // Two jobs totalling 3 hours, so the cell has to report both numbers.
    await win.DB.addJob({ name: 'Grid Load A', scheduledAt: d.getTime(), scheduledDurationMins: 120 });
    const d2 = new Date(d);
    d2.setHours(14, 0, 0, 0);
    await win.DB.addJob({ name: 'Grid Load B', scheduledAt: d2.getTime(), scheduledDurationMins: 60 });

    await win.Scheduler.open();
    await wait(400);
    const cell = Array.from(doc.querySelectorAll('.cal-cell:not(.cal-blank)'))
      .find((c) => c.querySelector('.cal-daynum').textContent === '15');
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
    const d = new Date();
    d.setDate(16);
    d.setHours(10, 0, 0, 0);
    await win.DB.addJob({ name: 'Long Job', scheduledAt: d.getTime(), scheduledDurationMins: 120 });

    await win.Scheduler.open();
    await wait(300);
    Array.from(doc.querySelectorAll('.cal-cell:not(.cal-blank)'))
      .find((c) => c.querySelector('.cal-daynum').textContent === '16').click();
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
      .find((c) => c.querySelector('.cal-daynum').textContent === '17').click();
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
    assertEqual(new Date(saved.scheduledAt).getDate(), 17, 'booked onto the selected day');
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
      .find((c) => c.querySelector('.cal-daynum').textContent === '22');
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
    assertEqual(new Date(a.scheduledAt).getDate(), 22, 'booked onto the selected day');
    // One-tap Book starts from 8am rather than the 7am start of the grid, so
    // an empty day does not put a client in at 7 just because the slot exists.
    assertEqual(new Date(a.scheduledAt).getHours(), 8, 'first booking takes the default start hour');
    assertEqual(new Date(b.scheduledAt).getHours(), 9, 'second booking steps past the clash');

    assert(!rowFor('Backlog A'), 'a booked job should leave the backlog');
  });

  test('Scheduler: booked jobs drop out of the backlog', async () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const d = new Date();
    d.setDate(d.getDate() + 4);
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

    const day = new Date();
    day.setDate(day.getDate() + 2);
    day.setHours(9, 0, 0, 0);
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
    const day = new Date();
    day.setDate(day.getDate() + 3);

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
    const day = new Date();
    day.setDate(day.getDate() + 4);

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
