// SYNC: wind-volume-explorer web/layers/curflow.js@eac80cf Copied verbatim except: rampAt from ./ramps.js,
// the drawing height Z (just over this project's water surface), speed-weighted spawning (spawn()),
// the style options size / width / trail / opacity (owner, 2026-10-05), and the comment below.
//
// The current made visible on the water: particles drifting with it and evenly spaced
// streamlines with arrowheads, from a regular grid of the current (model/flowgrid.js samples the
// SSCOFS mesh onto it), blended between the hours either side of the time on screen.
// Scaled to the view: particles are placed in the view, 1 m/s (~2 kt) crosses about 8% of it a
// second (× the flow speed setting); streamlines are spaced for the view and traced again once it
// stops moving. Colours: the currents key (blue slow → green → yellow → red fast).

import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { rampAt } from "./ramps.js?v=20261005223557";

const TRAIL = 8, KT = 1.943844, Z = 0.012;

function lines(nSeg, width, resolution, order, { casing = false } = {}) {
  const geo = new LineSegmentsGeometry();
  geo.setPositions(new Float32Array(Math.max(1, nSeg) * 6));
  if (!casing) geo.setColors(new Float32Array(Math.max(1, nSeg) * 6));
  const mat = new LineMaterial({ vertexColors: !casing, color: casing ? 0x08141a : 0xffffff, linewidth: width, transparent: true, depthWrite: false });
  mat.resolution.copy(resolution);
  const l = new LineSegments2(geo, mat);
  l.frustumCulled = false; l.renderOrder = order;
  return l;
}

export class CurrentFlow {
  constructor() {
    this.group = new THREE.Group(); this.group.renderOrder = 11;
    this.resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
    window.addEventListener("resize", () => { this.resolution.set(window.innerWidth, window.innerHeight); for (const o of this.group.children) o.material.resolution?.copy(this.resolution); });
    this.opacity = 0.9; this.flat = false; this.grid = null; this.P = null; this.streams = null;
    // size: particle line width ×; width: streamline width ×; trail: trail length ×; opacity 0..1.
    this.opts = { particles: true, lines: false, density: 1, speed: 1, size: 1, width: 1, trail: 1, opacity: 0.9 };
    this.dim = 1;                                                    // (the page fades them under curtains and slices)
    this.view = null; this.trailAcc = 0; this.spawnRef = 1;      // spawnRef: scales the speed weighting (net drift is slow)
  }
  // The view on the map: its middle and size (km), each frame. (Streamlines are traced again once
  // it has changed a good deal and held still for ~0.4 s.)
  setView(cx, cy, w, h) {
    const v = this.view, now = performance.now();
    if (v && Math.abs(v.cx - cx) < 1e-6 && Math.abs(v.cy - cy) < 1e-6 && Math.abs(v.w - w) < 1e-6) { if (this.linesStale && now - v.at > 400 && this.opts.lines && this.grid) { this.linesStale = false; this.buildLines(); return true; } return false; }
    this.view = { cx, cy, w, h, at: now };
    const L = this.linesView;
    if (L && (Math.abs(Math.log(w / L.w)) > 0.35 || Math.hypot(cx - L.cx, cy - L.cy) > 0.3 * L.w)) this.linesStale = true;
    return false;
  }
  viewKm() { const g = this.grid; return Math.min(this.D, this.view ? Math.max(this.view.w, this.view.h) : this.D) || 1; }
  // The view's box on the grid (a margin round it).
  box(m = 1.15) {
    const g = this.grid, v = this.view, X0 = g.x0, Y0 = g.y0, X1 = g.x0 + (g.nx - 1) * g.dxy, Y1 = g.y0 + (g.ny - 1) * g.dxy;
    if (!v) return [X0, Y0, X1, Y1];
    return [Math.max(X0, v.cx - (v.w / 2) * m), Math.max(Y0, v.cy - (v.h / 2) * m), Math.min(X1, v.cx + (v.w / 2) * m), Math.min(Y1, v.cy + (v.h / 2) * m)];
  }
  // g: {x0, y0, dxy, nx, ny, u, v} (m/s, NaN off the water), sampled at cell centres.
  // g, gB: the hours either side, blended by f (0..1); relines: trace the streamlines again
  // (they're kept a while as the time moves).
  setGrid(g, relines = true, gB = null, f = 0) {
    this.grid = g; this.gridB = gB; this.f = gB ? f : 0;
    this.D = Math.hypot(g.nx * g.dxy, g.ny * g.dxy);
    if (this.opts.lines && (relines || !this.streams)) this.buildLines(); else if (!this.opts.lines) this.dropLines();
    if (this.opts.particles && !this.P) this.buildParticles(); else if (!this.opts.particles) this.dropParticles();
  }
  set(opts) {
    const was = { ...this.opts };
    Object.assign(this.opts, opts);
    if (!this.grid) return;
    if (!this.opts.particles) this.dropParticles();
    else if (!this.P || was.density !== this.opts.density || was.size !== this.opts.size) { this.dropParticles(); this.buildParticles(); }
    if (!this.opts.lines) this.dropLines();
    else if (!this.streams || was.density !== this.opts.density || was.width !== this.opts.width) this.buildLines();
    this.setOpacity(this.opts.opacity * this.dim);
  }
  clear() { this.dropParticles(); this.dropLines(); this.grid = null; }
  // parts: the particles' opacity; lines: the streamlines'.
  setOpacity(parts, lines = parts) { this.opacity = parts; this.linesOp = lines; for (const m of this.group.children) m.material.opacity = (m.userData.lines ? lines : parts) * (m.userData.op ?? 1); }
  // 2D: over the land's edge like the sea surface (no depth test); 3D: hidden behind the hills.
  setFlat(on) { this.flat = on; for (const m of this.group.children) m.material.depthTest = !on; }
  add(o, op = 1, lines = false) { o.userData.op = op; o.userData.lines = lines; o.material.opacity = (lines ? this.linesOp ?? this.opacity : this.opacity) * op; o.material.depthTest = !this.flat; this.group.add(o); return o; }

