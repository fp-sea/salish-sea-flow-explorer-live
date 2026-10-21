// A small time-series chart on a canvas: stacked panels sharing a local-time axis, series with
// optional flood/ebb shading about zero, event markers with labels (overlaps dropped), dashed
// links between events in different panels, the time on screen, and a hover readout.
//
//   const ch = new TimeChart(canvas, { tz, onPick: (t) => … });
//   ch.set({ t: [...ms], panels: [{ label, unit, series: [{ v, color, width, dash, shade: [pos, neg] }],
//            markers: [{ t, v, color, label, below }], zero: true, range: [lo, hi] }],
//            links: [{ from: {panel, t, v}, to: {panel, t, v}, color, label }], now, hover: (t) => "text" });
//
// Colours are CSS variable names or literal colours.

export class TimeChart {
  constructor(cv, { tz, onPick } = {}) {
    this.cv = cv; this.tz = tz; this.spec = null;
    this.fmtT = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
    this.fmtD = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", day: "numeric" });
    cv.addEventListener("click", (e) => { const t = this.timeAt(e.offsetX); if (t != null) onPick?.(t); });
    cv.addEventListener("pointermove", (e) => { this.hoverT = this.timeAt(e.offsetX); this.draw(); });
    cv.addEventListener("pointerleave", () => { this.hoverT = null; this.draw(); });
  }
  set(spec) { this.spec = spec; this.draw(); }
  setNow(t) { if (this.spec) { this.spec.now = t; this.draw(); } }
  timeAt(px) { const L = this.L; return L ? L.t0 + ((px - L.x0) / (L.x1 - L.x0)) * (L.t1 - L.t0) : null; }

