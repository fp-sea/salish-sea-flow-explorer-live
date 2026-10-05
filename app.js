// Salish Sea Flow Explorer: the page. Wires the stage, the ground and (as they arrive) the model
// layers to the panel. Each layer is its own module; this file only connects them.
//
// ?debug exposes window.ssfe for checks from the console or a test browser.

import * as THREE from "three";
import { Stage } from "./shell/stage.js?v=20261005223557";
import { Projection } from "./shell/geo.js?v=20261005223557";
import { regionViews, homeView } from "./shell/views.js?v=20261005223557";
import { Ground, DEPTH_STOPS, depthTint } from "./layers/ground.js?v=20261005223557";
import { LITE } from "./device.js?v=20261005223557";
import { Sscofs } from "./model/sscofs.js?v=20261005223557";
import { FlowGrid } from "./model/flowgrid.js?v=20261005223557";
import { MeshField } from "./layers/meshfield.js?v=20261005223557";
import { CurrentFlow } from "./layers/curflow.js?v=20261005223557";
import { Curtains } from "./layers/curtains.js?v=20261005223557";
import { Slabs } from "./layers/slabs.js?v=20261005223557";
import { Particles3D } from "./layers/particles3d.js?v=20261005223557";
import { Paths3D } from "./layers/paths3d.js?v=20261005223557";
import { SectionPanel } from "./sectionpanel.js?v=20261005223557";
import { loadStations, loadSkill } from "./model/stations.js?v=20261005223557";
import { loadTides } from "./model/tides.js?v=20261005223557";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { StationMarks } from "./layers/stationmarks.js?v=20261005223557";
import { RAMPS, rampCss } from "./layers/ramps.js?v=20261005223557";
import { MODES, MODE } from "./modes.js?v=20261005223557";
import { TimeBar } from "./time.js?v=20261005223557";
import { PointPanel } from "./pointpanel.js?v=20261005223557";
import { PassPanel } from "./passpanel.js?v=20261005223557";
import { AreaReport } from "./report.js?v=20261005223557";
import { Lesson } from "./lessons.js?v=20261005223557";
import { keptRuns, pruneRuns, counters, storeInfo, clearKept } from "./model/store.js?v=20261005223557";

const $ = (id) => document.getElementById(id);

