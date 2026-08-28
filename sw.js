// Keep this in sync with version.js's APP_VERSION — that's what drives the
// login screen's build-color/label indicator, so a mismatched bump here
// defeats the whole point of it.
const CACHE_NAME = 'field-inspect-v42';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './report-schema.js',
  './pest-treatment-schema.js',
  './pest-products.js',
  './termite-management-schemas.js',
  './invoicing.js',
  './report.js',
  './sync.js',
  './media.js',
  './xero.js',
  './invoice-ui.js',
  './scheduler.js',
  './schedule-agent.js',
  './demo.js',
  './geo.js',
  './ai.js',
  './email.js',
  './version.js',
  // Vendored third-party libs. Same-origin so the service worker can cache
  // them, which is what lets the app boot and export PDFs with no signal.
  './vendor/supabase.min.js',
  './vendor/html2pdf.bundle.min.js',
  './supabase-config.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
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
async function findCached(request) {
  const direct = await caches.match(request);
  if (direct) return direct;
  if (request.mode === 'navigate') {
    return (await caches.match(request, { ignoreSearch: true }))
      || (await caches.match('./index.html'))
      || (await caches.match('./'));
  }
  return undefined;
}

// Cache-first for same-origin GET requests, falling back to network then cache update.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    findCached(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
