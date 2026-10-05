// NOAA's current predictions at the CO-OPS stations (pipeline/stations.py: stored with the site,
// a year at a time), and the run's skill against them (pipeline/skill.py → <run>/skill.json):
// the reference beside the model — markers on the map, NOAA's curve in the point panel, and the
// places the model is known to run weak or strong.
//
//   loadStations(t0, t1) → [{id, name, lat, lon, flood, ebb, ev: [{t, v kt flood +, type}]}]
//   stationSpeed(s, t)   → signed kt (flood +) at t, NOAA's sine between slack and max
//   loadSkill(base, meta) → Map(id → {ratio, floodRatio, ebbRatio, noaaMax, modelMax, flag}) or null
//
// SYNC: wind-volume-explorer web/model/currents.js@60ab6df loadCurrents, stationSpeed. Copied; changed:
// the paths (data/stations.json, data/stations/), no region id, and the skill reader added here.

export async function loadStations(t0, t1, { signal } = {}) {
  const meta = await fetch("data/stations.json", { cache: "no-cache", signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!meta?.months?.length) return null;                               // absent: not built yet
  const a = new Date(t0 - 8 * 3600e3), b = new Date(t1 + 8 * 3600e3), want = [];
  for (let d = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1)); d <= b; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))
    want.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  const have = want.filter((m) => meta.months.includes(m));
  if (!have.length) return { stations: [], outOfRange: true, from: meta.from, until: meta.until };
  const files = await Promise.all(have.map((m) => fetch(`data/stations/${m}.json`, { signal }).then((r) => r.json())));
  const TYPE = { s: "slack", f: "flood", e: "ebb" };
  const stations = meta.stations.map((s) => {
    const ev = [];
    for (const f of files) {
      const m0 = Date.parse(f.minutesFrom);
      for (const [min, v, ty] of f.stations[s.id] || []) { const t = m0 + min * 60e3; if (t >= a.getTime() - 12 * 3600e3 && t <= b.getTime() + 12 * 3600e3) ev.push({ t, v, type: TYPE[ty] }); }
    }
    return { ...s, ev };
  }).filter((s) => s.ev.length >= 2);
  return { stations, from: meta.from, until: meta.until };
}

// Signed speed (kt, flood +) at time t (ms): between successive events, a sine from slack to max
// and back (NOAA's standard shape); at the ends, held.
export function stationSpeed(s, t) {
  const e = s.ev;
  if (!e.length) return 0;
  if (t <= e[0].t) return e[0].v;
  for (let i = 0; i < e.length - 1; i++) {
    const a = e[i], b = e[i + 1];
    if (t > b.t) continue;
    const f = (t - a.t) / Math.max(1, b.t - a.t);
    if (a.type === "slack" && b.type !== "slack") return b.v * Math.sin((f * Math.PI) / 2);
    if (a.type !== "slack" && b.type === "slack") return a.v * Math.cos((f * Math.PI) / 2);
    return a.v + (b.v - a.v) * (1 - Math.cos(f * Math.PI)) / 2;       // max to max (no slack between): smooth
  }
  return e[e.length - 1].v;
}

export async function loadSkill(base, meta) {
  if (!meta?.skill) return null;
  try {
    const r = await fetch(base + meta.skill); if (!r.ok) return null;
    const sk = await r.json();
    return Object.assign(new Map(sk.stations.map((s) => [s.id, s])), { median: sk.median, n: sk.n, thresholds: sk.thresholds });
  } catch { return null; }
}