// Where the model data comes from: the shared data repo (pipeline/runner.py publishes it) on the
// live site; this site's own web/data/sscofs/ when run locally. ?data=local | ?data=<url> override.
const DATA = (() => {
  const q = new URLSearchParams(location.search).get("data");
  if (q === "local") return "data/sscofs/";
  if (q) return q.endsWith("/") ? q : `${q}/`;
  return /\.github\.io$/.test(location.hostname) ? "https://fp-sea.github.io/salish-currents/sscofs/" : "data/sscofs/";
})();
// Lab runs (pipeline/lab.py) sit beside the daily data: <data>/../lab/index.json.
const LAB = new URL("../lab/", new URL(DATA, location.href)).href;
// Which data: "live" (the daily run: surface current and tide) or "lab:<id>" (a kept whole run).
// ?lab=<id> (or ?lab for the newest) picks a lab run; the choice is remembered.
const SRC = (() => {
  const q = new URLSearchParams(location.search);
  if (q.has("lab")) return `lab:${q.get("lab")}`;
  if (q.has("live")) return "live";
  try { return JSON.parse(localStorage.getItem("ssfe.src")) || "live"; } catch { return "live"; }
})();
const pref = {
  get(k, d) { try { const v = localStorage.getItem(`ssfe.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`ssfe.${k}`, JSON.stringify(v)); } catch { /* private mode: fine */ } },
};
const status = (msg, err = false) => { $("status").textContent = msg || ""; $("status").classList.toggle("err", err); };

const stage = new Stage($("scene"), { panels: ["panel", "point", "passes", "report", "lesson", "section"] });   // views frame into what these leave visible
stage.renderer.localClippingEnabled = true;                    // (the land is cut at sea level: layers/ground.js)
const ground = new Ground({ stride: LITE ? 2 : 1 });
stage.scene.add(ground.group);
let region, proj, views = [], view = null;
let model = null, field = null, flow = null, fgrid = null, timebar = null, point = null, passes = null, report = null, lesson = null;
let curtains = null, slabs = null, section = null, p3 = null, paths = null, exch = null;
let stations = null, marks = null;
const FLOOD_FROM_NOAA = ["PUG1701", "PUG1629"];                       // Deception Pass (Narrows), Yokeko Point                                     // NOAA's current predictions and this run's skill against them                     // the full volume in 3D (lab runs)

// ---------- theme ----------
const THEMES = ["auto", "light", "dark"];
function applyTheme(t) {
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  $("theme-btn").textContent = t[0].toUpperCase() + t.slice(1);
  try { if (t === "auto") localStorage.removeItem("prefs.theme"); else localStorage.setItem("prefs.theme", t); } catch {}
}
let theme = (() => { try { return localStorage.getItem("prefs.theme") || "auto"; } catch { return "auto"; } })();
applyTheme(theme);
$("theme-btn").onclick = () => applyTheme(theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]);

// ---------- views ----------
function fillViews() {
  const sel = $("view-select"); sel.innerHTML = "";
  let og = null, last = null;
  for (const v of views) {
    if (v.group !== last) { og = document.createElement("optgroup"); og.label = last = v.group; sel.appendChild(og); }
    const o = document.createElement("option"); o.value = v.id; o.textContent = v.label; og.appendChild(o);
  }
}
async function goView(id, opts = {}) {
  const v = views.find((q) => q.id === id) || views[0];
  view = v; $("view-select").value = v.id;
  $("where").textContent = v.group;
  if (stage.is2D && v.tilt > 0) stage.set2D(false);
  await stage.flyTo(stage.framingFor(v, proj.box), opts);
}
$("view-select").onchange = (e) => goView(e.target.value);
$("view-home").onclick = () => goView(homeView(region));
$("view-top").onclick = () => goView(view?.sub ? `${view.sub}-top` : "region-top");
$("view-3d").onclick = () => goView(view?.sub ? `${view.sub}-3d` : "region-3d");
function set2D(on) {
  if (on && !stage.is2D) { const top = view?.sub ? `${view.sub}-top` : "region-top"; stage.set2D(true); goView(top); }
  else stage.set2D(on);
  $("view2d").textContent = on ? "3D" : "2D";
  $("view2d").title = on ? "Back to the 3D view (key: 2)" : "A north-up 2D map (key: 2)";
  $("hint").textContent = on ? "drag to pan · wheel to zoom" : "drag to rotate · right-drag to pan · wheel to zoom";
  pref.set("2d", on);
}
$("view2d").onclick = () => set2D(!stage.is2D);
addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, select, textarea")) return;
  if (e.key === "2") set2D(!stage.is2D);
  else if (/^[1-9]$/.test(e.key) && e.key !== "2" && views[+e.key - 1]) goView(views[+e.key - 1].id);
});

// ---------- ground controls ----------
const G = {
  land: () => ({ on: $("show-land").checked, style: $("land-style").value, ex: +$("land-ex").value || 0.001 }),
  seabed: () => ({ on: $("show-seabed").checked, ex: +$("seabed-ex").value, source: $("seabed-src").value }),
  water: () => ({ on: $("show-water").checked, style: $("water-style").value, opacity: +$("water-op").value }),
};
const GROUND_IDS = ["show-land", "land-style", "land-ex", "show-seabed", "seabed-src", "seabed-ex", "show-water", "water-style", "water-op"];
function saveGround() { pref.set("ground", Object.fromEntries(GROUND_IDS.map((id) => [id, $(id).type === "checkbox" ? $(id).checked : $(id).value]))); }
function restoreGround() {
  const g = pref.get("ground", {});
  for (const id of GROUND_IDS) if (id in g) { if ($(id).type === "checkbox") $(id).checked = g[id]; else $(id).value = g[id]; }
}
function labels() {
  $("land-ex-val").textContent = +$("land-ex").value === 0 ? "flat" : `${$("land-ex").value}×`;
  $("seabed-ex-val").textContent = `${$("seabed-ex").value}×`;
  $("water-op-val").textContent = `${Math.round(+$("water-op").value * 100)} %`;
}
let pend = {};
function rebuild(which) {
  labels(); saveGround();
  pend[which] = true;
  clearTimeout(rebuild.t);
  rebuild.t = setTimeout(async () => {
    const p = pend; pend = {};
    if (p.land) await ground.buildLand(G.land());
    if (p.seabed) ground.buildSeabed(G.seabed());
    if (p.water) await ground.buildWater(G.water());
    stage.markDirty();
  }, 60);
}
for (const id of ["show-land", "land-style", "land-ex"]) $(id).addEventListener("input", () => rebuild("land"));
for (const id of ["show-seabed", "seabed-src", "seabed-ex"]) $(id).addEventListener("input", () => rebuild("seabed"));
for (const id of ["show-water", "water-style"]) $(id).addEventListener("input", () => rebuild("water"));
$("water-op").addEventListener("input", () => { labels(); saveGround(); ground.setWaterOpacity(+$("water-op").value); stage.markDirty(); });

function depthKey() {
  const max = 400, c = document.createElement("canvas"); c.width = 200; c.height = 1;
  const x = c.getContext("2d"), img = x.createImageData(200, 1);
  for (let i = 0; i < 200; i++) { const t = depthTint((i / 199) * max); img.data.set([t[0], t[1], t[2], 255], i * 4); }
  x.putImageData(img, 0, 0);
  $("depth-key").innerHTML = `<div class="ttl">Seabed depth (m)</div><div class="bar" style="background:url(${c.toDataURL()}) 0 0/100% 100%"></div>`
    + `<div class="ticks">${[0, 50, 100, 200, 300, 400].map((d) => `<span>${d}${d === 400 ? "+" : ""}</span>`).join("")}</div>`;
}

// ---------- what's under the cursor ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), sea = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3();
// The curtain under the pointer (its id), if they're showing.
function curtainAt(ev) {
  if (!curtains?.group.visible || stage.is2D) return null;
  const r = stage.renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
  return ray.intersectObjects(curtains.meshes(), false)[0]?.object.userData.curtain || null;
}
export function pick(ev) {
  const r = stage.renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
  return ray.ray.intersectPlane(sea, hit) ? { x: hit.x, y: hit.y } : null;
}
const fmtLL = (lat, lon) => `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? "E" : "W"}`;
stage.renderer.domElement.addEventListener("pointermove", (ev) => {
  if (!proj || ev.buttons) return;
  const cid = curtainAt(ev);
  if (cid) { const c = curtains.items.find((q) => q.id === cid); $("hint").textContent = `${c.label}: the current across the pass at every depth · click for the whole run`; return; }
  const p = pick(ev); if (!p) return;
  const s = ground.sample(p.x, p.y), ll = proj.toLatLon(p.x, p.y);
  if (!s) return;
  let what = "";
  if (s.kind === "land") what = `land ${s.heightM} m`;
  else if (s.kind === "sea") what = "water outside the model (open Pacific, lakes)";
  else {
    what = `depth ${s.depthM?.toFixed(0)} m`;
    // The flow here at the time on screen (surface or depth-averaged, as chosen).
    const hit = model?.ready && model.locate(p.x, p.y), v = hit && model.at(hit, timebar.t);
    if (v) {
      const d = F.layer() === "davg" || F.layer() === "res_d", u = d ? v.ua : v.us, w = d ? v.va : v.vs, sp = Math.hypot(u, w);
      const toward = Math.round(((Math.atan2(u, w) * 180) / Math.PI + 360) % 360), units = point?.units || "ft";
      what += ` · current ${sp.toFixed(1)} kt toward ${toward}° · level ${Number.isFinite(v.zeta) ? `${(v.zeta * (units === "ft" ? 3.28084 : 1)).toFixed(1)} ${units}` : "dry"} · click for its tides`;
    }
  }
  $("hint").textContent = `${fmtLL(ll.lat, ll.lon)} · ${what}`;
});

// ---------- the model: tide and current ----------
const F = {
  mode: () => $("fill-mode").value, layer: () => $("flow-layer").value,
  // (net drift is ~10× slower than the tide: its particles run faster so the pattern shows)
  opts: () => ({ particles: $("show-parts").checked, lines: $("show-lines").checked, density: +$("density").value, speed: +$("pspeed").value * ($("flow-layer").value.startsWith("res_") ? 6 : 1),
    size: +$("psize").value, width: +$("lwidth").value, trail: +$("ptrail").value, opacity: +$("popac").value }),
};
const FLOW_IDS = ["fill-mode", "flow-layer", "fill-op", "show-parts", "show-lines", "density", "pspeed", "psize", "ptrail", "lwidth", "popac"];
function saveFlow() { pref.set("flow", Object.fromEntries(FLOW_IDS.map((id) => [id, $(id).type === "checkbox" ? $(id).checked : $(id).value]))); }
function restoreFlow() {
  const g = pref.get("flow", {});
  for (const id of FLOW_IDS) if (id in g) { if ($(id).type === "checkbox") $(id).checked = g[id]; else $(id).value = g[id]; }
}
function flowLabels() {
  $("fill-op-val").textContent = `${Math.round(+$("fill-op").value * 100)} %`;
  $("density-val").textContent = `${$("density").value}×`; $("pspeed-val").textContent = `${$("pspeed").value}×`;
  for (const id of ["psize", "ptrail", "lwidth"]) $(`${id}-val`).textContent = `${(+$(id).value).toFixed(1)}×`;
  $("popac-val").textContent = `${Math.round(+$("popac").value * 100)} %`;
}
// A surface-only (daily) run: the depth-averaged current and the depth slices are lab-only.
function gateLayers() {
  const live = model && !model.hasDavg, sel = $("flow-layer");
  for (const o of sel.options) {
    const lab = o.value === "davg" || o.value.startsWith("d:");
    o.dataset.txt ??= o.textContent;
    o.disabled = live && lab; o.textContent = o.dataset.txt + (live && lab ? " — in the Lab" : "");
  }
  const og = sel.querySelector('optgroup[label^="Over the"]');
  if (og) og.label = model?.borrowed ? `Over the lab run (${model.borrowed})` : "Over the run";
  if (sel.selectedOptions[0]?.disabled) { sel.value = "surf"; }
}
function fillModes() {
  const sel = $("fill-mode"), keep = sel.value || pref.get("flow", {})["fill-mode"] || "speed";
  sel.innerHTML = "";
  let og = null, last = null;
  for (const m of MODES) {
    if (m.kind === "static" && m.id !== "lag" && !model?.patterns) continue;
    if (m.needs === "compare" && !model?.compare) continue;
    if (m.id === "lag" && !model?.phase) continue;
    if (m.group !== last) { og = m.group ? Object.assign(document.createElement("optgroup"), { label: m.kind === "static" && model?.borrowed ? `${m.group} · lab run ${model.borrowed}` : m.group }) : sel; if (og !== sel) sel.appendChild(og); last = m.group; }
    og.appendChild(Object.assign(document.createElement("option"), { value: m.id, textContent: m.label }));
  }
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : "speed";
}
function fillKey() {
  const m = F.mode();
  $("fill-read").innerHTML = MODE[m]?.read || "";
  $("fill-read").hidden = !MODE[m]?.read;
  if (m === "none") { $("fill-key").innerHTML = ""; return; }
  const R = RAMPS[m];
  $("fill-key").innerHTML = `<div class="ttl">${R.title}</div><div class="bar" style="background:${rampCss(m)}"></div>`
    + `<div class="ticks">${R.ticks.map((v) => `<span>${v > 0 && R.min < 0 ? "+" : ""}${v}</span>`).join("")}</div>`;
}
let lineT = -Infinity, lineLead = -1;
function showTime(t) {
  if (!model) return;
  // A volume from an earlier run ends earlier: say so rather than showing an empty slice.
  if (F.layer().startsWith("d:") && model.volumeReady) {
    const out = !model.volumeCovers(Math.floor(model.fi(t)));
    if (out !== showTime.volOut) { showTime.volOut = out; status(out ? `the full volume (${model.volumeLabel} run) doesn't reach this time — depth views are blank here` : ""); }
  } else if (showTime.volOut) { showTime.volOut = false; status(""); }
  if (field && F.mode() !== "none") field.setTime(t);
  slabs?.setTime(t); curtains?.setTime(t); section?.setNow(t); if (p3?.group.visible) p3.setTime(t); paths?.setTime(t);
  if (flow && (F.opts().particles || F.opts().lines)) {
    const f = model.fi(t), i0 = Math.floor(f), i1 = Math.min(model.leads.length - 1, i0 + 1), L = F.layer();
    const gA = fgrid.grid(L, i0), gB = fgrid.grid(L, i1);
    const relines = Math.abs(t - lineT) > 15 * 60e3 || i0 !== lineLead;
    if (relines) { lineT = t; lineLead = i0; }
    if (gA) flow.setGrid(gA, relines, gB, f - i0);
    // Get the next hour ready while the browser is idle, so crossing into it doesn't stall playback.
    const nx = Math.min(model.leads.length - 1, i1 + 1);
    if (nx !== showTime.prepared) {
      showTime.prepared = nx;
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
      idle(() => { if (F.mode() !== "none") { const L2 = F.mode() === "level" ? "zeta" : L; if (F.mode() === "spin") model.spinField(L, nx); else model.nodeField(L2, nx); } fgrid.grid(L, nx); });
    }
  }
  if (point?.hit || (passes && !$("passes").hidden)) {
    clearTimeout(showTime.pt);
    showTime.pt = setTimeout(() => { if (point?.hit) point.draw(); passes?.setNow(t); }, timebar.playing ? 250 : 30);
  }
  stage.markDirty();
}
// Where the current layers sit: on the surface, as a flat slice at a depth, or over the seabed.
function placeLayers() {
  if (!field) return;
  const L = F.layer(), ex = +$("seabed-ex").value;
  const where = L.startsWith("d:") ? (L === "d:bottom" ? "bottom" : +L.slice(2)) : "surface";
  if (stage.is2D || where === "surface") { field.setDepth("surface"); flow.group.position.z = 0; flow.setFlat(stage.is2D); }
  else { field.setDepth(where, ex); flow.group.position.z = where === "bottom" ? 0 : -where / 1000 * ex; flow.setFlat(where === "bottom"); }
  vol3d();
  stage.markDirty();
}
function applyFill() {
  const m = F.mode(), L = F.layer();
  const needVol = L.startsWith("d:") && !model.volumeReady;
  if (needVol) volumeBox(true);
  field.group.visible = m !== "none";
  if (m !== "none") { field.stale = true; field.setMode(m, needVol ? "surf" : L); field.setOpacity(+$("fill-op").value); field.setTime(timebar.t); }
  placeLayers(); fillKey(); stage.markDirty();
}

// ---------- the full volume in 3D: any depth, stacked slices, curtains (lab runs) ----------
// The depth slider drives one extra "Current at" option (d:<m>), so links and the rest of the page
// treat it like the fixed depths.
function depthSlider() {
  const L = F.layer(), on = L.startsWith("d:") && L !== "d:bottom";
  $("depth-row").hidden = !on;
  if (on) { $("depth-m").value = L.slice(2); $("depth-val").textContent = `${L.slice(2)} m`; }
}
function setCustomDepth(m) {
  const o = $("opt-dcustom"); o.value = `d:${m}`; o.textContent = `${m} m down`;
  if (![10, 30, 100].includes(+m)) o.hidden = false;
  $("flow-layer").value = `d:${m}`; $("flow-layer").dispatchEvent(new Event("input"));
}
$("depth-m").addEventListener("input", () => { $("depth-val").textContent = `${$("depth-m").value} m`; clearTimeout(depthSlider.t); depthSlider.t = setTimeout(() => setCustomDepth($("depth-m").value), 120); });
// Stacked slices and curtains: shown in 3D, with the volume loaded; built on first use.
function vol3d() {
  if (!model) return;
  // Always on show (they were hidden until the volume was in: nobody found them). Live: greyed,
  // pointing to the Lab. Lab without the volume: ticking one downloads it first.
  $("vol3d-row").hidden = false;
  for (const id of ["show-stack", "show-curtains", "show-p3d", "show-exchange"]) $(id).disabled = !model.isLab;
  if (!model.isLab) {
    $("vol3d-note").hidden = false;
    $("vol3d-note").innerHTML = "Stacked slices, curtains and depths use a lab run's full 3D volume: choose a <b>Lab</b> run under Data.";
    return;
  }
  if (!model.volumeReady) {
    const want = $("show-stack").checked || $("show-curtains").checked || $("show-p3d").checked;
    $("vol3d-note").hidden = !want;
    if (want) { $("vol3d-note").textContent = `These need the full 3D volume (${Math.round(model.volumeBytes() / 1e6)} MB): downloading it…`; volumeNow(); }
    return;
  }
  const ex = +$("seabed-ex").value, note = [];
  paths?.setEx(ex);
  const wantStack = $("show-stack").checked && !stage.is2D, wantCur = $("show-curtains").checked && !stage.is2D, wantP3 = $("show-p3d").checked && !stage.is2D;
  $("p3d-box").hidden = !$("show-p3d").checked;
  if (wantP3) {
    p3 ||= (() => { const q = new Particles3D(model, fgrid); stage.scene.add(q.group); return q; })();
    p3.set({ ...p3Opts(), ex }); p3.group.visible = true;
    const n3 = p3.useView(viewBox()); if (n3) note.push(n3);
    p3.setTime(timebar.t);
  } else if (p3) p3.group.visible = false;
  if (flow) flow.group.visible = !wantP3;                              // (the 3D particles include the surface)
  if (wantStack) {
    slabs ||= (() => { const s = new Slabs(model, proj.box); for (const f of s.fields) if (model.floodFix) f.fixFlood(model.floodFix, 4); stage.scene.add(s.group); return s; })();
    const ok2 = slabs.set(F.mode(), ex, +$("fill-op").value);
    slabs.group.visible = ok2; field.group.visible = !ok2 && F.mode() !== "none";
    if (!ok2) note.push("Stacked slices show the current right now: choose Colour → Current speed or Flood or ebb.");
    else { slabs.redraw(); slabs.setTime(timebar.t); }
  } else if (slabs) { slabs.group.visible = false; field.group.visible = F.mode() !== "none"; }
  const wantEx = $("show-exchange").checked && curtains?.ready;
  if (wantEx && !exch) { exch = curtains.exchangeGroup(); stage.scene.add(exch); }
  if (exch) exch.visible = !!wantEx;
  if (curtains) { curtains.group.visible = wantCur && curtains.ready; if (curtains.ready && curtains.ex !== ex) curtains.build(ex); if (curtains.ready) curtains.setTime(timebar.t); }
  // The surface colour steps back while the slices or curtains are showing (it shares their colours).
  const under = slabs?.group.visible || curtains?.group.visible || p3?.group.visible;
  field.setOpacity(+$("fill-op").value * (under ? 0.3 : 1));
  if (flow) { flow.dim = under ? 0.33 : 1; flow.setOpacity(flow.opts.opacity * flow.dim); }   // (the particles too)
  if ((wantStack || wantCur) && ex < 4) note.push("Tip: a bigger “Seabed depth ×” (Land, seabed &amp; water) spreads the depths apart.");
  if (stage.is2D && ($("show-stack").checked || $("show-curtains").checked || $("show-p3d").checked)) note.push("Slices, curtains and 3D particles are drawn in 3D: press 3D.");
  $("vol3d-note").hidden = !note.length; $("vol3d-note").innerHTML = note.join(" ");
  stage.markDirty();
}
$("show-stack").addEventListener("input", () => { pref.set("stack", $("show-stack").checked); vol3d(); });
$("show-exchange").addEventListener("input", async () => { pref.set("exchange", $("show-exchange").checked); if ($("show-exchange").checked) await ensureCurtains(); vol3d(); });
// The 3D particles' options: their own (colour, depth band) and the shared particle style sliders.
function p3Opts() {
  const top = +$("p3d-top").value, bot = Math.max(top + 5, +$("p3d-bot").value);
  $("p3d-top-val").textContent = `${top} m`; $("p3d-bot-val").textContent = bot >= 400 ? "seabed" : `${bot} m`;
  return { colour: $("p3d-colour").value, top, bottom: bot >= 400 ? 1e4 : bot, density: +$("density").value, size: +$("psize").value, trail: +$("ptrail").value, opacity: +$("popac").value, speed: +$("pspeed").value };
}
$("show-p3d").addEventListener("input", () => { pref.set("p3d", $("show-p3d").checked); vol3d(); });
for (const id of ["p3d-colour", "p3d-top", "p3d-bot"]) $(id).addEventListener("input", () => { pref.set(id, $(id).value); if (p3) p3.set(p3Opts()); else p3Opts(); stage.markDirty(); });
// Curtains on, with the volume and the sections ready (downloads/cuts them if needed).
async function ensureCurtains() {
  if (!model?.isLab) return false;
  $("show-curtains").checked = true; pref.set("curtains", true);
  if (!model.volumeReady) { vol3d(); await volumeNow(); }
  curtains ||= (() => { const c = new Curtains(model, proj); stage.scene.add(c.group); return c; })();
  if (!curtains.ready) {
    $("vol3d-note").hidden = false;
    ensureCurtains.p ||= curtains.load((d, n) => { $("vol3d-note").textContent = `Cutting the sections: hour ${d} of ${n}…`; });
    await ensureCurtains.p;
    if (!curtains.ready) ensureCurtains.p = null;                     // (failed: the next try starts again)
  }
  vol3d();
  return curtains.ready;
}
$("show-curtains").addEventListener("input", async () => {
  pref.set("curtains", $("show-curtains").checked);
  if ($("show-curtains").checked) await ensureCurtains(); else vol3d();
});
// Jump to a curtain: curtains on, the camera square-on to the wall from the south side, its card open.
async function goCurtain(id) {
  if (stage.is2D) set2D(false);
  if (!(await ensureCurtains())) return;
  const c = curtains.items.find((q) => q.id === id); if (!c) return;
  if (+$("seabed-ex").value < 15) { $("seabed-ex").value = 15; $("seabed-ex").dispatchEvent(new Event("input")); }   // (a wall tall enough to read)
  const a = c.cols[0], b = c.cols.at(-1), ex = +$("seabed-ex").value, h = Math.max(...c.cols.map((q) => q.h));
  let az = Math.atan2(c.nx, c.ny) * 180 / Math.PI;                    // bearing of the wall's normal
  if (Math.cos((az - 180) * Math.PI / 180) < 0) az += 180;             // (look from the southern side)
  const span = Math.max(3, (b.s - a.s) * 1.6);
  openSection(id); await new Promise(requestAnimationFrame);          // (the card first: the framing leaves room for it)
  const f = stage.framingFor({ center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, span, tilt: 72, az }, proj.box), dz = -h / 2 / 1000 * ex;
  f.pos.z += dz; f.target.z += dz;                                     // (aim at the middle of the wall)
  stage.flyTo(f);
}
function curtainButtons() {
  const list = $("cur-list"), ps = (model?.passes?.basins || []).flatMap((b) => b.passes).concat(model?.phase ? [{ id: "haro", label: "Haro Strait" }, { id: "rosario", label: "Rosario Strait" }] : []);
  list.hidden = !model?.isLab || !ps.length;
  list.innerHTML = "";
  for (const p of ps) {
    const btn = Object.assign(document.createElement("button"), { className: "btn mini", textContent: p.label.replace(/ \(.*\)$/, "").replace(" entrance", ""), title: `Fly to the ${p.label} curtain and open its card` });
    btn.onclick = () => goCurtain(p.id); list.appendChild(btn);
  }
}
function openSection(id) {
  // A NOAA current station on the line (within 300 m) where this run's model is far off it: the card
  // shows that station's column, so it sits beside NOAA's numbers (Deception Pass narrows).
  const cc = curtains?.items.find((q) => q.id === id);
  const on = cc && (stations || []).find((st) => st.skill?.flag && cc.cols.some((q) => Math.hypot(q.x - st.x, q.y - st.y) < 0.3));
  const s = curtains?.section(id, on ? { x: on.x, y: on.y, name: on.name } : null); if (!s) return;
  point?.close(); passes?.close(); $("report").hidden = true;
  section.open(s, point?.units || "ft"); section.setNow(timebar.t);
  // A NOAA station on the line where this run's model is weak: say so, with both numbers.
  const c = curtains.items.find((q) => q.id === id), weak = (stations || []).filter((st) => st.skill?.flag && c.cols.some((q) => Math.hypot(q.x - st.x, q.y - st.y) < 0.6));
  const ex = curtains.exchange(id);
  const k1 = (v) => Math.round(Math.abs(v) / 100) / 10;
  if (ex) $("sc-sum").innerHTML += ` <div class="pt-noaa"><b>Net exchange</b> through the whole section (the tide fitted out, this run): <b class="sw-m">${k1(ex.out)}k m³/s out</b> in the upper layers, <b class="sw-b">${k1(ex.in)}k m³/s in</b> below${ex.zeroDepth != null ? ` (they part at about ${Math.round(ex.zeroDepth)} m)` : ""}. `
    + (ex.ok ? `In and out nearly balance (net ${k1(ex.net)}k), so the 3-day estimate holds up to about ±${Math.max(1, k1(ex.net))}k.` : `<b class="caution">Too uncertain in this run:</b> in and out should nearly balance, but they differ by ${k1(ex.net)}k — 3 days can't separate all the tides, and here what's left of them is as big as the exchange. Try the neap run (weaker tides).`)
    + ` The Salish Sea Model's circulation maps (SSMC/UW) show year-long averages of the same quantity.</div>`;
  for (const st of weak) $("sc-sum").innerHTML += ` <div class="pt-noaa"><b class="caution">Too ${st.skill.flag === "under" ? "weak" : "strong"} here:</b> at NOAA's ${st.name} station the model peaks at ${st.skill.modelMax} kt this run where NOAA predicts ${st.skill.noaaMax} kt (${Math.round(st.skill.ratio * 100)} % on average). The pattern with depth is still the model's best guess; the speeds aren't.</div>`;
}
// NOAA's predictions for the run's hours and the run's skill against them (both optional: absent → no markers).
async function loadNoaa() {
  loadGauges();
  const got = await loadStations(model.t0, model.t1).catch(() => null);
  const skill = await loadSkill(model.isLab ? LAB : DATA, model.meta);
  if (!got?.stations?.length) { $("show-stations").closest("label").hidden = true; return; }
  stations = got.stations;
  marks = new StationMarks(proj, stations, skill, (st) => { if (point.open(st.x, st.y)) { passes?.close(); section.close(); $("report").hidden = true; } });
  stage.scene.add(marks.group);
  $("show-stations").checked = pref.get("stations", true); marks.visible = $("show-stations").checked;
  const flagged = stations.filter((s) => s.skill?.flag === "under").length;
  $("stations-note").textContent = skill ? `(${stations.length}; model too weak at ${flagged})` : `(${stations.length})`;
  point.setStations(stations); stage.markDirty();
  // Deception Pass: the flood/ebb colours take their sense from NOAA's stations there (RESEARCH_LOG 2026-10-05).
  const fix = stations.filter((s) => FLOOD_FROM_NOAA.includes(s.id));
  if (fix.length) { field.fixFlood(fix, 4); for (const f of slabs?.fields || []) f.fixFlood(fix, 4); model.floodFix = fix; }
}
// NOAA's tide gauges (pipeline/tides.py): small squares; click → the point panel with NOAA's tide beside the model's.
let gauges = null;
async function loadGauges() {
  const got = await loadTides(model.t0, model.t1).catch(() => null);
  if (!got?.stations?.length) return;
  gauges = new THREE.Group();
  for (const s of got.stations) {
    const p = proj.toXY(s.lat, s.lon); s.x = p.x; s.y = p.y;
    const d = document.createElement("div"); d.className = "tg-mark"; d.title = `NOAA tide station ${s.name} (${s.id}) · click for NOAA's tide beside the model's`;
    d.addEventListener("pointerdown", (e) => e.stopPropagation());
    d.addEventListener("click", (e) => { e.stopPropagation(); const w = nearestWater(s.x, s.y); if (w && point.open(w.x, w.y)) { passes?.close(); section.close(); $("report").hidden = true; } });
    const o = new CSS2DObject(d); o.position.set(p.x, p.y, 0.03); gauges.add(o);
  }
  stage.scene.add(gauges); setGauges($("show-stations").checked);
  point.setTides(got.stations);
  $("show-stations").closest("label").hidden = false;
}
// The nearest model water to scene (x, y) within 1.5 km (gauges often sit on a pier just outside
// the model's coastline): the nearest triangle centre. → {x, y} or null
function nearestWater(x, y) {
  if (model.locate(x, y)) return { x, y };
  let best = -1, bd = 1.5 * 1.5;
  for (let e = 0; e < model.E; e++) { const d = (model.cx[e] - x) ** 2 + (model.cy[e] - y) ** 2; if (d < bd) { bd = d; best = e; } }
  return best < 0 ? null : { x: model.cx[best], y: model.cy[best] };
}
function setGauges(on) { if (gauges) { gauges.visible = on; stage.markDirty(); } }   // (the label renderer hides a hidden group's labels)
$("show-stations").addEventListener("input", () => { pref.set("stations", $("show-stations").checked); setGauges($("show-stations").checked); if (marks) { marks.visible = $("show-stations").checked; stage.markDirty(); } });

// ---------- the full 3D volume (tier 2) ----------
let volLoading = false;
function volumeBox(show, why = "") {
  if (!model?.meta.volume) { $("vol-box").hidden = true; return; }
  const mb = Math.round(model.volumeBytes() / 1e6);
  $("vol-box").hidden = !show;
  if (show && !volLoading && !model.volumeReady)
    $("vol-msg").innerHTML = why || `<b>Full 3D volume</b> (${mb} MB): all 10 layers, for the “At depth” views.`
      + (model.volOff > 0 ? ` It's from the ${model.volumeLabel} run, ${model.volOff} h before the surface run (rebuilt once a day; the tide is the same, only wind and river effects differ a little).` : "");
}
// ---------- following the water: paths through the volume (layers/paths3d.js) ----------
async function ensurePaths() {
  if (!model?.isLab) return null;
  await volumeNow();
  paths ||= (() => { const q = new Paths3D(model, proj); q.setEx(+$("seabed-ex").value); stage.scene.add(q.group); return q; })();
  return paths;
}
const fmtPath = (s) => `${s.hours.toFixed(0)} h: travels <b>${s.travelled.toFixed(1)} nm</b>, ends <b>${s.net.toFixed(1)} nm ${compassOf(s.dir)}</b> of where it started, between ${Math.round(s.from)} and ${Math.round(s.to)} m deep (ends at ${Math.round(s.end)} m)${s.ended ? " — it reached the shore or the edge of the model" : ""}.`;
const compassOf = (d) => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(d / 22.5) % 16];
for (const b of document.querySelectorAll("#pt-trace button[data-depth]")) b.onclick = async () => {
  if (!point?.hit) return;
  $("pt-trace-note").textContent = model.volumeReady ? "Following it…" : "Downloading the full 3D volume first…";
  const P = await ensurePaths(); if (!P) return;
  const p = await P.trace({ x: point.x, y: point.y, depth: b.dataset.depth }, timebar.t, +$("pt-trace-h").value);
  if (!p) { $("pt-trace-note").textContent = "Couldn't start a path here (dry, or past the end of the run)."; return; }
  P.add(p); stage.markDirty();
  $("pt-trace-note").innerHTML = `From ${b.textContent.toLowerCase()} (${Math.round(p.depth0)} m), ${fmtPath(P.summary(p))} Play the time bar to watch the white dot ride it.`;
};
$("pt-trace-clear").onclick = $("sc-clear").onclick = () => { paths?.clear(); $("pt-trace-note").textContent = $("sc-release-note").textContent = ""; stage.markDirty(); };
$("sc-release").onclick = async () => {
  const id = section?.s?.id, c = curtains?.items.find((q) => q.id === id); if (!c) return;
  $("sc-release-note").textContent = "Following the water across the line…";
  const P = await ensurePaths(); if (!P) return;
  const step = Math.max(1, Math.floor(c.cols.length / 6)), made = [];
  for (let i = Math.floor(step / 2); i < c.cols.length; i += step) for (const depth of ["surface", "mid", "bottom"]) {
    const p = await P.trace({ x: c.cols[i].x, y: c.cols[i].y, depth }, timebar.t, 24); if (p) { P.add(p, { group: depth }); made.push({ depth, p }); }
  }
  stage.markDirty();
  // Each depth's mean displacement (start → 24 h later): how far and which way, on average.
  const net = (d) => { const a = made.filter((q) => q.depth === d); if (!a.length) return "—"; let dx = 0, dy = 0; for (const { p } of a) { dx += p.pts.at(-1).x - p.pts[0].x; dy += p.pts.at(-1).y - p.pts[0].y; } dx /= a.length; dy /= a.length; return `${(Math.hypot(dx, dy) / 1.852).toFixed(1)} nm ${compassOf(((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360)}`; };
  $("sc-release-note").innerHTML = `${made.length} parcels followed for 24 h from the time on screen. On average they end up — <b class="sw-s">surface</b> ${net("surface")}, <b class="sw-m">mid-depth</b> ${net("mid")}, <b class="sw-b">near the seabed</b> ${net("bottom")} of where they started. Play the time bar to watch them.`;
};

