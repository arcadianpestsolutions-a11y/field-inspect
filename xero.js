// Client for the `xero` Supabase Edge Function.
//
// This module never holds a Xero token — it can't, safely, in a public PWA
// bundle. It asks the Edge Function to act on Xero, and the function holds
// the credentials. See supabase/functions/xero/index.ts.
//
// The OAuth round trip lands back on this app's own URL carrying ?code=,
// which captureAuthCodeFromUrl() below picks up on load.
(() => {
  'use strict';

  if (!window.supabaseClient) {
    console.warn('[xero] Supabase not configured — Xero integration unavailable.');
    return;
  }
  const supabaseClient = window.supabaseClient;

  async function invoke(body) {
    const { data, error } = await supabaseClient.functions.invoke('xero', { body });
    if (error) {
      // functions.invoke collapses any non-2xx into a generic message, which
      // hides the actual reason ("not connected", "not configured"). Read the
      // real body so the technician gets told what to do about it.
      let detail = '';
      try {
        if (error.context && typeof error.context.json === 'function') {
          const parsed = await error.context.json();
          detail = parsed && parsed.error ? parsed.error : '';
        }
      } catch (e) { /* fall through to the generic message */ }
      throw new Error(detail || error.message || 'Xero request failed');
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  const status = () => invoke({ action: 'status' });
  const exchangeCode = (code) => invoke({ action: 'exchange-code', code });
  const disconnect = () => invoke({ action: 'disconnect' });
  const createInvoice = (invoice) => invoke({ action: 'create-invoice', invoice });

  // Xero redirects back to this app with ?code=...&state=... after the user
  // grants access. Strip those params out of the address bar once captured so
  // a refresh doesn't try to redeem an already-used code.
  async function captureAuthCodeFromUrl() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (!code) return null;

    params.delete('code');
    params.delete('state');
    params.delete('session_state');
    const clean = location.pathname + (params.toString() ? '?' + params : '');
    history.replaceState({}, '', clean);

    try {
      const result = await exchangeCode(code);
      return { ok: true, tenantName: result.tenantName };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  window.Xero = { status, exchangeCode, disconnect, createInvoice, captureAuthCodeFromUrl };
})();
