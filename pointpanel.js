// The point analyzer: click the water → a meteogram of the whole run at that spot.
//
//   top     water level (ft or m), high and low waters marked with their times and heights
//   bottom  the current along the local flood direction (flood +, ebb −; kt), slack and max
//           flood/ebb marked, each slack labelled with its offset from the nearest HW/LW
//   both    the time on screen (a line; click the chart to move it), local time axis
//
// The summary says what the spot does: the median slack offset after HW and after LW, the run's
// tidal timing from the phase map (standing / progressive / between), the flood direction.
// Events come from model/events.js on the hourly series (times to minutes by parabola).

import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { extrema, slacks, maxima, pairUp, fmtOffset } from "./model/events.js?v=20261005223557";
import { compass } from "./shell/views.js?v=20261005223557";
import { stationSpeed } from "./model/stations.js?v=20261005223557";
import { tideHeight } from "./model/tides.js?v=20261005223557";

// The model's water level sits 0.40 m above NOAA's MSL-referenced predictions (4 gauges × 3 runs,
// RESEARCH_LOG 2026-10-05). Where a gauge's datums are known, the model is put on MLLW with this
// fixed offset — so a real difference (weather, rivers, forecast error) stays visible.
const MODEL_ABOVE_MSL = 0.40;
const OBS_API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

const $ = (id) => document.getElementById(id);
const FT = 3.28084;

export class PointPanel {
  constructor({ stage, model, proj, ground, timebar, tz, layer }) {
    Object.assign(this, { stage, model, proj, ground, timebar, tz, layer });
    this.el = $("point"); this.cv = $("pt-chart");
    this.units = (() => { try { return localStorage.getItem("ssfe.units") || "ft"; } catch { return "ft"; } })();
    $("pt-units").value = this.units;
    $("pt-units").onchange = (e) => { this.units = e.target.value; try { localStorage.setItem("ssfe.units", this.units); } catch {} this.refresh(); };
    $("pt-close").onclick = () => this.close();
    this.cv.addEventListener("click", (e) => { const t = this.timeAtX(e.offsetX); if (t) this.timebar.set(t); });
    this.cv.addEventListener("pointermove", (e) => { this.hoverT = this.timeAtX(e.offsetX); this.draw(); });
    this.cv.addEventListener("pointerleave", () => { this.hoverT = null; this.draw(); });
    this.fmtT = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
    this.fmtD = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", day: "numeric" });
    this.stations = [];                                              // NOAA stations (model/stations.js), with scene x, y
    const ring = document.createElement("div"); ring.className = "pt-ring";
    this.marker = new CSS2DObject(ring); this.marker.visible = false;
    stage.scene.add(this.marker);
  }

  open(x, y) {
    const hit = this.model.locate(x, y);
    if (!hit) return false;
    this.hit = hit; this.x = x; this.y = y;
    this.marker.position.set(x, y, 0.02); this.marker.visible = true;
    this.el.hidden = false;
    this.refresh();
    this.stage.markDirty();
    return true;
  }

  close() { this.el.hidden = true; this.hit = null; this.marker.visible = false; this.stage.markDirty(); }

  setLayer(layer) { this.layer = layer; if (this.hit) this.refresh(); }
  setStations(list) { this.stations = list || []; if (this.hit) this.refresh(); }
  setTides(list) { this.tides = list || []; if (this.hit) this.refresh(); }

