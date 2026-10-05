// 3D particles: drifting through the whole water column with the model's full current — east,
// north and vertical (the lab runs' volume: u, v, w at the 10 sigma layers of every triangle) —
// drawn at their depth (× the seabed exaggeration), with short fading trails.
//
// Where they are: x, y (scene km) and s, the fraction of the local depth (0 surface … 1 seabed),
// the model's own vertical coordinate, so particles follow the seabed over sills and banks. The
// current is sampled on a grid over the view (model/flowgrid.js layout(): each cell's triangle,
// down to ~50 m) × the 10 layer centres, and blended smoothly: bilinear between the 4 cells,
// linear between the 2 layers either side, linear between the 2 hours either side of the time on
// screen. So the animation is smooth in space, depth and time.
//
// Motion is scaled like the surface particles' (1 m/s crosses ~8 % of the view a second × speed);
// the vertical keeps the same scale against the true depth (ds = −w·dt / D), so what you see in
// the exaggerated 3D is the model's own ratio of rising and sinking to drifting.
//
// Options: colour "speed" (horizontal, kt) | "depth" | "vertical" (up red, down blue);
// band [top, bottom] metres (spawn there, retire when well outside); density, size, trail,
// opacity, speed (shared with the surface particles' controls).
// Needs a view under MAX_KM across (a whole-sea grid would be millions of cells): note() says so.

import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { rampAt } from "./ramps.js?v=20261005223557";

const TRAIL = 8, KN = 0.514444, KT = 1.943844, MAX_KM = 70, BASE_N = 5000;
const lerp3 = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
const DEPTH_RAMP = (t) => t < 0.5 ? lerp3([0.80, 0.97, 1.0], [0.30, 0.70, 0.95], t / 0.5) : lerp3([0.30, 0.70, 0.95], [0.55, 0.35, 0.95], (t - 0.5) / 0.5);
const VERT_RAMP = (w) => { const t = Math.max(-1, Math.min(1, w / 0.01)); return t >= 0 ? lerp3([0.92, 0.92, 0.90], [0.93, 0.30, 0.20], t) : lerp3([0.92, 0.92, 0.90], [0.25, 0.45, 0.95], -t); };

export class Particles3D {
  constructor(model, fgrid) {
    Object.assign(this, { model, fgrid });
    this.group = new THREE.Group(); this.group.visible = false;
    this.res = new THREE.Vector2(innerWidth, innerHeight);
    addEventListener("resize", () => { this.res.set(innerWidth, innerHeight); if (this.lines) this.lines.material.resolution.copy(this.res); });
    const sig = model.meta.siglev; this.L = model.meta.layers; this.mid = [];
    for (let l = 0; l < this.L; l++) this.mid.push(-(sig[l] + sig[l + 1]) / 2);
    this.opts = { colour: "speed", top: 0, bottom: 400, density: 1, size: 1, trail: 1, opacity: 0.9, speed: 1, ex: 8 };
    this.lay = null; this.A = this.B = null; this.keyA = this.keyB = null; this.f = 0; this.trailAcc = 0;
  }

  // Options (any subset). Count or size changes rebuild the particles.
  set(o) {
    const was = { ...this.opts }; Object.assign(this.opts, o);
    if (this.P && (was.density !== this.opts.density || was.size !== this.opts.size)) this.build();
    if (this.P && (was.top !== this.opts.top || was.bottom !== this.opts.bottom)) for (let i = 0; i < this.P.n; i++) this.respawn(i, true);
    if (this.lines) this.lines.material.opacity = this.opts.opacity;
  }

  // The view (centre, size km), when it settles. → "" or a note for the panel (too wide).
  useView(v) {
    this.view = v;
    if (Math.max(v.w, v.h) > MAX_KM) { this.lay = null; this.drop(); return `3D particles: zoom in to an area under about ${MAX_KM} km across (pick a View, e.g. Admiralty Inlet).`; }
    const L = this.lay, inside = L && v.cx - v.w / 2 >= L.x0 && v.cx + v.w / 2 <= L.x1 && v.cy - v.h / 2 >= L.y0 && v.cy + v.h / 2 <= L.y1;
    const dxy = Math.max(0.05, Math.min(0.5, Math.max(v.w, v.h) / 180));
    if (!inside || Math.abs(Math.log(dxy / L.dxy)) > 0.4) {
      const B = this.fgrid.box, hw = v.w * 0.65, hh = v.h * 0.65;
      this.lay = this.fgrid.layout({ x0: Math.max(B.x0, v.cx - hw), y0: Math.max(B.y0, v.cy - hh), x1: Math.min(B.x1, v.cx + hw), y1: Math.min(B.y1, v.cy + hh) }, dxy, null, "p3d");
      const lay = this.lay, m = this.model, n = lay.nx * lay.ny;
      lay.wi = new Int32Array(n).fill(-1); lay.wet.forEach((k, j) => { lay.wi[k] = j; });
      lay.D = new Float32Array(lay.wet.length);                      // local depth (m), from the triangle's corners
      lay.wet.forEach((k, j) => { const e = lay.tri[k], a = m.nv[3 * e], b = m.nv[3 * e + 1], c = m.nv[3 * e + 2], wa = lay.w[2 * k], wb = lay.w[2 * k + 1]; lay.D[j] = (wa * m.h[a] + wb * m.h[b] + (1 - wa - wb) * m.h[c]) / 10; });
      this.keyA = this.keyB = null;
      if (!this.P) this.build(); else for (let i = 0; i < this.P.n; i++) this.respawn(i, true);
    }
    return "";
  }

