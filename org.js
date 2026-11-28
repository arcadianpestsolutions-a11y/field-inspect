// The business, and the person signing. Both used to be constants in the
// source — "Arcadian Pest Solutions" across ten files, an inspector lookup
// table keyed by email address in report.js. Both are now rows.
//
// CACHED, BECAUSE A REPORT IS WRITTEN WITH NO SIGNAL. A report header needs
// the business name, the licence number and the phone at the moment a section
// is first opened, which is routinely in a subfloor with no reception. So the
// profile is fetched when the app can reach the network and kept in
// localStorage, and every read is served from there.
//
// FALLS BACK TO EMPTY, NEVER TO A GUESS. A blank provider line on a report is
// obvious and gets fixed. A stale or invented one gets signed.
(() => {
  'use strict';

  const ORG_KEY = 'scope.org.v1';
  const ME_KEY = 'scope.me.v1';

  const EMPTY_ORG = {
    id: '', name: '', tradingName: '', abn: '', licenceNumber: '',
    phone: '', email: '', address: '', website: '',
    // The client page assistant (migration 037). assistantSupported is whether
    // the server has the columns at all: saving them to a database without
    // them would fail the whole save, ABN and all.
    assistantSupported: false, assistantEnabled: false, assistantNotes: '',
    // A business trialling Scope (migration 045): tester.js records its use
    // and asks after each report. Never true for Arcadian.
    tester: false,
    // The business's logo, as a small data: URL kept in the row (migration
    // 048), so a report prints it with no signal. logoSupported is whether
    // the server has the column: see assistantSupported above.
    logoSupported: false, logoDataUrl: '',
    // Which optional parts of Scope the business has switched off (v174,
    // migration 049, parts.js). partsSupported: whether the server has the
    // column, as above. Empty means everything is on.
    partsSupported: false, partsOff: [],
  };
  const EMPTY_ME = { displayName: '', licenceNumber: '', phone: '', address: '' };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
    } catch (e) {
      // Private windows and cleared site data both land here. An org we
      // cannot read is an empty one, not a crash on boot.
      return { ...fallback };
    }
  }

  function write(key, value) {
    if (window.IS_DEMO) return; // the demo never replaces the real cached profile
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* not fatal */ }
  }

  const ROSTER_KEY = 'scope.roster.v1';
  // The business's approved subcontractors (v166): [{ email, name, businessName }].
  // Kept apart from the roster because the app treats them differently: their
  // reports wait for the business to review and send.
  const SUBS_KEY = 'scope.subs.v1';

  // The demo is a made-up business (v165). It read the cached profile of
  // whoever last signed in on this device, so a tester trying the demo on
  // the owner's computer saw the real ABN, phone and email on every page.
  const DEMO_ORG = {
    ...EMPTY_ORG, id: '', name: 'Sample Pest Co Pty Ltd', tradingName: 'Sample Pest Co',
    abn: '00 000 000 000', licenceNumber: 'DEMO-0000', phone: '02 0000 0000',
    email: 'office@samplepest.example', address: '1 Example Street, Sampleton NSW 2000', website: '',
  };
  // Opened with &as=sub the demo is a subcontractor of the made-up business
  // (subcontractor.js): the business stays the provider, they are the inspector.
  const DEMO_ME = /[?&]as=sub(&|$)/.test(window.location.search || '')
    ? { displayName: 'Jordan Lee', licenceNumber: 'DEMO-0002', phone: '0400 000 001', address: '' }
    : { displayName: 'Sam Rivera', licenceNumber: 'DEMO-0001', phone: '0400 000 000', address: '' };
  let org = window.IS_DEMO ? { ...DEMO_ORG } : read(ORG_KEY, EMPTY_ORG);
  let me = window.IS_DEMO ? { ...DEMO_ME } : read(ME_KEY, EMPTY_ME);
  // email -> display name, for turning a job's assignedTo into something a
  // person recognises on a job list. Cached with the rest so a shared job list
  // still reads properly with no signal.
  let roster = window.IS_DEMO ? {} : read(ROSTER_KEY, {});
  let subs = [];
  if (!window.IS_DEMO) {
    try { const raw = JSON.parse(localStorage.getItem(SUBS_KEY) || '[]'); if (Array.isArray(raw)) subs = raw; } catch (e) { /* none cached */ }
  }
  const lower = (s) => String(s || '').toLowerCase();

  // What a document should show as the provider. tradingName first: a company
  // registered as one thing and known to clients as another should print the
  // name the client recognises.
  function businessName() {
    return org.tradingName || org.name || '';
  }

  window.Org = {
    get: () => ({ ...org }),
    me: () => ({ ...me }),
    businessName,

    // Never blank: an unrecognised login shows as its email address, because
    // "someone" is always more use than nothing on a shared job list.
    nameFor(email) {
      if (!email) return '';
      const key = String(email).toLowerCase();
      if (roster[key]) return roster[key];
      const sub = subs.find((s) => lower(s.email) === key);
      return (sub && sub.name) || email;
    },

    // The business's logo for a document header, or '' when there is none.
    logo: () => org.logoDataUrl || '',

    // Approved subcontractors of this business (empty for a subcontractor's
    // own login, which cannot see the list).
    subcontractors: () => subs.map((s) => ({ ...s })),
    isSubcontractorEmail: (email) => !!email && subs.some((s) => lower(s.email) === lower(email)),

    // The provider block every document carries. One place, so a report, an
    // invoice and an email cannot disagree about who issued them.
    provider: () => ({
      providerName: businessName(),
      providerPhone: org.phone || '',
      providerEmail: org.email || '',
      providerAddress: org.address || '',
      signedOnBehalfOf: businessName(),
      // A Safe Work Method Statement is handed to a principal contractor who
      // checks both of these before anyone is allowed on site, so they belong
      // in the block every document draws from rather than being retyped.
      providerAbn: org.abn || '',
      providerLicence: org.licenceNumber || '',
    }),

    // The signing technician's own details, for the inspector section.
    inspector: () => ({
      inspectorName: me.displayName || '',
      inspectorLicence: me.licenceNumber || '',
      inspectorPhone: me.phone || org.phone || '',
      inspectorAddress: me.address || '',
    }),

    // Turns a chosen image into something small enough to keep in the
    // business record and print on every report: at most 480 x 200 pixels,
    // PNG (which keeps a see-through background) unless that comes out too
    // big, then JPEG on white. Resolves to a data: URL, or throws a sentence
    // a person can act on.
    async prepareLogo(file) {
      if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type || '')) {
        throw new Error('Choose a PNG or JPG picture of your logo.');
      }
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('That picture could not be read. Try a different file.'));
          el.src = url;
        });
        const scale = Math.min(1, 480 / img.naturalWidth, 200 / img.naturalHeight);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        let out = canvas.toDataURL('image/png');
        if (out.length > 150000) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          out = canvas.toDataURL('image/jpeg', 0.85);
        }
        if (out.length > 190000) throw new Error('That picture is too detailed to use as a logo. Try a simpler one.');
        return out;
      } finally {
        URL.revokeObjectURL(url);
      }
    },

    // Refreshes from the server. Best-effort and never throws: the app must
    // open on a cached profile when there is no signal, and an org that
    // cannot be refreshed is not a reason to stop working.
    async refresh() {
      const client = window.supabaseClient;
      if (!client) return { ...org };
      try {
        const { data: orgRow } = await client
          .from('organisations').select('*').order('created_at').limit(1).maybeSingle();
        if (orgRow) {
          org = {
            id: orgRow.id || '',
            name: orgRow.name || '',
            tradingName: orgRow.trading_name || '',
            abn: orgRow.abn || '',
            licenceNumber: orgRow.licence_number || '',
            phone: orgRow.phone || '',
            email: orgRow.email || '',
            address: orgRow.address || '',
            website: orgRow.website || '',
            assistantSupported: Object.prototype.hasOwnProperty.call(orgRow, 'portal_assistant_enabled'),
            assistantEnabled: orgRow.portal_assistant_enabled === true,
            assistantNotes: orgRow.portal_assistant_notes || '',
            tester: orgRow.tester === true,
            logoSupported: Object.prototype.hasOwnProperty.call(orgRow, 'logo_data_url'),
            logoDataUrl: orgRow.logo_data_url || '',
            partsSupported: Object.prototype.hasOwnProperty.call(orgRow, 'parts_off'),
            partsOff: Array.isArray(orgRow.parts_off) ? orgRow.parts_off.filter((x) => typeof x === 'string') : [],
          };
          write(ORG_KEY, org);
        } else if (window.Sync && window.Sync.isActiveSubcontractor && window.Sync.isActiveSubcontractor()) {
          // A subcontractor cannot read the organisations table. What they
          // are given about their host (sub_my_hosts, migration 048) is what
          // goes on the documents they produce: the host's name, licence and
          // logo as the provider, and their own name and licence as the
          // inspector.
          const s = window.Sync.subcontractor();
          const b = (s && s.business) || {};
          const m = (s && s.me) || {};
          org = {
            ...EMPTY_ORG,
            id: (s && s.orgId) || '',
            name: b.name || '', tradingName: b.tradingName || '', abn: b.abn || '',
            licenceNumber: b.licenceNumber || '', phone: b.phone || '', email: b.email || '',
            address: b.address || '', website: b.website || '',
            logoDataUrl: b.logoDataUrl || '',
          };
          write(ORG_KEY, org);
          me = {
            displayName: m.fullName || '', licenceNumber: m.licenceNumber || '',
            phone: m.phone || '', address: '',
          };
          write(ME_KEY, me);
          roster = {};
          write(ROSTER_KEY, roster);
          subs = [];
          write(SUBS_KEY, subs);
          return { ...org };
        }

        const { data: people } = await client
          .from('user_roles').select('email, display_name');
        if (Array.isArray(people)) {
          const next = {};
          for (const p of people) {
            if (p.email && p.display_name) next[String(p.email).toLowerCase()] = p.display_name;
          }
          roster = next;
          write(ROSTER_KEY, roster);
        }

        // Approved subcontractors, for names on job lists and the "assign to"
        // picker. A database without migration 048 has no such function, and
        // that is simply an empty list.
        try {
          const { data: subRows, error: subError } = await client.rpc('sub_roster');
          if (!subError && Array.isArray(subRows)) {
            subs = subRows.filter((r) => r && r.email).map((r) => ({
              email: String(r.email).toLowerCase(),
              name: r.full_name || r.business_name || r.email,
              businessName: r.business_name || '',
            }));
            write(SUBS_KEY, subs);
          }
        } catch (e) { /* keep the cached list */ }

        const uid = window.Sync && window.Sync.currentUserId && window.Sync.currentUserId();
        if (uid) {
          const { data: meRow } = await client
            .from('user_roles').select('display_name, licence_number, phone, address')
            .eq('user_id', uid).maybeSingle();
          if (meRow) {
            me = {
              displayName: meRow.display_name || '',
              licenceNumber: meRow.licence_number || '',
              phone: meRow.phone || '',
              address: meRow.address || '',
            };
            write(ME_KEY, me);
          }
        }
      } catch (e) {
        console.warn('[org] could not refresh business details:', e.message || e);
      }
      // Anything drawn from the profile (parts.js) can catch up.
      document.dispatchEvent(new Event('scope-org'));
      return { ...org };
    },

    // Admin-only server-side (see migration 022's policy); this only decides
    // whether to bother asking.
    async save(changes) {
      if (window.IS_DEMO) {
        // The demo keeps a change for the session, on this screen only, and
        // never writes the real cached profile (see the read above). It used
        // to answer "Business details are not loaded yet." to every Save.
        org = { ...org, ...changes };
        document.dispatchEvent(new Event('scope-org'));
        return { ...org };
      }
      const client = window.supabaseClient;
      if (!client || !org.id) throw new Error('Business details are not loaded yet.');
      const row = {
        name: changes.name, trading_name: changes.tradingName, abn: changes.abn,
        licence_number: changes.licenceNumber, phone: changes.phone,
        email: changes.email, address: changes.address, website: changes.website,
        updated_at: new Date().toISOString(),
      };
      if (org.assistantSupported && 'assistantEnabled' in changes) {
        row.portal_assistant_enabled = changes.assistantEnabled === true;
        row.portal_assistant_notes = String(changes.assistantNotes || '').slice(0, 3000);
      }
      if (org.logoSupported && 'logoDataUrl' in changes) {
        row.logo_data_url = String(changes.logoDataUrl || '');
      }
      if (org.partsSupported && 'partsOff' in changes) {
        row.parts_off = Array.isArray(changes.partsOff) ? changes.partsOff.filter((x) => typeof x === 'string').slice(0, 40) : [];
      }
      const { data, error } = await client
        .from('organisations').update(row).eq('id', org.id).select('id');
      if (error) throw error;
      // A row-level policy that refuses an update raises no error — Postgres
      // updates nothing and PostgREST reports success. Same silent shape the
      // sync layer already guards against.
      if (Array.isArray(data) && data.length === 0) {
        throw new Error('Not saved — only an admin can change the business details.');
      }
      org = { ...org, ...changes };
      write(ORG_KEY, org);
      document.dispatchEvent(new Event('scope-org'));
      return { ...org };
    },
  };
})();
