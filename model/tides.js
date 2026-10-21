// NOAA's tide predictions at the CO-OPS tide stations (pipeline/tides.py: high and low waters,
// metres above MLLW — the tide-table datum — stored with the site a year at a time), for the point
// panel's comparison with the model's water level.
//
//   loadTides(t0, t1) → {stations: [{id, name, lat, lon, type, ev: [{t, h m MLLW, hl "H"|"L"}]}]} or null (absent)
//   tideHeight(s, t)  → metres above MLLW at t: the usual cosine between successive high and low waters

export async function loadTides(t0, t1) {
  const meta = await fetch("data/tides.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!meta?.months?.length) return null;
  const a = t0 - 14 * 3600e3, b = t1 + 14 * 3600e3, want = [];
  for (let d = new Date(Date.UTC(new Date(a).getUTCFullYear(), new Date(a).getUTCMonth(), 1)); d.getTime() <= b; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))
    want.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  const have = want.filter((m) => meta.months.includes(m));
  if (!have.length) return { stations: [], outOfRange: true };
  const files = await Promise.all(have.map((m) => fetch(`data/tides/${m}.json`).then((r) => r.json())));
  const stations = meta.stations.map((s) => {
    const ev = [];
    for (const f of files) { const m0 = Date.parse(f.minutesFrom); for (const [min, h, hl] of f.stations[s.id] || []) { const t = m0 + min * 60e3; if (t >= a && t <= b) ev.push({ t, h, hl }); } }
    return { ...s, ev };
  }).filter((s) => s.ev.length >= 2);
  return { stations };
}

export function tideHeight(s, t) {
  const e = s.ev;
  if (t <= e[0].t) return e[0].h;
  for (let i = 0; i < e.length - 1; i++) {
    const a = e[i], b = e[i + 1]; if (t > b.t) continue;
    const f = (t - a.t) / Math.max(1, b.t - a.t);
    return a.h + (b.h - a.h) * (1 - Math.cos(f * Math.PI)) / 2;
  }
  return e.at(-1).h;
}
