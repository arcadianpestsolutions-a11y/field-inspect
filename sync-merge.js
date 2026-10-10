// ---------------------------------------------------------------------------
// sync-merge.js - what to do when this phone and the cloud both changed a record.
//
// PURPOSE   Sync used to keep whichever whole record was saved last. Two people
//           editing the same job offline - one fixing the phone number, the other
//           adding notes - meant one of them silently lost their change. This
//           decides field by field instead, against the last version both sides
//           agreed on (the "base", kept per record by db.js):
//             - changed on one side only        -> take that side
//             - changed on both, to the same value -> take it
//             - changed on both, differently    -> the later save wins, and the
//               other value is reported as a clash so it is never silently lost
//           Lists whose items have ids (photos in a report section) are merged
//           item by item; the report audit trail is merged so neither device's
//           entries are dropped.
// EXPOSES   window.SyncMerge = { reconcile, merge3, canonical, sameValue, META }
// DEPENDS   nothing. Pure functions; sync.js calls them and does the writing.
// TESTS     tests/run-tests.js - "Sync merge" group.
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  // Bookkeeping, not content: never compared, never a clash.
  const META = new Set(['updatedAt', 'createdAt', 'syncedAt']);
  // Append-only logs: merged as a union, never "one side wins".
  const APPEND_ONLY = new Set(['auditLog']);

  // A stable text form of any value, for comparing. Object key order does not
  // matter; a photo's bytes are not compared (they live only on the phone).
  function canonical(v) {
    if (v === undefined) return 'u';
    if (v === null) return 'n';
    if (typeof Blob !== 'undefined' && v instanceof Blob) return 'blob';
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (typeof v === 'object') {
      return `{${Object.keys(v).filter((k) => v[k] !== undefined && k !== 'blob' && k !== 'photoBlob' && k !== 'audioBlob').sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v);
  }
  const sameValue = (a, b) => canonical(a) === canonical(b);

  const hasIds = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every((x) => x && typeof x === 'object' && typeof x.id === 'string');

  // A list of things with ids, changed on both sides: keep additions from either,
  // drop what either side deliberately removed, and merge items edited on both.
  function mergeById(base, local, remote, path, ctx) {
    const b = new Map((Array.isArray(base) ? base : []).filter((x) => x && x.id).map((x) => [x.id, x]));
    const l = new Map(local.map((x) => [x.id, x]));
    const r = new Map(remote.map((x) => [x.id, x]));
    const order = [];
    const seen = new Set();
    for (const x of local.concat(remote)) { if (!seen.has(x.id)) { seen.add(x.id); order.push(x.id); } }
    const out = [];
    for (const id of order) {
      const inB = b.has(id); const inL = l.has(id); const inR = r.has(id);
      if (inL && inR) {
        out.push(sameValue(l.get(id), r.get(id)) ? l.get(id) : mergeObjects(b.get(id) || {}, l.get(id), r.get(id), `${path}[${id}]`, ctx));
      } else if (inL && !inR) {
        // Removed over there? Only if it existed before and was not touched here.
        if (inB && sameValue(l.get(id), b.get(id))) continue;
        out.push(l.get(id));
      } else if (inR && !inL) {
        if (inB && sameValue(r.get(id), b.get(id))) continue;
        out.push(r.get(id));
      }
    }
    return out;
  }

  // Union of two append-only logs, oldest first, no duplicates.
  function mergeLog(local, remote) {
    const seen = new Set();
    const out = [];
    for (const e of (Array.isArray(local) ? local : []).concat(Array.isArray(remote) ? remote : [])) {
      const key = canonical(e);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    return out.sort((a, b) => ((a && a.at) || 0) - ((b && b.at) || 0));
  }

  // One value, three versions.
  function mergeValue(base, local, remote, path, ctx, key) {
    if (sameValue(local, remote)) return local;
    if (APPEND_ONLY.has(key)) return mergeLog(local, remote);
    if (sameValue(local, base)) return remote; // only the other side changed it
    if (sameValue(remote, base)) return local; // only this side changed it
    // Both changed it, to different things.
    if (hasIds(local) && hasIds(remote)) return mergeById(base, local, remote, path, ctx);
    if (local && remote && typeof local === 'object' && typeof remote === 'object' && !Array.isArray(local) && !Array.isArray(remote)) {
      return mergeObjects(base && typeof base === 'object' ? base : {}, local, remote, path, ctx);
    }
    const keepLocal = ctx.localNewer;
    ctx.conflicts.push({
      field: path,
      kept: keepLocal ? local : remote,
      lost: keepLocal ? remote : local,
      keptFrom: keepLocal ? 'this phone' : 'another device',
    });
    return keepLocal ? local : remote;
  }

  function mergeObjects(base, local, remote, path, ctx) {
    const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
    const out = {};
    for (const k of keys) {
      if (META.has(k)) continue;
      const v = mergeValue((base || {})[k], (local || {})[k], (remote || {})[k], path ? `${path}.${k}` : k, ctx, k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  // Three versions of a whole record -> one, plus the clashes it had to settle.
  function merge3(base, local, remote, options) {
    const ctx = { conflicts: [], localNewer: !!(options && options.localNewer) };
    const merged = mergeObjects(base || {}, local || {}, remote || {}, '', ctx);
    // Keep the bookkeeping, and stamp it later than both so every device takes it.
    merged.createdAt = (local && local.createdAt) || (remote && remote.createdAt);
    merged.updatedAt = Math.max(Number(local && local.updatedAt) || 0, Number(remote && remote.updatedAt) || 0) + 1;
    return { merged, conflicts: ctx.conflicts };
  }

  // Only the fields the cloud knows about decide whether something changed;
  // anything kept only on this phone (photo bytes, say) is not a change to sync.
  function changedOn(a, b, keys) {
    for (const k of keys) {
      if (META.has(k)) continue;
      if (!sameValue((a || {})[k], (b || {})[k])) return true;
    }
    return false;
  }

  // The decision for one record that exists on both sides.
  //   { local, remote, base }  (all in the app's own shape; base may be missing)
  // -> { action: 'none' | 'pull' | 'push' | 'merge', merged?, conflicts? }
  function reconcile({ local, remote, base }) {
    if (!local) return { action: 'pull' };
    if (!remote) return { action: 'push' };
    const keys = new Set([...Object.keys(remote), ...Object.keys(base || {})]);
    const lt = Number(local.updatedAt) || 0;
    const rt = Number(remote.updatedAt) || 0;
    if (!changedOn(local, remote, keys)) return { action: 'none' };
    if (!base) {
      // Never seen in agreement before: no way to tell who changed what, so the
      // later save wins, as it always has.
      if (rt > lt) return { action: 'pull' };
      if (lt > rt) return { action: 'push' };
      return { action: 'none' };
    }
    const localChanged = changedOn(local, base, keys);
    const remoteChanged = changedOn(remote, base, keys);
    if (remoteChanged && !localChanged) return { action: 'pull' };
    if (localChanged && !remoteChanged) return { action: 'push' };
    const { merged, conflicts } = merge3(base, local, remote, { localNewer: lt >= rt });
    // Keep anything this phone holds that the cloud does not carry at all.
    for (const k of Object.keys(local)) if (!(k in merged) && !keys.has(k)) merged[k] = local[k];
    return { action: 'merge', merged, conflicts };
  }

  window.SyncMerge = { reconcile, merge3, canonical, sameValue, META, mergeById, mergeLog };
})();
