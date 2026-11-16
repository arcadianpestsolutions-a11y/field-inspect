// Xero integration — OAuth token exchange and draft invoice creation.
//
// WHY THIS IS SERVER-SIDE
// Xero's OAuth uses a client secret and issues long-lived refresh tokens that
// grant write access to a real accounting system. None of that can live in a
// PWA: the bundle is public, and anything in it is readable by anyone who
// loads the page. The browser therefore never sees a Xero token — it asks
// this function to act on Xero, and this function holds the credentials.
//
// Tokens are stored in public.xero_connections, which has RLS enabled and no
// policies, so only the service_role key used here can read them.
//
// v154 (16 Nov 2026), before Xero was ever switched on:
//   - ONE CONNECTION PER BUSINESS. It used to be a single shared row
//     ('default'), which with a second business on Scope would have put that
//     business's invoices into the first one's Xero. The row is now keyed by
//     the caller's organisation, and every action reads only that row.
//   - ONLY AN ADMIN CONNECTS OR DISCONNECTS. It is the business's accounts.
//   - THE OAUTH "state" IS CHECKED. It was generated and never compared, so a
//     link carrying someone else's ?code= could have connected the wrong Xero.
//     It is now stored with the business and must come back unchanged within
//     30 minutes, once.
//   - The organisation chosen is the one just authorised, not whichever Xero
//     lists first, for a login that can see several.
//
// Required secrets (supabase secrets set ...):
//   XERO_CLIENT_ID       — from the app you create at developer.xero.com
//   XERO_CLIENT_SECRET   — same place; never leaves this function
//   XERO_REDIRECT_URI    — must match the app's redirect URI exactly, e.g.
//                          https://arcadianpestsolutions-a11y.github.io/field-inspect/
//   SUPABASE_SERVICE_ROLE_KEY — provided by the platform
//
// Actions: 'status' | 'exchange-code' | 'create-invoice' | 'invoice-statuses' | 'disconnect'

import { orgIdForUser } from '../_shared/business.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';

const XERO_CLIENT_ID = Deno.env.get('XERO_CLIENT_ID') || '';
const XERO_CLIENT_SECRET = Deno.env.get('XERO_CLIENT_SECRET') || '';
const XERO_REDIRECT_URI = Deno.env.get('XERO_REDIRECT_URI') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// service_role client — bypasses RLS, so it alone can read/write the tokens.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface XeroConnection {
  tenant_id: string | null;
  tenant_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
}

interface XeroRow extends XeroConnection {
  oauth_state: string | null;
  oauth_state_at: number | null;
}

// One row per business: id and org_id are both the organisation's id.
async function loadConnection(orgId: string): Promise<XeroRow | null> {
  const { data, error } = await admin.from('xero_connections').select('*').eq('id', orgId).maybeSingle();
  if (error) throw new Error('Could not read the Xero connection: ' + error.message);
  return data as XeroRow | null;
}

async function saveConnection(orgId: string, fields: Record<string, unknown>, userId?: string) {
  const { error } = await admin.from('xero_connections').upsert({
    id: orgId,
    org_id: orgId,
    ...fields,
    ...(userId ? { connected_by: userId } : {}),
    updated_at: Date.now(),
  });
  if (error) throw new Error('Could not save the Xero connection: ' + error.message);
}

const STATE_MS = 30 * 60 * 1000;

// Which business the caller belongs to, and whether they may change its Xero.
async function callerContext(userId: string): Promise<{ orgId: string | null; isAdmin: boolean }> {
  const orgId = await orgIdForUser(admin, userId);
  if (!orgId) return { orgId: null, isAdmin: false };
  const { data, error } = await admin.from('user_roles').select('role').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Could not read your role: ' + error.message);
  return { orgId, isAdmin: !!data && data.role === 'admin' };
}

