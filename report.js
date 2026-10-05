// Area reports: the flow analyzer in words. For an area (a subarea's box, or the whole basin) the
// run's per-element patterns (phase map + pipeline/patterns.py) are summarised into short, plain
// statements — each with a "map ›" link that switches the colour to the matching pattern and,
// where there's a hot spot, flies there.
//
// Numbers are medians / percentiles over the model's elements in the area, weighted equally
// (the mesh is finer near shore, so shores count a little more than open water).

import { compass } from "./shell/views.js?v=20261005223557";
import { fmtOffset } from "./model/events.js?v=20261005223557";

const FT = 3.28084;
const med = (a) => { const s = a.filter(Number.isFinite).sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pct = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const hm = (h) => { const m = Math.round(Math.abs(h) * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };

export class AreaReport {
  constructor(model, places) {
    this.m = model; this.places = places || [];
    const E = model.E, nv = model.nv;
    this.lat = new Float32Array(E); this.lon = new Float32Array(E);
    for (let e = 0; e < E; e++) {
      this.lat[e] = (model.lat[nv[3 * e]] + model.lat[nv[3 * e + 1]] + model.lat[nv[3 * e + 2]]) / 3;
      this.lon[e] = (model.lon[nv[3 * e]] + model.lon[nv[3 * e + 1]] + model.lon[nv[3 * e + 2]]) / 3;
    }
    // Usable elements: wet every hour of the run (drying flats give junk drift and spin) and not on
    // the edge of the box (the cut mesh has open edges there).
    const dryNode = new Uint8Array(model.N);
    for (const fr of model.frames) for (let n = 0; n < model.N; n++) if (fr.zeta[n] === -32768) dryNode[n] = 1;
    const b = model.meta.box || null, R = this.box = model.regionBox;
    this.good = new Uint8Array(E);
    for (let e = 0; e < E; e++) {
      const wet = !dryNode[nv[3 * e]] && !dryNode[nv[3 * e + 1]] && !dryNode[nv[3 * e + 2]];
      const edge = R && (this.lat[e] - R.latMin < 0.02 || R.latMax - this.lat[e] < 0.02 || this.lon[e] - R.lonMin < 0.03 || R.lonMax - this.lon[e] < 0.03);
      this.good[e] = wet && !edge ? 1 : 0;
    }
  }

  near(e) {
    const la = this.lat[e], lo = this.lon[e], k = Math.cos(la * Math.PI / 180);
    let best = null, bd = Infinity;
    for (const [n, pla, plo] of this.places) { const d = Math.hypot((pla - la) * 111.2, (plo - lo) * 111.2 * k); if (d < bd) { bd = d; best = n; } }
    return best ? (bd < 2 ? `at ${best}` : bd < 12 ? `${Math.round(bd)} km from ${best}` : `${la.toFixed(2)}° N, ${Math.abs(lo).toFixed(2)}° W`) : "";
  }

  // box: {latMin, latMax, lonMin, lonMax} or null; → {title, items: [{head, html, mode, at: e|null}]}
  build(label, box, units = "ft") {
    const m = this.m, ph = m.phase, P = m.patterns, k = units === "ft" ? FT : 1;
    const els = [];
    // The whole basin means the inland sea: east of Cape Flattery (the open shelf has its own, unrelated, patterns).
    const B = box || { latMin: -90, latMax: 90, lonMin: -124.72, lonMax: 0 };
    for (let e = 0; e < m.E; e++) if (this.good[e] && this.lat[e] >= B.latMin && this.lat[e] <= B.latMax && this.lon[e] >= B.lonMin && this.lon[e] <= B.lonMax) els.push(e);
    const val = (name, e) => m.pat(name, e), phv = (name, e) => ph[name].raw[e] * ph[name].scale;
    // Hot spots only in water deeper than 5 m: river mouths enter the model as point sources in tiny
    // shallow elements (e.g. 3 kt "net drift" where the Duckabush meets Hood Canal).
    const depth = (e) => (m.h[m.nv[3 * e]] + m.h[m.nv[3 * e + 1]] + m.h[m.nv[3 * e + 2]]) / 30;
    const deep = els.filter((e) => depth(e) > 5);
    const strong = els.filter((e) => val("strength", e) >= 0.4), timed = els.filter((e) => ph.ok.raw[e]);
    const items = [];
    // The tide.
    const range = med(els.map((e) => 2 * (phv("zeta_m2", e) + phv("zeta_k1", e)))) * k;
    const hw = els.map((e) => { const v = val("hw_time", e); return v > 9 ? v - 12.42 : v; }), hwMed = med(hw), hwSpread = pct(hw, 90) - pct(hw, 10);
    items.push({ head: "The tide", mode: "hwtime",
      html: `When the twice-daily and daily tides line up the range reaches about <b>${range.toFixed(1)} ${units}</b>. High water arrives <b>${hwMed.toFixed(1)} h</b> after it does at the ocean entrance, `
        + (hwSpread < 0.75 ? `and <b>all at once</b> across the area (within ${hm(hwSpread)}) — the whole basin rises and falls together.` : `<b>sweeping across</b> it over ${hm(hwSpread)} — you can watch the tide travel.`) });
    // The current.
    if (strong.length) {
      const peak = pct(strong.map((e) => val("strength", e)), 95);
      const sd = strong.filter((e) => depth(e) > 5), cand = sd.length ? sd : strong;
      let top = cand[0]; for (const e of cand) if (val("strength", e) > val("strength", top)) top = e;
      const fx = med(strong.map((e) => Math.sin(phv("flood", e) * Math.PI / 180))), fy = med(strong.map((e) => Math.cos(phv("flood", e) * Math.PI / 180)));
      const fl = (Math.atan2(fx, fy) * 180 / Math.PI + 360) % 360;
      items.push({ head: "The current", mode: "strength", at: top,
        html: `The fastest 5 % of the moving water peaks at <b>${peak.toFixed(1)} kt</b> or more; the strongest, <b>${val("strength", top).toFixed(1)} kt</b>, ${this.near(top)}. The flood mostly sets <b>${compass(fl)}</b> (${Math.round(fl)}°).` });
    } else items.push({ head: "The current", mode: "strength", html: "Tidal currents here stay under about 0.4 kt — open, deep water that the tide fills without hurrying." });
    // Timing.
    if (timed.length > 10) {
      const lag = timed.map((e) => Math.abs(phv("lag", e))), L = med(lag);
      const stand = lag.filter((v) => v < 1).length / lag.length, prog = lag.filter((v) => v > 2).length / lag.length;
      const kind = L < 1 ? "a <b>standing wave</b>: slack comes close to high and low water, and the current runs hardest at half-tide"
        : L > 2 ? "a <b>progressive wave</b>: the current runs hardest near high and low water and turns around half-tide"
        : "<b>between</b> a standing and a progressive wave — slack comes an hour or two after high and low water";
      items.push({ head: "Slack vs high water", mode: "lag",
        html: `Slack comes about <b>${hm(L)}</b> from high or low water (median): ${kind}. ${Math.round(stand * 100)} % of the area behaves standing, ${Math.round(prog * 100)} % progressive.` });
    }
    // Character.
    if (strong.length) {
      const di = med(strong.map((e) => val("diurnal", e))), ro = med(strong.map((e) => val("rotary", e))), dom = med(strong.map((e) => val("dominance", e)));
      items.push({ head: "Its character", mode: di > 0.4 ? "diurnal" : "rotary",
        html: `${di > 0.45 ? `The daily tide carries <b>${Math.round(di * 100)} %</b> of the current: expect one big and one small flood a day, and slack times that jump from tide to tide.` : `Mostly twice-daily (the daily tide carries ${Math.round(di * 100)} %).`} `
          + `${ro < 0.2 ? "The current runs <b>back and forth</b> along its channel, with a real slack between." : ro < 0.45 ? "The current swings somewhat as it turns." : "The current <b>rotates</b> through the tide: it seldom stops, it changes direction."} `
          + `${Math.abs(dom) < 0.08 ? "Floods and ebbs are about as strong." : dom > 0 ? `<b>Flood-dominant</b> (floods ${Math.round(dom * 100)} % stronger, relatively).` : `<b>Ebb-dominant</b> (ebbs ${Math.round(-dom * 100)} % stronger, relatively).`}` });
    }
    // Eddies.
    const ed = deep.filter((e) => val("strength", e) >= 0.3);
    if (ed.length) {
      let top = ed[0]; for (const e of ed) if (val("eddy", e) > val("eddy", top)) top = e;
      const frac = ed.filter((e) => val("eddy", e) > 0.2).length / ed.length;
      items.push({ head: "Eddies", mode: "eddy", at: top,
        html: frac < 0.02 ? "Few eddies: the flow here is mostly smooth." : `About <b>${Math.round(frac * 100)} %</b> of the moving water spins a fifth of the time or more. The busiest spot (${Math.round(val("eddy", top) * 100)} % of hours, ${val("spin", top) > 0 ? "anticlockwise" : "clockwise"}) is ${this.near(top)}.` });
    }
    // Drift and layering.
    const du = med(els.map((e) => val("res_s_u", e))), dv = med(els.map((e) => val("res_s_v", e))), dsp = Math.hypot(du, dv);
    const dd = deep.length ? deep : els;
    let top = dd[0]; for (const e of dd) if (Math.hypot(val("res_s_u", e), val("res_s_v", e)) > Math.hypot(val("res_s_u", top), val("res_s_v", top))) top = e;
    const sh = med(els.map((e) => val("shear", e)));
    items.push({ head: "Net drift", mode: "drift", at: top,
      html: `After the tides cancel out, surface water drifts ${dsp < 0.03 ? "hardly at all on average" : `about <b>${dsp.toFixed(2)} kt</b> toward the <b>${compass((Math.atan2(du, dv) * 180 / Math.PI + 360) % 360)}</b> on average`}; the strongest net drift (${Math.hypot(val("res_s_u", top), val("res_s_v", top)).toFixed(1)} kt) is ${this.near(top)}. `
        + `${sh > 0.35 ? `The surface often moves <b>differently from the water below</b> (rms ${sh.toFixed(2)} kt) — river water and wind riding on top.` : "Surface and deeper water mostly move together."}` });
    return { title: label, items };
  }
}
