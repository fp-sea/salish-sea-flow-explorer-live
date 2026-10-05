// Curtains: vertical sections through the full 3D volume along the pass lines (passes.json:
// Tacoma Narrows, Hood Canal entrance, Admiralty Inlet, Deception Pass, Swinomish Channel), each
// a wall from the surface down to the model's seabed, coloured by the current across it: blue
// into the basin (flood), orange out (ebb), pale slack — so the two-layer exchange over the
// Admiralty Inlet sill (fresher water out on top, salt water in underneath) shows as two colours
// stacked, and the turn of the tide sweeps through the depth rather than all at once.
//
// Inputs: the model (a lab run with the volume loaded: model.volColumns), passes.json, the
// projection, the seabed exaggeration. Each curtain: columns every ~DS km along its line where the
// line is on the mesh; rows at the surface, the 10 layer centres (sigma, × the local depth) and the
// seabed. Values are unpacked once for every hour (~1.7 MB in all) and blended in time in the
// shader, like the colour fill (layers/meshfield.js).
//
// "Into the basin" is the side whose flow matches the basin filling: the sign of the depth-
// averaged current across the line is chosen to agree with the pass's published flux.
//
// Straits without a basin line (STRAITS): a section square across the channel at its deepest point
// (found on the mesh, RESEARCH_LOG 2026-10-05), its direction from the phase map's flood direction
// there, running out to the model's own shoreline both ways; blue = flood (the tide coming in).
//
// section(id) → {label, t[], depth[] (m, per layer centre at the deepest column), q[hour][layer]
// kt across (+ into the basin)}: the deepest point of a curtain over the whole run, for the card.
//
// exchange(id) → the net (tidally averaged) transport through the whole section, layer by layer, as
// in the Salish Sea Model's circulation maps (SSMC/UW; Khangaonkar et al. 2017): each layer's volume
// flux Σ q·Δσ·h·ds every hour, the tide fitted out (mean + trend + M2, K1, M4, least squares — as
// pipeline/patterns.py), the mean kept; the upper layers flowing out and the lower flowing in are
// summed: {out, in (m³/s, out negative), zeroDepth m (where the net flow changes direction), profile}.
// 73 hours can't separate every constituent (N2, O1 and the spring–neap beat leak into the mean),
// so the estimate carries an error of a few thousand m³/s. Check: in and out must nearly balance
// (rivers add ~1k m³/s), so |net| is a fair size for the error; `ok` = the exchange (the smaller of
// in and out) is clearly larger than it. The map draws only those; the card says so.

import * as THREE from "three";
import { RAMPS, rampPixels } from "./ramps.js?v=20261005223557";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { tidalMean } from "../model/tidefit.js?v=20261005223557";

const DS = 0.06;                      // km between columns
const STRAITS = [
  { id: "haro", label: "Haro Strait", at: [48.55, -123.212], basin: "the San Juan Islands and the Strait of Georgia" },
  { id: "rosario", label: "Rosario Strait", at: [48.50, -122.743], basin: "the north end of the strait" },
];
const RAMP = "along";

export class Curtains {
  constructor(model, proj) {
    Object.assign(this, { model, proj });
    this.group = new THREE.Group(); this.group.visible = false;
    this.tex = new THREE.DataTexture(rampPixels(RAMP), 256, 1); this.tex.needsUpdate = true;
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.items = []; this.ready = false; this.ex = null;
  }