  // The volume for hour j on the view's cells: {u, v (m/s), w (m/s)} as [layer][wet cell], or null while it unpacks.
  _fill(j) {
    const m = this.model, V = m.volFrame(j), lay = this.lay; if (!V || !lay) return null;
    const E = m.E, LE = this.L * E, nw = lay.wet.length, q = V.q, ov = V.over, g = (k) => { const o = ov.size ? ov.get(k) : undefined; return o ?? q[k]; };
    const u = new Float32Array(this.L * nw), v = new Float32Array(this.L * nw), w = new Float32Array(this.L * nw);
    for (let jj = 0; jj < nw; jj++) {
      const e = lay.tri[lay.wet[jj]];
      for (let l = 0; l < this.L; l++) { const k = l * E + e, o = l * nw + jj; u[o] = g(k) * 0.1 * KN; v[o] = g(LE + k) * 0.1 * KN; w[o] = g(2 * LE + k) * 0.001; }
    }
    return { u, v, w };
  }

  // Time on screen (ms). → false while the hours it needs are still unpacking.
  setTime(t) {
    if (!this.lay) return false;
    const m = this.model, fi = m.fi(t), i0 = Math.floor(fi), j0 = Math.max(0, Math.min(m.vol.length - 1, i0 + m.volOff)), j1 = Math.min(m.vol.length - 1, j0 + 1);
    if (this.keyA !== j0) { const a = this.keyB === j0 ? this.B : this._fill(j0); if (a) { this.A = a; this.keyA = j0; } }
    if (this.keyB !== j1) { const b = this._fill(j1); if (b) { this.B = b; this.keyB = j1; } }
    this.f = fi - i0;
    return this.keyA === j0 && this.keyB === j1;
  }
  invalidate() { this.keyA = this.keyB = null; }

