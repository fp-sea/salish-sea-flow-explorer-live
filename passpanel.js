// Basins & passes: the continuity picture (pipeline/passes.py → passes.json).
//
// A basin card: the basin's mean water level above, and below it the water flowing in (+) and out
// (−) through its passes, with the rate the basin is filling (area × rate of rise) dashed over it.
// The two curves lie on top of each other: water in = basin rising. So the flow peaks when the
// level climbs fastest (mid-tide) and stops when the level stops (high and low water): slack at
// HW/LW. The card states the numbers from this run.
//
// A head card (Deception Pass): the level on each side, and the current through the pass, which
// runs downhill from the higher side and turns when the two levels cross.
//
// On the map: the pass lines, labelled, while a card is open.

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { TimeChart, lerpAt } from "./chart.js?v=20261005223557";
import { extrema, slacks, pairUp, fmtOffset } from "./model/events.js?v=20261005223557";

const $ = (id) => document.getElementById(id);
const FT = 3.28084;
const k3 = (v) => `${Math.round(v / 1000).toLocaleString()} thousand m³/s`;

export class PassPanel {
  constructor({ stage, model, proj, timebar, tz, units, onFly }) {
    Object.assign(this, { stage, model, proj, timebar, onFly });
    this.data = model.passes; this.units = units;
    this.el = $("passes"); this.chart = new TimeChart($("ps-chart"), { tz, onPick: (t) => timebar.set(t) });
    this.group = new THREE.Group(); this.group.visible = false; stage.scene.add(this.group);
    this.res = new THREE.Vector2(innerWidth, innerHeight);
    addEventListener("resize", () => { this.res.set(innerWidth, innerHeight); this.group.traverse((o) => o.material?.resolution?.copy(this.res)); this.chart.draw(); });
    $("ps-close").onclick = () => this.close();
    const list = $("ps-list");
    list.innerHTML = "";
    for (const b of this.data.basins) list.appendChild(this.button(b.label.split(",")[0], () => this.open("basin", b.id), b.about));
    for (const h of this.data.heads) list.appendChild(this.button(h.label.split(":")[0], () => this.open("head", h.id), h.about));
    this.t = this.data.leads.map((L) => model.cycle.getTime() + L * 3600e3);
  }

  button(txt, fn, title) { const b = document.createElement("button"); b.className = "btn"; b.textContent = txt; b.title = title; b.onclick = fn; return b; }

  close() { this.el.hidden = true; this.group.visible = false; this.which = null; this.stage.markDirty(); }

  setUnits(u) { this.units = u; if (this.which) this.open(...this.which, { fly: false }); }

  setNow(t) { if (!this.el.hidden) this.chart.setNow(t); }

