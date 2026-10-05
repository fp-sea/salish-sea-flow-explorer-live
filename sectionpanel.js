// The section card: the current across a pass at its deepest point, every depth, the whole run
// (layers/curtains.js section()). x = time, y = depth (surface at the top), colour = flood (blue,
// into the basin) / ebb (orange) / slack (pale) — the same key as the curtains. A line marks the
// time on screen; click to move the time there.
//
// Beside it, the run's average at each depth (the tide cancels out; ~0.1 kt is left, against ~3 kt
// of tide, so it gets its own scale): where the water on balance goes out on top and comes in
// underneath (the estuarine exchange), it shows — and the summary says so with the numbers.

import { RAMPS } from "./layers/ramps.js?v=20261005223557";

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export class SectionPanel {
  constructor({ timebar, tz }) {
    Object.assign(this, { timebar, tz });
    this.el = $("section"); this.cv = $("sc-chart");
    this.fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric" });
    $("sc-close").onclick = () => this.close();
    this.cv.addEventListener("click", (e) => { if (!this.s) return; const t = this.timeAt(e.offsetX); if (t != null) timebar.set(t); });
    addEventListener("resize", () => this.draw());
  }
  close() { this.el.hidden = true; this.s = null; }
  open(s, units = "ft") {
    this.s = s; this.el.hidden = false;
    const ft = units === "ft", D = (m) => ft ? `${Math.round(m * 3.28084)} ft` : `${Math.round(m)} m`;
    $("sc-title").textContent = `${s.label}: the current at every depth`;
    $("sc-sub").textContent = `${s.atName ? `At NOAA's ${s.atName} station` : "Deepest point of the section"} (${D(s.h)}), across the ${s.widthKm.toFixed(1)} km line · blue into ${s.basin} (flood), orange out (ebb)`;
    // The run's mean by layer (the tide averages out; what's left is the exchange).
    const L = s.depth.length, mean = s.depth.map((_, l) => s.q.reduce((a, r) => a + r[l], 0) / s.q.length);
    const top = mean.slice(0, Math.ceil(L / 2)), bot = mean.slice(Math.ceil(L / 2));
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length, mt = avg(top), mb = avg(bot);
    const peak = Math.max(...s.q.flat().map(Math.abs));
    $("sc-sum").innerHTML = `Peak current here this run: <b>${peak.toFixed(1)} kt</b>. Averaged over the run (the tides cancel out), the upper half of the water column moves <b>${Math.abs(mt).toFixed(2)} kt ${mt < 0 ? "out" : "in"}</b> and the lower half <b>${Math.abs(mb).toFixed(2)} kt ${mb < 0 ? "out" : "in"}</b>`
      + (mt < 0 && mb > 0 ? ` — the two-layer exchange: lighter, fresher water leaves on top while denser salt water comes in underneath.` : ".")
      + ` Watch the colours: the tide often turns at one depth before another.`;
    this.draw();
  }
  setNow(t) { if (this.s) { this.now = t; this.draw(); } }
  geom() {
    const r = this.cv.getBoundingClientRect(), W = Math.max(200, r.width), H = Math.max(120, r.height);
    return { W, H, x0: 46, x1: W - 104, y0: 8, y1: H - 30, p0: W - 86, p1: W - 8 };
  }
  timeAt(px) { const g = this.geom(), s = this.s, f = (px - g.x0) / (g.x1 - g.x0); return f < 0 || f > 1 ? null : s.t[0] + f * (s.t.at(-1) - s.t[0]); }
  draw() {
    const s = this.s; if (!s || this.el.hidden) return;
    const g = this.geom(), dpr = devicePixelRatio || 1, cv = this.cv;
    cv.width = g.W * dpr; cv.height = g.H * dpr;
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, g.W, g.H);
    const R = RAMPS.along, T = s.t.length, L = s.depth.length, X = (t) => g.x0 + (t - s.t[0]) / (s.t.at(-1) - s.t[0]) * (g.x1 - g.x0), Y = (d) => g.y0 + d / s.h * (g.y1 - g.y0);
    // Cells: each hour × each layer (layer edges halfway between centres; top at 0, bottom at h).
    const edges = [0]; for (let l = 0; l + 1 < L; l++) edges.push((s.depth[l] + s.depth[l + 1]) / 2); edges.push(s.h);
    const col = (v) => { const k = R.f(Math.max(0, Math.min(1, (v - R.min) / (R.max - R.min)))); return `rgb(${k.map((q) => Math.round(q * 255)).join(",")})`; };
    for (let j = 0; j < T; j++) {
      const xa = j === 0 ? X(s.t[0]) : (X(s.t[j - 1]) + X(s.t[j])) / 2, xb = j === T - 1 ? X(s.t[j]) : (X(s.t[j]) + X(s.t[j + 1])) / 2;
      for (let l = 0; l < L; l++) { c.fillStyle = col(s.q[j][l]); c.fillRect(xa, Y(edges[l]), xb - xa + 0.6, Y(edges[l + 1]) - Y(edges[l]) + 0.6); }
    }
    // Axes: depth on the left, days along the bottom.
    c.fillStyle = css("--ink-soft") || "#567"; c.font = "10px system-ui"; c.textAlign = "right"; c.textBaseline = "middle";
    for (const f of [0, 0.25, 0.5, 0.75, 1]) { c.textBaseline = f === 1 ? "bottom" : f === 0 ? "top" : "middle"; c.fillText(`${Math.round(f * s.h)} m`, g.x0 - 4, Y(f * s.h)); }
    c.textAlign = "center"; c.textBaseline = "top";
    const span = (s.t.at(-1) - s.t[0]) / 3600e3, step = [6, 12, 24].find((h) => (g.x1 - g.x0) / (span / h) >= 64) || 24;
    for (let t = Math.ceil(s.t[0] / (step * 3600e3)) * step * 3600e3; t <= s.t.at(-1); t += step * 3600e3) { c.fillText(this.fmt.format(new Date(t)), X(t), g.y1 + 5); c.fillRect(X(t), g.y1, 1, 3); }
    // The run's average by depth, on its own scale.
    const mean = s.depth.map((_, l) => s.q.reduce((a, r) => a + r[l], 0) / s.q.length), M = Math.max(0.1, ...mean.map(Math.abs)) * 1.15;
    const P = (v) => (g.p0 + g.p1) / 2 + v / M * (g.p1 - g.p0) / 2;
    c.fillStyle = css("--grid") || "#ccd"; c.fillRect(P(0) - 0.5, g.y0, 1, g.y1 - g.y0);
    for (let l = 0; l < L; l++) { c.fillStyle = col(mean[l] / M * R.max * 0.9); const y = Y(edges[l]) + 1, h = Y(edges[l + 1]) - Y(edges[l]) - 2; c.fillRect(Math.min(P(0), P(mean[l])), y, Math.abs(P(mean[l]) - P(0)), h); }
    c.fillStyle = css("--ink-soft") || "#567"; c.textAlign = "center";
    c.fillText("out · avg · in", (g.p0 + g.p1) / 2, g.y1 + 5);
    c.textBaseline = "top"; c.font = "9px system-ui"; c.fillText(`±${M.toFixed(2)} kt`, (g.p0 + g.p1) / 2, g.y1 + 16);
    const now = this.now ?? this.timebar.t;
    if (now >= s.t[0] && now <= s.t.at(-1)) { c.fillStyle = css("--ink") || "#123"; c.fillRect(X(now) - 1, g.y0, 2, g.y1 - g.y0); }
  }
}
