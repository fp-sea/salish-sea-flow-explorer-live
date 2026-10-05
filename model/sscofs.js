// The latest SSCOFS run as published by pipeline/sscofs.py (its docstring is the file contract):
// the mesh, every hour's water level and currents (tier 1, always loaded), the full volume when
// asked for (tier 2), and the per-element tide/current timing (phase).
//
// Two kinds of run share this class: the daily run (sscofs/latest.json: surface only, "davg":
// false, its ua/va are zeros) and lab runs (lab/<id>.json, pipeline/lab.py: every layer, the
// volume, phase, passes, patterns). A daily run can borrow a lab run's phase and patterns (same
// mesh; tidal timing barely changes week to week): borrowFrom() — their files then load from the
// lab's folder (meta.phase.base / meta.patterns.base).
//
// FVCOM keeps water level at triangle corners (nodes) and currents at triangle centres
// (elements). For drawing, element values are carried to nodes as area-weighted averages
// (nodeAvg), so every field is smooth across the mesh; the probe and meteogram use the element
// itself (and its three corners for the level).
//
// Units on the way out: knots (east/north components), metres (level), m/s for w.

import { fetchKept, counters } from "./store.js?v=20261005223557";

const KT_STEP = 0.1, W_STEP = 0.001;

// The file as it arrives (gzip bytes), from this device's store when it's there.
export async function rawBuf(url) {
  const r = await fetchKept(url);
  if (!r.ok) throw new Error(`${url.split("/").pop()}: HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  counters[r.fromDevice ? "device" : "network"] += buf.byteLength;
  return buf;
}
export async function gunzip(buf) {
  const h = new Uint8Array(buf, 0, 2);
  return h[0] === 0x1f && h[1] === 0x8b ? new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer() : buf;
}
export async function gunzipBuf(url) { return gunzip(await rawBuf(url)); }

// int8 values from `off` (count n) plus the overflow list after them → {q: Int8Array, over: Map(index → value)}.
export function readI8(buf, off, n) {
  const q = new Int8Array(buf, off, n), dv = new DataView(buf), base = off + n, k = dv.getUint32(base, true);
  const over = new Map();
  for (let i = 0; i < k; i++) over.set(dv.getUint32(base + 4 + 4 * i, true), dv.getInt16(base + 4 + 4 * k + 2 * i, true));
  return { q, over };
}

export class Sscofs {
  // The newest published run's description (never cached), or null.
  static async latest(base = "data/sscofs/") {
    try { const r = await fetch(`${base}latest.json`, { cache: "no-cache" }); return r.ok ? await r.json() : null; } catch { return null; }
  }
  // meta: a run's description (latest.json, or one kept from an earlier visit).
  static async open(base = "data/sscofs/", proj, meta = null) {
    meta = meta || await Sscofs.latest(base);
    if (!meta) return null;
    const m = new Sscofs(meta, base);
    await m.loadMesh(proj);
    return m;
  }

  constructor(meta, base) {
    this.meta = meta; this.base = base;
    this.cycle = new Date(meta.cycle);
    this.leads = meta.leads;
    this.t0 = this.cycle.getTime() + this.leads[0] * 3600e3;
    this.t1 = this.cycle.getTime() + this.leads.at(-1) * 3600e3;
    this.N = meta.nodes; this.E = meta.elements;
    this.frames = new Array(this.leads.length).fill(null);       // tier 1 per lead
    // Tier 2 can come from an earlier run than tier 1 (the runner rebuilds the volume once a day):
    // its own cycle and leads; volume index = tier-1 index + volOff (same valid time).
    const V = meta.volume;
    this.volCycle = V ? new Date(V.cycle || meta.cycle) : null;
    this.volOff = V ? Math.round((this.cycle - this.volCycle) / 3600e3) : 0;
    this.vol = new Array(V ? (V.leads || meta.leads).length : 0).fill(null);
    this.cache = new Map();                                       // decoded node fields, "kind|lead"
    this.phase = null;
  }

  get tag() { return this.meta.t1.file.split("/")[0]; }
  // Has the depth-averaged current (ua, va)? Runs from before the field existed always did.
  get hasDavg() { return this.meta.davg !== false; }
  // A lab run's phase map and patterns for this run (same mesh only). → the lab's label, or null
  borrowFrom(labMeta, labBase) {
    if (!labMeta || labMeta.mesh !== this.meta.mesh) return null;
    for (const k of ["phase", "patterns"]) if (!this.meta[k] && labMeta[k]) this.meta = { ...this.meta, [k]: { ...labMeta[k], base: labBase } };
    this.borrowed = labMeta.lab?.label || labMeta.cycle.slice(0, 10);
    return this.borrowed;
  }
  get label() { return `SSCOFS ${String(this.cycle.getUTCHours()).padStart(2, "0")}Z ${this.meta.cycle.slice(0, 10)}`; }
  timeOf(i) { return this.cycle.getTime() + this.leads[i] * 3600e3; }
  covers(t) { return t >= this.t0 && t <= this.t1; }
  // Fractional lead index for time t (clamped).
  fi(t) { return Math.max(0, Math.min(this.leads.length - 1, (t - this.cycle.getTime()) / 3600e3 - this.leads[0])); }

  async loadMesh(proj) {
    const d = `${this.base}${this.meta.mesh}/`;
    const [nodes, nv, h] = await Promise.all([gunzipBuf(d + "nodes.f32.gz"), gunzipBuf(d + "nv.u32.gz"), gunzipBuf(d + "h.i16.gz")]);
    const ll = new Float32Array(nodes), N = this.N, E = this.E;
    this.nv = new Uint32Array(nv);
    this.h = new Int16Array(h);                                    // dm
    this.lon = new Float32Array(N); this.lat = new Float32Array(N);
    this.x = new Float32Array(N); this.y = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.lon[i] = ll[2 * i]; this.lat[i] = ll[2 * i + 1];
      const p = proj.toXY(this.lat[i], this.lon[i]); this.x[i] = p.x; this.y[i] = p.y;
    }
    // Element centres, areas, and node ← element weights (area), as CSR.
    this.cx = new Float32Array(E); this.cy = new Float32Array(E); const area = new Float32Array(E), cnt = new Uint32Array(N + 1);
    for (let e = 0; e < E; e++) {
      const a = this.nv[3 * e], b = this.nv[3 * e + 1], c = this.nv[3 * e + 2];
      this.cx[e] = (this.x[a] + this.x[b] + this.x[c]) / 3; this.cy[e] = (this.y[a] + this.y[b] + this.y[c]) / 3;
      area[e] = Math.abs((this.x[b] - this.x[a]) * (this.y[c] - this.y[a]) - (this.x[c] - this.x[a]) * (this.y[b] - this.y[a])) / 2;
      cnt[a + 1]++; cnt[b + 1]++; cnt[c + 1]++;
    }
    for (let i = 0; i < N; i++) cnt[i + 1] += cnt[i];
    const fill = cnt.slice(0, N), elems = new Uint32Array(3 * E), wts = new Float32Array(3 * E);
    for (let e = 0; e < E; e++) for (let k = 0; k < 3; k++) { const n = this.nv[3 * e + k], s = fill[n]++; elems[s] = e; wts[s] = area[e]; }
    for (let i = 0; i < N; i++) { let s = 0; for (let j = cnt[i]; j < cnt[i + 1]; j++) s += wts[j]; for (let j = cnt[i]; j < cnt[i + 1]; j++) wts[j] /= s || 1; }
    this.csr = { off: cnt, elems, wts };
    this.area = area;
    this._buildLocator();
  }

  // Buckets of elements (1 km) for point lookup.
  _buildLocator() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < this.N; i++) { x0 = Math.min(x0, this.x[i]); x1 = Math.max(x1, this.x[i]); y0 = Math.min(y0, this.y[i]); y1 = Math.max(y1, this.y[i]); }
    const B = 1.0, nx = Math.ceil((x1 - x0) / B) + 1, ny = Math.ceil((y1 - y0) / B) + 1, E = this.E;
    const cnt = new Uint32Array(nx * ny + 1), span = [];
    const cells = (e, f) => {
      const a = this.nv[3 * e], b = this.nv[3 * e + 1], c = this.nv[3 * e + 2];
      const i0 = Math.floor((Math.min(this.x[a], this.x[b], this.x[c]) - x0) / B), i1 = Math.floor((Math.max(this.x[a], this.x[b], this.x[c]) - x0) / B);
      const j0 = Math.floor((Math.min(this.y[a], this.y[b], this.y[c]) - y0) / B), j1 = Math.floor((Math.max(this.y[a], this.y[b], this.y[c]) - y0) / B);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * nx + i);
    };
    for (let e = 0; e < E; e++) cells(e, (k) => cnt[k + 1]++);
    for (let k = 0; k < nx * ny; k++) cnt[k + 1] += cnt[k];
    const fill = cnt.slice(0, nx * ny), list = new Uint32Array(cnt[nx * ny]);
    for (let e = 0; e < E; e++) cells(e, (k) => { list[fill[k]++] = e; });
    this.loc = { x0, y0, B, nx, ny, cnt, list };
  }

  // The element containing scene (x, y) and its barycentric weights on its 3 nodes, or null.
  locate(x, y) {
    const L = this.loc, i = Math.floor((x - L.x0) / L.B), j = Math.floor((y - L.y0) / L.B);
    if (i < 0 || j < 0 || i >= L.nx || j >= L.ny) return null;
    const k = j * L.nx + i;
    for (let s = L.cnt[k]; s < L.cnt[k + 1]; s++) {
      const e = L.list[s], a = this.nv[3 * e], b = this.nv[3 * e + 1], c = this.nv[3 * e + 2];
      const x1 = this.x[a], y1 = this.y[a], x2 = this.x[b], y2 = this.y[b], x3 = this.x[c], y3 = this.y[c];
      const det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
      const l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / det, l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / det, l3 = 1 - l1 - l2;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) return { e, nodes: [a, b, c], w: [l1, l2, l3] };
    }
    return null;
  }

  // ---------------- tier 1: all hours ----------------
  async loadTier1(onProgress) {
    const n = this.leads.length, url = (i) => this.base + this.meta.t1.file.replace("{lead:03d}", String(this.leads[i]).padStart(3, "0"));
    let done = 0, bytes = 0;
    const one = async (i) => {
      if (this.frames[i]) return;
      const buf = await gunzipBuf(url(i)); bytes += buf.byteLength;
      const N = this.N, E = this.E, rest = readI8(buf, 2 * N, 4 * E);
      // A surface-only run's ua/va are zeros: keep copies of just the level and the surface current,
      // so the unpacked hour (1.6 MB) can be freed — ~40 % less memory for the 73 hours (phones).
      this.frames[i] = this.hasDavg ? { zeta: new Int16Array(buf, 0, N), q: rest.q, over: rest.over }
        : { zeta: new Int16Array(buf, 0, N).slice(), q: rest.q.slice(0, 2 * E), over: new Map([...rest.over].filter(([k]) => k < 2 * E)) };
      onProgress?.(++done, n);
    };
    const order = [...Array(n).keys()];
    for (let k = 0; k < order.length; k += 6) await Promise.all(order.slice(k, k + 6).map(one));
    return bytes;
  }

  get ready() { return this.frames.every(Boolean); }

  // Element field value (kt) from a tier-1 frame: f = 0 us, 1 vs, 2 ua, 3 va.
  _el(fr, f, e) { if (f >= 2 && !this.hasDavg) return 0; const k = f * this.E + e, o = fr.over.size ? fr.over.get(k) : undefined; return (o ?? fr.q[k]) * KT_STEP; }

  // Decoded per-node field for one lead (cached): "zeta" (m, NaN dry), "surf" / "davg" ([u, v] kt
  // interleaved), or "d:<metres>" / "d:bottom" (from the volume: depthField).
  nodeField(kind, i) {
    if (kind.startsWith("d:")) { const d = kind.slice(2); return this.depthField(d === "bottom" ? "bottom" : +d, i); }
    if (kind === "res_s" || kind === "res_d") {                    // net drift over the run (static): [u, v] kt per node
      if (this.cache.has(kind)) return this.cache.get(kind);
      if (!this.patterns) return null;
      const U = new Float32Array(this.E), V = new Float32Array(this.E);
      for (let e = 0; e < this.E; e++) { U[e] = this.pat(`${kind}_u`, e); V[e] = this.pat(`${kind}_v`, e); }
      const nu = this.toNodes(U), nvv = this.toNodes(V), out = new Float32Array(2 * this.N);
      for (let n = 0; n < this.N; n++) { out[2 * n] = nu[n]; out[2 * n + 1] = nvv[n]; }
      this.cache.set(kind, out);                                 // (kept: tiny and reused)
      return out;
    }
    const key = `${kind}|${i}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const fr = this.frames[i]; if (!fr) return null;
    const N = this.N, { off, elems, wts } = this.csr;
    let out;
    if (kind === "zeta") {
      out = new Float32Array(N);
      for (let n = 0; n < N; n++) out[n] = fr.zeta[n] === -32768 ? NaN : fr.zeta[n] / 100;
    } else {
      const fu = kind === "surf" ? 0 : 2; out = new Float32Array(2 * N);
      for (let n = 0; n < N; n++) {
        let u = 0, v = 0;
        for (let j = off[n]; j < off[n + 1]; j++) { const e = elems[j], w = wts[j]; u += w * this._el(fr, fu, e); v += w * this._el(fr, fu + 1, e); }
        out[2 * n] = u; out[2 * n + 1] = v;
      }
    }
    if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, out);
    return out;
  }

  // Values at a located point for time t: {zeta m, us, vs, ua, va kt} blended between hours; null if not loaded.
  at(hit, t) {
    const f = this.fi(t), i0 = Math.floor(f), i1 = Math.min(this.leads.length - 1, i0 + 1), w = f - i0;
    const A = this.frames[i0], B = this.frames[i1]; if (!A || !B) return null;
    const one = (fr) => {
      let z = 0, dry = false;
      hit.nodes.forEach((n, k) => { const q = fr.zeta[n]; if (q === -32768) dry = true; z += hit.w[k] * q / 100; });
      return { zeta: dry ? NaN : z, us: this._el(fr, 0, hit.e), vs: this._el(fr, 1, hit.e), ua: this._el(fr, 2, hit.e), va: this._el(fr, 3, hit.e) };
    };
    const a = one(A), b = one(B), o = {};
    for (const k in a) o[k] = a[k] * (1 - w) + b[k] * w;
    return o;
  }

  // The whole run at a located point: {t[], zeta[], us[], vs[], ua[], va[]} (hourly).
  series(hit) {
    const n = this.leads.length, s = { t: [], zeta: [], us: [], vs: [], ua: [], va: [] };
    for (let i = 0; i < n; i++) {
      const v = this.at(hit, this.timeOf(i)); if (!v) continue;
      s.t.push(this.timeOf(i)); for (const k of ["zeta", "us", "vs", "ua", "va"]) s[k].push(v[k]);
    }
    return s;
  }

  // ---------------- phase (per element) ----------------
  async loadPhase() {
    const p = this.meta.phase; if (!p) return null;
    const buf = await gunzipBuf((p.base || this.base) + p.file), E = this.E, out = {};
    let off = 0;
    for (const L of p.layout) {
      const raw = L.type === "i1" ? new Int8Array(buf, off, E) : new Uint8Array(buf, off, E);
      out[L.name] = { raw, scale: L.scale, about: L.about };
      off += E;
    }
    this.phase = out;
    return out;
  }
  phaseAt(e) {
    const p = this.phase; if (!p) return null;
    const o = {}; for (const k in p) o[k] = p[k].raw[e] * p[k].scale;
    return o;
  }

  // ---------------- patterns over the run (pipeline/patterns.py) ----------------
  async loadPatterns() {
    const p = this.meta.patterns; if (!p) return null;
    const buf = await gunzipBuf((p.base || this.base) + p.file), E = this.E, out = {};
    let off = 0;
    for (const L of p.layout) { out[L.name] = { raw: L.type === "i1" ? new Int8Array(buf, off, E) : new Uint8Array(buf, off, E), scale: L.scale, about: L.about }; off += E; }
    this.patterns = out;
    return out;
  }
  pat(name, e) { const q = this.patterns?.[name]; return q ? q.raw[e] * q.scale : NaN; }
  // A pattern as a per-element Float32Array, optionally mapped (v, e) → value.
  patEl(name, fn) { const out = new Float32Array(this.E); for (let e = 0; e < this.E; e++) { const v = this.pat(name, e); out[e] = fn ? fn(v, e) : v; } return out; }

  // Element values → smooth node values (area-weighted), skipping NaN elements.
  toNodes(ev) {
    const out = new Float32Array(this.N), { off, elems, wts } = this.csr;
    for (let n = 0; n < this.N; n++) {
      let s = 0, w = 0;
      for (let j = off[n]; j < off[n + 1]; j++) { const v = ev[elems[j]]; if (Number.isNaN(v)) continue; s += wts[j] * v; w += wts[j]; }
      out[n] = w > 0.5 ? s / w : NaN;
    }
    return out;
  }

  // Relative vorticity / f per node for lead i (surface or depth-averaged): + anticlockwise.
  spinField(layer, i) {
    const key = `spin:${layer}|${i}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const F = this.nodeField(layer, i); if (!F) return null;
    if (!this.gradK) {                                    // per element: d/dx, d/dy weights of its 3 nodes (1/m)
      const E = this.E, g = new Float32Array(6 * E), nv = this.nv, X = (n) => this.x[n] * 1000, Y = (n) => this.y[n] * 1000;
      for (let e = 0; e < E; e++) {
        const a = nv[3 * e], b = nv[3 * e + 1], c = nv[3 * e + 2], det = (X(b) - X(a)) * (Y(c) - Y(a)) - (X(c) - X(a)) * (Y(b) - Y(a));
        // f_x = [(fb−fa)(yc−ya) − (fc−fa)(yb−ya)]/det ; f_y = [(fc−fa)(xb−xa) − (fb−fa)(xc−xa)]/det
        g[6 * e] = (-(Y(c) - Y(a)) + (Y(b) - Y(a))) / det; g[6 * e + 1] = (Y(c) - Y(a)) / det; g[6 * e + 2] = -(Y(b) - Y(a)) / det;
        g[6 * e + 3] = (-(X(b) - X(a)) + (X(c) - X(a))) / det; g[6 * e + 4] = -(X(c) - X(a)) / det; g[6 * e + 5] = (X(b) - X(a)) / det;
      }
      this.gradK = g;
    }
    const E = this.E, g = this.gradK, nv = this.nv, om = new Float32Array(E), f = 2 * 7.2921e-5 * Math.sin(48.6 * Math.PI / 180), KN = 0.514444;
    for (let e = 0; e < E; e++) {
      const a = nv[3 * e], b = nv[3 * e + 1], c = nv[3 * e + 2];
      const vx = g[6 * e] * F[2 * a + 1] + g[6 * e + 1] * F[2 * b + 1] + g[6 * e + 2] * F[2 * c + 1];
      const uy = g[6 * e + 3] * F[2 * a] + g[6 * e + 4] * F[2 * b] + g[6 * e + 5] * F[2 * c];
      om[e] = ((vx - uy) * KN) / f;
    }
    const out = this.toNodes(om);
    if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, out);
    return out;
  }

  // ---------------- passes and basins (pipeline/passes.py) ----------------
  async loadPasses() {
    if (!this.meta.passes) return null;
    const r = await fetchKept(this.base + this.meta.passes);
    this.passes = r.ok ? await r.json() : null;
    return this.passes;
  }

  // ---------------- tier 2: the full volume ----------------
  volumeBytes() { return this.meta.volume?.bytes || 0; }
  async loadVolume(onProgress) {
    if (!this.meta.volume) return 0;
    const vl = this.meta.volume.leads || this.leads, n = vl.length, url = (i) => this.base + this.meta.volume.file.replace("{lead:03d}", String(vl[i]).padStart(3, "0"));
    // Kept compressed (~2.3 MB an hour instead of ~9 MB unpacked: the whole run would be ~680 MB in
    // memory); the hours on screen are unpacked on demand (volFrame), a few at a time.
    let done = 0, bytes = 0;
    const one = async (i) => {
      if (this.vol[i]) return;
      const buf = await rawBuf(url(i)); bytes += buf.byteLength;
      this.vol[i] = buf;
      onProgress?.(++done, n, bytes);
    };
    for (let k = 0; k < n; k += 4) await Promise.all([...Array(Math.min(4, n - k)).keys()].map((j) => one(k + j)));
    return bytes;
  }
  // Current at a fixed depth below the surface for lead i: per node [u, v] kt (NaN where the
  // water is shallower), interpolated between layer centres using each element's h + ζ.
  // depth "bottom" = the bottom layer. Cached like the tier-1 fields. Needs the volume.
  depthField(depth, i) {
    const key = `d${depth}|${i}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const j = i + this.volOff;                                       // (the volume run's hour for this time)
    if (!this.vol[j] || !this.frames[i] || !this.volFrame(j)) return null;
    const E = this.E, N = this.N, L = this.meta.layers, sig = this.meta.siglev, nv = this.nv, fr = this.frames[i];
    const mid = []; for (let l = 0; l < L; l++) mid.push(-(sig[l] + sig[l + 1]) / 2);       // layer centres, fraction of depth (0 top … 1 bottom)
    const eu = new Float32Array(E), ev = new Float32Array(E);
    for (let e = 0; e < E; e++) {
      const a = nv[3 * e], b = nv[3 * e + 1], c = nv[3 * e + 2];
      const z = [a, b, c].reduce((s, n) => s + (fr.zeta[n] === -32768 ? 0 : fr.zeta[n] / 100), 0) / 3;
      const D = (this.h[a] + this.h[b] + this.h[c]) / 30 + z;                                // water depth here (m)
      let l0, l1, w;
      if (depth === "bottom") { l0 = l1 = L - 1; w = 0; }
      else {
        const f = depth / D;                                                                 // fraction of the column
        if (!(D > 0) || f > mid[L - 1] + 0.5 * (1 - mid[L - 1])) { eu[e] = ev[e] = NaN; continue; }
        if (f <= mid[0]) { l0 = l1 = 0; w = 0; }
        else if (f >= mid[L - 1]) { l0 = l1 = L - 1; w = 0; }
        else { l0 = 0; while (mid[l0 + 1] < f) l0++; l1 = l0 + 1; w = (f - mid[l0]) / (mid[l1] - mid[l0]); }
      }
      const A = this.volAt(j, l0, e), B = this.volAt(j, l1, e);
      eu[e] = A.u * (1 - w) + B.u * w; ev[e] = A.v * (1 - w) + B.v * w;
    }
    const out = new Float32Array(2 * N), { off, elems, wts } = this.csr;
    for (let n = 0; n < N; n++) {
      let u = 0, v = 0, ws = 0;
      for (let j = off[n]; j < off[n + 1]; j++) { const e = elems[j]; if (Number.isNaN(eu[e])) continue; u += wts[j] * eu[e]; v += wts[j] * ev[e]; ws += wts[j]; }
      out[2 * n] = ws > 0.5 ? u / ws : NaN; out[2 * n + 1] = ws > 0.5 ? v / ws : NaN;
    }
    if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, out);
    return out;
  }
  get volumeReady() { return this.vol.length > 0 && this.vol.every(Boolean); }
  // Does the volume cover tier-1 lead i? (An older volume run ends earlier.)
  volumeCovers(i) { const j = i + this.volOff; return j >= 0 && j < this.vol.length; }
  get volumeLabel() { return this.volCycle ? `${String(this.volCycle.getUTCHours()).padStart(2, "0")}Z ${this.volCycle.toISOString().slice(0, 10)}` : ""; }

  // The unpacked volume for the volume run's hour j, or null while it's being unpacked (onVolume is called when ready).
  volFrame(i) {
    this.volDec ||= new Map();
    const d = this.volDec.get(i);
    if (d && !d.then) return d;
    if (!d && this.vol[i]) {
      const p = gunzip(this.vol[i]).then((buf) => {
        const f = readI8(buf, 0, 3 * this.meta.layers * this.E);
        this.volDec.set(i, f);
        while (this.volDec.size > 6) this.volDec.delete(this.volDec.keys().next().value);
        this.onVolume?.(i);
        return f;
      });
      this.volDec.set(i, p);
    }
    return null;
  }

  // u, v (kt) at every layer of elements `elems`, for every hour of the volume, unpacking each
  // hour once (for sections: layers/curtains.js). → {u, v: Float32Array [hour][layer][k]}, or null
  // without the volume. onProgress(done, n).
  async volColumns(elems, onProgress) {
    if (!this.volumeReady) return null;
    const T = this.vol.length, L = this.meta.layers, n = elems.length, LE = L * this.E;
    const u = new Float32Array(T * L * n), v = new Float32Array(T * L * n);
    for (let j = 0; j < T; j++) {
      const f = readI8(await gunzip(this.vol[j]), 0, 3 * LE), g = (q) => { const o = f.over.size ? f.over.get(q) : undefined; return (o ?? f.q[q]) * KT_STEP; };
      for (let l = 0; l < L; l++) for (let k = 0; k < n; k++) {
        const q = l * this.E + elems[k], o = (j * L + l) * n + k;
        u[o] = g(q); v[o] = g(LE + q);
      }
      onProgress?.(j + 1, T);
    }
    return { u, v, T, L, n };
  }

  // The volume's hour j unpacked (for paths: layers/paths3d.js), kept in its own small cache so it
  // doesn't push out the hours on screen. → {q, over}
  async volHour(j) {
    this.volHours ||= new Map();
    if (!this.volHours.has(j)) {
      this.volHours.set(j, gunzip(this.vol[j]).then((buf) => readI8(buf, 0, 3 * this.meta.layers * this.E)));
      while (this.volHours.size > 30) this.volHours.delete(this.volHours.keys().next().value);
    }
    return this.volHours.get(j);
  }
  // u, v, w (m/s) at element e, depth fraction s (0 surface … 1 seabed; linear between layer centres) from an unpacked hour.
  volSample(H, e, s) {
    const L = this.meta.layers, E = this.E, LE = L * E, sig = this.meta.siglev;
    this._mid ||= [...Array(L).keys()].map((l) => -(sig[l] + sig[l + 1]) / 2);
    const mid = this._mid; let l0 = 0; while (l0 < L - 2 && mid[l0 + 1] < s) l0++;
    const f = Math.max(0, Math.min(1, (s - mid[l0]) / (mid[l0 + 1] - mid[l0]))), g = (k) => { const o = H.over.size ? H.over.get(k) : undefined; return o ?? H.q[k]; };
    const at = (base) => g(base + l0 * E + e) * (1 - f) + g(base + (l0 + 1) * E + e) * f;
    return [at(0) * KT_STEP * 0.514444, at(LE) * KT_STEP * 0.514444, at(2 * LE) * W_STEP];
  }

  // Volume value at element e, layer l (0 = top) for the volume run's hour j: {u, v kt, w m/s}.
  volAt(i, l, e) {
    const V = this.volFrame(i); if (!V) return null;
    const LE = this.meta.layers * this.E, k = l * this.E + e, g = (j) => { const o = V.over.size ? V.over.get(j) : undefined; return o ?? V.q[j]; };
    return { u: g(k) * KT_STEP, v: g(LE + k) * KT_STEP, w: g(2 * LE + k) * W_STEP };
  }
}