  refresh() {
    const m = this.model, hit = this.hit, s = m.series(hit), ph = m.phaseAt(hit.e);
    const ll = this.proj.toLatLon(this.x, this.y), g = this.ground.sample(this.x, this.y);
    // The nearest NOAA station within 1 km: its predicted current over the run (every 10 min), beside
    // the model's — measured along NOAA's own flood direction, so both curves share one axis (the
    // model's timing rule can point the other way in short passes: guide §10).
    let st = null, sd = 1.0;
    for (const q of this.stations) { const d = Math.hypot(q.x - this.x, q.y - this.y); if (d < sd) { sd = d; st = q; } }
    const flood = st ? st.flood : ph ? ph.flood : null, fr = flood == null ? null : flood * Math.PI / 180;
    const [U, V] = this.layer === "davg" || this.layer === "res_d" ? [s.ua, s.va] : [s.us, s.vs];      // (depth slices: the surface series here)
    const along = U.map((u, i) => fr == null ? Math.hypot(u, V[i]) : u * Math.sin(fr) + V[i] * Math.cos(fr));
    const speed = U.map((u, i) => Math.hypot(u, V[i]));
    const ex = extrema(s.t, s.zeta), sl = pairUp(slacks(s.t, along), ex), mx = maxima(s.t, along);
    const noaa = st ? (() => { const t = []; for (let u = s.t[0]; u <= s.t.at(-1); u += 600e3) t.push(u); return { st, km: sd, t, v: t.map((u) => stationSpeed(st, u)) }; })() : null;
    // The nearest NOAA tide station within 3 km: its predicted tide (MLLW) every 10 min; the model's
    // level is shifted to NOAA's mean over the run (its own zero sits ~0.4 m below MSL: RESEARCH_LOG).
    let ts = null, td = 3.0;
    for (const q of this.tides || []) { const d = Math.hypot(q.x - this.x, q.y - this.y); if (d < td) { td = d; ts = q; } }
    let tide = null;
    if (ts) {
      const t = []; for (let u = s.t[0]; u <= s.t.at(-1); u += 600e3) t.push(u);
      const h = t.map((u) => tideHeight(ts, u)), zf = s.zeta.filter(Number.isFinite), nm = s.t.map((u) => tideHeight(ts, u)).reduce((a, q) => a + q, 0) / s.t.length;
      const fixed = ts.msl != null, shift = fixed ? ts.msl - MODEL_ABOVE_MSL : zf.length ? nm - zf.reduce((a, q) => a + q, 0) / zf.length : 0;
      const evs = ts.ev.filter((e) => e.t >= s.t[0] && e.t <= s.t.at(-1)), dt = [];
      for (const e of ex) { const n = evs.filter((q) => (q.hl === "H") === (e.kind === "HW")).sort((p, q) => Math.abs(p.t - e.t) - Math.abs(q.t - e.t))[0]; if (n && Math.abs(n.t - e.t) < 3 * 3600e3) dt.push((e.t - n.t) / 60e3); }
      const med = dt.length ? [...dt].sort((p, q) => p - q)[Math.floor(dt.length / 2)] : null;
      tide = { st: ts, km: td, t, h, shift, fixed, evs, med, rangeN: Math.max(...h) - Math.min(...h), rangeM: zf.length ? Math.max(...zf) - Math.min(...zf) : null };
      if (ts.realtime) this.loadObs(ts, s);                           // (async: redraws when it arrives)
    }
    this.data = { s, along, speed, ex, sl, mx, noaa, tide };
    // Header and summary.
    const depth = m.h[hit.nodes[0]] / 10;
    $("pt-title").textContent = `${Math.abs(ll.lat).toFixed(4)}° N, ${Math.abs(ll.lon).toFixed(4)}° W`;
    $("pt-sub").textContent = `model depth ${Math.round((m.h[hit.nodes[0]] * hit.w[0] + m.h[hit.nodes[1]] * hit.w[1] + m.h[hit.nodes[2]] * hit.w[2]) / 10)} m`
      + (g?.depthM != null ? ` · survey ${Math.round(g.depthM)} m` : "") + (flood != null ? ` · flood sets ${Math.round(flood)}° (${compass(flood)})${st ? ", NOAA's" : ""}` : "")
      + ` · ${this.layer === "davg" || this.layer === "res_d" ? "depth-averaged" : "surface"} current`;
    const med = (a) => { const b = [...a].sort((p, q) => p - q); return b.length ? b[Math.floor(b.length / 2)] : null; };
    const afterHW = med(sl.filter((q) => q.ref?.kind === "HW").map((q) => q.offset)), afterLW = med(sl.filter((q) => q.ref?.kind === "LW").map((q) => q.offset));
    let html = "";
    if (afterHW != null || afterLW != null) {
      html += `Slack here: ${afterHW != null ? `<b>${fmtOffset(afterHW, "HW")}</b>` : ""}${afterHW != null && afterLW != null ? ", " : ""}${afterLW != null ? `<b>${fmtOffset(afterLW, "LW")}</b>` : ""} (median of ${sl.length} in this run). `;
    }
    if (ph?.ok) {
      const lag = Math.abs(ph.lag), kind = lag < 0.75 ? "a <b>standing</b> wave: the water stops turning when it stops rising or falling" : lag > 2.25
        ? "a <b>progressive</b> wave: the current runs hardest at high and low water and turns near half-tide" : "<b>between</b> standing and progressive";
      html += `Twice-daily (M2) tide: slack ${lag.toFixed(1)} h from HW/LW — ${kind}. Tidal current M2 ${ph.cur_m2.toFixed(1)} kt, daily K1 ${ph.cur_k1.toFixed(1)} kt; range M2 ${(2 * ph.zeta_m2 * (this.units === "ft" ? FT : 1)).toFixed(1)} ${this.units}, K1 ${(2 * ph.zeta_k1 * (this.units === "ft" ? FT : 1)).toFixed(1)} ${this.units}.`;
    } else if (ph) html += `The tidal current here is too weak (or the spot dries) for slack timing to mean much.`;
    if (noaa) {
      const pk = (a, sgn) => Math.max(0, ...a.map((v) => v * sgn)), nf = pk(noaa.v, 1), ne = pk(noaa.v, -1), mf = pk(along, 1), me = pk(along, -1);
      const k = noaa.st.skill, pct = (m, n) => n >= 0.3 ? `${Math.round((m / n) * 100)} %` : "—";
      html += `<div class="pt-noaa"><b>NOAA prediction</b> (dashed) at ${noaa.st.name}${noaa.km > 0.15 ? `, ${noaa.km.toFixed(1)} km away` : ""}: peaks this run up to <b>${nf.toFixed(1)} kt flood</b>, <b>${ne.toFixed(1)} kt ebb</b>. The model here: ${mf.toFixed(1)} kt flood (${pct(mf, nf)}), ${me.toFixed(1)} kt ebb (${pct(me, ne)}).`
        + (k?.flag === "under" ? ` <b class="caution">The model is too weak here</b> — this pass is narrower than its mesh can resolve; use NOAA's figures.` : k?.flag === "over" ? ` <b class="caution">The model runs stronger than NOAA here.</b>` : "")
        + ` NOAA's are tidal predictions (no wind or river flow).</div>`;
    }
    if (tide) {
      const k = this.units === "ft" ? FT : 1, u = this.units, hi = Math.max(...tide.evs.filter((e) => e.hl === "H").map((e) => e.h)), lo = Math.min(...tide.evs.filter((e) => e.hl === "L").map((e) => e.h));
      html += `<div class="pt-noaa"><b>NOAA tide</b> (dashed, above MLLW as in tide tables) at ${tide.st.name}${tide.km > 0.3 ? `, ${tide.km.toFixed(1)} km away` : ""}: highs up to <b>${(hi * k).toFixed(1)} ${u}</b>, lows down to <b>${(lo * k).toFixed(1)} ${u}</b> this run. The model's range here: ${tide.rangeM != null ? `${(tide.rangeM * k).toFixed(1)} ${u} against NOAA's ${(tide.rangeN * k).toFixed(1)}` : "—"}${tide.med != null ? `; its high and low waters come ${Math.abs(Math.round(tide.med))} min ${tide.med >= 0 ? "later" : "earlier"} (median)` : ""}. ${tide.fixed ? `The model's curve is put on MLLW with its datum offset (its zero sits ${MODEL_ABOVE_MSL} m below mean sea level), so differences here are real.` : `The model's curve is shifted ${(tide.shift * k).toFixed(1)} ${u} to NOAA's mean level (no datums published for this station).`}</div>`
        + (tide.st.realtime ? `<div class="pt-noaa" id="pt-obs">${this.obsNote(tide)}</div>` : "");
    }
    $("pt-sum").innerHTML = html;
    // (NOAA's curves in the legend rather than on the chart, where they collided with the HW/LW labels)
    const nm = [tide && `tide at ${tide.st.name}`, noaa && `current at ${noaa.st.name}`].filter(Boolean);
    $("pt-legend-noaa").innerHTML = (nm.length ? `<span class="sw noaa"></span>NOAA ${nm.join(", ")}` : "") + (tide?.st.realtime ? ` <span class="sw obs"></span>observed` : "");
    this.draw();
  }

