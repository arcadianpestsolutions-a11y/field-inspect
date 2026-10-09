// ---------------------------------------------------------------------------
// theme.js - dark, light or follow-the-phone appearance.
//
// PURPOSE   The app was dark-only on the argument that a white screen is a mirror
//           in the sun. Many phones are in fact easier to read outdoors with a
//           light, high-contrast screen, and nobody can settle that from a desk,
//           so the person holding the phone chooses. Dark stays the default.
// EXPOSES   window.Theme = { get, set, resolved, mountPicker, MODES, COLORS }
// DEPENDS   nothing. Loaded in <head>, before the stylesheet paints, so a light
//           choice never flashes dark first.
// TOUCHES   localStorage key "scope-theme" ('dark' | 'light' | 'auto'); the
//           data-theme attribute on <html>; the theme-color meta tag.
// TESTS     tests/run-tests.js - "Theme" group.
//
// The colours themselves live in styles.css (:root and :root[data-theme="light"]).
// The header stays dark in both themes on purpose: on an installed iPhone app the
// clock and battery are drawn in white over the top of the page, and that cannot
// be changed after install, so a light header would make them unreadable.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  const KEY = 'scope-theme';
  const MODES = ['dark', 'light', 'auto'];
  // The colour of the header strip, which is what the phone's own bar is tinted to.
  const COLORS = { dark: '#080b0a', light: '#101614' };

  function read() {
    try {
      const v = localStorage.getItem(KEY);
      if (MODES.includes(v)) return v;
    } catch (e) { /* storage blocked: fall through to the default */ }
    return 'dark';
  }

  const prefersLight = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);

  // What is actually showing: 'dark' or 'light'. 'auto' follows the phone.
  function resolve(mode) {
    if (mode === 'light') return 'light';
    if (mode === 'auto') return prefersLight() ? 'light' : 'dark';
    return 'dark';
  }

  function apply() {
    const mode = read();
    const shown = resolve(mode);
    const root = document.documentElement;
    root.setAttribute('data-theme', shown);
    root.setAttribute('data-theme-mode', mode);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COLORS[shown]);
    syncPicker();
  }

  function set(mode) {
    const next = MODES.includes(mode) ? mode : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* the choice just will not be remembered */ }
    apply();
  }

  // ---------- The picker, in the More sheet ----------
  const LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };

  function syncPicker() {
    const bar = document.getElementById('theme-picker');
    if (!bar) return;
    const mode = read();
    bar.querySelectorAll('button').forEach((b) => {
      const on = b.getAttribute('data-mode') === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
  }

  function mountPicker() {
    if (document.getElementById('theme-picker')) return;
    const panel = document.querySelector('#more-sheet .more-sheet-panel');
    const close = document.getElementById('more-close-btn');
    if (!panel || !close) return;
    const wrap = document.createElement('div');
    wrap.className = 'theme-row';
    const label = document.createElement('span');
    label.className = 'theme-label';
    label.textContent = 'Screen';
    const bar = document.createElement('div');
    bar.id = 'theme-picker';
    bar.className = 'theme-picker';
    bar.setAttribute('role', 'radiogroup');
    bar.setAttribute('aria-label', 'Screen brightness');
    ['auto', 'light', 'dark'].forEach((mode) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme-choice';
      b.setAttribute('data-mode', mode);
      b.setAttribute('role', 'radio');
      b.textContent = LABELS[mode];
      b.addEventListener('click', () => set(mode));
      bar.appendChild(b);
    });
    wrap.appendChild(label);
    wrap.appendChild(bar);
    panel.insertBefore(wrap, close);
    syncPicker();
  }

  // Applied now, in <head>, before anything is drawn.
  apply();
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { if (read() === 'auto') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPicker);
  else mountPicker();

  window.Theme = { get: read, set, resolved: () => resolve(read()), mountPicker, MODES, COLORS };
})();