  // Current and depth at (x, y, s): [u, v, w m/s, D m], or null off the water.
  sample(x, y, s) {
    const lay = this.lay, A = this.A, B = this.B; if (!lay || !A || !B) return null;
    const fx = (x - lay.x0) / lay.dxy, fy = (y - lay.y0) / lay.dxy, i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= lay.nx - 1 || j >= lay.ny - 1) return null;
    const mid = this.mid, L = this.L;
    let l0 = 0; while (l0 < L - 2 && mid[l0 + 1] < s) l0++;
    const wl = Math.max(0, Math.min(1, (s - mid[l0]) / (mid[l0 + 1] - mid[l0]))), nw = lay.wet.length, ft = this.f;
    let u = 0, v = 0, w = 0, D = 0, ws = 0;
    for (const [a, b, q] of [[0, 0, (1 - (fx - i)) * (1 - (fy - j))], [1, 0, (fx - i) * (1 - (fy - j))], [0, 1, (1 - (fx - i)) * (fy - j)], [1, 1, (fx - i) * (fy - j)]]) {
      const jj = lay.wi[(j + b) * lay.nx + i + a]; if (jj < 0 || q <= 0) continue;
      const o0 = l0 * nw + jj, o1 = (l0 + 1) * nw + jj, at = (F) => (F[o0] * (1 - wl) + F[o1] * wl);
      u += q * (at(A.u) * (1 - ft) + at(B.u) * ft); v += q * (at(A.v) * (1 - ft) + at(B.v) * ft); w += q * (at(A.w) * (1 - ft) + at(B.w) * ft);
      D += q * lay.D[jj]; ws += q;
    }
    return ws > 0.3 ? [u / ws, v / ws, w / ws, D / ws] : null;
  }

  build() {
    this.drop();
    const n = Math.round(BASE_N * this.opts.density);
    this.P = { n, x: new Float32Array(n * TRAIL), y: new Float32Array(n * TRAIL), s: new Float32Array(n * TRAIL), age: new Float32Array(n), life: new Float32Array(n), live: new Uint8Array(n), c: new Float32Array(n * 3) };
    const geo = new LineSegmentsGeometry(); geo.setPositions(new Float32Array(n * (TRAIL - 1) * 6)); geo.setColors(new Float32Array(n * (TRAIL - 1) * 6));
    const mat = new LineMaterial({ vertexColors: true, linewidth: 2.2 * this.opts.size, transparent: true, opacity: this.opts.opacity, depthWrite: false });
    mat.resolution.copy(this.res);
    this.lines = new LineSegments2(geo, mat); this.lines.frustumCulled = false; this.lines.renderOrder = 22;
    this.group.add(this.lines);
    for (let i = 0; i < n; i++) this.respawn(i, true);
  }
  drop() { if (this.lines) { this.group.remove(this.lines); this.lines.geometry.dispose(); this.lines.material.dispose(); } this.lines = null; this.P = null; }

  // A random spot in the view's water and depth band (speed-weighted, like the surface particles).
  respawn(i, anyAge = false) {
    const P = this.P, lay = this.lay, b = i * TRAIL;
    P.live[i] = 0; P.life[i] = 4 + Math.random() * 5; P.age[i] = anyAge ? Math.random() * P.life[i] : 0;
    if (!lay || !lay.wet.length) return;
    const v = this.view, x0 = Math.max(lay.x0, v.cx - v.w * 0.55), x1 = Math.min(lay.x1, v.cx + v.w * 0.55), y0 = Math.max(lay.y0, v.cy - v.h * 0.55), y1 = Math.min(lay.y1, v.cy + v.h * 0.55);
    for (let k = 0; k < 40; k++) {
      const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0), jj = lay.wi[Math.round((y - lay.y0) / lay.dxy) * lay.nx + Math.round((x - lay.x0) / lay.dxy)];
      if (jj === undefined || jj < 0) continue;
      const D = lay.D[jj], top = this.opts.top, bot = Math.min(this.opts.bottom, D);
      if (top >= bot - 1) continue;
      const s = (top + Math.random() * (bot - top)) / D, c = this.sample(x, y, s);
      if (!c) continue;
      if (k < 30 && Math.random() > Math.min(1, Math.hypot(c[0], c[1]) / 0.5 + 0.08)) continue;
      for (let q = 0; q < TRAIL; q++) { P.x[b + q] = x; P.y[b + q] = y; P.s[b + q] = s; }
      P.live[i] = 1; return;
    }
  }

  // Each frame: move on dt real seconds. → true if anything was drawn.
  step(dt) {
    const P = this.P; if (!P || !this.group.visible || !this.lay || !this.A || !this.B) return false;
    dt = Math.min(0.1, dt); this.trailAcc += dt;
    const shift = this.trailAcc >= 0.07 * this.opts.trail; if (shift) this.trailAcc = 0;
    const o = this.opts, K = 0.08 * Math.max(this.view.w, this.view.h) * o.speed, exk = o.ex / 1000;
    const pos = this.lines.geometry.attributes.instanceStart.data.array, col = this.lines.geometry.attributes.instanceColorStart.data.array;
    for (let i = 0; i < P.n; i++) {
      const b = i * TRAIL; P.age[i] += dt;
      let c = P.live[i] ? this.sample(P.x[b], P.y[b], P.s[b]) : null;
      const depth = c ? P.s[b] * c[3] : 0;
      if (!c || P.age[i] > P.life[i] || depth < o.top - 10 || depth > o.bottom + 10) { this.respawn(i); c = P.live[i] ? this.sample(P.x[b], P.y[b], P.s[b]) : null; }
      if (shift) for (let k = TRAIL - 1; k > 0; k--) { P.x[b + k] = P.x[b + k - 1]; P.y[b + k] = P.y[b + k - 1]; P.s[b + k] = P.s[b + k - 1]; }
      if (c) {
        P.x[b] += c[0] * K * dt; P.y[b] += c[1] * K * dt;
        P.s[b] = Math.max(0.005, Math.min(0.995, P.s[b] - (c[2] * K * dt * 1000) / Math.max(1, c[3])));
        const rgb = o.colour === "depth" ? DEPTH_RAMP(Math.min(1, (P.s[b] * c[3]) / 200)) : o.colour === "vertical" ? VERT_RAMP(c[2]) : rampAt(Math.hypot(c[0], c[1]) * KT).map((q) => q + (1 - q) * 0.3);
        P.c[3 * i] = rgb[0]; P.c[3 * i + 1] = rgb[1]; P.c[3 * i + 2] = rgb[2];
        P.D = c[3];
      }
      const fade = Math.min(1, P.age[i] / 0.6, (P.life[i] - P.age[i]) / 0.6) * P.live[i], D = c ? c[3] : 0;
      for (let k = 0; k < TRAIL - 1; k++) {
        const s = (i * (TRAIL - 1) + k) * 6, a = fade * (1 - k / (TRAIL - 1)), a2 = fade * (1 - (k + 1) / (TRAIL - 1));
        pos[s] = P.x[b + k]; pos[s + 1] = P.y[b + k]; pos[s + 2] = -P.s[b + k] * D * exk;
        pos[s + 3] = P.x[b + k + 1]; pos[s + 4] = P.y[b + k + 1]; pos[s + 5] = -P.s[b + k + 1] * D * exk;
        for (let q = 0; q < 3; q++) { col[s + q] = 0.05 + (P.c[3 * i + q] - 0.05) * a; col[s + 3 + q] = 0.05 + (P.c[3 * i + q] - 0.05) * a2; }
      }
    }
    this.lines.geometry.attributes.instanceStart.data.needsUpdate = true;
    this.lines.geometry.attributes.instanceColorStart.data.needsUpdate = true;
    return true;
  }
}