// The volume, once: every caller shares the same download.
function volumeNow() { return model.volumeReady ? Promise.resolve() : (volumeNow.p ||= loadVolume().finally(() => { volumeNow.p = null; })); }
async function loadVolume() {
  if (volLoading || model.volumeReady) return;
  volLoading = true; $("vol-go").disabled = $("vol-no").disabled = true; volumeBox(true);
  const mb = Math.round(model.volumeBytes() / 1e6);
  await model.loadVolume((done, n, bytes) => { $("vol-msg").textContent = `Downloading the 3D volume: hour ${done} of ${n} (${Math.round(bytes / 1e6)} of ${mb} MB)…`; });
  volLoading = false; $("vol-msg").innerHTML = "<b>Full 3D volume loaded.</b> Choose a depth under “Current at”.";
  $("vol-go").disabled = $("vol-no").disabled = false;
  setTimeout(() => volumeBox(false), 4000);
  if (F.layer().startsWith("d:")) { applyFill(); lineT = -Infinity; showTime(timebar.t); }
  if (pref.get("curtains", false)) { $("show-curtains").checked = true; $("show-curtains").dispatchEvent(new Event("input")); }
  if (pref.get("stack", false)) $("show-stack").checked = true;
  if (pref.get("p3d", false)) $("show-p3d").checked = true;
  for (const id of ["p3d-colour", "p3d-top", "p3d-bot"]) { const v = pref.get(id, null); if (v != null) $(id).value = v; }
  vol3d();
}
$("vol-go").onclick = () => volumeNow();
$("vol-no").onclick = () => volumeBox(false);
$("vol-pref").onchange = (e) => { pref.set("volume", e.target.value); if (e.target.value === "always") volumeNow(); };
$("seabed-ex").addEventListener("input", () => placeLayers());
for (const id of ["fill-mode", "flow-layer"]) $(id).addEventListener("input", () => {
  saveFlow(); if (!model) return;
  if (flow) flow.spawnRef = F.layer().startsWith("res_") ? 0.15 : 1;
  applyFill(); lineT = -Infinity; fgrid?.cache.clear(); flow?.set(F.opts()); point?.setLayer(F.layer()); depthSlider(); vol3d(); showTime(timebar.t);
});
$("fill-op").addEventListener("input", () => { flowLabels(); saveFlow(); field?.setOpacity(+$("fill-op").value); vol3d(); stage.markDirty(); });
for (const id of ["show-parts", "show-lines", "density", "pspeed", "psize", "ptrail", "lwidth", "popac"]) $(id).addEventListener("input", () => {
  flowLabels(); saveFlow(); if (!flow) return; flow.set(F.opts()); p3?.set(p3Opts()); lineT = -Infinity; showTime(timebar.t);
});