  // Current (m/s) at scene (x, y): bilinear, null off the water.
  at(x, y) {
    const a = this.at1(this.grid, x, y);
    if (!this.gridB || !(this.f > 0)) return a;
    const b = this.at1(this.gridB, x, y);
    if (!a || !b) return a || b;
    return [a[0] + (b[0] - a[0]) * this.f, a[1] + (b[1] - a[1]) * this.f];
  }
  at1(g, x, y) {
    if (!g) return null;
    const fi = (x - g.x0) / g.dxy, fj = (y - g.y0) / g.dxy, i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return null;
    let u = 0, v = 0, w = 0;
    for (const [a, b, q] of [[0, 0, (1 - (fi - i)) * (1 - (fj - j))], [1, 0, (fi - i) * (1 - (fj - j))], [0, 1, (1 - (fi - i)) * (fj - j)], [1, 1, (fi - i) * (fj - j)]]) {
      const c = (j + b) * g.nx + i + a, uu = g.u[c];
      if (Number.isFinite(uu) && q > 0) { u += uu * q; v += g.v[c] * q; w += q; }
    }
    return w > 0.25 ? [u / w, v / w] : null;
  }
  // A random place on the water in the view, with some current (a few tries).
  spawn() {
    const [x0, y0, x1, y1] = this.box();
    if (x1 <= x0 || y1 <= y0) return null;
    for (let k = 0; k < 30; k++) {
      const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0), c = this.at(x, y);
      // (this project) spawn in proportion to speed (up to 0.6 m/s), so the passes get the particles
      // rather than the wide slow basins and the open shelf; slow water still gets some (late tries).
      const sp = c ? Math.hypot(c[0], c[1]) : 0;
      if (c && sp > 0.04 && (k > 24 || Math.random() < Math.min(1, sp / (0.6 * this.spawnRef)))) return [x, y];
    }
    return null;
  }

  // ---------- particles ----------
  buildParticles() {
    const n = Math.round(3000 * this.opts.density), P = { n, x: new Float32Array(n * TRAIL), y: new Float32Array(n * TRAIL), age: new Float32Array(n), life: new Float32Array(n), kt: new Float32Array(n), live: new Uint8Array(n) };
    for (let i = 0; i < n; i++) this.respawn(P, i, true);
    P.lines = this.add(lines(n * (TRAIL - 1), 2.6 * this.opts.size, this.resolution, 12));
    this.P = P;
  }
  respawn(P, i, anyAge = false) {
    const s = this.spawn();
    P.live[i] = s ? 1 : 0;
    const [x, y] = s || [0, 0];
    for (let k = 0; k < TRAIL; k++) { P.x[i * TRAIL + k] = x; P.y[i * TRAIL + k] = y; }
    P.life[i] = 3 + Math.random() * 5; P.age[i] = anyAge ? Math.random() * P.life[i] : 0;
  }
  dropParticles() { if (this.P) { this.group.remove(this.P.lines); this.P.lines.geometry.dispose(); this.P.lines.material.dispose(); this.P = null; } }
  // Each frame: move the particles on (dt real seconds). → true while there's anything to draw.
  step(dt) {
    const P = this.P;
    if (!P || !this.grid || !this.group.visible) return false;
    dt = Math.min(0.1, dt);
    this.trailAcc += dt;
    const shift = this.trailAcc >= 0.07 * this.opts.trail;          // (a trail point every 0.07 s: ~½ s of motion, × trail)
    if (shift) this.trailAcc = 0;
    const K = 0.08 * this.viewKm() * this.opts.speed, [bx0, by0, bx1, by1] = this.box(1.3), pos = P.lines.geometry.attributes.instanceStart.data.array, col = P.lines.geometry.attributes.instanceColorStart.data.array;
    for (let i = 0; i < P.n; i++) {
      const b = i * TRAIL;
      P.age[i] += dt;
      let c = P.live[i] ? this.at(P.x[b], P.y[b]) : null;
      if (!c || P.age[i] > P.life[i] || P.x[b] < bx0 || P.x[b] > bx1 || P.y[b] < by0 || P.y[b] > by1) { this.respawn(P, i); c = P.live[i] ? this.at(P.x[b], P.y[b]) : null; }
      if (shift) for (let k = TRAIL - 1; k > 0; k--) { P.x[b + k] = P.x[b + k - 1]; P.y[b + k] = P.y[b + k - 1]; }
      if (c) { P.x[b] += c[0] * K * dt; P.y[b] += c[1] * K * dt; P.kt[i] = Math.hypot(c[0], c[1]) * KT; }
      // Fade in and out over the particle's life; the tail darker toward its end.
      const fade = Math.min(1, P.age[i] / 0.6, (P.life[i] - P.age[i]) / 0.6) * (P.live[i] ? 1 : 0), rgb = rampAt(P.kt[i]).map((q) => q + (1 - q) * 0.35);   // (lightened: reads on the dark water)
      for (let k = 0; k < TRAIL - 1; k++) {
        const s = (i * (TRAIL - 1) + k) * 6, a = fade * (1 - k / (TRAIL - 1)), a2 = fade * (1 - (k + 1) / (TRAIL - 1));
        pos[s] = P.x[b + k]; pos[s + 1] = P.y[b + k]; pos[s + 2] = Z; pos[s + 3] = P.x[b + k + 1]; pos[s + 4] = P.y[b + k + 1]; pos[s + 5] = Z;
        for (let q = 0; q < 3; q++) { col[s + q] = 0.06 + (rgb[q] - 0.06) * a; col[s + 3 + q] = 0.06 + (rgb[q] - 0.06) * a2; }
      }
    }
    P.lines.geometry.attributes.instanceStart.data.needsUpdate = true;
    P.lines.geometry.attributes.instanceColorStart.data.needsUpdate = true;
    return true;
  }

  // ---------- streamlines ----------
  // Evenly spaced (seeds on a grid; a line stops where it comes near another), traced both ways
  // from each seed, with an arrowhead every ~5 spacings.
  buildLines() {
    this.dropLines();
    const g = this.grid, sp = Math.max(0.3, (0.03 * this.viewKm()) / Math.sqrt(this.opts.density)), h = sp / 6, oc = sp * 0.5, [bx0, by0, bx1, by1] = this.box(1.4);
    this.linesView = this.view ? { ...this.view } : null; this.linesStale = false;
    const onx = Math.ceil((g.nx * g.dxy) / oc) + 1, occ = new Int32Array(onx * (Math.ceil((g.ny * g.dxy) / oc) + 1)).fill(-1);
    const cell = (x, y) => Math.floor((y - g.y0) / oc) * onx + Math.floor((x - g.x0) / oc);
    const segs = [], heads = [];
    let id = 0;
    const trace = (x, y, dir, me) => {
      const pts = [];
      for (let k = 0; k < 400; k++) {
        if (x < bx0 || x > bx1 || y < by0 || y > by1) break;
        const c = this.at(x, y); if (!c) break;
        const m = Math.hypot(c[0], c[1]); if (m < 0.03) break;
        const o = cell(x, y); if (occ[o] !== -1 && occ[o] !== me) break;
        occ[o] = me; pts.push([x, y, m * KT]);
        const mx = x + (dir * c[0] / m) * h * 0.5, my = y + (dir * c[1] / m) * h * 0.5, c2 = this.at(mx, my); if (!c2) break;
        const m2 = Math.hypot(c2[0], c2[1]) || 1; x += (dir * c2[0] / m2) * h; y += (dir * c2[1] / m2) * h;
      }
      return pts;
    };
    for (let y = by0 + sp / 2; y < by1; y += sp) for (let x = bx0 + sp / 2 + (Math.random() - 0.5) * sp * 0.3; x < bx1; x += sp) {
      const o = cell(x, y); if (occ[o] !== -1) continue;
      const c = this.at(x, y); if (!c || Math.hypot(c[0], c[1]) < 0.05) continue;
      const me = id++, back = trace(x, y, -1, me).reverse(), fwd = trace(x, y, 1, me).slice(1), line = back.concat(fwd);
      if (line.length < 6) continue;
      for (let k = 1; k < line.length; k++) segs.push(line[k - 1], line[k]);
      for (let k = 3; k < line.length - 1; k += 30) heads.push([line[k - 1], line[k + 1]]);
    }
    // Arrowheads: two short strokes back from the point, along the flow.
    const L = sp * 0.35;
    for (const [a, b] of heads) {
      const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1, ux = dx / m, uy = dy / m;
      for (const s of [1, -1]) segs.push([b[0], b[1], b[2]], [b[0] - L * (ux * 0.87 - s * uy * 0.5), b[1] - L * (uy * 0.87 + s * ux * 0.5), b[2]]);
    }
    const n = segs.length / 2;
    if (!n) return;
    const cas = this.add(lines(n, 4 * this.opts.width, this.resolution, 11, { casing: true }), 0.55, true), fill = this.add(lines(n, 1.8 * this.opts.width, this.resolution, 12), 1, true);
    const cp = cas.geometry.attributes.instanceStart.data.array, fp = fill.geometry.attributes.instanceStart.data.array, fc = fill.geometry.attributes.instanceColorStart.data.array;
    for (let k = 0; k < segs.length; k++) {
      const p = segs[k], rgb = rampAt(p[2]);
      cp[k * 3] = fp[k * 3] = p[0]; cp[k * 3 + 1] = fp[k * 3 + 1] = p[1]; cp[k * 3 + 2] = Z - 0.001; fp[k * 3 + 2] = Z;
      fc[k * 3] = rgb[0]; fc[k * 3 + 1] = rgb[1]; fc[k * 3 + 2] = rgb[2];
    }
    this.streams = [cas, fill];
  }
  dropLines() { for (const o of this.streams || []) { this.group.remove(o); o.geometry.dispose(); o.material.dispose(); } this.streams = null; }
}
// END SYNC
