// ---------------------------------------------------------------------------
// sync-conflicts.js - where an edit that clashed with another device's ends up.
//
// PURPOSE   When two people changed the SAME field of the same record before
//           syncing, only one value can stay. sync-merge.js keeps the later one.
//           The other used to vanish without a trace; now it is listed here, with
//           what was kept, so a person can put it back if it was the right one.
//           Changes to different fields are merged and never appear here.
// EXPOSES   window.SyncConflicts = { record, list, clear, describe, render, KEY }
// TOUCHES   localStorage "scope-sync-conflicts" (this phone only, newest 100).
// TESTS     tests/run-tests.js - "Sync merge" group.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  const KEY = 'scope-sync-conflicts';
  const MAX = 100;

  function list() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function save(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX))); } catch (e) { /* not kept */ }
  }

  const FIELD_NAMES = {
    name: 'name', address: 'address', clientPhone: 'phone number', clientEmail: 'email',
    phone: 'phone number', email: 'email', notes: 'notes', status: 'status',
    scheduledAt: 'booking time', scheduledDurationMins: 'booking length', assignedTo: 'technician',
    stage: 'stage', quotedCents: 'quote', title: 'title', siteAddress: 'site address',
    lineItems: 'invoice lines', dueDate: 'due date', number: 'invoice number',
  };

  // "sections.findings.activeTermites" -> "Findings: active termites"
  function fieldLabel(path) {
    const parts = String(path || '').split('.').filter(Boolean);
    const words = (s) => String(s).replace(/\[.*\]$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    if (parts[0] === 'sections' && parts.length >= 3) {
      const section = words(parts[1]);
      return `${section.charAt(0).toUpperCase()}${section.slice(1)}: ${words(parts.slice(2).join(' '))}`;
    }
    const last = parts[parts.length - 1] || 'a field';
    return FIELD_NAMES[last] || words(last);
  }

  function valueText(v, field) {
    if (v === undefined || v === null || v === '') return '(empty)';
    if (/scheduledAt|At$/.test(field || '') && typeof v === 'number') {
      return new Date(v).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    }
    if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 77)}...` : v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    const s = JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 77)}...` : s;
  }

  // One sentence a person can act on. Pure.
  function describe(c) {
    const what = fieldLabel(c.field);
    return `${c.label || 'A record'}: ${what}. Kept "${valueText(c.kept, c.field)}" (from ${c.keptFrom || 'the later save'}); the other change was "${valueText(c.lost, c.field)}".`;
  }

  function record(conflicts) {
    if (!conflicts || !conflicts.length) return;
    const items = conflicts.map((c) => ({
      table: c.table, id: c.id, label: c.label, field: c.field,
      kept: c.kept, lost: c.lost, keptFrom: c.keptFrom, at: c.at || Date.now(),
    }));
    save(items.concat(list()));
    const n = items.length;
    if (window.appToast) {
      window.appToast(`${n} change${n === 1 ? '' : 's'} clashed with another device. The later one was kept; the other is listed under More, Saved reports.`);
    }
    render();
    try { document.dispatchEvent(new Event('scope-sync-conflicts')); } catch (e) { /* ignore */ }
  }

  function clear() { save([]); render(); }

  // On the Saved reports screen, under the backup controls. Hidden when empty.
  function render() {
    const anchor = document.getElementById('restore-result') || document.getElementById('export-data-btn');
    if (!anchor || !anchor.parentNode) return;
    let card = document.getElementById('sync-conflicts');
    if (!card) {
      card = document.createElement('div');
      card.id = 'sync-conflicts';
      card.className = 'card sync-conflicts hidden';
      const h = document.createElement('h2');
      h.className = 'sync-conflicts-title';
      h.textContent = 'Changes that clashed';
      const intro = document.createElement('p');
      intro.className = 'empty-hint';
      intro.textContent = 'Two people changed the same thing before syncing. The later change was kept. If the other one was right, open the record and put it back.';
      const ul = document.createElement('ul');
      ul.id = 'sync-conflicts-list';
      ul.className = 'sync-conflicts-list';
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.id = 'sync-conflicts-clear';
      clearBtn.className = 'link-btn';
      clearBtn.textContent = 'Clear this list';
      clearBtn.addEventListener('click', clear);
      card.append(h, intro, ul, clearBtn);
      anchor.parentNode.insertBefore(card, anchor.nextSibling);
    }
    const items = list();
    const ul = card.querySelector('#sync-conflicts-list');
    ul.textContent = '';
    items.slice(0, 30).forEach((c) => {
      const li = document.createElement('li');
      const when = document.createElement('span');
      when.className = 'sync-conflicts-when';
      when.textContent = new Date(c.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
      const text = document.createElement('span');
      text.textContent = describe(c);
      li.append(when, text);
      ul.appendChild(li);
    });
    card.classList.toggle('hidden', items.length === 0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();

  window.SyncConflicts = { record, list, clear, describe, render, fieldLabel, KEY };
})();
