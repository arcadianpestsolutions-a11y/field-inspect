// What things are called in SharePoint: one folder per client, and files
// named so they sort by date and say what they are without being opened.
//
// Shared between the sharepoint-files Edge Function and the browser test
// suite. Pure: no network, no Deno, no DOM.
//
//   Arcadian Clients / Documents /
//     Faye Swain - 12 Example St Camden /
//       2026-10-21 Timber Pest Inspection - 12 Example St Camden.pdf
//       2026-10-21 Invoice INV-00918.pdf
//       2026-10-21 Photos /
//         Subfloor 01.jpg, Subfloor 02.jpg, Roof Void 01.jpg ...
//
// WHY A FOLDER IS NAMED ONCE. A client renamed in Scope ("Mrs F Swain" ->
// "Faye Swain") must not grow a second folder; the Edge Function remembers
// the folder it first used for a client (sharepoint_files) and keeps using it.
// These functions only decide the name the first time.

// Characters SharePoint and OneDrive refuse in a file or folder name, plus
// '#' and '%' which are allowed but break links people paste around.
const BAD = /["*:<>?/\\|#%\u0000-\u001f]/g;

export function clean(value, max = 120) {
  let s = String(value == null ? '' : value).replace(BAD, ' ').replace(/\s+/g, ' ').trim();
  // No leading or trailing dots or spaces, and none of the names Windows
  // reserves (a folder called "CON" cannot be synced to a PC).
  s = s.replace(/^[.\s]+|[.\s]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `${s}_`;
  if (s.length > max) s = s.slice(0, max).replace(/[.\s]+$/g, '');
  return s;
}

// "16 Sanctuary Drive, Tahmoor New South Wales, 2573 Australia" ->
// "16 Sanctuary Drive Tahmoor". Street and suburb are what a person
// recognises; the state, postcode and country make every name longer
// without telling Tal anything.
export function shortAddress(address) {
  let s = String(address || '')
    .replace(/,?\s*Australia\s*$/i, '')
    .replace(/\b(New South Wales|NSW|Victoria|VIC|Queensland|QLD|ACT|Australian Capital Territory)\b/gi, '')
    .replace(/\b\d{4}\b/g, '')
    .replace(/[,]+/g, ' ');
  // Council names sometimes come along from the geocoder.
  s = s.replace(/\b[A-Z][a-z]+ (Shire )?Council\b/g, '');
  return clean(s, 80);
}

export function clientFolderName({ clientName, address, fallbackId }) {
  const name = clean(clientName, 60);
  const addr = shortAddress(address);
  const parts = [name, addr].filter(Boolean);
  if (!parts.length) return clean(`Client ${fallbackId || 'unnamed'}`);
  return clean(parts.join(' - '));
}

// YYYY-MM-DD in Sydney time, so a job finished at 9 pm is not filed under
// tomorrow's date (the server runs on UTC).
export function sydneyDate(ts) {
  const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts || '') || Date.now());
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const DOCUMENT_TITLES = {
  timber_pest_inspection: 'Timber Pest Inspection',
  termite_action_plan: 'Termite Management Action Plan',
  termite_certificate: 'Termite Certificate of Installation',
  termite_monitoring: 'Termite Service Record',
  general_pest: 'Pest Treatment Report',
};

export function reportFileName({ documentType, finalizedAt, address }) {
  const title = DOCUMENT_TITLES[documentType] || 'Report';
  const addr = shortAddress(address);
  return `${clean(`${sydneyDate(finalizedAt)} ${title}${addr ? ` - ${addr}` : ''}`, 150)}.pdf`;
}

export function invoiceFileName({ number, issuedAt }) {
  return `${clean(`${sydneyDate(issuedAt)} Invoice ${number || ''}`, 150)}.pdf`;
}

export function photoFolderName(takenAt) {
  return `${sydneyDate(takenAt)} Photos`;
}

// "Subfloor 01.jpg". Numbered within a zone so a batch reads in order and
// two photos of one zone never fight over a name.
export function photoFileName({ zone, index, ext }) {
  const z = clean(zone, 50) || 'Photo';
  const n = String(Math.max(1, Number(index) || 1)).padStart(2, '0');
  const e = /^[a-z0-9]{1,5}$/i.test(String(ext || '')) ? String(ext).toLowerCase() : 'jpg';
  return `${z} ${n}.${e}`;
}

// A path for Graph's /root:/{path}: form, each segment encoded on its own.
export function graphPath(segments) {
  return segments.map((s) => encodeURIComponent(s)).join('/');
}
