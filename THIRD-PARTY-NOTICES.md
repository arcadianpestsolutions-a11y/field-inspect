# Third-party notices

Four libraries are vendored (copied, unmodified, into `vendor/`) so the app has
no CDN dependency and works offline. Nothing else is bundled; there is no
`package.json`.

| File | Library | Version | Licence | Used for |
|---|---|---|---|---|
| `vendor/supabase.min.js` | @supabase/supabase-js | 2.112.3 (from the file's banner) | MIT | Auth, database, storage and function calls |
| `vendor/html2pdf.bundle.min.js` | html2pdf.js (bundles jsPDF and html2canvas) | see the file's own banner / LICENSE.txt reference | MIT (bundle and its parts) | Turning the report into a PDF to email |
| `vendor/jsqr.min.js` | jsQR | 1.4.0 (from the file's banner) | Apache-2.0 | Scanning asset QR stickers |
| `vendor/qrcode.min.js` | qrcodejs (davidshimjs) | version not stated in file | MIT | Drawing QR stickers and the client-link QR |

Reviewer note: these were not hand-verified against upstream checksums. If that
matters to you, re-download each from the original package at the stated version
and diff. Licence texts are the upstream ones; add them here before any
redistribution outside this repository.

Server side, the Edge Functions import from `esm.sh` / `jsr` at deploy time (see
the `import` lines at the top of each `supabase/functions/*/index.ts`).
