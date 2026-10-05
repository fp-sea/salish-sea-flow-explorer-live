// Particle paths: where a parcel of water actually goes over the run — traced through the full 3D
// volume (lab runs) at real time scale, from a point and depth on the map, or as a line of release
// points across a pass. Unlike the animated particles (layers/particles3d.js: visual speed, short
// trails) these integrate the model's current in real seconds: a path covering 30 km in 6 hours
// did so in the model.
//
// Integration: steps of DT s (midpoint method) through u, v, w at the parcel's triangle (the model's
// own element values) and depth fraction s (0 surface … 1 seabed; linear between layer centres),
// linear in time between hours. ds = −w·dt / D (D: the triangle's depth). A path stops where it
// leaves the model's water (ashore, out of the box) or at the end of the run / the length asked.
//
// Drawn at depth (× the seabed exaggeration), 3 px: a single path coloured by time along it (pale
// at the start → deep at the end) with a mark every 6 hours; released lines of parcels (add(p,
// {group})) coloured by their starting depth — surface yellow, mid-depth orange, near the seabed
// violet — darkening along time, without marks. A dot rides each path at the time on screen.
//
//   trace({x, y, depth m | "surface" | "mid" | "bottom"}, t0, hours) → path {pts: [{x, y, s, D, t}], ...}
//   add(path), clear(), setTime(t), setEx(ex), summary(path) → text

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const DT = 300;                                   // s
const lerp3 = (a, b, f) => a.map((v, k) => v + (b[k] - v) * f);
const GROUP = { surface: [1.0, 0.86, 0.30], mid: [0.98, 0.55, 0.22], bottom: [0.68, 0.45, 0.98] };
const TIME_RAMP = (f) => f < 0.5 ? lerp3([1.0, 0.95, 0.70], [0.98, 0.55, 0.25], f / 0.5) : lerp3([0.98, 0.55, 0.25], [0.65, 0.15, 0.45], (f - 0.5) / 0.5);

export class Paths3D {
  constructor(model, proj) {
    Object.assign(this, { model, proj });
    this.group = new THREE.Group(); this.paths = []; this.ex = 8;
  }

  async trace({ x, y, depth }, t0, hours = 24) {
    const m = this.model, hit = m.locate(x, y); if (!hit) return null;
    const Dof = (h) => h.nodes.reduce((s, q, k) => s + h.w[k] * m.h[q] / 10, 0);
    let D = Dof(hit), s = depth === "surface" ? 0.02 : depth === "mid" ? 0.5 : depth === "bottom" ? 0.95 : Math.min(0.97, depth / D);
    const vc = m.volCycle.getTime(), last = vc + (m.vol.length - 1) * 3600e3, t1 = Math.min(last, t0 + hours * 3600e3);
    const pts = [{ x, y, s, D, t: t0 }];
    let e = hit.e, t = t0;
    const vel = async (e, s, t) => {                                   // m/s at element e, depth s, time t
      const h = (t - vc) / 3600e3, j = Math.max(0, Math.min(m.vol.length - 2, Math.floor(h))), f = Math.min(1, h - j);
      const [A, B] = await Promise.all([m.volHour(j), m.volHour(j + 1)]), a = m.volSample(A, e, s), b = m.volSample(B, e, s);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    };
    while (t < t1) {
      const v1 = await vel(e, s, t);
      const mx = x + v1[0] * DT / 2000, my = y + v1[1] * DT / 2000, mh = m.locate(mx, my); if (!mh) break;   // (km: m/s × s / 1000; half step)
      const ms = Math.max(0.005, Math.min(0.995, s - (v1[2] * DT / 2) / Math.max(1, D)));
      const v2 = await vel(mh.e, ms, t + DT * 500);
      const nx = x + v2[0] * DT / 1000, ny = y + v2[1] * DT / 1000, nh = m.locate(nx, ny); if (!nh) break;
      x = nx; y = ny; e = nh.e; D = Dof(nh); s = Math.max(0.005, Math.min(0.995, s - (v2[2] * DT) / Math.max(1, D))); t += DT * 1000;
      pts.push({ x, y, s, D, t });
    }
    return pts.length > 1 ? { pts, t0, t1: pts.at(-1).t, start: this.proj.toLatLon(pts[0].x, pts[0].y), depth0: pts[0].s * pts[0].D } : null;
  }

