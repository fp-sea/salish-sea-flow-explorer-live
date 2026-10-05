// Stacked slices: the colour fill (layers/meshfield.js) drawn at several depths at once — 20 m,
// 60 m and 120 m down — under the (dimmed) surface colour and the particles, so the change of the
// current with depth shows in one picture (e.g. the surface ebbing while the deep water still
// floods). Each slice exists only where the water is that deep, so the channels stand out; a
// "near the seabed" slice would drape over every shallow and hide the rest.
// Needs the full volume (model.depthField). Only the "right now" current modes (speed, flood/ebb)
// make sense stacked; set() returns false for the others.

import * as THREE from "three";
import { MeshField } from "./meshfield.js?v=20261005223557";

export const STACK = ["d:20", "d:60", "d:120"];
const STACKABLE = new Set(["speed", "along"]);

export class Slabs {
  constructor(model, box) {
    this.model = model; this.group = new THREE.Group(); this.group.visible = false;
    this.fields = STACK.map(() => new MeshField(model, box));
    if (model.phase) for (const f of this.fields) f.setFlood(model.phase);
    for (const f of this.fields) this.group.add(f.group);
  }
  // → false if this mode doesn't stack (the caller says so).
  set(mode, ex, opacity) {
    if (!STACKABLE.has(mode)) return false;
    STACK.forEach((L, k) => {
      const f = this.fields[k];
      f.stale = true; f.setMode(mode, L); f.setOpacity(Math.min(1, opacity * 1.05)); f.setDepth(+L.slice(2), ex); f.setFlat(false);
    });
    return true;
  }
  setTime(t) { if (this.group.visible) for (const f of this.fields) f.setTime(t); }
  redraw() { for (const f of this.fields) f.keyA = f.keyB = null; }
}