  draw() {
    const S = this.spec, cv = this.cv;
    if (!S || !cv.isConnected || !cv.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement), col = (v) => (v?.startsWith("--") ? css.getPropertyValue(v).trim() : v);
    const ink = col("--ink"), soft = col("--ink-soft"), grid = col("--grid");
    const t = S.t, t0 = t[0], t1 = t.at(-1), x0 = 44, x1 = W - 8, X = (q) => x0 + ((q - t0) / (t1 - t0)) * (x1 - x0);
    this.L = { x0, x1, t0, t1 };
    // Panels share the height (weights), with a gap.
    const top = 30, bottom = H - 18, gap = 22, wsum = S.panels.reduce((a, p) => a + (p.weight || 1), 0);
    let y = top;
    const P = S.panels.map((p) => { const h = ((bottom - top - gap * (S.panels.length - 1)) * (p.weight || 1)) / wsum, o = { ...p, y0: y, y1: y + h }; y += h + gap; return o; });
    c.font = "10px ui-monospace, Menlo, monospace"; c.textBaseline = "middle";
    const placed = [];
    const label = (txt, x, yy, color, align = "center") => {
      const w = c.measureText(txt).width + 4, l = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
      if (placed.some((q) => l < q.r && l + w > q.l && Math.abs(yy - q.y) < 11)) return;
      placed.push({ l, r: l + w, y: yy }); c.fillStyle = color; c.textAlign = align; c.fillText(txt, x, yy);
    };
    // Time grid: every 6 h local, days labelled.
    for (let q = Math.ceil(t0 / 3600e3) * 3600e3; q <= t1; q += 3600e3) {
      const hh = +this.fmtT.format(new Date(q)).slice(0, 2) % 24;
      if (hh % 6) continue;
      c.strokeStyle = grid; c.lineWidth = hh === 0 ? 1.2 : 0.5;
      c.beginPath(); c.moveTo(X(q), P[0].y0); c.lineTo(X(q), P.at(-1).y1); c.stroke();
      c.fillStyle = soft; c.textAlign = "center"; c.fillText(hh === 0 ? this.fmtD.format(new Date(q)) : String(hh).padStart(2, "0"), X(q), H - 7);
    }
    for (const p of P) {
      const all = p.series.flatMap((s) => s.v).filter(Number.isFinite);
      let [lo, hi] = p.range || [Math.min(...all), Math.max(...all)];
      if (p.zero) { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -m; hi = m; }
      const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
      p.Y = (v) => p.y1 - ((v - lo) / (hi - lo)) * (p.y1 - p.y0);
      // y axis
      const span = hi - lo, raw = span / 4, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= raw);
      c.textAlign = "right";
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
        c.strokeStyle = grid; c.lineWidth = Math.abs(v) < step * 1e-6 ? 1.1 : 0.4;
        c.beginPath(); c.moveTo(x0, p.Y(v)); c.lineTo(x1, p.Y(v)); c.stroke();
        c.fillStyle = soft; c.fillText(String(+v.toFixed(2)), x0 - 4, p.Y(v));
      }
      c.textAlign = "left"; c.fillStyle = soft; c.fillText(p.label || "", 2, p.y0 - 9);
      if (p.upLabel) { c.textAlign = "right"; c.fillText(p.upLabel, x1, p.y0 + 6); c.fillText(p.downLabel || "", x1, p.y1 - 6); }
      for (const s of p.series) {
        const v = s.v;
        if (s.shade) for (const [sign, fc] of [[1, col(s.shade[0])], [-1, col(s.shade[1])]]) {
          c.beginPath(); c.moveTo(X(t[0]), p.Y(0));
          t.forEach((q, i) => c.lineTo(X(q), p.Y(Number.isFinite(v[i]) ? (sign > 0 ? Math.max(0, v[i]) : Math.min(0, v[i])) : 0)));
          c.lineTo(X(t.at(-1)), p.Y(0)); c.closePath(); c.fillStyle = fc; c.globalAlpha = 0.28; c.fill(); c.globalAlpha = 1;
        }
        c.beginPath(); let pen = false;
        t.forEach((q, i) => { if (!Number.isFinite(v[i])) { pen = false; return; } pen ? c.lineTo(X(q), p.Y(v[i])) : c.moveTo(X(q), p.Y(v[i])); pen = true; });
        c.strokeStyle = col(s.color || "--ink"); c.lineWidth = s.width || 1.8; c.setLineDash(s.dash || []); c.stroke(); c.setLineDash([]);
      }
    }
    for (const k of S.links || []) {
      const a = P[k.from.panel], b = P[k.to.panel], color = col(k.color || "--slack");
      c.strokeStyle = color; c.lineWidth = 1; c.setLineDash([2, 2]);
      c.beginPath(); c.moveTo(X(k.from.t), a.Y(k.from.v)); c.lineTo(X(k.from.t), b.y0 + 2); c.lineTo(X(k.to.t), b.Y(k.to.v)); c.stroke(); c.setLineDash([]);
      if (k.label) label(k.label, X(k.to.t), b.Y(k.to.v) + (k.below ? 11 : -11), color);
    }
    for (const p of P) for (const m of p.markers || []) {
      const color = col(m.color || "--ink");
      c.fillStyle = color; c.beginPath(); c.arc(X(m.t), p.Y(m.v), m.r || 3, 0, 7); c.fill();
      if (m.label) label(m.label, X(m.t), p.Y(m.v) + (m.below ? 10 : -10), m.labelColor ? col(m.labelColor) : ink);
    }
    if (this.hoverT != null && this.hoverT >= t0 && this.hoverT <= t1 && S.hover) {
      const ht = this.hoverT;
      c.strokeStyle = soft; c.lineWidth = 1; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(X(ht), P[0].y0); c.lineTo(X(ht), P.at(-1).y1); c.stroke(); c.setLineDash([]);
      const txt = `${this.fmtD.format(new Date(ht))} ${this.fmtT.format(new Date(ht))} · ${S.hover(ht)}`;
      c.font = "10.5px ui-monospace, Menlo, monospace";
      const tw = c.measureText(txt).width + 10, tx = Math.min(Math.max(X(ht) - tw / 2, x0), x1 - tw);
      c.fillStyle = col("--panel"); c.globalAlpha = 0.94; c.fillRect(tx, 1, tw, 15); c.globalAlpha = 1;
      c.fillStyle = ink; c.textAlign = "left"; c.fillText(txt, tx + 5, 9);
    }
    if (S.now >= t0 && S.now <= t1) { c.strokeStyle = col("--caution"); c.lineWidth = 1.5; c.beginPath(); c.moveTo(X(S.now), P[0].y0 - 4); c.lineTo(X(S.now), P.at(-1).y1); c.stroke(); }
  }
}

// Linear interpolation of an hourly series at time q (t: ms array).
export function lerpAt(t, v, q) {
  const f = (q - t[0]) / (t[1] - t[0]), i = Math.max(0, Math.min(t.length - 2, Math.floor(f))), w = f - i;
  return v[i] * (1 - w) + v[i + 1] * w;
}
