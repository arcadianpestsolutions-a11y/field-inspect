// In-app replacements for window.confirm / prompt / alert.
//
// WHY THIS EXISTS
// This app's manifest declares display:standalone, and the whole point is
// that a technician installs it to their phone's home screen. On iOS, a web
// app launched that way has no browser chrome to host a native dialog:
// alert(), confirm() and prompt() return immediately with nothing on screen.
// Every flow sitting behind one of them silently does nothing — and in this
// app that included Finalize Report, deleting a job, sending a report, and
// the mandatory reason for amending a finalized report. A technician taps
// the button, nothing happens, and there is no error to explain why.
//
// So these are real DOM modals instead: promise-based, because a modal
// cannot block the way native confirm() does. Every caller awaits.
//
// THE MARKUP IS BUILT HERE, NOT IN index.html — deliberately. GitHub Pages
// serves assets through a CDN that does not invalidate them together, so a
// returning device can pair a fresh script with a stale cached index.html.
// If this needed markup that only lived in index.html, that mismatch would
// break every confirm in the app at once. Owning its own DOM means it works
// as long as this file loaded at all. Callers add a one-line fallback to
// native confirm() for the case where even that did not happen.
(() => {
  'use strict';

  let openCount = 0;

  function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'modal app-dialog';
    const card = document.createElement('div');
    card.className = 'app-dialog-card';
    overlay.appendChild(card);
    return { overlay, card };
  }

  // Message text is set with textContent, never innerHTML — some of these
  // strings interpolate a client name or a job name straight from the
  // record, and those are user data, not markup.
  function addMessage(card, message) {
    const p = document.createElement('p');
    p.className = 'app-dialog-message';
    p.textContent = message == null ? '' : String(message);
    card.appendChild(p);
    return p;
  }

  function addButtonRow(card) {
    const row = document.createElement('div');
    row.className = 'row gap app-dialog-actions';
    card.appendChild(row);
    return row;
  }

  function makeButton(label, className) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ' + className + ' flex1';
    btn.textContent = label;
    return btn;
  }

  // Shared open/close plumbing: focus restore, Escape to cancel, and click
  // on the backdrop to cancel — the three things a person expects from a
  // dialog and would otherwise have to be re-implemented per dialog type.
  function present(overlay, { onCancel, initialFocus }) {
    const previouslyFocused = document.activeElement;
    openCount += 1;
    document.body.appendChild(overlay);
    document.body.classList.add('dialog-open');

    function onKeyDown(e) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    }
    overlay.addEventListener('keydown', onKeyDown);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) onCancel(); });

    if (initialFocus) {
      // A frame's grace so the element is actually laid out and focusable.
      requestAnimationFrame(() => { try { initialFocus.focus(); } catch (e) { /* not focusable yet */ } });
    }

    return function dismiss() {
      overlay.removeEventListener('keydown', onKeyDown);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      openCount = Math.max(0, openCount - 1);
      if (openCount === 0) document.body.classList.remove('dialog-open');
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try { previouslyFocused.focus(); } catch (e) { /* element may be gone */ }
      }
    };
  }

  // Resolves true/false, same as window.confirm. `danger: true` styles the
  // confirming button as destructive — used for the delete flows, so "this
  // cannot be undone" is visible in the button, not only in the sentence.
  function confirm(message, options) {
    const opts = options || {};
    return new Promise((resolve) => {
      const { overlay, card } = buildOverlay();
      if (opts.title) {
        const h = document.createElement('h2');
        h.textContent = opts.title;
        card.appendChild(h);
      }
      addMessage(card, message);

      const row = addButtonRow(card);
      const cancelBtn = makeButton(opts.cancelLabel || 'Cancel', 'btn-secondary');
      const okBtn = makeButton(opts.okLabel || 'OK', opts.danger ? 'btn-danger' : 'btn-primary');
      row.appendChild(cancelBtn);
      row.appendChild(okBtn);

      const finish = (value) => { dismiss(); resolve(value); };
      const dismiss = present(overlay, { onCancel: () => finish(false), initialFocus: okBtn });
      cancelBtn.addEventListener('click', () => finish(false));
      okBtn.addEventListener('click', () => finish(true));
    });
  }

  // Resolves the entered string, or null if cancelled — matching
  // window.prompt, so call sites keep their existing null/empty handling.
  function prompt(message, defaultValue, options) {
    const opts = options || {};
    return new Promise((resolve) => {
      const { overlay, card } = buildOverlay();
      if (opts.title) {
        const h = document.createElement('h2');
        h.textContent = opts.title;
        card.appendChild(h);
      }
      addMessage(card, message);

      // Some of these prompts ask for a sentence (an amendment reason), not
      // a word — a textarea for those, a single-line input otherwise.
      const input = document.createElement(opts.multiline ? 'textarea' : 'input');
      input.className = 'app-dialog-input';
      if (!opts.multiline) input.type = opts.inputType || 'text';
      if (opts.placeholder) input.placeholder = opts.placeholder;
      input.value = defaultValue == null ? '' : String(defaultValue);
      card.appendChild(input);

      const row = addButtonRow(card);
      const cancelBtn = makeButton(opts.cancelLabel || 'Cancel', 'btn-secondary');
      const okBtn = makeButton(opts.okLabel || 'OK', 'btn-primary');
      row.appendChild(cancelBtn);
      row.appendChild(okBtn);

      const finish = (value) => { dismiss(); resolve(value); };
      const dismiss = present(overlay, { onCancel: () => finish(null), initialFocus: input });
      cancelBtn.addEventListener('click', () => finish(null));
      okBtn.addEventListener('click', () => finish(input.value));
      input.addEventListener('keydown', (e) => {
        // Enter submits a single-line prompt; in a textarea it should still
        // be able to make a new line, so only Ctrl/Cmd+Enter submits there.
        if (e.key !== 'Enter') return;
        if (opts.multiline && !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        finish(input.value);
      });
    });
  }

  function alert(message, options) {
    const opts = options || {};
    return new Promise((resolve) => {
      const { overlay, card } = buildOverlay();
      if (opts.title) {
        const h = document.createElement('h2');
        h.textContent = opts.title;
        card.appendChild(h);
      }
      addMessage(card, message);

      const row = addButtonRow(card);
      const okBtn = makeButton(opts.okLabel || 'OK', 'btn-primary');
      row.appendChild(okBtn);

      const finish = () => { dismiss(); resolve(); };
      const dismiss = present(overlay, { onCancel: finish, initialFocus: okBtn });
      okBtn.addEventListener('click', finish);
    });
  }

  window.Dialog = { confirm, prompt, alert };
})();