  // ---------- NOAA's observed water level (real-time gauges; the API allows browsers) ----------
  // absent: no readings in the run's span yet; failed: the request didn't work. One request a gauge and run.
  async loadObs(st, s) {
    const key = `${st.id}|${s.t[0]}`;
    if (this.obsKey === key) return;
    this.obsKey = key; this.obs = { state: "loading" };
    const f = (t) => new Date(t).toISOString().slice(0, 16).replace(/-/g, "").replace("T", " "), end = Math.min(Date.now(), s.t.at(-1));
    try {
      if (end <= s.t[0]) throw Object.assign(new Error("the run hasn't started yet"), { absent: true });
      const q = new URLSearchParams({ product: "water_level", station: st.id, begin_date: f(s.t[0]), end_date: f(end), datum: "MLLW", units: "metric", time_zone: "gmt", format: "json", application: "salish-sea-flow-explorer" });
      const j = await fetch(`${OBS_API}?${q}`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
      const d = (j.data || []).filter((x) => x.v !== "");
      if (!d.length) throw Object.assign(new Error(j.error?.message || "no readings"), { absent: true });
      this.obs = { state: "ok", t: d.map((x) => Date.parse(x.t.replace(" ", "T") + ":00Z")), h: d.map((x) => +x.v) };
    } catch (e) { this.obs = { state: e.absent ? "absent" : "failed", msg: e.message }; }
    if (this.obsKey !== key || !this.hit) return;
    const el = document.getElementById("pt-obs"); if (el && this.data?.tide) el.innerHTML = this.obsNote(this.data.tide);
    this.draw();
  }
  obsNote(T) {
    const o = this.obs, k = this.units === "ft" ? FT : 1, u = this.units, s = this.data?.s;
    if (!o || o.state === "loading") return "<b>Observed</b> (NOAA, real time): loading…";
    if (o.state === "absent") return `<b>Observed</b>: none for this run yet (${o.msg}).`;
    if (o.state === "failed") return `<b>Observed</b>: couldn't load NOAA's readings (${o.msg}).`;
    const zAt = (t) => { const f = (t - s.t[0]) / 3600e3, i = Math.max(0, Math.min(s.t.length - 2, Math.floor(f))), w = f - i; return s.zeta[i] * (1 - w) + s.zeta[i + 1] * w + T.shift; };
    const n = o.t.length, tl = o.t[n - 1], hl = o.h[n - 1], pl = tideHeight(T.st, tl), ml = zAt(tl);
    const d = o.t.map((t, i) => zAt(t) - o.h[i]).filter(Number.isFinite), mean = d.reduce((a, b) => a + b, 0) / d.length, rms = Math.sqrt(d.reduce((a, b) => a + b * b, 0) / d.length);
    const hrs = (tl - o.t[0]) / 3600e3, sg = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v * k).toFixed(1)} ${u}`;
    return `<b>Observed</b> (NOAA, black): ${tl > Date.now() - 2 * 3600e3 ? "now" : "at the end of the run"} <b>${(hl * k).toFixed(1)} ${u}</b> — <b>${sg(hl - pl)}</b> against the tide table (wind, pressure, rivers). The model had forecast ${sg(ml - pl)}. Over the ${Math.round(hrs)} h observed, model − observed averages ${sg(mean)} (rms ${(rms * k).toFixed(1)} ${u}).`;
  }

  // ---------- chart ----------
  timeAtX(px) { const L = this.layout; if (!L) return null; return L.t0 + ((px - L.x0) / (L.x1 - L.x0)) * (L.t1 - L.t0); }

  draw() {
    if (!this.data || this.el.hidden) return;
    const cv = this.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement), col = (v) => css.getPropertyValue(v).trim();
    const ink = col("--ink"), soft = col("--ink-soft"), grid = col("--grid"), hwc = col("--hw"), fl = col("--flood"), eb = col("--ebb"), slc = col("--slack");
    const { s, along, ex, sl, mx } = this.data, k = this.units === "ft" ? FT : 1;
    // Labels that would overlap one already drawn are left out (hover shows everything).
    const placed = [];
    const label = (txt, x, y, color, align = "center") => {
      const w = c.measureText(txt).width + 4, l = align === "center" ? x - w / 2 : x;
      if (placed.some((p) => l < p.r && l + w > p.l && Math.abs(y - p.y) < 11)) return;
      placed.push({ l, r: l + w, y }); c.fillStyle = color; c.textAlign = align; c.fillText(txt, x, y);
    };
    const x0 = 38, x1 = W - 8, t0 = s.t[0], t1 = s.t.at(-1), X = (t) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
    this.layout = { x0, x1, t0, t1 };
    const panels = [{ y0: 26, y1: H * 0.42 }, { y0: H * 0.52, y1: H - 22 }];
    c.font = "10px ui-monospace, Menlo, monospace"; c.textBaseline = "middle";
    // Days and 6-hourly ticks (local).
    for (let t = Math.ceil(t0 / 3600e3) * 3600e3; t <= t1; t += 3600e3) {
      const hh = +this.fmtT.format(new Date(t)).slice(0, 2);
      if (hh % 6) continue;
      c.strokeStyle = grid; c.lineWidth = hh === 0 ? 1.2 : 0.5;
      c.beginPath(); c.moveTo(X(t), panels[0].y0); c.lineTo(X(t), panels[1].y1); c.stroke();
      c.fillStyle = soft; c.textAlign = "center";
      c.fillText(hh === 0 ? this.fmtD.format(new Date(t)) : `${String(hh).padStart(2, "0")}`, X(t), H - 9);
    }
    const series = (P, vals, lo, hi, stroke, fill) => {
      const Y = (v) => P.y1 - ((v - lo) / (hi - lo)) * (P.y1 - P.y0);
      if (fill) {                                                  // flood/ebb shading about zero
        for (const [sign, fc] of [[1, fill[0]], [-1, fill[1]]]) {
          c.beginPath(); c.moveTo(X(s.t[0]), Y(0));
          s.t.forEach((t, i) => c.lineTo(X(t), Y(sign > 0 ? Math.max(0, vals[i]) : Math.min(0, vals[i]))));
          c.lineTo(X(s.t.at(-1)), Y(0)); c.closePath(); c.fillStyle = fc; c.globalAlpha = 0.28; c.fill(); c.globalAlpha = 1;
        }
      }
      c.beginPath(); let pen = false;
      s.t.forEach((t, i) => { const v = vals[i]; if (!Number.isFinite(v)) { pen = false; return; } pen ? c.lineTo(X(t), Y(v)) : c.moveTo(X(t), Y(v)); pen = true; });
      c.strokeStyle = stroke; c.lineWidth = 1.8; c.stroke();
      return Y;
    };
    const axis = (P, lo, hi, step, unit) => {
      c.fillStyle = soft; c.textAlign = "right";
      const Y = (v) => P.y1 - ((v - lo) / (hi - lo)) * (P.y1 - P.y0);
      for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
        c.strokeStyle = grid; c.lineWidth = Math.abs(v) < 1e-9 ? 1 : 0.4; c.beginPath(); c.moveTo(x0, Y(v)); c.lineTo(x1, Y(v)); c.stroke();
        c.fillText(`${+v.toFixed(1)}`, x0 - 4, Y(v));
      }
      c.textAlign = "left"; c.fillText(unit, 2, P.y0 - 8);
    };
    // Level.
    const T = this.data.tide, z = s.zeta.map((v) => (v + (T ? T.shift : 0)) * k), zf = z.filter(Number.isFinite).concat(T ? T.h.map((v) => v * k) : []);
    if (zf.length) {
      let lo = Math.min(...zf), hi = Math.max(...zf); const pad = (hi - lo) * 0.18 || 1; lo -= pad; hi += pad;
      const step = this.units === "ft" ? (hi - lo > 12 ? 4 : 2) : (hi - lo > 4 ? 1 : 0.5);
      axis(panels[0], lo, hi, step, T ? `${this.units} above MLLW` : `level ${this.units}`);
      const Y = series(panels[0], z, lo, hi, hwc);
      if (T) {                                                      // NOAA's tide, dashed
        c.beginPath(); T.t.forEach((t, i) => (i ? c.lineTo(X(t), Y(T.h[i] * k)) : c.moveTo(X(t), Y(T.h[i] * k))));
        c.strokeStyle = col("--caution"); c.lineWidth = 1.5; c.setLineDash([5, 3]); c.stroke(); c.setLineDash([]);
        const o = this.obs;
        if (o?.state === "ok" && T.st.realtime) {                    // NOAA's observed level, solid ink
          c.beginPath(); let pen = false;
          o.t.forEach((t, i) => { if (t < t0 || t > t1) { pen = false; return; } pen ? c.lineTo(X(t), Y(o.h[i] * k)) : c.moveTo(X(t), Y(o.h[i] * k)); pen = true; });
          c.strokeStyle = ink; c.lineWidth = 1.4; c.stroke();
        }
      }
      for (const e of ex) {
        const ev = (e.v + (T ? T.shift : 0)) * k;
        c.fillStyle = hwc; c.beginPath(); c.arc(X(e.t), Y(ev), 3, 0, 7); c.fill();
        label(`${e.kind} ${this.fmtT.format(new Date(e.t))}`, X(e.t), Y(ev) + (e.kind === "HW" ? -9 : 9), ink);
      }
    }
    // Current.
    const nv = this.data.noaa?.v || [], af = along.filter(Number.isFinite), amax = Math.max(1, ...af.map(Math.abs), ...nv.map(Math.abs)) * 1.2;
    axis(panels[1], -amax, amax, amax > 5 ? 2 : 1, "kt");
    c.fillStyle = soft; c.textAlign = "right"; c.fillText("flood ↑", x1, panels[1].y0 + 6); c.fillText("ebb ↓", x1, panels[1].y1 - 6);
    const Yc = series(panels[1], along, -amax, amax, ink, [fl, eb]);
    if (this.data.noaa) {                                           // NOAA's prediction, dashed
      const N = this.data.noaa; c.beginPath(); N.t.forEach((t, i) => (i ? c.lineTo(X(t), Yc(N.v[i])) : c.moveTo(X(t), Yc(N.v[i]))));
      c.strokeStyle = col("--caution"); c.lineWidth = 1.6; c.setLineDash([5, 3]); c.stroke(); c.setLineDash([]);
    }
    for (const m of mx) {
      c.fillStyle = m.v > 0 ? fl : eb; c.beginPath(); c.arc(X(m.t), Yc(m.v), 3, 0, 7); c.fill();
      label(`${Math.abs(m.v).toFixed(1)}`, X(m.t), Yc(m.v) + (m.v > 0 ? -8 : 8), ink);
    }
    for (const q of sl) {
      c.fillStyle = slc; c.beginPath(); c.arc(X(q.t), Yc(0), 3.2, 0, 7); c.fill();
      if (q.ref) {                                                  // a bracket from the HW/LW above to the slack
        c.strokeStyle = slc; c.lineWidth = 1; c.setLineDash([2, 2]);
        c.beginPath(); c.moveTo(X(q.ref.t), panels[0].y1); c.lineTo(X(q.ref.t), panels[1].y0 + 4); c.lineTo(X(q.t), Yc(0)); c.stroke(); c.setLineDash([]);
        const m = Math.round(q.offset / 60e3), lbl = `${m >= 0 ? "+" : "−"}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, "0")}`;
        label(lbl, X(q.t), Yc(0) + (q.kind === "flood→ebb" ? 11 : -11), slc);
      }
    }
    // Hover: a cursor line and the values there.
    if (this.hoverT != null && this.hoverT >= t0 && this.hoverT <= t1) {
      const ht = this.hoverT, f = ((ht - t0) / 3600e3), i = Math.min(s.t.length - 2, Math.floor(f)), w = f - i;
      const lv = (a) => a[i] * (1 - w) + a[i + 1] * w, zz = (lv(s.zeta) + (T ? T.shift : 0)) * k, cu = lv(along), sp = lv(this.data.speed);
      c.strokeStyle = soft; c.lineWidth = 1; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(X(ht), panels[0].y0); c.lineTo(X(ht), panels[1].y1); c.stroke(); c.setLineDash([]);
      const txt = `${this.fmtD.format(new Date(ht))} ${this.fmtT.format(new Date(ht))} · level ${Number.isFinite(zz) ? zz.toFixed(1) : "dry"} ${this.units} · ${cu >= 0 ? "flood" : "ebb"} ${Math.abs(cu).toFixed(1)} kt (speed ${sp.toFixed(1)})`;
      c.font = "10.5px ui-monospace, Menlo, monospace";
      const tw = c.measureText(txt).width + 10, tx = Math.min(Math.max(X(ht) - tw / 2, x0), x1 - tw);
      c.fillStyle = col("--panel"); c.globalAlpha = 0.92; c.fillRect(tx, 2, tw, 15); c.globalAlpha = 1;
      c.fillStyle = ink; c.textAlign = "left"; c.fillText(txt, tx + 5, 10);
    }
    // Now.
    const tn = this.timebar.t;
    if (tn >= t0 && tn <= t1) { c.strokeStyle = col("--caution"); c.lineWidth = 1.5; c.beginPath(); c.moveTo(X(tn), panels[0].y0 - 4); c.lineTo(X(tn), panels[1].y1); c.stroke(); }
  }
}
