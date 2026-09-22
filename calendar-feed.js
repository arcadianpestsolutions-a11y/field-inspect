// Calendar feed — lets Field Inspect's bookings show up on any external
// calendar (Google Calendar, Outlook, Apple Calendar) without knowing or
// caring which one, by publishing a standard iCalendar (.ics) subscription
// URL. The URL is generated and shown here; it's actually served by the
// `calendar-feed` Edge Function reading the token this module writes.
//
// The token in that URL is the ENTIRE access control for the feed — anyone
// holding it can see every booked job's name, address and notes, with no
// login. That's unavoidable (a calendar app subscribing to a URL cannot log
// in), so this treats the link the way a password reset link is treated
// elsewhere: shown once, copyable, and replaceable if it ever leaks.
(() => {
  'use strict';

  const openBtn = document.getElementById('calendar-feed-open');
  const closeBtn = document.getElementById('calendar-feed-close');
  const panel = document.getElementById('calendar-feed-panel');
  const urlInput = document.getElementById('calendar-feed-url');
  const copyBtn = document.getElementById('calendar-feed-copy');
  const generateBtn = document.getElementById('calendar-feed-generate');
  const regenerateBtn = document.getElementById('calendar-feed-regenerate');
  const hintEl = document.getElementById('calendar-feed-hint');
  if (!openBtn || !panel) return; // markup not present — nothing to wire up

  const toast = (m) => (window.appToast ? window.appToast(m) : console.log(m));

  // ai.js's humanError exists for a different domain (Edge Function/network
  // failures) and falls through to the raw string for anything it doesn't
  // recognise — which is exactly what a missing-table Postgres error is.
  // "Could not find the table 'public.calendar_feed' in the schema cache"
  // reads like the app is broken; it actually means one SQL file hasn't
  // been run yet, which is a very different, very fixable thing to hear.
  function feedErrorText(err) {
    const raw = String((err && err.message) || err || '');
    if (/relation .* does not exist|could not find the table|schema cache/i.test(raw)) {
      return 'Calendar feed isn’t set up on the server yet — run supabase-migration-010-calendar-feed.sql, then try again.';
    }
    if (/not authenticated|jwt|permission denied|42501/i.test(raw)) {
      return 'Sign in again, then try generating the link.';
    }
    if (/failed to fetch|networkerror|load failed/i.test(raw) || navigator.onLine === false) {
      return 'No connection — try again once you have signal.';
    }
    return 'Could not create the calendar link — try again.';
  }

  // Mirrors ai.js/email.js/sync.js: if Supabase isn't configured (local dev,
  // demo mode), the feature simply isn't available rather than throwing.
  function client() {
    return window.supabaseClient || null;
  }

  // Every function endpoint in this project lives under the same base as
  // the configured Supabase URL — built directly rather than stored twice,
  // so the two can never drift apart.
  function functionsBaseUrl() {
    if (!window.SUPABASE_URL) return null;
    return window.SUPABASE_URL.replace(/\.supabase\.co\/?$/, '.supabase.co/functions/v1');
  }

  function feedUrlFor(token) {
    const base = functionsBaseUrl();
    return base ? `${base}/calendar-feed?token=${token}` : null;
  }

  function randomToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function loadCurrentToken() {
    const c = client();
    if (!c) return null;
    const { data, error } = await c.from('calendar_feed').select('token').eq('id', 'default').maybeSingle();
    if (error) {
      // 42P01 = table doesn't exist yet — migration 010 not run. Anything
      // else is worth seeing in the console, but neither should crash the
      // scheduler screen over a feature that is entirely optional.
      console.warn('[calendar-feed] could not load token:', error.message || error);
      return null;
    }
    return data ? data.token : null;
  }

  async function saveToken(token) {
    const c = client();
    if (!c) throw new Error('Sign in to set up the calendar feed.');
    const user = window.Sync && window.Sync.currentUser ? window.Sync.currentUser() : null;
    const { error } = await c.from('calendar_feed').upsert({
      id: 'default',
      token,
      created_by: user ? user.id : null,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    if (error) throw error;
  }

  function render(token) {
    const url = token ? feedUrlFor(token) : null;
    if (url) {
      urlInput.value = url;
      urlInput.classList.remove('hidden');
      copyBtn.classList.remove('hidden');
      regenerateBtn.classList.remove('hidden');
      generateBtn.classList.add('hidden');
      hintEl.textContent = 'Add this as a "subscribe by URL" calendar in Google Calendar, Outlook, or Apple Calendar. '
        + 'It updates on its own — most calendar apps check every 12–24 hours, not instantly.';
    } else {
      urlInput.classList.add('hidden');
      copyBtn.classList.add('hidden');
      regenerateBtn.classList.add('hidden');
      generateBtn.classList.remove('hidden');
      hintEl.textContent = 'Generate a link, then add it to any calendar app as a URL subscription. '
        + 'Anyone with this link can see booked jobs’ names and addresses — treat it like a password.';
    }
  }

  async function openPanel() {
    // Both this and the booking assistant are panels inside the same
    // scheduler screen, opened from adjacent header icons — without this,
    // opening one after the other left both stacked on screen at once.
    const agentPanel = document.getElementById('agent-panel');
    if (agentPanel) agentPanel.classList.add('hidden');
    panel.classList.remove('hidden');
    hintEl.textContent = 'Loading…';
    try {
      const token = await loadCurrentToken();
      render(token);
    } catch (e) {
      hintEl.textContent = 'Calendar feed isn’t set up on the server yet.';
    }
  }

  openBtn.addEventListener('click', openPanel);
  if (closeBtn) closeBtn.addEventListener('click', () => panel.classList.add('hidden'));

  generateBtn.addEventListener('click', async () => {
    generateBtn.disabled = true;
    try {
      const token = randomToken();
      await saveToken(token);
      render(token);
      toast('Calendar link created');
    } catch (e) {
      toast(feedErrorText(e));
    } finally {
      generateBtn.disabled = false;
    }
  });

  regenerateBtn.addEventListener('click', async () => {
    if (!window.confirm('This replaces the current link. Any calendar already subscribed to the old one will stop updating. Continue?')) return;
    regenerateBtn.disabled = true;
    try {
      const token = randomToken();
      await saveToken(token);
      render(token);
      toast('New calendar link created — the old one no longer works');
    } catch (e) {
      toast(feedErrorText(e));
    } finally {
      regenerateBtn.disabled = false;
    }
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(urlInput.value);
      toast('Link copied');
    } catch (e) {
      // Clipboard permission can be denied or unavailable (older WebViews,
      // some in-app browsers) — the value is already selected and visible
      // in a plain text input, so a manual copy is never actually blocked.
      urlInput.select();
      toast('Copy blocked here — link is selected, use your keyboard to copy');
    }
  });

  // Exposed so the suite can assert on the wording a technician actually
  // reads, same reasoning as sync.js's window.SyncMessages.
  window.CalendarFeedMessages = { feedErrorText, randomToken, feedUrlFor };
})();