function basicAuthHeader() {
  return 'Basic ' + btoa(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`);
}

// Exchanges an authorization code for tokens, then resolves which Xero
// organisation (tenant) those tokens belong to. Both steps are required before
// any invoice can be written — the tenant id is a mandatory request header.
async function exchangeCode(orgId: string, code: string, state: string, userId: string) {
  // The state must be the one this business was just given, and fresh.
  const pending = await loadConnection(orgId);
  if (!pending || !pending.oauth_state || !state || pending.oauth_state !== state
    || !pending.oauth_state_at || Date.now() - pending.oauth_state_at > STATE_MS) {
    throw new Error('This Xero sign-in link has expired or was not started from Scope. Tap Connect Xero again.');
  }
  // Used once: cleared before anything else can go wrong.
  await saveConnection(orgId, { oauth_state: null, oauth_state_at: null });

  const tokenRes = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: XERO_REDIRECT_URI,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Xero token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
  }
  const tokens = await tokenRes.json();

  const connRes = await fetch('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
  });
  if (!connRes.ok) {
    throw new Error(`Could not read Xero connections (${connRes.status}): ${await connRes.text()}`);
  }
  const connections = await connRes.json();
  if (!Array.isArray(connections) || !connections.length) {
    throw new Error('Xero returned no organisations for this login.');
  }
  // The organisation just authorised is the most recently updated one.
  const chosen = connections.slice().sort((a: any, b: any) =>
    String(b.updatedDateUtc || '').localeCompare(String(a.updatedDateUtc || '')))[0];

  await saveConnection(orgId, {
    tenant_id: chosen.tenantId,
    tenant_name: chosen.tenantName,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in || 1800) * 1000,
    connected_at: Date.now(),
  }, userId);

  return { tenantName: chosen.tenantName };
}

// Xero access tokens last 30 minutes. Refreshing 60s early avoids losing a
// race against expiry mid-request. Xero also rotates the refresh token on
// every use, so the new one must be stored or the connection dies silently.
async function validAccessToken(orgId: string): Promise<{ token: string; tenantId: string }> {
  const conn = await loadConnection(orgId);
  if (!conn || !conn.refresh_token || !conn.tenant_id) {
    throw new Error('NOT_CONNECTED');
  }
  if (conn.access_token && conn.expires_at && conn.expires_at - 60000 > Date.now()) {
    return { token: conn.access_token, tenantId: conn.tenant_id };
  }

  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refresh_token }),
  });
  if (!res.ok) {
    throw new Error(`Xero token refresh failed (${res.status}). Reconnect Xero from the app.`);
  }
  const tokens = await res.json();
  await saveConnection(orgId, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in || 1800) * 1000,
  });
  return { token: tokens.access_token, tenantId: conn.tenant_id };
}

interface LineItem {
  description: string;
  quantity: number;
  unitAmountCents: number;
  taxExempt?: boolean;
}

// Builds the Xero payload. Amounts are converted from integer cents to
// decimal dollars only here, at the boundary — everything upstream keeps
// cents so the arithmetic can't drift.
function toXeroInvoice(invoice: any) {
  const gstRegistered = invoice.gstRegistered !== false;
  const lineItems = (invoice.lineItems || []).map((l: LineItem) => ({
    Description: l.description || 'Pest control services',
    Quantity: Number(l.quantity) || 0,
    UnitAmount: Number(((l.unitAmountCents || 0) / 100).toFixed(2)),
    // AU GST on income. EXEMPTOUTPUT covers a GST-free sale; NONE is for a
    // business not registered for GST at all.
    TaxType: !gstRegistered ? 'NONE' : (l.taxExempt ? 'EXEMPTOUTPUT' : 'OUTPUT'),
    ...(invoice.accountCode ? { AccountCode: String(invoice.accountCode) } : {}),
  }));

  return {
    Type: 'ACCREC', // accounts receivable — a sale
    Contact: {
      Name: invoice.clientName || 'Client',
      ...(invoice.clientEmail ? { EmailAddress: invoice.clientEmail } : {}),
    },
    Date: invoice.issueDate,
    DueDate: invoice.dueDate,
    InvoiceNumber: invoice.number,
    Reference: [invoice.reference, invoice.propertyAddress].filter(Boolean).join(' — '),
    // Always DRAFT. Nothing this app creates should be able to reach a client
    // without a human opening it in Xero first.
    Status: 'DRAFT',
    LineAmountTypes: 'Exclusive', // unit amounts exclude GST; Xero adds it
    LineItems: lineItems,
  };
}

async function createInvoice(orgId: string, invoice: any) {
  const { token, tenantId } = await validAccessToken(orgId);
  const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Xero-tenant-id': tenantId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ Invoices: [toXeroInvoice(invoice)] }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Xero rejected the invoice (${res.status}): ${body}`);

  const parsed = JSON.parse(body);
  const created = parsed.Invoices && parsed.Invoices[0];
  if (!created) throw new Error('Xero accepted the request but returned no invoice.');
  return {
    xeroInvoiceId: created.InvoiceID,
    xeroInvoiceNumber: created.InvoiceNumber,
    xeroStatus: created.Status,
    total: created.Total,
  };
}