  add(path, { group = null } = {}) { if (path) { path.group = group; this.paths.push(path); this.draw(path); } }
  clear() { for (const p of this.paths) this.group.remove(p.obj); this.paths = []; }
  setEx(ex) { if (ex === this.ex) return; this.ex = ex; const ps = this.paths; this.clear(); for (const p of ps) this.add(p); }

  draw(p) {
    const obj = new THREE.Group(), n = p.pts.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), span = Math.max(1, p.t1 - p.t0), z = (q) => -q.s * q.D * this.ex / 1000;
    p.pts.forEach((q, i) => { const f = (q.t - p.t0) / span; pos.set([q.x, q.y, z(q)], 3 * i); col.set(p.group ? GROUP[p.group].map((c) => c * (1 - 0.45 * f)) : TIME_RAMP(f), 3 * i); });
    const geo = new LineGeometry(); geo.setPositions(pos); geo.setColors(col);
    const mat = new LineMaterial({ vertexColors: true, linewidth: p.group ? 2.2 : 3.2, transparent: true, opacity: 0.95 });
    mat.resolution.set(innerWidth, innerHeight);
    const line = new Line2(geo, mat); line.computeLineDistances(); line.renderOrder = 23; obj.add(line);
    // A short drop line from the surface to the start, so the start depth reads in 3D.
    const s0 = p.pts[0]; obj.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(s0.x, s0.y, 0), new THREE.Vector3(s0.x, s0.y, z(s0))]), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.05, gapSize: 0.04 })).computeLineDistances());
    for (let k = 1; !p.group && (k * 6 * 3600e3) < span + 1; k++) {     // marks every 6 h (single paths)
      const q = p.pts.find((r) => r.t - p.t0 >= k * 6 * 3600e3); if (!q) break;
      const d = document.createElement("div"); d.className = "path-tag"; d.textContent = `+${k * 6} h`;
      const o = new CSS2DObject(d); o.position.set(q.x, q.y, z(q)); obj.add(o);
    }
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    dot.renderOrder = 24; obj.add(dot); p.dot = dot;
    p.obj = obj; this.group.add(obj);
    this.setTime(this.t ?? p.t0);
  }

  // The dots: where each parcel is at time t (hidden outside its path's span).
  setTime(t) {
    this.t = t;
    for (const p of this.paths) {
      const pts = p.pts, i = pts.findIndex((q) => q.t >= t);
      p.dot.visible = t >= p.t0 && t <= p.t1 && i >= 0;
      if (!p.dot.visible) continue;
      const a = pts[Math.max(0, i - 1)], b = pts[i], f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      p.dot.position.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, -(a.s * a.D + (b.s * b.D - a.s * a.D) * f) * this.ex / 1000);
    }
  }

  // A plain summary: how far, net drift and its direction, depth range.
  summary(p) {
    const a = p.pts[0], b = p.pts.at(-1), hrs = (p.t1 - p.t0) / 3600e3;
    let dist = 0; for (let i = 1; i < p.pts.length; i++) dist += Math.hypot(p.pts[i].x - p.pts[i - 1].x, p.pts[i].y - p.pts[i - 1].y);
    const net = Math.hypot(b.x - a.x, b.y - a.y), dir = ((Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI) + 360) % 360;
    const depths = p.pts.map((q) => q.s * q.D), NM = 1.852;
    return { hours: hrs, travelled: dist / NM, net: net / NM, dir, from: Math.min(...depths), to: Math.max(...depths), start: a.s * a.D, end: b.s * b.D, ended: p.t1 < p.t0 + hrs * 3600e3 - 1 };
  }
}