// ---------- the API lessons (and tests) drive the page through ----------
function appApi() {
  const setSel = (id, v) => { if (v == null || $(id).value === String(v)) return; $(id).value = v; $(id).dispatchEvent(new Event("input")); };
  const setBox = (id, v) => { if (v == null || $(id).checked === v) return; $(id).checked = v; $(id).dispatchEvent(new Event("input")); };
  return {
    model,
    set({ view: v, fill, layer, parts, lines }) {
      if (v) { if (stage.is2D && !v.endsWith("-top")) set2D(false); goView(v); }
      setSel("flow-layer", layer); setSel("fill-mode", fill); setBox("show-parts", parts); setBox("show-lines", lines);
    },
    time(t) { timebar.set(t); },
    play(on, rate) { if (rate) { $("play-rate").value = String(rate); timebar.rate = rate; } if (timebar.playing !== on) timebar.play(on); },
    point(lat, lon) { const p = proj.toXY(lat, lon); point.open(p.x, p.y); passes?.close(); $("report").hidden = true; },
    locate(lat, lon) { const p = proj.toXY(lat, lon); return model.locate(p.x, p.y)?.e; },
    // The deep conveyor at Admiralty Inlet: its curtain, then parcels released across it (needs the volume).
    async conveyor() { await goCurtain("admiralty"); $("sc-release").click(); },
    get volumeMB() { return Math.round((model.meta.volume?.bytes || 0) / 1e6); },
    pass(kind, id) { passes.open(kind, id); },
    series(lat, lon) { const p = proj.toXY(lat, lon), hit = model.locate(p.x, p.y); return model.series(hit); },
    floodAt(lat, lon) { const p = proj.toXY(lat, lon), hit = model.locate(p.x, p.y); return model.phaseAt(hit.e).flood; },
    tz: region.tz,
    // The lab runs (spring / between / neap), switching to one (optionally at a lesson step), and their files.
    get labs() { return labSets; }, labBase: LAB,
    goLab(id, step = 0) { goSource(`lab:${id}`, { lesson: String(step) }); },
    closeCards() { point.close(); passes?.close(); $("report").hidden = true; },
  };
}

