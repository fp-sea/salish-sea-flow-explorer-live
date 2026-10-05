// Model files kept on this device (Cache Storage), so a revisit — or a reload — downloads nothing
// that's already here.
//
// Only immutable files are kept: the mesh (named by its hash) and a run's files (in a folder named
// by its cycle). latest.json is never cached: it's how the page learns a newer run exists.
// Runs other than the ones in `keep` are dropped (latest run only, plus the one on screen).
//
//   fetchKept(url)           → Response (from the device if there, else the network, then kept)
//   keptRuns()               → { cycleTag: number of files }
//   pruneRuns(keepTags)      drop other runs' files
//   storeInfo()              → { usedMB, quotaMB }
//
// Storage can be unavailable (private windows, blocked site data): everything falls back to the
// network quietly.

const NAME = "ssfe-data-v1";
const KEEP = /\/(mesh-[0-9a-f]+|\d{10})\//;
let cache = null;

async function open() {
  if (cache !== null) return cache;
  try { cache = await caches.open(NAME); } catch { cache = false; }
  return cache;
}

export async function fetchKept(url) {
  const abs = new URL(url, location.href).href;
  const c = KEEP.test(abs) ? await open() : null;
  if (c) {
    try { const hit = await c.match(abs); if (hit) { hit.fromDevice = true; return hit; } } catch { /* fall through */ }
  }
  const r = await fetch(abs);
  if (c && r.ok) { try { await c.put(abs, r.clone()); } catch { /* quota: fine */ } }
  return r;
}

// Bytes read so far this visit, by where they came from (callers add: see model/sscofs.js rawBuf).
export const counters = { network: 0, device: 0 };

export async function keptRuns() {
  const c = await open(), out = {};
  if (!c) return out;
  for (const req of await c.keys()) { const m = req.url.match(/\/(\d{10})\//); if (m) out[m[1]] = (out[m[1]] || 0) + 1; }
  return out;
}

export async function pruneRuns(keepTags) {
  const c = await open();
  if (!c) return;
  for (const req of await c.keys()) { const m = req.url.match(/\/(\d{10})\//); if (m && !keepTags.includes(m[1])) await c.delete(req); }
}

export async function storeInfo() {
  try { const e = await navigator.storage.estimate(); return { usedMB: Math.round(e.usage / 1e6), quotaMB: Math.round(e.quota / 1e6) }; } catch { return null; }
}

export async function clearKept() { try { await caches.delete(NAME); cache = null; } catch {} }
