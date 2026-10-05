// A colour fill drawn on the SSCOFS mesh itself: every triangle of the model, smooth per-vertex
// values (element values carried to the nodes), blended between the two hours either side of the
// time on screen in the shader, so playback is smooth and cheap.
//
// Modes: modes.js (vec: speed, along-flood; scalar: level, spin; static: the run's patterns).
//
// Draws just over the water surface (z = Z km), under the particles and streamlines. Dry nodes
// and nodes without a value (NaN: e.g. a depth slice where the water is shallower) are stored as
// NONE and every triangle touching one is left out — GPUs may optimise a NaN test away, which
// painted those edges in the ramp's first colour.

import * as THREE from "three";
import { RAMPS, rampPixels } from "./ramps.js?v=20261005223557";
import { MODE } from "../modes.js?v=20261005223557";

const Z = 0.006, NONE = 1e9;
const unNaN = (a) => { for (let i = 0; i < a.length; i++) if (Number.isNaN(a[i])) a[i] = NONE; };

export class MeshField {
  // box: the scene's extent (km) — the shared data covers a little more; nothing is drawn outside.
  constructor(model, box = null) {
    this.model = model;
    this.group = new THREE.Group();
    const N = model.N, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[3 * i] = model.x[i]; pos[3 * i + 1] = model.y[i]; pos[3 * i + 2] = Z; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(model.nv, 1));
    this.aA = new THREE.BufferAttribute(new Float32Array(N * 2), 2); this.aB = new THREE.BufferAttribute(new Float32Array(N * 2), 2);
    this.aFlood = new THREE.BufferAttribute(new Float32Array(N * 2), 2);
    geo.setAttribute("aA", this.aA); geo.setAttribute("aB", this.aB); geo.setAttribute("aFlood", this.aFlood);
    this.tex = new THREE.DataTexture(rampPixels("speed"), 256, 1); this.tex.needsUpdate = true;
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uRamp: { value: this.tex }, uMin: { value: 0 }, uMax: { value: 5.5 }, uMix: { value: 0 }, uMode: { value: 1 }, uOpacity: { value: 0.85 },
        uBox: { value: box ? new THREE.Vector4(box.x0, box.y0, box.x1, box.y1) : new THREE.Vector4(-1e9, -1e9, 1e9, 1e9) } },
      vertexShader: `attribute vec2 aA; attribute vec2 aB; attribute vec2 aFlood; varying float vVal; varying float vOk; varying vec2 vXY; uniform float uMix; uniform int uMode;
        void main() {
          vXY = position.xy;
          vOk = (aA.x > 1e8 || aB.x > 1e8) ? 0.0 : 1.0;
          vec2 c = mix(aA, aB, uMix);
          vVal = uMode == 0 ? c.x : uMode == 1 ? length(c) : dot(c, aFlood);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `uniform sampler2D uRamp; uniform float uMin; uniform float uMax; uniform float uOpacity; uniform vec4 uBox; varying float vVal; varying float vOk; varying vec2 vXY;
        void main() {
          if (vOk < 0.999) discard;                                 // (a corner without a value)
          if (vXY.x < uBox.x || vXY.y < uBox.y || vXY.x > uBox.z || vXY.y > uBox.w) discard;   // (outside the scene)
          if (!(vVal == vVal) || vVal > 1e6) discard;              // NaN: dry or unmapped
          float t = clamp((vVal - uMin) / (uMax - uMin), 0.0, 1.0);
          gl_FragColor = vec4(texture2D(uRamp, vec2(t, 0.5)).rgb, uOpacity);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
      side: THREE.DoubleSide,                                    // (FVCOM lists triangle corners clockwise: seen from above they face away)
    });
    Object.assign(this.mat, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.mode = null; this.keyA = this.keyB = null;
  }

  setOpacity(o) { this.mat.uniforms.uOpacity.value = o; }

  // Where the fill sits: "surface" (just over the water), a depth in metres (a flat slice at that
  // depth, × the seabed exaggeration), or "bottom" (draped just over the model's seabed).
  setDepth(where, ex = 1) {
    const pos = this.mesh.geometry.attributes.position, m = this.model, key = `${where}|${ex}`;
    if (this._depthKey === key) return;
    this._depthKey = key;
    for (let i = 0; i < m.N; i++) pos.array[3 * i + 2] = where === "bottom" ? -(m.h[i] / 10) * 0.97 / 1000 * ex : Z;
    pos.needsUpdate = true;
    this.mesh.position.z = typeof where === "number" ? -where / 1000 * ex : 0;
  }
  setFlat(on) { this.mat.depthTest = !on; }

  // The flood direction per node (unit east/north), from the phase map's per-element "flood".
  setFlood(phase) {
    const m = this.model, a = this.aFlood.array, { off, elems, wts } = m.csr;
    for (let n = 0; n < m.N; n++) {
      let x = 0, y = 0;
      for (let j = off[n]; j < off[n + 1]; j++) {
        const e = elems[j], d = phase.flood.raw[e] * phase.flood.scale * Math.PI / 180;
        x += wts[j] * Math.sin(d); y += wts[j] * Math.cos(d);
      }
      const L = Math.hypot(x, y) || 1; a[2 * n] = x / L; a[2 * n + 1] = y / L;
    }
    this.aFlood.needsUpdate = true;
  }

  // Where the phase map's rule points flood the wrong way (short passes driven by the level
  // difference across them: Deception Pass — guide §10), take the sense from NOAA's stations:
  // within R km of each {x, y, flood °T}, a node whose flood points more than 90° from NOAA's is
  // flipped (the model's axis is kept). → how many nodes changed
  fixFlood(points, R = 2.5) {
    const m = this.model, a = this.aFlood.array; let n = 0;
    for (const p of points) {
      const fx = Math.sin(p.flood * Math.PI / 180), fy = Math.cos(p.flood * Math.PI / 180);
      for (let i = 0; i < m.N; i++) if ((m.x[i] - p.x) ** 2 + (m.y[i] - p.y) ** 2 < R * R && a[2 * i] * fx + a[2 * i + 1] * fy < 0) { a[2 * i] = -a[2 * i]; a[2 * i + 1] = -a[2 * i + 1]; n++; }
    }
    this.aFlood.needsUpdate = true;
    return n;
  }

  // mode: an id from modes.js; layer: "surf" | "davg" | "d:<m>" | "d:bottom" | "res_s" | "res_d"
  setMode(mode, layer = "surf") {
    if (this.mode === mode && this.layer === layer && !this.stale) return;
    this.mode = mode; this.layer = layer; this.keyA = this.keyB = null; this.stale = false;
    const R = RAMPS[mode], def = MODE[mode];
    this.kind = def.kind;
    this.tex.image.data.set(rampPixels(mode)); this.tex.needsUpdate = true;
    Object.assign(this.mat.uniforms, { uMin: { value: R.min }, uMax: { value: R.max }, uMode: { value: mode === "speed" ? 1 : mode === "along" ? 2 : 0 } });
    if (this.kind === "static") {
      const v = this.model.toNodes(def.values(this.model, layer)), a = this.aA.array;
      for (let n = 0; n < this.model.N; n++) { a[2 * n] = v[n]; a[2 * n + 1] = 0; }
      unNaN(a); this.aB.array.set(a); this.aA.needsUpdate = this.aB.needsUpdate = true;
      this.mat.uniforms.uMix.value = 0;
    }
  }

  _fill(attr, i) {
    const m = this.model, a = attr.array;
    if (this.mode === "level" || this.mode === "spin") {
      const z = this.mode === "level" ? m.nodeField("zeta", i) : m.spinField(this.layer, i);
      if (!z) { a.fill(NONE); attr.needsUpdate = true; return false; }
      for (let n = 0; n < m.N; n++) { a[2 * n] = z[n]; a[2 * n + 1] = 0; }
    } else {
      const F = m.nodeField(this.layer, i); if (!F) { a.fill(NONE); attr.needsUpdate = true; return false; }
      a.set(F);
    }
    unNaN(a);
    attr.needsUpdate = true;
    return true;
  }

  // Show time t (ms). → true if anything changed.
  setTime(t) {
    if (!this.mode || this.kind === "static" || this.kind === "none") return false;
    const m = this.model, f = m.fi(t), i0 = Math.floor(f), i1 = Math.min(m.leads.length - 1, i0 + 1);
    // (An hour whose data isn't there yet — the volume unpacks hour by hour — is tried again next time.)
    if (this.keyA !== i0) { if (this.keyB === i0) { this.aA.array.set(this.aB.array); this.aA.needsUpdate = true; this.keyA = i0; } else this.keyA = this._fill(this.aA, i0) ? i0 : null; }
    if (this.keyB !== i1) this.keyB = this._fill(this.aB, i1) ? i1 : null;
    this.mat.uniforms.uMix.value = f - i0;
    return true;
  }
}
