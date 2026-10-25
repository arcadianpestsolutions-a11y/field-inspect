// Copies a job's client files into the business's SharePoint site, one folder
// per client: the finalised report PDF, invoices, and the job's photos.
//
// Names and folder rules: _shared/sharepoint-names.js (covered by the suite).
// What has been copied: public.sharepoint_files (migration 038).
//
// HOW IT SIGNS IN TO MICROSOFT. As the "Scope - client files" app registered
// in Arcadian's own Microsoft Entra, with the client-credentials flow. That
// app holds Sites.Selected only, which reaches nothing until a site is
// granted to it individually; it is granted the one site, Arcadian Clients.
// It cannot see mail, Teams, OneDrive or any other site.
//
// NOTHING HAPPENS UNTIL IT IS SET UP. Without MS_CLIENT_SECRET (which Tal
// creates and pastes in himself) every action answers { configured: false }
// and copies nothing. No user-visible error is raised for that state.
//
// Signed-in users only (JWT verification ON), and only for jobs in their own
// business: the job's org is checked against the caller's before anything
// is read.
//
// Actions (POST JSON):
//   { action: 'status' }                       -> { configured, siteUrl? }
//   { action: 'copy-job', jobId }              -> copies report + photos not yet copied
//   { action: 'copy-invoice', jobId, invoiceId, number, issuedAt, pdfBase64 }
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   MS_TENANT_ID, MS_CLIENT_ID, SHAREPOINT_SITE ("host:/sites/Name"),
//   MS_CLIENT_SECRET (Tal's, never in this repo).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';
import { orgIdForUser } from '../_shared/business.js';
import {
  clientFolderName, graphPath, invoiceFileName, photoFileName, photoFolderName, reportFileName,
} from '../_shared/sharepoint-names.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MS_TENANT_ID = Deno.env.get('MS_TENANT_ID') || '';
const MS_CLIENT_ID = Deno.env.get('MS_CLIENT_ID') || '';
const MS_CLIENT_SECRET = Deno.env.get('MS_CLIENT_SECRET') || '';
const SHAREPOINT_SITE = Deno.env.get('SHAREPOINT_SITE') || '';

const BUCKET = 'inspection-media';
const GRAPH = 'https://graph.microsoft.com/v1.0';
// Graph's simple upload takes up to 4 MB; anything bigger goes through an
// upload session in chunks (a multiple of 320 KiB, as Graph requires).
const SIMPLE_LIMIT = 4 * 1024 * 1024;
const CHUNK = 320 * 1024 * 10;
// A job's photos in one call: enough for a full inspection, small enough to
// finish well inside the function's time limit. The app calls again for more.
const MAX_FILES_PER_CALL = 40;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
type Row = Record<string, any>;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const configured = () => !!(MS_TENANT_ID && MS_CLIENT_ID && MS_CLIENT_SECRET && SHAREPOINT_SITE);
const newId = () => `sp_${crypto.randomUUID().replace(/-/g, '')}`;