  // The pass lines, sampled on the mesh. (Cheap; no volume needed.)
  lines() {
    const m = this.model, out = [];
    for (const b of m.passes?.basins || []) for (const p of b.passes) {
      const A = this.proj.toXY(...p.a), B = this.proj.toXY(...p.b), L = Math.hypot(B.x - A.x, B.y - A.y), n = Math.max(2, Math.round(L / DS) + 1);
      const cols = [];
      for (let k = 0; k < n; k++) {
        const f = k / (n - 1), x = A.x + (B.x - A.x) * f, y = A.y + (B.y - A.y) * f, hit = m.locate(x, y);
        if (hit) cols.push({ x, y, e: hit.e, h: hit.nodes.reduce((s, q, i) => s + hit.w[i] * m.h[q] / 10, 0), s: f * L });
      }
      if (cols.length < 2) continue;
      out.push({ id: p.id, label: p.label, basin: b.label.split(",")[0], flux: p.flux, cols, nx: -(B.y - A.y) / L, ny: (B.x - A.x) / L });
    }
    for (const S of this.model.phase ? STRAITS : []) {
      const c0 = this.proj.toXY(...S.at), hit = m.locate(c0.x, c0.y); if (!hit) continue;
      const fl = this.model.phaseAt(hit.e).flood * Math.PI / 180, fx = Math.sin(fl), fy = Math.cos(fl), px = fy, py = -fx;   // flood, and across it
      const walk = (sgn) => { const pts = []; for (let k = 0; k < 400; k++) { const x = c0.x + sgn * px * DS * k, y = c0.y + sgn * py * DS * k, h = m.locate(x, y); if (!h) break; pts.push({ x, y, e: h.e, h: h.nodes.reduce((s, q, i) => s + h.w[i] * m.h[q] / 10, 0) }); } return pts; };
      const one = walk(-1).reverse(), two = walk(1).slice(1), cols = one.concat(two);
      cols.forEach((q, k) => { q.s = k * DS; });
      if (cols.length > 4) out.push({ id: S.id, label: S.label, basin: S.basin, flux: null, cols, nx: fx, ny: fy });
    }
    return out;
  }

  // Unpack the volume along every line (once). onProgress(done, n).
  async load(onProgress) {
    if (this.ready) return true;
    const items = this.lines(), m = this.model;
    const elems = items.flatMap((c) => c.cols.map((q) => q.e));
    const V = await m.volColumns(elems, onProgress);
    if (!V) return false;
    const { T, L, n } = V;
    let off = 0;
    for (const c of items) {
      const k = c.cols.length;
      c.q = new Float32Array(T * L * k);                              // kt across the line, left of a→b
      for (let j = 0; j < T; j++) for (let l = 0; l < L; l++) for (let i = 0; i < k; i++) {
        const o = (j * L + l) * n + off + i; c.q[(j * L + l) * k + i] = V.u[o] * c.nx + V.v[o] * c.ny;
      }
      // Sign: depth-averaged flow across the line should rise and fall with the pass's flux (+ = filling).
      const ds = m.meta.siglev.slice(1).map((s, l) => m.meta.siglev[l] - s);
      let agree = 0;
      for (let j = 0; c.flux && j < T && j < c.flux.length; j++) {
        let s = 0; for (let l = 0; l < L; l++) for (let i = 0; i < k; i++) s += c.q[(j * L + l) * k + i] * ds[l] * c.cols[i].h;
        agree += s * (c.flux[j - this.model.volOff] || 0);
      }
      if (c.flux && agree < 0) { for (let i = 0; i < c.q.length; i++) c.q[i] = -c.q[i]; c.nx = -c.nx; c.ny = -c.ny; }   // (+ and the normal both into the basin; straits: already the flood direction)
      off += k;
    }
    this.items = items; this.T = T; this.L = L; this.ready = true;
    this.build(this.ex ?? 8);
    return true;
  }