// ---------- shareable links ----------
// ?view=…&t=ISO&fill=…&at=…&pt=lat,lon&ps=basin:id|head:id&lesson=n&2d=1 — applied after the model loads.
function linkUrl() {
  const q = new URLSearchParams();
  if (view) q.set("view", view.id);
  if (timebar) q.set("t", new Date(Math.round(timebar.t / 60e3) * 60e3).toISOString().slice(0, 16) + "Z");
  q.set("fill", F.mode()); q.set("at", F.layer());
  if (point?.hit) { const ll = proj.toLatLon(point.x, point.y); q.set("pt", `${ll.lat.toFixed(4)},${ll.lon.toFixed(4)}`); }
  if (passes?.which && !$("passes").hidden) q.set("ps", passes.which.join(":"));
  if (lesson && !$("lesson").hidden) q.set("lesson", String(lesson.i));
  if (stage.is2D) q.set("2d", "1");
  if (SRC.startsWith("lab:")) q.set("lab", SRC.slice(4));
  return `${location.origin}${location.pathname}?${q}`;
}
$("link-btn").onclick = async () => {
  const u = linkUrl();
  try { await navigator.clipboard.writeText(u); $("link-btn").textContent = "✓ Copied"; } catch { prompt("Copy this link:", u); }
  setTimeout(() => { $("link-btn").textContent = "🔗 Link"; }, 1800);
};
function applyLink() {
  const q = new URLSearchParams(location.search), set = (id, v) => { if (v && [...$(id).options].some((o) => o.value === v && !o.disabled)) { $(id).value = v; $(id).dispatchEvent(new Event("input")); } };
  const at = q.get("at");
  if (/^d:\d+$/.test(at || "") && ![...$("flow-layer").options].some((o) => o.value === at)) { const o = $("opt-dcustom"); o.value = at; o.textContent = `${at.slice(2)} m down`; o.hidden = false; }
  set("flow-layer", at); set("fill-mode", q.get("fill"));
  if (q.get("2d") === "1") set2D(true);
  if (q.has("view")) goView(q.get("view"), { instant: true });
  if (q.get("pt")) { const [la, lo] = q.get("pt").split(",").map(Number); if (Number.isFinite(la) && Number.isFinite(lo)) { const p = proj.toXY(la, lo); point.open(p.x, p.y); } }
  if (q.get("ps") && passes) { const [k, id] = q.get("ps").split(":"); try { passes.open(k, id, { fly: !q.has("view") }); } catch {} }
  if (q.has("lesson") && lesson) lesson.open(Math.max(0, Math.min(lesson.steps.length - 1, +q.get("lesson") || 0)));
}

