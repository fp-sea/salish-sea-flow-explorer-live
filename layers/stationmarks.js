// NOAA current-prediction stations on the map (model/stations.js): a small dot each, ringed in
// the caution colour where this run's model is too weak against NOAA's predictions (skill "under"),
// violet where it's too strong ("over"), plain where they agree or there's no rating. Hover: the
// name and the ratio; click: onPick(station) (the page opens the point panel there).

import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import * as THREE from "three";

export class StationMarks {
  constructor(proj, stations, skill, onPick) {
    this.group = new THREE.Group();
    for (const s of stations) {
      const p = proj.toXY(s.lat, s.lon), k = skill?.get(s.id), d = document.createElement("div");
      s.x = p.x; s.y = p.y; s.skill = k || null;
      d.className = `st-mark${k?.flag ? ` ${k.flag}` : ""}`;
      d.title = `NOAA station ${s.name} (${s.id})` + (k?.ratio != null ? ` · this run the model gives ${Math.round(k.ratio * 100)} % of NOAA's predicted peaks${k.flag === "under" ? " — too weak here" : k.flag === "over" ? " — too strong here" : ""}` : "") + " · click for both";
      d.addEventListener("pointerdown", (e) => e.stopPropagation());
      d.addEventListener("click", (e) => { e.stopPropagation(); onPick(s); });
      const o = new CSS2DObject(d); o.position.set(p.x, p.y, 0.03); this.group.add(o);
    }
  }
  set visible(on) { this.group.visible = on; this.group.traverse((o) => { if (o.element) o.element.style.display = on ? "" : "none"; }); }
}