  drawLines(lines) {
    this.group.clear();
    const pos = [];
    for (const L of lines) {
      const a = this.proj.toXY(...L.a), b = this.proj.toXY(...L.b);
      pos.push(a.x, a.y, 0.03, b.x, b.y, 0.03);
      const d = document.createElement("div"); d.className = "ps-tag"; d.textContent = L.label;
      const o = new CSS2DObject(d); o.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0.05); this.group.add(o);
    }
    const geo = new LineSegmentsGeometry(); geo.setPositions(pos);
    const mat = new LineMaterial({ color: 0xffcf8a, linewidth: 4, depthTest: false, transparent: true });
    mat.resolution.copy(this.res);
    const seg = new LineSegments2(geo, mat); seg.renderOrder = 20; this.group.add(seg);
    this.group.visible = true;
    return lines.flatMap((L) => [this.proj.toXY(...L.a), this.proj.toXY(...L.b)]);
  }

  open(kind, id, { fly = true } = {}) {
    this.which = [kind, id];
    this.el.hidden = false;
    $("point").hidden = true; $("report").hidden = true;
    const k = this.units === "ft" ? FT : 1, U = this.units, t = this.t;
    if (kind === "basin") {
      const b = this.data.basins.find((q) => q.id === id);
      const pts = [...this.drawLines(b.passes), this.proj.toXY(b.bbox[0], b.bbox[1]), this.proj.toXY(b.bbox[2], b.bbox[3])];
      const lvl = b.level.map((v) => v * k), ex = extrema(t, b.level), sl = pairUp(slacks(t, b.flux), ex);
      const maxIn = Math.max(...b.flux), maxOut = Math.min(...b.flux);
      // Tidal prism: the water each flood brings in (km³), between successive slacks.
      const floods = []; let acc = 0;
      for (let i = 0; i < t.length - 1; i++) { const f = (b.flux[i] + b.flux[i + 1]) / 2; if (f > 0) acc += f * 3600; else if (acc > 0) { floods.push(acc); acc = 0; } }
      const prism = floods.length ? floods.reduce((a, q) => a + q, 0) / floods.length / 1e9 : null;
      const med = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
      const off = med(sl.map((q) => Math.abs(q.offset)));
      // When does the strongest inflow come, relative to the fastest rise?
      const iMax = b.flux.indexOf(maxIn), iFill = b.fill.indexOf(Math.max(...b.fill));
      const share = b.passes.length > 1 ? b.passes.map((p) => [p.label, p.flux.reduce((a, q) => a + Math.abs(q), 0)]) : null;
      const tot = share?.reduce((a, q) => a + q[1], 0);
      $("ps-title").textContent = b.label;
      $("ps-sub").textContent = `${b.areaKm2.toLocaleString()} km² of water · ${b.volumeKm3} km³ · ${b.passes.length > 1 ? `${b.passes.length} passes` : "one pass"}`;
      $("ps-sum").innerHTML = `<p><b>Water in = basin rising.</b> The flow through ${b.passes.length > 1 ? "the passes" : b.passes[0].label} (solid) and the rate ${b.label.split(",")[0]} fills (its area × how fast its level rises, dashed) match almost exactly (r = ${b.match.toFixed(3)}). So the inflow is strongest when the level climbs fastest — around half-tide — and stops when the level stops: <b>slack ${off != null ? `within ${fmtSpan(off)}` : "close to"}</b> of high and low water (median, this run).</p>`
        + `<p>Peak inflow ${k3(maxIn)}, peak outflow ${k3(-maxOut)}${prism ? `; each flood brings in about <b>${prism.toFixed(1)} km³</b> — ${Math.round((prism / b.volumeKm3) * 100)} % of the basin's volume` : ""}.`
        + `${Math.abs(iMax - iFill) <= 1 ? " The strongest inflow comes within an hour of the fastest rise." : ""}</p>`
        + (share ? `<p>Share of the exchange: ${share.map(([l, v]) => `${l} <b>${Math.round((v / tot) * 100)} %</b>`).join(" · ")}.</p>` : "")
        + `<p class="fine">${b.about}</p>`;
      this.chart.set({
        t, now: this.timebar.t,
        panels: [
          { label: `basin mean level (${U})`, weight: 0.8, series: [{ v: lvl, color: "--hw" }],
            markers: ex.map((e) => ({ t: e.t, v: e.v * k, color: "--hw", label: `${e.kind} ${this.chart.fmtT.format(new Date(e.t))}`, below: e.kind === "LW" })) },
          { label: "flow in (+) / out (−), thousand m³/s", zero: true, upLabel: "filling ↑", downLabel: "emptying ↓",
            series: [{ v: b.flux.map((q) => q / 1000), color: "--ink", shade: ["--flood", "--ebb"] }, { v: b.fill.map((q) => q / 1000), color: "--hw", dash: [5, 4], width: 2 }],
            markers: sl.map((q) => ({ t: q.t, v: 0, color: "--slack", r: 3.2 })) },
        ],
        links: sl.filter((q) => q.ref).map((q) => ({ from: { panel: 0, t: q.ref.t, v: q.ref.v * k }, to: { panel: 1, t: q.t, v: 0 }, label: fmtShort(q.offset), below: q.kind === "flood→ebb" })),
        hover: (q) => `level ${lerpAt(t, lvl, q).toFixed(1)} ${U} · flow ${Math.round(lerpAt(t, b.flux, q) / 1000)}k · fill ${Math.round(lerpAt(t, b.fill, q) / 1000)}k m³/s`,
      });
      $("ps-legend").innerHTML = `<span class="sw hw"></span>basin level <span class="sw fl"></span>flowing in <span class="sw eb"></span>flowing out <span class="dash"></span>area × rate of rise <span class="sw sl"></span>slack (± h:mm from HW/LW)`;
      if (fly) this.onFly?.(pts);
    } else {
      const h = this.data.heads.find((q) => q.id === id);
      const pts = this.drawLines([{ label: h.label.split(":")[0], a: [h.at[0] + 0.006, h.at[1]], b: [h.at[0] - 0.006, h.at[1]] }]);
      const A = h.sideA.level, B = h.sideB.level, head = A.map((a, i) => a - B[i]);
      const cross = slacks(t, head).map((c) => ({ t: c.t, kind: c.kind === "ebb→flood" ? "A rises above B" : "B rises above A" }));
      const sl = slacks(t, h.current), pairs = sl.map((s) => { let best = null; for (const c of cross) if (!best || Math.abs(c.t - s.t) < Math.abs(best.t - s.t)) best = c; return { ...s, ref: best, offset: best ? s.t - best.t : null }; });
      const med = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
      const lag = med(pairs.filter((p) => p.ref).map((p) => p.offset));
      const exA = extrema(t, A), slA = pairUp(sl, exA), offA = med(slA.map((q) => Math.abs(q.offset)));
      $("ps-title").textContent = h.label;
      $("ps-sub").textContent = `levels at ${h.sideA.label} and ${h.sideB.label} · current through the pass toward ${h.flowBearing}° (east +)`;
      $("ps-sum").innerHTML = `<p><b>The current runs downhill.</b> The tide reaches the two ends of the pass at different times, so one side stands higher than the other — by up to <b>${(Math.max(...head.map(Math.abs)) * k).toFixed(1)} ${U}</b> in this run — and the water pours through toward the lower side. It turns when the two levels cross: slack comes ${lag != null ? `<b>${fmtOffset(lag, "the crossing")}</b>` : "near the crossing"} (median), but ${offA != null ? `${fmtSpan(offA)} away from` : "well away from"} high or low water on the Rosario side. That's why a tide table for one side can't time this pass.</p><p class="fine">${h.about}</p>`;
      this.chart.set({
        t, now: this.timebar.t,
        panels: [
          { label: `water level (${U})`, weight: 0.9, series: [{ v: A.map((v) => v * k), color: "--flood" }, { v: B.map((v) => v * k), color: "--ebb" }],
            markers: cross.map((c) => ({ t: c.t, v: lerpAt(t, A, c.t) * k, color: "--slack", r: 2.5 })) },
          { label: "current through the pass, kt", zero: true, upLabel: "eastward ↑", downLabel: "westward ↓",
            series: [{ v: h.current, color: "--ink", shade: ["--flood", "--ebb"] }], markers: sl.map((q) => ({ t: q.t, v: 0, color: "--slack", r: 3.2 })) },
        ],
        links: pairs.filter((p) => p.ref).map((p) => ({ from: { panel: 0, t: p.ref.t, v: lerpAt(t, A, p.ref.t) * k }, to: { panel: 1, t: p.t, v: 0 }, label: fmtShort(p.offset), below: p.kind === "flood→ebb" })),
        hover: (q) => `${h.sideA.label.split(" (")[0]} ${(lerpAt(t, A, q) * k).toFixed(1)} · ${h.sideB.label.split(" (")[0]} ${(lerpAt(t, B, q) * k).toFixed(1)} ${U} · ${lerpAt(t, h.current, q).toFixed(1)} kt`,
      });
      $("ps-legend").innerHTML = `<span class="sw fl"></span>${h.sideA.label} <span class="sw eb"></span>${h.sideB.label} <span class="sw sl"></span>levels equal / slack (± h:mm)`;
      if (fly) this.onFly?.(pts);
    }
    this.stage.markDirty();
  }
}

// "2 minutes", "1 h 45 m"
const fmtSpan = (ms) => { const m = Math.round(Math.abs(ms) / 60e3); return m < 60 ? `${m} minute${m === 1 ? "" : "s"}` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
const fmtShort = (ms) => { const m = Math.round(ms / 60e3); return `${m >= 0 ? "+" : "−"}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, "0")}`; };