// ---------- area report ----------
function openReport() {
  const sub = region.subareas.find((q) => q.id === view?.sub);
  const r = report.build(sub ? sub.label : "The whole Salish Sea", sub ? sub.box : null, point?.units || "ft");
  $("rp-title").textContent = r.title;
  $("rp-body").innerHTML = r.items.map((it, i) => `<div class="rp-item"><h3>${it.head}<a data-i="${i}">map ›</a></h3>${it.html}</div>`).join("");
  for (const a of $("rp-body").querySelectorAll("a[data-i]")) a.onclick = () => {
    const it = r.items[+a.dataset.i];
    $("fill-mode").value = it.mode; $("fill-mode").dispatchEvent(new Event("input"));
    if (it.at != null) {
      const x = model.cx[it.at], y = model.cy[it.at];
      stage.flyTo(stage.framingFor({ center: { x, y }, span: 14, tilt: stage.is2D ? 0 : 40, az: 200 }, proj.box));
      point.open(x, y); $("report").hidden = false; $("point").hidden = true; point.marker.visible = true;
    }
  };
  $("report").hidden = false; $("point").hidden = true; passes?.close();
}

// The camera's view on the water (centre and size, km) for the particles and streamlines.
function viewBox() {
  const c = stage.controls.target, d = stage.camera.position.distanceTo(c), h = 2 * d * Math.tan((stage.camera.fov / 2) * Math.PI / 180);
  return { cx: c.x, cy: c.y, w: h * stage.camera.aspect, h };
}

// ---------- data sources: live and the lab ----------
let labSets = [];
// The lab runs, the default (the strongest-flow run, lab/index.json "default") first.
async function labIndex() {
  try {
    const r = await fetch(`${LAB}index.json`, { cache: "no-cache" }); if (!r.ok) return [];
    const d = await r.json(), sets = d.sets || [], k = sets.findIndex((s) => s.id === d.default);
    return k > 0 ? [sets[k], ...sets.slice(0, k), ...sets.slice(k + 1)] : sets;
  } catch { return []; }
}
// The lab runs' patterns and phase maps by tide (spring, neap, between), for the comparison maps
// (spring and neap) and the lesson's table (all three). Same mesh only. → {spring, neap, between?} or null
async function loadCompare() {
  const pick = (t) => labSets.find((s) => s.tide === t);
  if (!pick("spring") || !pick("neap")) return null;
  const out = {};
  for (const t of ["spring", "neap", "between"]) {
    if (!pick(t)) continue;
    const meta = await labMeta(pick(t)); if (!meta || meta.mesh !== model.meta.mesh) return null;
    const r = new Sscofs(meta, LAB); await Promise.all([r.loadPatterns(), r.loadPhase()]); out[t] = r;
  }
  return out;
}
async function labMeta(set) {
  try { const r = await fetch(LAB + set.meta, { cache: "no-cache" }); return r.ok ? await r.json() : null; } catch { return null; }
}
// Switch source: remembered, and the page reloads on it (a run is the page's whole state). extra: more URL params.
function goSource(v, extra = {}) {
  pref.set("src", v);
  const q = new URLSearchParams(location.search);
  q.delete("lab"); q.delete("live"); q.delete("t"); q.delete("lesson");
  if (v.startsWith("lab:")) q.set("lab", v.slice(4)); else q.set("live", "");
  for (const [k, x] of Object.entries(extra)) q.set(k, x);
  location.search = q.toString().replace(/=(&|$)/g, "$1");
}
function fillSources(cur) {
  const sel = $("src-select"); sel.innerHTML = "";
  sel.appendChild(Object.assign(document.createElement("option"), { value: "live", textContent: "Live forecast" }));
  for (const s of labSets) sel.appendChild(Object.assign(document.createElement("option"), { value: `lab:${s.id}`, textContent: `Lab · ${s.label}` }));
  sel.value = cur; $("src-row").hidden = !labSets.length;
  sel.onchange = () => goSource(sel.value);
  document.body.classList.toggle("lab-on", cur.startsWith("lab:"));
}