// ---------- Microsoft ----------
let tokenCache: { token: string; until: number } | null = null;
async function graphToken() {
  if (tokenCache && tokenCache.until > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(MS_TENANT_ID)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  const data = await res.json().catch(() => ({}));
  // Microsoft's error text says which part is wrong (expired secret, wrong
  // tenant); it carries no secret, so it is passed on as-is.
  if (!res.ok || !data.access_token) throw new Error(`Microsoft sign-in failed: ${data.error_description || data.error || res.status}`);
  tokenCache = { token: data.access_token, until: Date.now() + (Number(data.expires_in) || 3000) * 1000 };
  return tokenCache.token;
}

async function graph(path: string, init: RequestInit = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${GRAPH}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await graphToken()}`, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text).error.message || msg; } catch { /* keep text */ }
    if (res.status === 403) msg = `SharePoint refused access (${msg}). Has the Arcadian Clients site been granted to the Scope app?`;
    throw new Error(`SharePoint ${res.status}: ${msg}`);
  }
  return res;
}

let driveCache: { driveId: string; siteUrl: string } | null = null;
async function drive() {
  if (driveCache) return driveCache;
  const site = await (await graph(`/sites/${SHAREPOINT_SITE}`)).json();
  const d = await (await graph(`/sites/${site.id}/drive`)).json();
  driveCache = { driveId: d.id, siteUrl: site.webUrl || '' };
  return driveCache;
}

async function upload(segments: string[], bytes: Uint8Array, contentType: string) {
  const { driveId } = await drive();
  const path = graphPath(segments);
  if (bytes.byteLength <= SIMPLE_LIMIT) {
    const res = await graph(`/drives/${driveId}/root:/${path}:/content?@microsoft.graph.conflictBehavior=replace`, {
      method: 'PUT', headers: { 'content-type': contentType || 'application/octet-stream' }, body: bytes,
    });
    return await res.json();
  }
  const session = await (await graph(`/drives/${driveId}/root:/${path}:/createUploadSession`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
  })).json();
  let item: Row = {};
  for (let start = 0; start < bytes.byteLength; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.byteLength);
    // The upload URL is pre-authorised; it must NOT carry the bearer token.
    const res = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: { 'content-length': String(end - start), 'content-range': `bytes ${start}-${end - 1}/${bytes.byteLength}` },
      body: bytes.slice(start, end),
    });
    if (!res.ok && res.status !== 202) throw new Error(`SharePoint upload failed: ${res.status}`);
    if (res.status === 200 || res.status === 201) item = await res.json();
  }
  return item;
}

// ---------- Scope ----------
async function callerOrg(req: Request) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  return await orgIdForUser(admin, user.id);
}

async function jobFor(jobId: string, orgId: string) {
  const { data: job } = await admin.from('jobs')
    .select('id, name, address, client_id, org_id, inspection_ended_at, created_at')
    .eq('id', jobId).maybeSingle();
  if (!job || job.org_id !== orgId) return null;
  let client: Row | null = null;
  if (job.client_id) {
    const { data } = await admin.from('clients').select('id, name, address').eq('id', job.client_id).maybeSingle();
    client = data || null;
  }
  return { job: job as Row, client };
}

// The folder this client already has, or a new name for one. Keyed on the
// client record where there is one, otherwise on the job.
async function folderFor(job: Row, client: Row | null) {
  const key = client ? { col: 'client_id', val: client.id } : { col: 'job_id', val: job.id };
  const { data } = await admin.from('sharepoint_files').select('folder')
    .eq('org_id', job.org_id).eq(key.col, key.val).neq('folder', '').limit(1);
  if (data && data[0] && data[0].folder) return data[0].folder as string;
  return clientFolderName({
    clientName: (client && client.name) || job.name,
    // The property address, not the client's postal one: a strata manager
    // in the city has properties all over Macarthur.
    address: job.address || (client && client.address) || '',
    fallbackId: job.id,
  });
}

async function alreadyCopied(orgId: string, source: string, version: string) {
  const { data } = await admin.from('sharepoint_files').select('id, source_version')
    .eq('org_id', orgId).eq('source', source).maybeSingle();
  return data && data.source_version === version ? data : (data ? { id: data.id, stale: true } : null);
}

async function record(job: Row, client: Row | null, source: string, version: string, folder: string, spPath: string, item: Row, bytes: number, existingId?: string) {
  const row = {
    id: existingId || newId(), job_id: job.id, client_id: client ? client.id : null, source, source_version: version,
    folder, sp_path: spPath, sp_item_id: item.id || '', web_url: item.webUrl || '', bytes, uploaded_at: Date.now(), org_id: job.org_id,
  };
  const { error } = await admin.from('sharepoint_files').upsert(row, { onConflict: 'org_id,source' });
  if (error) console.error('[sharepoint-files] could not record copy', error.message);
}

async function storageBytes(path: string) {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

async function copyJob(jobId: string, orgId: string) {
  const found = await jobFor(jobId, orgId);
  if (!found) return json({ error: 'not-found' }, 404);
  const { job, client } = found;
  const folder = await folderFor(job, client);
  const copied: string[] = [];
  const skipped: string[] = [];
  let budget = MAX_FILES_PER_CALL;

  // The finalised report. Re-copied when it is finalised again (amended).
  const { data: report } = await admin.from('reports').select('document_type, finalized_at').eq('job_id', job.id).maybeSingle();
  if (report && report.finalized_at) {
    const source = `${job.id}/report/report.pdf`;
    const version = String(report.finalized_at);
    const seen = await alreadyCopied(job.org_id, source, version);
    if (seen && !(seen as Row).stale) skipped.push('report');
    else {
      const bytes = await storageBytes(source);
      if (bytes) {
        const name = reportFileName({ documentType: report.document_type, finalizedAt: report.finalized_at, address: job.address });
        const item = await upload([folder, name], bytes, 'application/pdf');
        await record(job, client, source, version, folder, `${folder}/${name}`, item, bytes.byteLength, seen ? (seen as Row).id : undefined);
        copied.push(name);
        budget--;
      }
    }
  }

  // Photos, numbered per zone in the order they were taken.
  const { data: captures } = await admin.from('captures').select('id, zone, photo_path, created_at')
    .eq('job_id', job.id).not('photo_path', 'is', null).order('created_at', { ascending: true });
  const perZone: Record<string, number> = {};
  let remaining = 0;
  for (const c of captures || []) {
    const zone = (c.zone || 'Photo').trim() || 'Photo';
    perZone[zone] = (perZone[zone] || 0) + 1;
    const seen = await alreadyCopied(job.org_id, c.photo_path, 'v1');
    if (seen && !(seen as Row).stale) continue;
    if (budget <= 0) { remaining++; continue; }
    const bytes = await storageBytes(c.photo_path);
    if (!bytes) continue;
    const ext = String(c.photo_path).split('.').pop();
    const sub = photoFolderName(job.inspection_ended_at || c.created_at);
    const name = photoFileName({ zone, index: perZone[zone], ext });
    const item = await upload([folder, sub, name], bytes, ext === 'png' ? 'image/png' : 'image/jpeg');
    await record(job, client, c.photo_path, 'v1', folder, `${folder}/${sub}/${name}`, item, bytes.byteLength);
    copied.push(`${sub}/${name}`);
    budget--;
  }
  return json({ configured: true, folder, copied: copied.length, skipped: skipped.length, remaining });
}

async function copyInvoice(body: Row, orgId: string) {
  const found = await jobFor(String(body.jobId || ''), orgId);
  if (!found) return json({ error: 'not-found' }, 404);
  const { job, client } = found;
  const b64 = String(body.pdfBase64 || '');
  if (!b64 || b64.length > 20_000_000) return json({ error: 'bad-request', message: 'Invoice PDF missing or too large.' }, 400);
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const folder = await folderFor(job, client);
  const name = invoiceFileName({ number: body.number, issuedAt: body.issuedAt });
  const source = `invoice:${String(body.invoiceId || body.number || '')}`;
  const seen = await alreadyCopied(job.org_id, source, String(body.version || ''));
  const item = await upload([folder, name], bytes, 'application/pdf');
  await record(job, client, source, String(body.version || ''), folder, `${folder}/${name}`, item, bytes.byteLength, seen ? (seen as Row).id : undefined);
  return json({ configured: true, folder, copied: 1 });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const orgId = await callerOrg(req);
  if (!orgId) return json({ error: 'Not authenticated' }, 401);
  let body: Row = {};
  try { body = await req.json(); } catch { /* empty */ }

  if (!configured()) return json({ configured: false });
  try {
    if (body.action === 'status') {
      const { siteUrl } = await drive();
      return json({ configured: true, siteUrl });
    }
    if (body.action === 'copy-job') return await copyJob(String(body.jobId || ''), orgId);
    if (body.action === 'copy-invoice') return await copyInvoice(body, orgId);
    return json({ error: 'bad-request', message: 'Unknown action.' }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sharepoint-files]', message);
    return json({ configured: true, error: 'failed', message }, 502);
  }
});
