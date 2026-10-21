// Ground: three surfaces, each with its own controls.
//
//   Land     terrain mesh (Terrarium DEM) on land cells only. Styles: shaded relief (hypsometric
//            tint, lit), satellite photo (draped), plain dark. Its own vertical exaggeration.
//   Seabed   the seabed under the water: NOAA CUDEM where it covers, the SSCOFS model's depth
//            elsewhere (or the model's own seabed only, as a choice), coloured by depth and lit.
//            Its own (usually larger) exaggeration: the basin is ~300 km across and ~400 m deep.
//   Water    a surface at sea level, translucent so the seabed shows through (or the photo).
//
// Data: pipeline/ground → web/data/ground/ground.json, terrain.i16.gz (m), land.u8.gz (0 water,
// 1 land, 2 sea outside the model), coast.i16.gz (signed distance, 10 m), seabed.i16.gz and
// modelbed.i16.gz (dm, negative down), bedsrc.u8.gz. Grid: int16, [ny][nx], row 0 south, x fastest.
//
// The land mesh and the hypsometric tint are wind-volume-explorer's web/layers/ground.js@eac80cf.

import * as THREE from "three";

export async function gunzipTyped(url, Type) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url.split("/").pop()}: HTTP ${r.status}`);
  let buf = await r.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  }
  return new Type(buf);
}

// SYNC: wind-volume-explorer web/layers/ground.js@eac80cf hypsometric tint. Copied verbatim.
const TINT = [[0, [52, 84, 58]], [300, [74, 104, 66]], [800, [112, 118, 78]], [1400, [128, 112, 92]],
  [2000, [140, 136, 132]], [2400, [220, 224, 230]]];
function tint(m) {
  if (m <= TINT[0][0]) return TINT[0][1];
  for (let i = 1; i < TINT.length; i++) {
    if (m <= TINT[i][0]) {
      const [a, ca] = TINT[i - 1], [b, cb] = TINT[i], w = (m - a) / (b - a);
      return ca.map((c, k) => c + (cb[k] - c) * w);
    }
  }
  return TINT[TINT.length - 1][1];
}
// END SYNC

// Seabed by depth (m): sand-pale in the shallows through teal to deep navy; tuned so the basin's
// sills (~50–70 m) and basins (~200–300 m) separate clearly.
const DEPTH = [[0, [176, 178, 146]], [2, [160, 190, 170]], [6, [140, 196, 186]], [20, [112, 182, 182]], [60, [58, 140, 160]],
  [120, [36, 102, 138]], [220, [28, 70, 112]], [400, [20, 44, 84]], [1000, [12, 24, 52]]];
export function depthTint(d) {
  if (d <= DEPTH[0][0]) return DEPTH[0][1];
  for (let i = 1; i < DEPTH.length; i++) {
    if (d <= DEPTH[i][0]) {
      const [a, ca] = DEPTH[i - 1], [b, cb] = DEPTH[i], w = (d - a) / (b - a);
      return ca.map((c, k) => c + (cb[k] - c) * w);
    }
  }
  return DEPTH[DEPTH.length - 1][1];
}
export const DEPTH_STOPS = DEPTH;

const ABOVE_SEA = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.0002);   // keeps z ≥ −0.2 m (needs renderer.localClippingEnabled)

const WATER_COLORS = { sea: 0x0d4f5c, dark: 0x0b1820, clear: 0x1a6070 };
const LAND_DARK = [34, 40, 40];

export class Ground {
  constructor({ stride = 1 } = {}) {
    this.group = new THREE.Group();
    this.stride = stride;                                      // 2 on phones: a quarter of the vertices
    this.land = this.seabed = this.water = null;
    this.meta = null; this.photo = null;
  }

  async load(base = "data/ground/") {
    const r = await fetch(`${base}ground.json`);
    if (!r.ok) return false;
    this.meta = await r.json();
    this.base = base;
    const t = this.meta.terrain, s = this.meta.seabed;
    if (!t) return false;
    [this.h, this.mask, this.coast, this.bed, this.modelBed, this.bedSrc] = await Promise.all([
      gunzipTyped(base + t.file, Int16Array), gunzipTyped(base + t.mask, Uint8Array), gunzipTyped(base + t.coast, Int16Array),
      s ? gunzipTyped(base + s.file, Int16Array) : null, s ? gunzipTyped(base + s.model, Int16Array) : null,
      s ? gunzipTyped(base + s.src, Uint8Array) : null]);
    return true;
  }

  get ready() { return !!this.h; }
  get hasPhoto() { return !!this.meta?.photo; }

  async photoTexture() {
    if (this.photo || !this.meta?.photo) return this.photo;
    const tex = await new THREE.TextureLoader().loadAsync(this.base + this.meta.photo.file);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.photo = tex;
    return tex;
  }

  // What's under scene (x, y): {kind: "land"|"water"|"sea", heightM, depthM, modelDepthM, src} or null outside.
  sample(x, y) {
    if (!this.h) return null;
    const t = this.meta.terrain, i = Math.round((x - t.x0) / t.dxy), j = Math.round((y - t.y0) / t.dxy);
    if (i < 0 || j < 0 || i >= t.nx || j >= t.ny) return null;
    const k = j * t.nx + i, m = this.mask[k];
    if (m === 1) return { kind: "land", heightM: this.h[k] };
    if (m === 2) return { kind: "sea" };
    return { kind: "water", depthM: this.bed ? -this.bed[k] / 10 : null, modelDepthM: this.modelBed ? -this.modelBed[k] / 10 : null,
      src: ["", "NOAA CUDEM", "SSCOFS model depth", "CUDEM/model blend"][this.bedSrc?.[k] ?? 0] };
  }

  isWater(x, y) { return this.sample(x, y)?.kind === "water"; }

  _drop(k) {
    const m = this[k];
    if (!m) return;
    this.group.remove(m); m.geometry.dispose(); m.material.dispose(); this[k] = null;
  }

  dispose() { for (const k of ["land", "seabed", "water"]) this._drop(k); }

  // The subsampled grid both meshes share: positions x, y, uv; z filled per surface.
  _grid() {
    if (this._g) return this._g;
    const t = this.meta.terrain, s = this.stride, nx = Math.floor((t.nx - 1) / s) + 1, ny = Math.floor((t.ny - 1) / s) + 1;
    const W = (t.nx - 1) * t.dxy, H = (t.ny - 1) * t.dxy, src = new Int32Array(nx * ny), uv = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, si = Math.min(t.nx - 1, i * s), sj = Math.min(t.ny - 1, j * s);
      src[k] = sj * t.nx + si; uv[2 * k] = (si * t.dxy) / W; uv[2 * k + 1] = (sj * t.dxy) / H;
    }
    this._g = { nx, ny, src, uv, dxy: t.dxy * s, x0: t.x0, y0: t.y0 };
    return this._g;
  }

  _mesh(z, col, keepQuad) {
    const g = this._grid(), { nx, ny } = g, pos = new Float32Array(nx * ny * 3);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos[3 * k] = g.x0 + i * g.dxy; pos[3 * k + 1] = g.y0 + j * g.dxy; pos[3 * k + 2] = z[k];
    }
    const idx = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (keepQuad(a, b, c, d)) idx.push(a, b, d, a, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(g.uv, 2));
    if (col) geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx.length > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return geo;
  }

  // land: {on, style: "relief"|"photo"|"dark", ex (× on heights)}
  async buildLand({ on = true, style = "relief", ex = 1.5 } = {}) {
    this._drop("land");
    if (!this.h || !on) return;
    const g = this._grid(), n = g.nx * g.ny, z = new Float32Array(n), col = new Float32Array(n * 3);
    // Smooth coastline (WVE): nodes near the coast take a height from their signed distance to it,
    // so the land crosses sea level on the model's coastline, not on the 250 m grid.
    const S = 0.01;
    const isLand = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const q = g.src[k], m = Math.max(0, this.h[q]), sd = this.coast[q] / 100;
      isLand[k] = this.mask[q] === 1;
      // Water corners slope down steeply with distance from the coast (≈ mirror of a low shore), so
      // the sea-level crossing — where the land is clipped — falls on the coastline itself.
      z[k] = isLand[k] ? Math.max(m / 1000 * ex, sd * S) : Math.max(-0.2, Math.min(-0.002, sd * 0.3));
      const c = style === "dark" ? LAND_DARK : tint(m);
      col[3 * k] = c[0] / 255; col[3 * k + 1] = c[1] / 255; col[3 * k + 2] = c[2] / 255;
    }
    const geo = this._mesh(z, col, (a, b, c, d) => isLand[a] || isLand[b] || isLand[c] || isLand[d]);
    const tex = style === "photo" ? await this.photoTexture() : null;
    const mat = tex ? new THREE.MeshLambertMaterial({ map: tex }) : new THREE.MeshLambertMaterial({ vertexColors: true });
    // Cut at sea level: the land's edge is then the zero contour of the coast distance (the model's
    // coastline, smooth), not the 250 m squares, and nothing of it shows under the translucent water.
    mat.clippingPlanes = [ABOVE_SEA];
    this.land = new THREE.Mesh(geo, mat);
    this.land.renderOrder = 1;
    this.group.add(this.land);
  }

  // seabed: {on, ex (× on depths), source: "best"|"model"}
  buildSeabed({ on = true, ex = 8, source = "best" } = {}) {
    this._drop("seabed");
    if (!this.bed || !on) return;
    const g = this._grid(), n = g.nx * g.ny, z = new Float32Array(n), col = new Float32Array(n * 3), wet = new Uint8Array(n);
    const bed = source === "model" ? this.modelBed : this.bed;
    for (let k = 0; k < n; k++) {
      const q = g.src[k], d = -bed[q] / 10;
      wet[k] = this.mask[q] === 0;
      z[k] = wet[k] ? -d / 1000 * ex : 0;                        // land corners pin the seabed to the shore
      const c = depthTint(wet[k] ? d : 0);
      col[3 * k] = c[0] / 255; col[3 * k + 1] = c[1] / 255; col[3 * k + 2] = c[2] / 255;
    }
    const geo = this._mesh(z, col, (a, b, c, d) => wet[a] || wet[b] || wet[c] || wet[d]);
    this.seabed = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.seabed.renderOrder = 0;
    this.group.add(this.seabed);
  }

  // water: {on, style: "sea"|"clear"|"dark"|"photo", opacity}
  async buildWater({ on = true, style = "sea", opacity = 0.45 } = {}) {
    this._drop("water");
    if (!this.h || !on) return;
    const t = this.meta.terrain, W = (t.nx - 1) * t.dxy, H = (t.ny - 1) * t.dxy;
    const tex = style === "photo" ? await this.photoTexture() : null;
    const mat = tex ? new THREE.MeshBasicMaterial({ map: tex, transparent: opacity < 1, opacity })
      : new THREE.MeshBasicMaterial({ color: WATER_COLORS[style] ?? WATER_COLORS.sea, transparent: opacity < 1, opacity });
    Object.assign(mat, { depthWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    this.water.position.set(t.x0 + W / 2, t.y0 + H / 2, 0);
    this.water.renderOrder = 2;
    this.group.add(this.water);
  }

  setWaterOpacity(o) {
    if (!this.water) return;
    const m = this.water.material; m.opacity = o; m.transparent = o < 1; m.needsUpdate = true;
  }

  credits() {
    const m = this.meta || {};
    return [m.terrain?.credit, m.seabed?.credit, m.photo?.credit].filter(Boolean);
  }
}
