// ---------------------------------------------------------------------------
// job-details.js - the "who and where" card at the top of a job: one-tap Call,
// Directions, and an Edit form for the client's name, address, phone, email and
// notes.
//
// PURPOSE   Before this existed a job's name, address, phone and email could
//           never be corrected after creation, and nothing on the job screen
//           could be tapped to ring the client or open the map. A mistyped
//           phone number meant reminders going to a stranger, with no fix
//           except deleting the job.
// EXPOSES   window.JobDetails = { LIMITS, clean, validate, validateField,
//           changesFor, clientUpdateFor, offerClientUpdate, telHref,
//           directionsUrl, render }
// DEPENDS   DB (updateJob), HtmlSafe (not needed: all text uses textContent).
// TOUCHES   IndexedDB jobs store through DB.updateJob only.
// TESTS     tests/run-tests.js - "Job details" group.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  // Upper bounds on what one text box may hold. Nothing legitimate is longer, and
  // an unbounded box lets a paste of a whole document into "phone" through.
  const LIMITS = { name: 120, address: 200, phone: 20, email: 120, notes: 2000 };

  const str = (v) => String(v == null ? '' : v);

  // Trim, collapse stray whitespace in single-line fields, and cut to the limit.
  function clean(values) {
    const v = values || {};
    const oneLine = (x, max) => str(x).replace(/\s+/g, ' ').trim().slice(0, max);
    return {
      name: oneLine(v.name, LIMITS.name),
      address: oneLine(v.address, LIMITS.address),
      phone: oneLine(v.phone, LIMITS.phone),
      email: oneLine(v.email, LIMITS.email),
      notes: str(v.notes).trim().slice(0, LIMITS.notes),
    };
  }

  // Returns a sentence for the technician, or null when the values may be saved.
  // Deliberately lenient about phone and email shape: a technician typing at a
  // job site is better served by being warned about an obvious slip than by
  // being blocked by a strict rule, and the server re-validates before any
  // message is sent.
  // The first problem, and which box it is in: { field, message }, or null.
  function validateField(values) {
    const v = clean(values);
    if (!v.name) return { field: 'name', message: 'Enter a job name.' };
    if (v.phone && v.phone.replace(/\D/g, '').length < 6) {
      return { field: 'phone', message: 'That phone number looks too short. Check it, or clear it.' };
    }
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) {
      return { field: 'email', message: 'That email address does not look right. Check it, or clear it.' };
    }
    return null;
  }
  function validate(values) {
    const problem = validateField(values);
    return problem ? problem.message : null;
  }

  // What to write to the job. A changed address clears the saved map position:
  // keeping coordinates that belong to the OLD address would route and schedule
  // the technician to the wrong place while the screen shows the new one.
  function changesFor(job, values) {
    const v = clean(values);
    const j = job || {};
    const out = {
      name: v.name,
      address: v.address,
      clientPhone: v.phone,
      clientEmail: v.email,
      notes: v.notes,
    };
    if (v.address !== str(j.address)) {
      out.addressLat = null;
      out.addressLng = null;
    }
    return out;
  }

  // Job and client details drifting apart (break-it run, 28 Nov 2026): a
  // phone fixed on the job stayed wrong on the client record, so the next job
  // booked for them started from the old one. The job keeps its own copy on
  // purpose (clients.js says why), so the client is never changed silently:
  // this says what would change, only for what was edited just now, and the
  // technician is asked.
  function clientUpdateFor(client, before, after) {
    if (!client) return null;
    const C = window.Clients;
    const phoneKey = (p) => (C ? C.normalisePhone(p) : str(p).replace(/\D/g, ''));
    const emailKey = (e) => (C && C.normaliseEmail ? C.normaliseEmail(e) : str(e).trim().toLowerCase());
    const b = before || {};
    const a = after || {};
    const out = {};
    const newPhone = str(a.clientPhone).trim();
    const newEmail = str(a.clientEmail).trim();
    if (newPhone && phoneKey(newPhone) !== phoneKey(b.clientPhone) && phoneKey(newPhone) !== phoneKey(client.phone)) out.phone = newPhone;
    if (newEmail && emailKey(newEmail) !== emailKey(b.clientEmail) && emailKey(newEmail) !== emailKey(client.email)) out.email = newEmail;
    return Object.keys(out).length ? out : null;
  }

  async function offerClientUpdate(before, after) {
    if (!after || !after.clientId || !window.DB || !window.DB.getClient) return false;
    const client = await window.DB.getClient(after.clientId);
    const change = clientUpdateFor(client, before, after);
    if (!change) return false;
    const who = (window.Clients && window.Clients.labelFor(client)) || 'this client';
    const what = [change.phone ? `phone ${change.phone}` : '', change.email ? `email ${change.email}` : ''].filter(Boolean).join(' and ');
    const ask = window.Common && window.Common.askConfirm;
    if (!ask) return false;
    const yes = await ask(`Save the new ${what} on ${who}'s client record as well, for the next job booked for them? Reports already done keep the details they had.`,
      { title: 'Update the client too?', okLabel: 'Update client', cancelLabel: 'Only this job' });
    if (!yes) return false;
    await window.DB.saveClient({ ...client, ...change });
    if (window.Common.toast) window.Common.toast(`${who}'s client record updated too`);
    return true;
  }

  // tel: wants digits and a leading plus only. '' when there is nothing dialable.
  function telHref(phone) {
    const cleaned = str(phone).replace(/[^0-9+]/g, '');
    return cleaned.replace(/\D/g, '').length >= 3 ? `tel:${cleaned}` : '';
  }

  // Opens the phone's maps app (or the web map). Prefers exact coordinates when
  // the address was picked from the suggestions, else the typed address.
  function directionsUrl(job) {
    const j = job || {};
    const q = (typeof j.addressLat === 'number' && typeof j.addressLng === 'number')
      ? `${j.addressLat},${j.addressLng}`
      : str(j.address).trim();
    return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : '';
  }

  // ---------- The card ----------
  // Built here, not in index.html: a stale cached index.html paired with this
  // fresh script would otherwise leave the card silently missing.
  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, val]) => {
      if (k === 'class') node.className = val;
      else if (k === 'text') node.textContent = val;
      else node.setAttribute(k, val);
    });
    (children || []).forEach((c) => node.appendChild(c));
    return node;
  }

  function field(id, label, value, attrs) {
    const input = attrs && attrs.tag === 'textarea'
      ? el('textarea', Object.assign({ id, rows: '3' }, attrs.attrs || {}))
      : el('input', Object.assign({ id, autocomplete: 'off' }, (attrs && attrs.attrs) || {}));
    input.value = value;
    return [el('label', { class: 'field-label', for: id, text: label }), input];
  }

  function render(job, hooks) {
    const host = document.querySelector('#view-job .content');
    if (!host || !job) return;
    const old = document.getElementById('job-details-card');
    if (old) old.remove();

    const canEdit = !hooks || hooks.canEdit !== false;
    const card = el('div', { id: 'job-details-card', class: 'card job-details-card' });
    const view = el('div', { class: 'job-details-view' });
    const form = el('div', { class: 'job-details-form job-form hidden' });
    card.appendChild(view);
    card.appendChild(form);

    function line(label, text, href, linkText) {
      const row = el('div', { class: 'job-details-row' }, [
        el('span', { class: 'job-details-label', text: label }),
        el('span', { class: 'job-details-value', text: text || 'Not set' }),
      ]);
      // An email wraps after the @, not mid-word as "example.co / m" (v165).
      const at = String(text || '').indexOf('@');
      if (label === 'Email' && at > 0) {
        const v = row.querySelector('.job-details-value');
        v.textContent = '';
        v.append(document.createTextNode(text.slice(0, at + 1)), document.createElement('wbr'), document.createTextNode(text.slice(at + 1)));
        v.style.overflowWrap = 'break-word';
      }
      if (href) {
        const a = el('a', { class: 'link-btn job-details-link', href, text: linkText });
        // Maps opens outside the PWA; mark it so it never replaces the app.
        if (/^https?:/.test(href)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
        row.appendChild(a);
      }
      return row;
    }

    function showView(current) {
      view.textContent = '';
      view.appendChild(line('Phone', current.clientPhone, telHref(current.clientPhone), 'Call'));
      // A subcontractor is not given the client's email (v166): no row at all,
      // rather than one that says "Not set" about an address that exists.
      if (!(hooks && hooks.hideEmail)) {
        view.appendChild(line('Email', current.clientEmail,
          /^[^\s@]+@[^\s@]+$/.test(str(current.clientEmail)) ? `mailto:${current.clientEmail}` : '', 'Email'));
      }
      view.appendChild(line('Address', current.address, directionsUrl(current), 'Directions'));
      if (str(current.notes).trim()) view.appendChild(line('Notes', current.notes));
      if (canEdit) {
        const edit = el('button', { type: 'button', id: 'job-details-edit-btn', class: 'btn btn-outline full', text: 'Edit details' });
        edit.addEventListener('click', () => showForm(current));
        view.appendChild(edit);
      }
      view.classList.remove('hidden');
      form.classList.add('hidden');
    }

    function showForm(current) {
      form.textContent = '';
      const parts = [];
      parts.push(...field('jd-name', 'Client / site name', str(current.name), { attrs: { type: 'text', maxlength: String(LIMITS.name), autocapitalize: 'words' } }));
      parts.push(...field('jd-address', 'Property address', str(current.address), { attrs: { type: 'text', maxlength: String(LIMITS.address) } }));
      parts.push(...field('jd-phone', 'Client phone', str(current.clientPhone), { attrs: { type: 'tel', maxlength: String(LIMITS.phone) } }));
      parts.push(...field('jd-email', 'Client email', str(current.clientEmail), { attrs: { type: 'email', maxlength: String(LIMITS.email), autocapitalize: 'none' } }));
      parts.push(...field('jd-notes', 'Notes', str(current.notes), { tag: 'textarea', attrs: { maxlength: String(LIMITS.notes) } }));
      parts.forEach((p) => form.appendChild(p));

      const note = el('p', { class: 'calendar-feed-hint', id: 'jd-hint', text: '' });
      form.appendChild(note);
      const cancel = el('button', { type: 'button', id: 'jd-cancel', class: 'btn btn-secondary flex1', text: 'Cancel' });
      const save = el('button', { type: 'button', id: 'jd-save', class: 'btn btn-primary flex1', text: 'Save' });
      form.appendChild(el('div', { class: 'row gap' }, [cancel, save]));

      cancel.addEventListener('click', () => showView(current));
      let saving = false;
      save.addEventListener('click', async () => {
        if (saving) return; // a double tap must not write twice
        const values = {
          name: form.querySelector('#jd-name').value,
          address: form.querySelector('#jd-address').value,
          phone: form.querySelector('#jd-phone').value,
          email: form.querySelector('#jd-email').value,
          notes: form.querySelector('#jd-notes').value,
        };
        const problem = validate(values);
        if (problem) { note.textContent = problem; return; }
        saving = true; save.disabled = true;
        try {
          const next = await window.DB.updateJob(current.id, changesFor(current, values));
          if (!next) {
            const gone = new Error('This job was deleted, so those changes were not saved.');
            gone.code = 'JOB_DELETED';
            throw gone;
          }
          const before = current;
          showView(next);
          if (hooks && hooks.onSaved) hooks.onSaved(next);
          offerClientUpdate(before, next).catch((e) => {
            if (window.ErrorLog) window.ErrorLog.note(e, 'job details: update the client too');
          });
        } catch (err) {
          if (window.ErrorLog) window.ErrorLog.note(err, 'job details: save');
          note.textContent = window.DB.describeSaveFailure
            ? window.DB.describeSaveFailure(err, 'Those changes')
            : 'Could not save. Please try again.';
        } finally {
          saving = false; save.disabled = false;
        }
      });
      view.classList.add('hidden');
      form.classList.remove('hidden');
      const first = form.querySelector('#jd-name');
      if (first) first.focus();
    }

    showView(job);
    const anchor = host.querySelector('.inspection-card');
    if (anchor) host.insertBefore(card, anchor); else host.insertBefore(card, host.firstChild);
  }

  window.JobDetails = { LIMITS, clean, validate, validateField, changesFor, clientUpdateFor, offerClientUpdate, telHref, directionsUrl, render };
})();