// Which run to show: the one already kept on this device if it's complete (no download), with a
// "newer run" chip when the server has a newer one; else the newest.
async function chooseRun() {
  const latest = await Sscofs.latest(DATA);
  const tagOf = (m) => m.t1.file.split("/")[0];
  const lastTag = pref.get("run", null), lastMeta = lastTag ? pref.get(`meta.${lastTag}`, null) : null;
  if (!latest) return lastMeta;                                     // offline: whatever is kept
  if (lastMeta && tagOf(latest) !== lastTag) {
    const kept = await keptRuns();
    if ((kept[lastTag] || 0) >= lastMeta.leads.length) {
      const hrs = (Date.parse(latest.cycle) - Date.parse(lastMeta.cycle)) / 3600e3, mb = Math.round(latest.t1.bytes / 1e6);
      $("newer").hidden = false;
      $("newer").textContent = `Newer run: ${latest.cycle.slice(11, 13)}Z ${latest.cycle.slice(5, 10)} (+${Math.round(hrs)} h) · load ${mb} MB`;
      $("newer").title = `You're looking at the run kept on this device (${lastMeta.cycle.slice(0, 13)}Z). Load the newer one?`;
      $("newer").onclick = () => { pref.set("run", tagOf(latest)); location.reload(); };
      return lastMeta;
    }
  }
  return latest;
}

