// Tide and current events in an hourly series, and how they line up.
//
//   extrema(t, z)      high and low waters: local extremes of the level, timed by a parabola
//                      through the three hourly values round each (minutes, not hours).
//   slacks(t, u)       zero crossings of the along-channel current (linear between hours),
//                      each with the turn it marks: "flood→ebb" (after flood) or "ebb→flood".
//   maxima(t, u)       the strongest flood and ebb between successive slacks (parabola).
//   pairUp(sl, ex)     each slack with its nearest high or low water and the offset (ms; + = slack after).
//
// Times are ms. Values: any units. Pure functions (web/tests/events.test.mjs).

function parabola(t, y, i) {
  const a = y[i - 1], b = y[i], c = y[i + 1], den = a - 2 * b + c;
  const d = den ? 0.5 * (a - c) / den : 0;                        // offset in steps, −0.5..0.5
  const dt = (t[i + 1] - t[i - 1]) / 2;
  return { t: t[i] + Math.max(-0.5, Math.min(0.5, d)) * dt, v: b - 0.25 * (a - c) * d };
}

export function extrema(t, z, { minRange = 0.05 } = {}) {
  const out = [];
  for (let i = 1; i < z.length - 1; i++) {
    if (!Number.isFinite(z[i - 1]) || !Number.isFinite(z[i]) || !Number.isFinite(z[i + 1])) continue;
    const hi = z[i] >= z[i - 1] && z[i] > z[i + 1], lo = z[i] <= z[i - 1] && z[i] < z[i + 1];
    if (!hi && !lo) continue;
    const p = parabola(t, z, i);
    out.push({ t: p.t, v: p.v, kind: hi ? "HW" : "LW" });
  }
  // Drop wiggles: successive events must alternate and differ by minRange.
  const clean = [];
  for (const e of out) {
    const last = clean.at(-1);
    if (last && last.kind === e.kind) { if ((e.kind === "HW") === (e.v > last.v)) clean[clean.length - 1] = e; continue; }
    if (last && Math.abs(e.v - last.v) < minRange) { clean.pop(); continue; }
    clean.push(e);
  }
  return clean;
}

export function slacks(t, u) {
  const out = [];
  for (let i = 0; i < u.length - 1; i++) {
    const a = u[i], b = u[i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
    if ((a > 0 && b <= 0) || (a < 0 && b >= 0)) {
      if (b === 0 && i + 2 < u.length && Math.sign(u[i + 2]) === Math.sign(a)) continue;   // touched zero, didn't turn
      out.push({ t: t[i] + (t[i + 1] - t[i]) * (a / (a - b)), kind: a > 0 ? "flood→ebb" : "ebb→flood" });
    }
  }
  return out;
}

export function maxima(t, u) {
  const out = [], cuts = [-1, ...slacks(t, u).map((s) => t.findIndex((x) => x > s.t) - 1), u.length - 1];
  for (let k = 0; k < cuts.length - 1; k++) {
    let best = -1;
    for (let i = cuts[k] + 1; i <= cuts[k + 1]; i++) if (Number.isFinite(u[i]) && (best < 0 || Math.abs(u[i]) > Math.abs(u[best]))) best = i;
    if (best < 0) continue;
    const edge = best === 0 || best === u.length - 1, p = edge ? { t: t[best], v: u[best] } : parabola(t, u, best);
    if (Math.abs(p.v) < 0.05) continue;
    out.push({ t: p.t, v: p.v, kind: p.v > 0 ? "max flood" : "max ebb", edge });
  }
  return out.filter((m) => !m.edge);
}

export function pairUp(sl, ex) {
  return sl.map((s) => {
    let best = null;
    for (const e of ex) if (!best || Math.abs(e.t - s.t) < Math.abs(best.t - s.t)) best = e;
    return { ...s, ref: best, offset: best ? s.t - best.t : null };
  });
}

// "1 h 05 min after HW" / "25 min before LW"
export function fmtOffset(ms, ref) {
  const m = Math.round(Math.abs(ms) / 60e3), h = Math.floor(m / 60), mm = m % 60;
  const d = h ? `${h} h ${String(mm).padStart(2, "0")} min` : `${mm} min`;
  return m === 0 ? `at ${ref}` : `${d} ${ms > 0 ? "after" : "before"} ${ref}`;
}
