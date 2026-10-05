// The SSCOFS mesh sampled onto a regular grid for the particles and streamlines (layers/curflow.js
// wants {x0, y0, dxy, nx, ny, u, v} in m/s, NaN off the water).
//
// Two layouts. The region grid matches the ground grid's spacing (250 m) and covers everything.
// Zoomed in (a view under FINE_KM across), a finer grid covers just the view and a margin round it,
// at ~1/250 of the view (down to 40 m) — finer than the model's own triangles (~75 m in the
// tightest passes, ~130 m typical), so particles and streamlines follow every eddy the model has.
// It's rebuilt once the view settles somewhere it doesn't cover (useView). Each water cell
// remembers its triangle and barycentric weights once; a new hour is then a cheap weighted sum of
// the node values.

const KN = 0.514444;            // kt → m/s
const FINE_KM = 30, MIN_DXY = 0.04, MARGIN = 1.5;

export class FlowGrid {
  // water: optional Uint8Array on the region grid (the ground's land mask: 0 = water) to skip land fast.
  constructor(model, box, dxy = 0.25, water = null) {
    this.model = model; this.box = box;
    this.base = this.layout(box, dxy, water, "base");
    this.lay = this.base;
    this.cache = new Map();
  }
  get dxy() { return this.lay.dxy; }

  layout(box, dxy, water, id) {
    const m = this.model, nx = Math.round((box.x1 - box.x0) / dxy) + 1, ny = Math.round((box.y1 - box.y0) / dxy) + 1, n = nx * ny;
    const tri = new Int32Array(n).fill(-1), w = new Float32Array(2 * n);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (water && water.length === n && water[k] === 1) continue;
      const hit = m.locate(box.x0 + i * dxy, box.y0 + j * dxy);
      if (hit) { tri[k] = hit.e; w[2 * k] = hit.w[0]; w[2 * k + 1] = hit.w[1]; }
    }
    let nw = 0; for (let k = 0; k < n; k++) if (tri[k] >= 0) nw++;
    const wet = new Int32Array(nw); nw = 0; for (let k = 0; k < n; k++) if (tri[k] >= 0) wet[nw++] = k;
    return { id, x0: box.x0, y0: box.y0, x1: box.x0 + (nx - 1) * dxy, y1: box.y0 + (ny - 1) * dxy, dxy, nx, ny, tri, w, wet };
  }

  // The view (centre cx, cy and size w, h km). → true if the layout changed (the caller redraws).
  useView(v) {
    const L = this.lay;
    if (v.w >= FINE_KM) { if (L === this.base) return false; this.lay = this.base; this.cache.clear(); return true; }
    const dxy = Math.max(MIN_DXY, Math.min(this.base.dxy, Math.max(v.w, v.h) / 250));
    const inside = L !== this.base && v.cx - v.w / 2 >= L.x0 && v.cx + v.w / 2 <= L.x1 && v.cy - v.h / 2 >= L.y0 && v.cy + v.h / 2 <= L.y1;
    if (inside && Math.abs(Math.log(dxy / L.dxy)) < 0.4) return false;
    const B = this.box, hw = (v.w * MARGIN) / 2, hh = (v.h * MARGIN) / 2;
    const box = { x0: Math.max(B.x0, v.cx - hw), y0: Math.max(B.y0, v.cy - hh), x1: Math.min(B.x1, v.cx + hw), y1: Math.min(B.y1, v.cy + hh) };
    this.lay = this.layout(box, dxy, null, `fine${dxy.toFixed(3)}@${box.x0.toFixed(2)},${box.y0.toFixed(2)}`);
    this.cache.clear();
    return true;
  }

  // The grid for lead i from a node field ("surf" | "davg" | "d:…": [u, v] kt interleaved per node).
  has(kind, i) { return this.cache.has(`${kind}|${i}`); }

  grid(kind, i) {
    const key = `${kind}|${i}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const F = this.model.nodeField(kind, i); if (!F) return null;
    const L = this.lay, n = L.nx * L.ny, u = new Float32Array(n).fill(NaN), v = new Float32Array(n).fill(NaN), nv = this.model.nv, W = L.wet;
    for (let j = 0; j < W.length; j++) {
      const k = W[j], e = L.tri[k];
      const a = nv[3 * e], b = nv[3 * e + 1], c = nv[3 * e + 2], wa = L.w[2 * k], wb = L.w[2 * k + 1], wc = 1 - wa - wb;
      u[k] = (wa * F[2 * a] + wb * F[2 * b] + wc * F[2 * c]) * KN; v[k] = (wa * F[2 * a + 1] + wb * F[2 * b + 1] + wc * F[2 * c + 1]) * KN;
    }
    const g = { x0: L.x0, y0: L.y0, dxy: L.dxy, nx: L.nx, ny: L.ny, u, v, layout: L.id };
    if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value);   // (each up to ~12 MB)
    this.cache.set(key, g);
    return g;
  }
}
