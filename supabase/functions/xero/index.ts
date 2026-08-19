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
// Required secrets (supabase secrets set ...):
//   XERO_CLIENT_ID       — from the app you create at developer.xero.com
//   XERO_CLIENT_SECRET   — same place; never leaves this function
//   XERO_REDIRECT_URI    — must match the app's redirect URI exactly, e.g.
//                          https://arcadianpestsolutions-a11y.github.io/field-inspect/
//   SUPABASE_SERVICE_ROLE_KEY — provided by the platform
//
// Actions: 'status' | 'exchange-code' | 'create-invoice' | 'disconnect'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

async function loadConnection(): Promise<XeroConnection | null> {
  const { data } = await admin.from('xero_connections').select('*').eq('id', 'default').maybeSingle();
  return data as XeroConnection | null;
}

async function saveConnection(fields: Record<string, unknown>, userId?: string) {
  await admin.from('xero_connections').upsert({
    id: 'default',
    ...fields,
    ...(userId ? { connected_by: userId } : {}),
    updated_at: Date.now(),
  });
}

function basicAuthHeader() {
  return 'Basic ' + btoa(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`);
}

// Exchanges an authorization code for tokens, then resolves which Xero
// organisation (tenant) those tokens belong to. Both steps are required before
// any invoice can be written — the tenant id is a mandatory request header.
async function exchangeCode(code: string, userId: string) {
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

  await saveConnection({
    tenant_id: connections[0].tenantId,
    tenant_name: connections[0].tenantName,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in || 1800) * 1000,
    connected_at: Date.now(),
  }, userId);

  return { tenantName: connections[0].tenantName };
}

// Xero access tokens last 30 minutes. Refreshing 60s early avoids losing a
// race against expiry mid-request. Xero also rotates the refresh token on
// every use, so the new one must be stored or the connection dies silently.
async function validAccessToken(): Promise<{ token: string; tenantId: string }> {
  const conn = await loadConnection();
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
  await saveConnection({
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

async function createInvoice(invoice: any) {
  const { token, tenantId } = await validAccessToken();
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

    if (body.action === 'status') {
      const conn = await loadConnection();
      return json({
        connected: !!(conn && conn.refresh_token && conn.tenant_id),
        tenantName: conn ? conn.tenant_name : null,
        // The URL the app sends the technician to in order to grant access.
        authorizeUrl: 'https://login.xero.com/identity/connect/authorize?' + new URLSearchParams({
          response_type: 'code',
          client_id: XERO_CLIENT_ID,
          redirect_uri: XERO_REDIRECT_URI,
          scope: 'openid profile email accounting.transactions accounting.contacts offline_access',
          state: crypto.randomUUID(),
        }).toString(),
      });
    }

    if (body.action === 'exchange-code') {
      if (!body.code) return json({ error: 'code is required' }, 400);
      const result = await exchangeCode(body.code, user.id);
      return json({ success: true, ...result });
    }

    if (body.action === 'create-invoice') {
      if (!body.invoice) return json({ error: 'invoice is required' }, 400);
      try {
        const result = await createInvoice(body.invoice);
        return json({ success: true, ...result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'NOT_CONNECTED') {
          return json({ error: 'Xero is not connected yet. Connect it from Settings first.' }, 409);
        }
        throw err;
      }
    }

    if (body.action === 'disconnect') {
      await admin.from('xero_connections').delete().eq('id', 'default');
      return json({ success: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
