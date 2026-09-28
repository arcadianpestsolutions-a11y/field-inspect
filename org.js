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
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* not fatal */ }
  }

  const ROSTER_KEY = 'scope.roster.v1';

  let org = read(ORG_KEY, EMPTY_ORG);
  let me = read(ME_KEY, EMPTY_ME);
  // email -> display name, for turning a job's assignedTo into something a
  // person recognises on a job list. Cached with the rest so a shared job list
  // still reads properly with no signal.
  let roster = read(ROSTER_KEY, {});

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
      return roster[String(email).toLowerCase()] || email;
    },

    // The provider block every document carries. One place, so a report, an
    // invoice and an email cannot disagree about who issued them.
    provider: () => ({
      providerName: businessName(),
      providerPhone: org.phone || '',
      providerEmail: org.email || '',
      providerAddress: org.address || '',
      signedOnBehalfOf: businessName(),
    }),

    // The signing technician's own details, for the inspector section.
    inspector: () => ({
      inspectorName: me.displayName || '',
      inspectorLicence: me.licenceNumber || '',
      inspectorPhone: me.phone || org.phone || '',
      inspectorAddress: me.address || '',
    }),

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
          };
          write(ORG_KEY, org);
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
      return { ...org };
    },

    // Admin-only server-side (see migration 022's policy); this only decides
    // whether to bother asking.
    async save(changes) {
      const client = window.supabaseClient;
      if (!client || !org.id) throw new Error('Business details are not loaded yet.');
      const row = {
        name: changes.name, trading_name: changes.tradingName, abn: changes.abn,
        licence_number: changes.licenceNumber, phone: changes.phone,
        email: changes.email, address: changes.address, website: changes.website,
        updated_at: new Date().toISOString(),
      };
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
      return { ...org };
    },
  };
})();