async function loadModel() {
  status("looking for the latest SSCOFS run…");
  labSets = await labIndex();
  let src = SRC, set = null;
  if (src.startsWith("lab:")) {
    set = labSets.find((s) => s.id === src.slice(4)) || labSets[0];
    if (!set) src = "live";                                         // (no lab published: live)
    else src = `lab:${set.id}`;
  }
  fillSources(src);
  const lab = set ? await labMeta(set) : null;
  if (set && !lab) { dataState = { kind: "failed", msg: `lab run ${set.label} didn't load` }; }
  const meta = set ? lab : await chooseRun();
  try { model = meta && await Sscofs.open(set ? LAB : DATA, proj, meta); } catch (e) { model = null; console.error(e); dataState = { kind: "failed", msg: e.message }; }
  if (model) model.isLab = !!set;
  // Live: the newest lab run's phase map and patterns (tidal timing, same mesh).
  if (model && !set && labSets[0] && (!model.meta.phase || !model.meta.patterns)) model.borrowFrom(await labMeta(labSets[0]), LAB);
  $("src-note").hidden = !model || !labSets.length;
  if (model) $("src-note").innerHTML = model.isLab
    ? `<b>Lab run</b> ${model.meta.lab?.label || ""}: a whole model run kept for exploring — every depth, the depth-averaged current, the basin and pass charts and the lesson. ${model.meta.lab?.note || ""}`
    : `<b>Live</b>: today's forecast — surface current and tide.${model.borrowed ? ` Pattern maps come from the lab run (${model.borrowed}).` : ""} For depths, the depth-averaged current, basins &amp; passes and the lesson, pick a <b>Lab</b> run.`;
  if (!model) {
    dataState ||= { kind: "absent" };
    status(dataState.kind === "failed" ? `couldn't load the model data (${dataState.msg})` : "no model run published yet", true);
    showDataState(); return;
  }
  timebar = new TimeBar({ tz: region.tz, onChange: showTime });
  const mb = (model.meta.t1.bytes / 1e6).toFixed(0);
  await model.loadTier1((done, n) => status(`loading the tide: hour ${done} of ${n} (${mb} MB)…`));
  await Promise.all([model.loadPhase(), model.loadPatterns()]);
  model.compare = await loadCompare().catch(() => null);
  // Keep this run on the device (the live one, and the lab runs).
  if (!model.isLab) {
    pref.set("run", model.tag); pref.set(`meta.${model.tag}`, model.meta);
    try { for (const k of Object.keys(localStorage)) if (k.startsWith("ssfe.meta.") && k !== `ssfe.meta.${model.tag}`) localStorage.removeItem(k); } catch {}
  }
  pruneRuns([model.tag, pref.get("run", null), ...labSets.map((s) => s.id)].filter(Boolean));
  // The volume is unpacked hour by hour as needed: redraw when an hour arrives.
  model.onVolume = () => { clearTimeout(model._vt); model._vt = setTimeout(() => { if (F.layer().startsWith("d:") || slabs?.group.visible || p3?.group.visible) { field.keyA = field.keyB = null; slabs?.redraw(); p3?.invalidate(); fgrid.cache.clear(); lineT = -Infinity; showTime(timebar.t); } }, 30); };
  fillModes(); gateLayers();
  field = new MeshField(model, proj.box);
  if (model.phase) field.setFlood(model.phase);
  stage.scene.add(field.group);
  status("placing the currents on the water…");
  await new Promise((r) => setTimeout(r, 0));
  fgrid = new FlowGrid(model, proj.box, ground.meta.terrain.dxy, ground.mask);
  flow = new CurrentFlow(); flow.set(F.opts());
  stage.scene.add(flow.group);
  let lastNow = performance.now(); const lastView = {};
  stage.onFrame.push((now) => {
    const dt = (now - lastNow) / 1000; lastNow = now;
    const moved = timebar.tick(now);
    const v = viewBox(); flow.setView(v.cx, v.cy, v.w, v.h);
    // Zoomed in, the particles get a finer grid of the view (model/flowgrid.js) once it settles.
    const vk = `${v.cx.toFixed(2)},${v.cy.toFixed(2)},${v.w.toFixed(2)}`;
    if (vk !== lastView.k) Object.assign(lastView, { k: vk, at: now, done: false });
    else if (!lastView.done && now - lastView.at > 300) {
      lastView.done = true; if (fgrid.useView(v)) { lineT = -Infinity; showTime(timebar.t); }
      if (p3?.group.visible) { const n3 = p3.useView(v); p3.setTime(timebar.t); if (n3 || $("vol3d-note").textContent.startsWith("3D particles")) { $("vol3d-note").hidden = !n3; $("vol3d-note").textContent = n3; } }
    }
    const a = flow.step(dt), b = p3?.step(dt);
    return a || b || moved;
  });
  stage.on2D = (on) => { field.setFlat(on); placeLayers(); };
  section = new SectionPanel({ timebar, tz: region.tz });
  $("pt-trace").hidden = !model.isLab;
  if (stage.is2D) stage.on2D(true);
  const made = new Date(model.meta.made), cyc = model.cycle;
  timebar.setRange(model.t0, model.t1, `${model.isLab ? "Lab · " : ""}${model.label} · out to +${model.leads.at(-1)} h`);
  const net = Math.round(counters.network / 1e6), dev = Math.round(counters.device / 1e6);
  $("run-note").innerHTML = `Model run <b>${model.label}</b> (NOAA SSCOFS), ${model.N.toLocaleString()} mesh points; processed ${made.toISOString().slice(0, 16).replace("T", " ")} UTC. `
    + (dev > net ? `Loaded from this device (${dev} MB) — nothing downloaded again.` : net ? `Downloaded ${net} MB; kept on this device for next time.` : "");
  $("flow-grp").hidden = false;
  $("vol-pref").value = pref.get("volume", "ask");
  if (model.meta.volume && $("vol-pref").value === "always") volumeNow();
  else if (model.meta.volume && $("vol-pref").value === "ask") volumeBox(true);
  applyFill(); depthSlider();
  point = new PointPanel({ stage, model, proj, ground, timebar, tz: region.tz, layer: F.layer() });
  loadNoaa();
  // A click (not a drag) on the water opens the point analyzer there.
  let down = null;
  stage.renderer.domElement.addEventListener("pointerdown", (e) => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; });
  stage.renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const cid = curtainAt(e); if (cid) { openSection(cid); return; }
    const p = pick(e); if (p && point.open(p.x, p.y)) { passes?.close(); $("report").hidden = true; section.close(); }
  });
  if (!model.isLab && labSets.length) {
    $("ps-grp").hidden = false;
    $("ps-list").innerHTML = `<div class="note">Basin and pass charts use a whole run's every layer: they're in the Lab.</div><button class="btn" id="ps-tolab">Open the Lab (${labSets[0].label})</button>`;
    $("ps-tolab").onclick = () => goSource(`lab:${labSets[0].id}`);
  }
  const hasPasses = await model.loadPasses();
  curtainButtons();
  if (hasPasses) {
    passes = new PassPanel({ stage, model, proj, timebar, tz: region.tz, units: point.units,
      onFly: (pts) => {
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const span = Math.max(8, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.15;
        stage.flyTo(stage.framingFor({ center: { x: cx, y: cy }, span, tilt: stage.is2D ? 0 : 35, az: 200 }, proj.box));
      } });
    $("ps-units").value = point.units;
    const syncUnits = (u) => { $("ps-units").value = $("pt-units").value = u; point.units = u; try { localStorage.setItem("ssfe.units", u); } catch {} point.hit && point.refresh(); passes.setUnits(u); };
    $("ps-units").onchange = (e) => syncUnits(e.target.value);
    $("pt-units").onchange = (e) => syncUnits(e.target.value);
    $("ps-grp").hidden = false;
  }
  // Area reports (the flow analyzer in words).
  if (model.patterns && model.phase) {
    if (model.borrowed) $("report").querySelector(".pt-head .note").textContent = `From the lab run ${model.borrowed} (tidal patterns change little from week to week) · each “map ›” shows it in colour`;
    const places = await fetch("data/places.json").then((r) => (r.ok ? r.json() : { places: [] })).catch(() => ({ places: [] }));
    model.regionBox = region.bbox;
    report = new AreaReport(model, places.places);
    $("report-btn").hidden = false;
    $("report-btn").onclick = () => openReport();
    $("rp-close").onclick = () => { $("report").hidden = true; };
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape") { point.close(); passes?.close(); section.close(); $("report").hidden = true; } });
  // The guided lesson (timed to a lab run's own hours: on live, the button opens the lab).
  if (!model.isLab && labSets.length) {
    $("lesson-btn").hidden = false;
    $("lesson-btn").title = `The guided lesson runs on the lab run (${labSets[0].label})`;
    $("lesson-btn").onclick = () => goSource(`lab:${labSets[0].id}`, { lesson: "0" });
  }
  if (model.passes && model.patterns && model.phase) {
    lesson = new Lesson(appApi());
    $("lesson-btn").hidden = false;
    $("lesson-btn").onclick = () => { $("welcome").hidden = true; lesson.open(0); };
    if (!pref.get("welcomed", false) && !new URLSearchParams(location.search).has("debug")) {
      $("welcome").hidden = false;
      const done = () => { $("welcome").hidden = true; pref.set("welcomed", true); };
      $("wl-go").onclick = () => { done(); lesson.open(0); };
      $("wl-no").onclick = done;
    }
  }
  addEventListener("resize", () => point.draw());
  const q = new URLSearchParams(location.search).get("t");
  if (q) timebar.set(Date.parse(q)); else timebar.now();
  stage.updateViewOffset();
}

// ---------- is the data fresh? (absent / failed / stale: CLAUDE.md's three states) ----------
let dataState = null;
async function checkData() {
  let st = null;
  try { const r = await fetch(new URL("../status.json", new URL(DATA, location.href)), { cache: "no-cache" }); st = r.ok ? await r.json() : null; } catch { /* local runs have no status.json */ }
  const age = model && !model.isLab ? (Date.now() - model.cycle.getTime()) / 3600e3 : null, lim = st?.staleHours || 30;
  if (model?.isLab) dataState = { kind: "ok", st };                  // (a lab run is old on purpose)
  else if (st?.failuresInARow > 0) dataState = { kind: "failing", msg: st.lastAttempt?.message || "", since: st.lastSuccess, st };
  else if (age != null && age > lim) dataState = { kind: "stale", msg: `the model run is ${Math.round(age)} h old`, st };
  else dataState = model ? { kind: "ok", st } : dataState;
  showDataState();
}
function showDataState() {
  const d = dataState || {}, w = $("data-warn");
  const text = d.kind === "absent" ? "No model run has been published yet."
    : d.kind === "failed" ? `Couldn't load the model data: ${d.msg}.`
    : d.kind === "failing" ? `The data runner has failed ${d.st.failuresInARow} time(s) in a row (last good run ${d.since ? d.since.slice(0, 16).replace("T", " ") + " UTC" : "—"}). Showing the last good data. Last error: ${d.msg}`
    : d.kind === "stale" ? `Stale: ${d.msg}. The data runner may have stopped.` : "";
  w.hidden = !text; w.textContent = { failing: "⚠ Data runner failing", stale: "⚠ Old data", absent: "⚠ No data", failed: "⚠ Data didn't load" }[d.kind] || "⚠";
  w.title = text;
  w.onclick = () => { $("about-grp").open = true; $("about-grp").scrollIntoView({ behavior: "smooth" }); };
  const st = d.st;
  $("data-status").innerHTML = (text ? `<b class="caution">${text}</b><br>` : "")
    + (model ? (model.isLab ? `Lab run: <b>${model.label}</b> (${model.meta.lab?.label || ""}) with the full volume.` : `Live data: <b>${model.label}</b>, surface current and tide${model.borrowed ? `; pattern maps from the lab run ${model.borrowed}` : ""}.`) : "")
    + (st ? ` Data runner last ran ${st.lastAttempt?.at?.slice(0, 16).replace("T", " ")} UTC (${st.lastAttempt?.result}). <a href="${new URL("..", new URL(DATA, location.href))}" target="_blank" rel="noopener">Data status page ↗</a>` : "");
}

// ---------- panel groups remember open/closed ----------
for (const d of document.querySelectorAll("details.grp")) {
  const k = `open.${d.id}`, v = pref.get(k, null);
  if (v != null) d.open = v;
  d.addEventListener("toggle", () => pref.set(k, d.open));
}
$("store-clear").onclick = async () => { await clearKept(); $("store-note").textContent = "Cleared: the next visit downloads the run again."; };
async function storeNote() {
  const i = await storeInfo(), kept = await keptRuns(), n = Object.values(kept).reduce((a, q) => a + q, 0);
  $("store-note").textContent = `Kept on this device: ${n} model files${i ? ` (${i.usedMB} MB used of ${i.quotaMB.toLocaleString()} MB allowed)` : ""}.`;
}

// ---------- start ----------
async function start() {
  status("loading the region…");
  region = await fetch("data/region.json").then((r) => r.json());
  proj = new Projection(region);
  views = regionViews(region, proj);
  fillViews();
  restoreGround(); labels(); depthKey(); restoreFlow(); flowLabels();
  status("loading land and seabed…");
  if (!(await ground.load())) { status("ground layers not built (pipeline.ground)", true); return; }
  if (!ground.hasPhoto) {
    for (const id of ["land-style", "water-style"]) { const o = $(id).querySelector('option[value="photo"]'); o.disabled = true; o.textContent += " (not built yet)"; if ($(id).value === "photo") $(id).value = id === "land-style" ? "relief" : "sea"; }
  }
  await ground.buildLand(G.land()); ground.buildSeabed(G.seabed()); await ground.buildWater(G.water());
  const s = ground.meta.seabed;
  $("ground-note").innerHTML = s ? `Seabed: survey depths — NOAA's DEM in US waters, CHS NONNA in Canadian waters — cover ${Math.round(((s.sources.cudem || 0) + (s.sources.nonna || 0) + (s.sources.blend || 0)) * 100)} % of the water; the open coast and shelf use the model's own depth.` : "";
  $("credits").textContent = ground.credits().join(" ");
  await goView(new URLSearchParams(location.search).get("view") || homeView(region), { instant: true });
  if (pref.get("2d", false)) set2D(true);
  await loadModel();
  if (model) { status(""); applyLink(); }
  checkData();
  setInterval(checkData, 30 * 60e3);                                 // (a page left open notices a newer or stalled run)
  storeNote();
}
start().catch((e) => { console.error(e); status(`failed: ${e.message}`, true); });

if (new URLSearchParams(location.search).has("debug")) window.ssfe = { stage, ground, get model() { return model; }, get field() { return field; }, get flow() { return flow; }, get timebar() { return timebar; }, get point() { return point; }, get passes() { return passes; }, get lesson() { return lesson; }, get proj() { return proj; }, get curtains() { return curtains; }, get slabs() { return slabs; }, get section() { return section; }, get stations() { return stations; }, get p3() { return p3; }, get paths() { return paths; }, get exch() { return exch; }, openSection, goCurtain, get views() { return views; }, goView, set2D };