  // Geometry for seabed exaggeration ex. Rows: surface, the layer centres, the seabed.
  build(ex) {
    this.ex = ex;
    if (!this.ready) return;
    this.group.clear();
    const sig = this.model.meta.siglev, L = this.L, mid = [];
    for (let l = 0; l < L; l++) mid.push(-(sig[l] + sig[l + 1]) / 2);
    const rows = [0, ...mid, 1], R = rows.length;
    for (const c of this.items) {
      const k = c.cols.length, pos = new Float32Array(k * R * 3), idx = [];
      for (let i = 0; i < k; i++) for (let r = 0; r < R; r++) {
        const o = (i * R + r) * 3; pos[o] = c.cols[i].x; pos[o + 1] = c.cols[i].y; pos[o + 2] = -rows[r] * c.cols[i].h / 1000 * ex;
      }
      for (let i = 0; i + 1 < k; i++) {
        if (c.cols[i + 1].s - c.cols[i].s > DS * 1.6) continue;        // (a gap: land, e.g. an island in the line)
        for (let r = 0; r + 1 < R; r++) { const a = i * R + r, b = (i + 1) * R + r; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      c.aA = new THREE.BufferAttribute(new Float32Array(k * R), 1); c.aB = new THREE.BufferAttribute(new Float32Array(k * R), 1);
      geo.setAttribute("aA", c.aA); geo.setAttribute("aB", c.aB); geo.setIndex(idx);
      const R0 = RAMPS[RAMP];
      c.mat = new THREE.ShaderMaterial({
        uniforms: { uRamp: { value: this.tex }, uMin: { value: R0.min }, uMax: { value: R0.max }, uMix: { value: 0 }, uOpacity: { value: 0.95 } },
        vertexShader: `attribute float aA; attribute float aB; uniform float uMix; varying float vVal;
          void main() { vVal = mix(aA, aB, uMix); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D uRamp; uniform float uMin; uniform float uMax; uniform float uOpacity; varying float vVal;
          void main() { float t = clamp((vVal - uMin) / (uMax - uMin), 0.0, 1.0); gl_FragColor = vec4(texture2D(uRamp, vec2(t, 0.5)).rgb, uOpacity);
            #include <colorspace_fragment>
          }`,
        transparent: true, side: THREE.DoubleSide, depthWrite: true,
      });
      c.mesh = new THREE.Mesh(geo, c.mat); c.mesh.renderOrder = 20; c.mesh.frustumCulled = false; c.mesh.userData.curtain = c.id;
      // The wall's outline (dark: it shares the fill's colours, so it needs an edge to read as a
      // wall) and faint lines at the layer centres, which also show the model's layers thinning
      // into shallow water.
      const P = (i, r) => [pos[(i * R + r) * 3], pos[(i * R + r) * 3 + 1], pos[(i * R + r) * 3 + 2]];
      const frame = [], layers = [];
      for (let i = 0; i + 1 < k; i++) {
        if (c.cols[i + 1].s - c.cols[i].s > DS * 1.6) continue;
        frame.push(...P(i, 0), ...P(i + 1, 0), ...P(i, R - 1), ...P(i + 1, R - 1));
        for (let r = 1; r < R - 1; r++) layers.push(...P(i, r), ...P(i + 1, r));
      }
      frame.push(...P(0, 0), ...P(0, R - 1), ...P(k - 1, 0), ...P(k - 1, R - 1));
      const seg = (arr, color, opacity) => { const l = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(arr), 3)),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity })); l.renderOrder = 21; l.frustumCulled = false; return l; };
      c.R = R; c.keyA = c.keyB = null;
      this.group.add(c.mesh, seg(frame, 0x0b1a22, 0.9), seg(layers, 0x0b1a22, 0.18));
    }
  }

  _fill(c, attr, j) {
    const k = c.cols.length, R = c.R, L = this.L, a = attr.array;
    for (let i = 0; i < k; i++) for (let r = 0; r < R; r++) {
      const l = Math.min(L - 1, Math.max(0, r - 1));                  // surface row = top layer; seabed row = bottom layer
      a[i * R + r] = c.q[(j * L + l) * k + i];
    }
    attr.needsUpdate = true;
  }

  // Show time t (ms). The volume's hours: index j = tier-1 index + volOff.
  setTime(t) {
    if (!this.ready || !this.group.visible) return;
    const m = this.model, f = m.fi(t), i0 = Math.floor(f), j0 = Math.max(0, Math.min(this.T - 1, i0 + m.volOff)), j1 = Math.min(this.T - 1, j0 + 1);
    for (const c of this.items) {
      if (c.keyA !== j0) { this._fill(c, c.aA, j0); c.keyA = j0; }
      if (c.keyB !== j1) { this._fill(c, c.aB, j1); c.keyB = j1; }
      c.mat.uniforms.uMix.value = f - i0;
    }
  }

  meshes() { return this.items.map((c) => c.mesh).filter(Boolean); }

  exchange(id) {
    const c = this.items.find((q) => q.id === id); if (!c || !this.ready) return null;
    const sig = this.model.meta.siglev, L = this.L, k = c.cols.length, T = this.T, KN = 0.514444, ds = DS * 1000;
    const t = [...Array(T).keys()], prof = [];
    for (let l = 0; l < L; l++) {
      const dsig = sig[l] - sig[l + 1], F = [];
      for (let j = 0; j < T; j++) { let f = 0; for (let i = 0; i < k; i++) f += c.q[(j * L + l) * k + i] * KN * dsig * c.cols[i].h * ds; F.push(f); }
      prof.push(tidalMean(F, t));
    }
    const out = prof.filter((v) => v < 0).reduce((a, b) => a + b, 0), inn = prof.filter((v) => v > 0).reduce((a, b) => a + b, 0);
    const hmax = Math.max(...c.cols.map((q) => q.h)); let zeroDepth = null;
    for (let l = 0; l + 1 < L; l++) if (Math.sign(prof[l]) !== Math.sign(prof[l + 1])) { zeroDepth = -sig[l + 1] * hmax; break; }
    const net = out + inn;
    return { id, label: c.label, out, in: inn, net, zeroDepth, profile: prof, c, ok: Math.min(inn, -out) > 2 * Math.abs(net) && Math.min(inn, -out) > 300 };
  }

  // The net exchange on the map: at each section a flat arrow each way (blue in, orange out; length
  // grows with the transport) with its number in thousand m³/s.
  exchangeGroup() {
    const g = new THREE.Group(), css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";
    for (const c of this.items) {
      const ex = this.exchange(c.id); if (!ex?.ok) continue;
      const a = c.cols[0], b = c.cols.at(-1), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, width = b.s - a.s;
      for (const [q, sgn, color] of [[ex.in, 1, css("--flood")], [ex.out, -1, css("--ebb")]]) {
        if (Math.abs(q) < 50) continue;
        const len = Math.max(1, Math.min(9, 1.2 + Math.sqrt(Math.abs(q) / 1000) * 1.1)), w = len * 0.22, side = (sgn > 0 ? 1 : -1) * Math.min(1.2, width * 0.25 + 0.2);
        const ux = c.nx * sgn, uy = c.ny * sgn, px = -uy, py = ux, ox = mx + px * side - ux * len * 0.1, oy = my + py * side - uy * len * 0.1;
        const P = (f, s2) => [ox + ux * len * f + px * w * s2, oy + uy * len * f + py * w * s2, 0.02];
        const v = [...P(0, -0.35), ...P(0.65, -0.35), ...P(0.65, 0.35), ...P(0, -0.35), ...P(0.65, 0.35), ...P(0, 0.35), ...P(0.65, -1), ...P(1, 0), ...P(0.65, 1)];
        const m = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(v), 3)), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.92, depthTest: false }));
        m.renderOrder = 30; g.add(m);
        const d = document.createElement("div"); d.className = "ex-tag"; d.style.color = color; d.textContent = `${sgn > 0 ? "in" : "out"} ${Math.round(Math.abs(q) / 1000 * 10) / 10}k`;
        const o = new CSS2DObject(d); o.position.set(ox + ux * len * 1.15, oy + uy * len * 1.15, 0.05); g.add(o);
      }
    }
    return g;
  }

  // The deepest column of curtain `id` over the run: for the card's depth × time chart.
  // at: {x, y, name} — a NOAA station on the line: its column instead of the deepest.
  section(id, at = null) {
    const c = this.items.find((q) => q.id === id); if (!c) return null;
    let i = 0; c.cols.forEach((q, k) => { if (q.h > c.cols[i].h) i = k; });
    if (at) c.cols.forEach((q, k) => { if (Math.hypot(q.x - at.x, q.y - at.y) < Math.hypot(c.cols[i].x - at.x, c.cols[i].y - at.y)) i = k; });
    const sig = this.model.meta.siglev, L = this.L, k = c.cols.length, h = c.cols[i].h, depth = [], q = [];
    for (let l = 0; l < L; l++) depth.push(-(sig[l] + sig[l + 1]) / 2 * h);
    for (let j = 0; j < this.T; j++) { const row = []; for (let l = 0; l < L; l++) row.push(c.q[(j * L + l) * k + i]); q.push(row); }
    const vc = this.model.volCycle?.getTime() ?? this.model.cycle.getTime(), vl = this.model.meta.volume.leads;
    return { id, label: c.label, basin: c.basin, h, depth, q, atName: at?.name || null, t: vl.map((L0) => vc + L0 * 3600e3), at: this.proj.toLatLon(c.cols[i].x, c.cols[i].y), widthKm: c.cols.at(-1).s - c.cols[0].s };
  }
}
