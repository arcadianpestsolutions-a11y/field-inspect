// Keep this in sync with version.js's APP_VERSION — that's what drives the
// login screen's build-color/label indicator, so a mismatched bump here
// defeats the whole point of it.
const CACHE_NAME = 'field-inspect-v91';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './dialog.js',
  './ios-install.js',
  './db.js',
  './form-render.js',
  './report-schema.js',
  './pest-treatment-schema.js',
  './photo-checklists.js',
  './pest-products.js',
  './termite-management-schemas.js',
  './swms-schema.js',
  './invoicing.js',
  './availability.js',
  './routing.js',
  './reporting.js',
  './assets.js',
  './camera.js',
  './qr-scan.js',
  './pipeline.js',
  './report.js',
  './sync.js',
  './org.js',
  './media.js',
  './xero.js',
  './invoice-ui.js',
  './swms-ui.js',
  './business-ui.js',
  './assets-ui.js',
  './leads-ui.js',
  './client-link.js',
  './scheduler.js',
  './schedule-agent.js',
  './calendar-feed.js',
  './demo.js',
  './geo.js',
  './ai.js',
  './email.js',
  './comms.js',
  './reminders-ui.js',
  './version.js',
  './portal.html',
  './portal-config.js',
  // Vendored third-party libs. Same-origin so the service worker can cache
  // them, which is what lets the app boot and export PDFs with no signal.
  './vendor/supabase.min.js',
  './vendor/html2pdf.bundle.min.js',
  './vendor/qrcode.min.js',
  './vendor/jsqr.min.js',
  './supabase-config.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
];

// Every shell file is fetched with cache: 'reload', which bypasses the
// browser's ordinary HTTP cache and goes to the network.
//
// Without it, cache.addAll() is served by the HTTP cache like any other
// fetch — and GitHub Pages sends these files with a ten-minute max-age that
// its CDN can stretch further. So a browser holding yesterday's app.js will
// copy YESTERDAY'S app.js into the new version's cache, where it then sits
// permanently: the service worker believes it precached the new build, the
// version bump that was supposed to fix things has already been spent, and
// nothing dislodges it until the NEXT deploy happens to catch the file
// fresh. Different files go stale at different moments, so what a device
// ends up running is a mix of builds, which is the worst possible failure
// mode — it looks like a bug in whichever feature happens to straddle the
// split rather than like a caching problem at all.
//
// Caught in the act on the live site: a browser running APP_VERSION v66
// while that same page's service-worker cache AND the network both held
// v79. Nothing was wrong with the deploy; the page had simply been handed a
// months-old version.js out of the HTTP cache. An app.js going stale the
// same way is what a report like "the demo asks me to log in" looks like
// from the outside, since that early return has not always been there.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Finds the cached copy of a request. caches.match() compares the FULL url
// including the query string, so a cached "/" is not a hit for "/?demo=1" —
// which meant every mode the app is entered by (?demo=1, ?test=1, any link
// carrying a parameter) failed to open with no signal, while the bare URL
// worked. On a job site with no reception that is the difference between an
// app that opens and a browser error page.
//
// Only navigations get the relaxed match: a page is the same page whatever
// query it carries, but a versioned asset like foo.js?v=2 is genuinely a
// different file and must not be answered with the old one.
//
// The index.html fallback used to live in here too, and that was a mistake
// worth spelling out. Because this whole worker is cache-first, returning the
// shell from this function meant EVERY in-scope navigation that wasn't already
// cached was answered with the app's own login screen and never even tried the
// network. So tests/run-tests.html opened as the app with 33 missing scripts,
// scope-qr.html was unreachable, and any page added to the app in future would
// have been invisible on every device that had ever loaded it. A fallback
// belongs where the network has actually failed, not ahead of it.
async function findCached(request) {
  const direct = await caches.match(request);
  if (direct) return direct;
  if (request.mode === 'navigate') {
    return await caches.match(request, { ignoreSearch: true });
  }
  return undefined;
}

// Genuinely last resort: a navigation with no signal, no cached copy of that
// exact page, and nothing else to show. The app is only ever entered at "/" or
// "/?demo=1", both of which findCached answers directly, so in practice this is
// for a deep link opened cold and offline.
async function navigationFallback() {
  return (await caches.match('./index.html')) || (await caches.match('./'));
}

// Cache-first for same-origin GET requests, falling back to network then cache update.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await findCached(request);
    const fromNetwork = fetch(request)
      .then((networkResponse) => {
        // Navigations are deliberately not written back. caches.put() keys on
        // the full URL, so every distinct query string stores ANOTHER copy of
        // the same document — the suite's cache-busted iframe loads alone had
        // put 8 identical copies of index.html in here, growing without bound.
        // The shell is precached at install, which is what actually makes the
        // app open with no signal, so runtime-caching a navigation buys
        // nothing.
        if (networkResponse && networkResponse.ok && request.mode !== 'navigate') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      })
      .catch(async () => {
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shell = await navigationFallback();
          if (shell) return shell;
        }
        return Response.error();
      });
    return cached || fromNetwork;
  })());
});
