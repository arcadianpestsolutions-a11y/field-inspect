// Runs the browser test suite headless, for CI (.github/workflows/tests.yml).
//
// The suite is a web page (tests/run-tests.html) with no framework, so this
// does what a person does: serve the project, open the page in Chromium, run
// every test, and read the result off the page. It fails the job if any test
// fails or the run never finishes, and names each failure as a GitHub
// annotation so it can be read without opening the log.
//
// No dependencies beyond Playwright. Sydney time and an Australian locale,
// because a handful of tests are about Sydney's daylight-saving changes and
// Australian date formats, and the suite's own clock (test-clock.js) handles
// the date.
//
//   node tests/ci-run.mjs            (from the repository root)

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve('.');
const PORT = 8787;
const RUN_LIMIT_MS = 20 * 60 * 1000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.ts': 'text/plain; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

// A static server for the repository, nothing more. Only files under ROOT.
const server = http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((ok) => server.listen(PORT, ok));

const browser = await chromium.launch();
let exitCode = 1;
try {
  const context = await browser.newContext({ timezoneId: 'Australia/Sydney', locale: 'en-AU' });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[page error]', e.message));
  await page.goto(`http://localhost:${PORT}/tests/run-tests.html`);
  await page.waitForFunction(() => typeof window.runAllTests === 'function', null, { timeout: 60000 });

  await page.evaluate(() => { window.__ciDone = false; window.runAllTests().finally(() => { window.__ciDone = true; }); });
  await page.waitForFunction(() => window.__ciDone === true, null, { timeout: RUN_LIMIT_MS, polling: 2000 });

  const result = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/(\d+) passed, (\d+) failed \(of (\d+)\)/);
    const failures = Array.from(document.querySelectorAll('li, div, p'))
      .filter((e) => /^✗/.test(e.innerText || '') && e.children.length < 6)
      .map((e) => e.innerText.trim())
      .filter((v, i, a) => a.indexOf(v) === i);
    return { summary: m ? m[0] : null, passed: m ? +m[1] : 0, failed: m ? +m[2] : -1, total: m ? +m[3] : 0, failures };
  });

  console.log(result.summary || 'No summary on the page.');
  for (const f of result.failures) {
    const [title, ...rest] = f.replace(/^✗\s*/, '').split('\n');
    const detail = rest.join(' ').replace(/[\r\n%]/g, ' ').slice(0, 900);
    console.log(`::error title=${title.replace(/[,:\r\n]/g, ' ').slice(0, 200)}::${detail || title}`);
  }
  exitCode = result.summary && result.failed === 0 && result.total > 0 ? 0 : 1;
} catch (e) {
  console.log(`::error title=Test run did not finish::${String(e && e.message || e).slice(0, 900)}`);
} finally {
  await browser.close();
  server.close();
}
process.exit(exitCode);