// Where invoices this app sent are up to now: DRAFT, AUTHORISED, PAID, VOIDED.
// Read only. Scope only ever knew the status at the moment it sent an
// invoice (always DRAFT), so it never found out anything was paid; this is
// how it does (v121: the referral credit is earned on payment, and the
// business figures and the client portal show paid too).
//
// Up to 50 at a time, and only well-formed Xero ids: they go into a URL.
const XERO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function invoiceStatuses(orgId: string, ids: unknown) {
  const list = Array.from(new Set((Array.isArray(ids) ? ids : []).map((v) => String(v || '').trim())))
    .filter((v) => XERO_ID.test(v))
    .slice(0, 50);
  if (!list.length) return { invoices: [] };
  const { token, tenantId } = await validAccessToken(orgId);
  const res = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?IDs=${list.join(',')}&summaryOnly=true`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Xero-tenant-id': tenantId,
      Accept: 'application/json',
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Xero would not say where those invoices are up to (${res.status}): ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body);
  return {
    invoices: (parsed.Invoices || []).map((i: any) => ({
      xeroInvoiceId: i.InvoiceID,
      xeroStatus: i.Status,
      amountDue: i.AmountDue,
      amountPaid: i.AmountPaid,
      // Xero's "/Date(1700000000000+0000)/" form, as epoch ms, or null.
      fullyPaidAt: (() => {
        const m = /\/Date\((\d+)/.exec(String(i.FullyPaidOnDate || ''));
        return m ? Number(m[1]) : null;
      })(),
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    // Same auth gate as the other functions: a valid signed-in technician.
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Not authenticated' }, 401);

    if (!XERO_CLIENT_ID || !XERO_CLIENT_SECRET || !XERO_REDIRECT_URI) {
      return json({ error: 'Xero is not configured on the server yet (missing client id, secret or redirect URI).' }, 503);
    }

    const body = await req.json();
    const { orgId, isAdmin } = await callerContext(user.id);
    if (!orgId) return json({ error: 'Your login is not part of a business in Scope yet.' }, 403);

    if (body.action === 'status') {
      const conn = await loadConnection(orgId);
      const connected = !!(conn && conn.refresh_token && conn.tenant_id);
      // Only an admin is offered the link, and only when not connected; the
      // state it carries is kept with the business to be checked on return.
      let authorizeUrl: string | null = null;
      if (!connected && isAdmin) {
        const state = crypto.randomUUID();
        await saveConnection(orgId, { oauth_state: state, oauth_state_at: Date.now() });
        authorizeUrl = 'https://login.xero.com/identity/connect/authorize?' + new URLSearchParams({
          response_type: 'code',
          client_id: XERO_CLIENT_ID,
          redirect_uri: XERO_REDIRECT_URI,
          scope: 'openid profile email accounting.transactions accounting.contacts offline_access',
          state,
        }).toString();
      }
      return json({ connected, tenantName: conn ? conn.tenant_name : null, canConnect: isAdmin, authorizeUrl });
    }

    if (body.action === 'exchange-code') {
      if (!isAdmin) return json({ error: 'Only the business owner (an admin) can connect Xero.' }, 403);
      if (!body.code) return json({ error: 'code is required' }, 400);
      const result = await exchangeCode(orgId, String(body.code), String(body.state || ''), user.id);
      return json({ success: true, ...result });
    }

    if (body.action === 'create-invoice') {
      if (!body.invoice) return json({ error: 'invoice is required' }, 400);
      try {
        const result = await createInvoice(orgId, body.invoice);
        return json({ success: true, ...result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'NOT_CONNECTED') {
          return json({ error: 'Xero is not connected yet. Connect it from Settings first.' }, 409);
        }
        throw err;
      }
    }

    if (body.action === 'invoice-statuses') {
      try {
        return json({ success: true, ...(await invoiceStatuses(orgId, body.ids)) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'NOT_CONNECTED') return json({ error: 'Xero is not connected yet.', notConnected: true }, 409);
        throw err;
      }
    }

    if (body.action === 'disconnect') {
      if (!isAdmin) return json({ error: 'Only the business owner (an admin) can disconnect Xero.' }, 403);
      // Tell Xero to cancel the access too, so the stored keys are dead even
      // if a copy of the row survived somewhere. Best effort: the row goes
      // either way.
      const conn = await loadConnection(orgId);
      if (conn && conn.refresh_token) {
        try {
          await fetch('https://identity.xero.com/connect/revocation', {
            method: 'POST',
            headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: conn.refresh_token }),
          });
        } catch (_e) { /* the delete below still disconnects Scope */ }
      }
      const { error: delError } = await admin.from('xero_connections').delete().eq('id', orgId);
      if (delError) throw new Error('Could not disconnect Xero: ' + delError.message);
      return json({ success: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
