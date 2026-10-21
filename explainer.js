// The two kinds of tide wave, in one channel you can play with (lesson step 1, and the guide).
//
// A channel open to the sea at the left, closed (or not) at the right. The tide comes in as a wave
// η = A cos(kx − ωt); a fraction R of it reflects off the head of the channel and comes back,
// A·R cos(kx + ωt − 2kL). With R = 0 the wave just travels (progressive: current in step with
// the level, so the current is strongest at high water and slack comes at half-tide). With R = 1
// the two make a standing wave (current a quarter-cycle ahead of the level: strongest at
// half-tide, slack at high and low water). The current for each wave is u = ±(c/H)·η, so
//   u ∝ cos(kx − ωt) − R cos(kx + ωt − 2kL)
// Drawn: the water surface (side view, exaggerated), arrows for the current along the channel, a
// probe you can drag, and its level and current over one tide with HW and slack marked and the gap
// between them read out. Pure canvas; no model data.

const TAU = Math.PI * 2, T = 12.42;

export class Explainer {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <canvas class="ex-cv"></canvas>
      <div class="ex-ctl">
        <label>Reflection from the head of the channel <b class="ex-r"></b><input class="ex-R" type="range" min="0" max="1" step="0.01" value="0"></label>
        <div class="btnrow"><button class="btn mini ex-prog">Travelling (Juan de Fuca)</button><button class="btn mini ex-mid">Partly (San Juans)</button><button class="btn mini ex-stand">Sloshing (Puget Sound)</button></div>
        <div class="ex-read note"></div>
      </div>`;
    this.cv = root.querySelector(".ex-cv"); this.R = 0; this.px = 0.62; this.t = 0; this.run = true;
    const R = root.querySelector(".ex-R"), set = (v) => { R.value = v; this.R = +v; this.readout(); };
    R.oninput = () => set(R.value);
    root.querySelector(".ex-prog").onclick = () => set(0);
    root.querySelector(".ex-mid").onclick = () => set(0.6);
    root.querySelector(".ex-stand").onclick = () => set(1);
    const drag = (e) => { const r = this.cv.getBoundingClientRect(); this.px = Math.min(0.98, Math.max(0.02, (e.clientX - r.left - 12) / (r.width - 24))); this.readout(); };
    this.cv.addEventListener("pointerdown", (e) => { this.drag = true; drag(e); });
    addEventListener("pointermove", (e) => { if (this.drag) drag(e); });
    addEventListener("pointerup", () => { this.drag = false; });
    this.readout();
    const loop = (now) => {
      if (!root.isConnected) return;
      const dt = Math.min(0.05, (now - (this.last ?? now)) / 1000); this.last = now;
      if (this.run && !root.closest("[hidden]")) { this.t = (this.t + dt * 1.6) % T; this.draw(); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // Level and current at channel position x (0 mouth … 1 head) and time t (h). Channel length:
  // (0.18 of a tidal wavelength, short of quarter-wave resonance, like the Salish Sea's basins).
  eta(x, t) { const k = TAU * 0.18, w = TAU / T; return Math.cos(k * x - w * t) + this.R * Math.cos(k * x + w * t - 2 * k); }
  vel(x, t) { const k = TAU * 0.18, w = TAU / T; return Math.cos(k * x - w * t) - this.R * Math.cos(k * x + w * t - 2 * k); }

  readout() {
    // HW at the probe and the nearest slack after it, numerically over one tide.
    const n = 600, x = this.px, ts = [...Array(n)].map((_, i) => (i / n) * T * 2);
    let hw = 0; for (let i = 1; i < n / 2; i++) if (this.eta(x, ts[i]) > this.eta(x, ts[hw])) hw = i;
    let sl = null; for (let i = hw - n / 4; i < hw + n / 4; i++) { const a = this.vel(x, ts[(i + n) % n]), b = this.vel(x, ts[(i + 1 + n) % n]); if (a * b <= 0 && a !== b) { const ti = ts[(i + n) % n] + (ts[1] - ts[0]) * (a / (a - b)); if (sl == null || Math.abs(ti - ts[hw]) < Math.abs(sl - ts[hw])) sl = ti; } }
    let off = sl != null ? sl - ts[hw] : 0; if (off > T / 2) off -= T;
    const h = Math.abs(off), kind = h < 0.8 ? "standing" : h > 2.4 ? "progressive" : "in between";
    this.root.querySelector(".ex-r").textContent = this.R < 0.02 ? "none" : `${Math.round(this.R * 100)} %`;
    this.root.querySelector(".ex-read").innerHTML = `At the probe, slack comes <b>${h < 0.05 ? "right at" : `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, "0")} min ${off > 0 ? "after" : "before"}`}</b> high water — <b>${kind}</b>. `
      + (kind === "progressive" ? "The current runs hardest at high and low water, with the crest." : kind === "standing" ? "The water stops moving when it stops rising: slack at high and low water, fastest at half-tide." : "Partly reflected: slack an hour or two from high water.")
      + " Drag the probe along the channel.";
  }

  draw() {
    const cv = this.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement), col = (v) => css.getPropertyValue(v).trim();
    const x0 = 12, x1 = W - 12, sideH = H * 0.5, mid = sideH * 0.5 + 8, amp = sideH * 0.3, X = (x) => x0 + x * (x1 - x0), t = this.t;
    const norm = 1 + this.R;
    // Side view: seabed, water, the head wall.
    c.fillStyle = col("--grid"); c.fillRect(x0, mid + amp * 1.5, x1 - x0, sideH - (mid + amp * 1.5) + 4);
    c.beginPath(); c.moveTo(X(0), sideH + 4);
    for (let i = 0; i <= 100; i++) c.lineTo(X(i / 100), mid - (this.eta(i / 100, t) / norm) * amp);
    c.lineTo(X(1), sideH + 4); c.closePath(); c.fillStyle = col("--sea"); c.globalAlpha = 0.35; c.fill(); c.globalAlpha = 1;
    c.beginPath(); for (let i = 0; i <= 100; i++) c[i ? "lineTo" : "moveTo"](X(i / 100), mid - (this.eta(i / 100, t) / norm) * amp); c.strokeStyle = col("--sea"); c.lineWidth = 2; c.stroke();
    c.fillStyle = col("--ink-soft"); c.fillRect(X(1), mid - amp * 1.6, 4, sideH - mid + amp * 1.6 + 4);
    c.font = "10px ui-monospace, Menlo, monospace"; c.fillText("ocean →", x0, 10); c.textAlign = "right"; c.fillText("head of the channel", x1, 10); c.textAlign = "left";
    // Current arrows.
    for (let i = 1; i < 12; i++) {
      const x = i / 12, u = this.vel(x, t) / norm, L = u * 22, y = mid + amp * 0.9;
      c.strokeStyle = u >= 0 ? col("--flood") : col("--ebb"); c.lineWidth = 2;
      c.beginPath(); c.moveTo(X(x) - L / 2, y); c.lineTo(X(x) + L / 2, y); c.stroke();
      if (Math.abs(L) > 3) { const s = Math.sign(L); c.beginPath(); c.moveTo(X(x) + L / 2, y); c.lineTo(X(x) + L / 2 - s * 5, y - 3); c.lineTo(X(x) + L / 2 - s * 5, y + 3); c.closePath(); c.fillStyle = c.strokeStyle; c.fill(); }
    }
    // Probe.
    c.strokeStyle = col("--caution"); c.lineWidth = 1.5; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(X(this.px), 14); c.lineTo(X(this.px), sideH); c.stroke(); c.setLineDash([]);
    c.fillStyle = col("--caution"); c.fillText("probe ↔", X(this.px) + 4, 22);
    // The probe over one tide.
    const g0 = sideH + 16, g1 = H - 14, gm = (g0 + g1) / 2, ga = (g1 - g0) * 0.42, TX = (q) => x0 + (q / T) * (x1 - x0);
    c.strokeStyle = col("--grid"); c.lineWidth = 1; c.beginPath(); c.moveTo(x0, gm); c.lineTo(x1, gm); c.stroke();
    // (the current drawn at 0.75 scale: in a travelling wave it's the same curve as the level)
    const line = (f, color, k = 1) => { c.beginPath(); for (let i = 0; i <= 200; i++) { const q = (i / 200) * T; c[i ? "lineTo" : "moveTo"](TX(q), gm - (f(this.px, q) / norm) * ga * k); } c.strokeStyle = color; c.lineWidth = 2; c.stroke(); };
    line((x, q) => this.eta(x, q), col("--hw")); line((x, q) => this.vel(x, q), col("--ink"), 0.75);
    c.strokeStyle = col("--caution"); c.beginPath(); c.moveTo(TX(t), g0); c.lineTo(TX(t), g1); c.stroke();
    c.textAlign = "right"; c.fillStyle = col("--hw"); c.fillText("level ●HW", x1 - 110, g0 + 2); c.fillStyle = col("--ink"); c.fillText("current (flood +) ", x1 - 14, g0 + 2);
    c.fillStyle = col("--slack"); c.fillText("●", x1 - 4, g0 + 2); c.textAlign = "left";
    // HW and slack marks on the probe's curves.
    for (let i = 1; i < 400; i++) {
      const q0 = ((i - 1) / 400) * T, q1 = (i / 400) * T, q2 = ((i + 1) / 400) * T;
      const e0 = this.eta(this.px, q0), e1 = this.eta(this.px, q1), e2 = this.eta(this.px, q2);
      if (e1 > e0 && e1 >= e2) { c.fillStyle = col("--hw"); c.beginPath(); c.arc(TX(q1), gm - (e1 / norm) * ga, 4, 0, 7); c.fill(); }
      const v0 = this.vel(this.px, q0), v1 = this.vel(this.px, q1);
      if (v0 * v1 < 0) { c.fillStyle = col("--slack"); c.beginPath(); c.arc(TX(q1), gm, 4, 0, 7); c.fill(); }
    }
  }
}
