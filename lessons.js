// The guided lesson: "Why don't high water and slack water line up?"
//
// Each step sets the stage (view, colour, layers, time, cards) through the app's small API and
// tells one part of the story, with the numbers from this run where they matter. The moments are
// picked from the run itself (a strong flood into Puget Sound, a high water in Juan de Fuca …), so
// the lesson works on whichever lab run it opens on. Next/Back, or ←/→ with the card focused.
//
// Teaching claims are the ones checked in docs/RESEARCH_LOG.md (and shown by this run's phase map).

import { Explainer } from "./explainer.js?v=20261005223557";
import { extrema, maxima } from "./model/events.js?v=20261005223557";

const $ = (id) => document.getElementById(id);

export class Lesson {
  constructor(app) {
    this.app = app; this.i = 0;
    this.el = $("lesson");
    $("ls-next").onclick = () => this.go(this.i + 1);
    $("ls-back").onclick = () => this.go(this.i - 1);
    $("ls-close").onclick = () => this.close();
    this.steps = this.build();
    $("ls-dots").innerHTML = this.steps.map((_, k) => `<button class="dot" data-k="${k}" title="Step ${k + 1}"></button>`).join("");
    for (const b of $("ls-dots").querySelectorAll(".dot")) b.onclick = () => this.go(+b.dataset.k);
  }

  // Moments from the run.
  moments() {
    const A = this.app, m = A.model, P = m.passes, t = P.leads.map((L) => m.cycle.getTime() + L * 3600e3);
    const ps = P.basins.find((b) => b.id === "pugetsound"), ex = extrema(t, ps.level);
    const iIn = ps.flux.indexOf(Math.max(...ps.flux));
    const lw = ex.find((e) => e.kind === "LW" && e.t > t[0] + 3 * 3600e3) || ex[0];
    // Juan de Fuca: the high or low water with the strongest matching current closest to it
    // (max flood ↔ HW, max ebb ↔ LW): the travelling wave's signature, from this run.
    const jdf = A.series(48.25, -123.5), fl = A.floodAt(48.25, -123.5) * Math.PI / 180;
    const al = jdf.ua.map((u, i) => u * Math.sin(fl) + jdf.va[i] * Math.cos(fl));
    const exJ = extrema(jdf.t, jdf.zeta, { minRange: 0.02 }), mxJ = maxima(jdf.t, al).filter((q) => Math.abs(q.v) > 1);
    let best = null;
    for (const q of mxJ) for (const e of exJ) if ((q.v > 0) === (e.kind === "HW") && (!best || Math.abs(q.t - e.t) < Math.abs(best.q.t - best.e.t))) best = { q, e };
    const levels = exJ.length / ((jdf.t.at(-1) - jdf.t[0]) / 86400e3);
    return { floodIn: t[iIn], lwPS: lw.t, jdf: best, jdfPerDay: levels, start: t[0] };
  }

  build() {
    const A = this.app;
    const M = () => (this._m ||= this.moments());
    return [
      { title: "Why don't high water and slack water line up?",
        html: `<p>Look up a tide table and a current table for the same place in the Salish Sea and the times disagree: slack water can come right at high water in one place and three hours later in another. Boaters learn it the hard way at Deception Pass and Admiralty Inlet.</p>
          <p>This lesson uses NOAA's SSCOFS model — a whole run kept in the Lab${A.model.meta.lab?.label ? ` (${A.model.meta.lab.label})` : ""}, ${A.model.N.toLocaleString()} points on a mesh as fine as ~100 m in the passes — to show why. It takes about five minutes; every step leaves the map live, so stop and explore whenever you like.</p>${this.tideButtons(0)}`,
        run: () => { A.closeCards(); A.set({ view: "region-3d", fill: "speed", layer: "surf", parts: true, lines: false }); A.time(M().start + 9 * 3600e3); A.play(false); } },
      { title: "1 · Two ways a tide wave can move", tall: true,
        html: `<p>A tide is a very long, slow wave. In a channel it can do two things:</p>
          <p><b>Travel</b> (progressive): the crest moves up the channel and the water under it moves with it — the current runs hardest <i>at</i> high and low water and stops in between.</p>
          <p><b>Slosh</b> (standing): the wave reflects off the head of the channel and the whole basin rises and falls together, like water in a bathtub — the water must flow in to make it rise, so the current runs hardest at half-tide and stops at high and low water.</p>
          <div id="ls-ex" class="explainer"></div>
          <p class="fine">Slide from travelling to sloshing and watch the purple slack marks slide toward high water.</p>`,
        run: () => { A.closeCards(); A.play(false); new Explainer($("ls-ex")); } },
      { title: "2 · The tide arrives from the Pacific",
        html: `<p>Colour now shows the <b>water level</b>. Playing from low water in Puget Sound: watch high water (blue-violet) come in at the mouth of Juan de Fuca and work its way east.</p>
          <p>Notice what happens once it's inside: Puget Sound and the Strait of Georgia don't fill from one end — they go blue <b>almost all at once</b>.</p>`,
        run: () => { A.closeCards(); A.set({ view: "region-3d", fill: "level", parts: false, lines: false }); A.time(M().lwPS - 4 * 3600e3); A.play(true, 1); } },
      { title: "3 · The map of when high water arrives",
        html: `<p>The same thing as one picture: the colour is <b>how many hours after the ocean entrance high water arrives</b>.</p>
          <p>Along Juan de Fuca the colours change steadily — the wave takes about two hours to travel the strait. Past Admiralty Inlet, all of Puget Sound is one colour: high water within about half an hour from Port Townsend to Olympia. The Strait of Georgia is one colour too. Inside the sea the tide <b>sloshes</b>; in the strait it <b>travels</b>.</p>`,
        run: () => { A.closeCards(); A.play(false); A.set({ view: "region-top", fill: "hwtime", parts: false, lines: false }); } },
      { title: "4 · Juan de Fuca: the current runs with the crest",
        html: () => {
          const j = M().jdf, f = new Intl.DateTimeFormat("en-US", { timeZone: A.tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
          if (!j) return "<p>Mid-strait off Port Angeles. The meteogram (top right) shows the whole run here.</p>";
          const dm = Math.round(Math.abs(j.q.t - j.e.t) / 60e3), word = j.e.kind === "HW" ? "high" : "low";
          return `<p>Mid-strait off Port Angeles, at <b>${word} water</b> (${f.format(new Date(j.e.t))}). The colour shows <b>flood (blue) or ebb (orange)</b> — and the ${j.q.v > 0 ? "flood" : "ebb"} is running at its strongest, <b>${Math.abs(j.q.v).toFixed(1)} kt</b>, within ${dm} min of ${word} water. Current strongest at the crest or trough: the travelling wave.</p>
            <p>The meteogram (top right) shows the run here.${M().jdfPerDay < 3 ? " This week the <i>level</i> here is almost all the daily tide (one high and one low a day), while the <i>current</i> keeps a twice-daily beat — the mixed tide in action. The phase map, which uses the twice-daily tide alone, puts slack here nearly 3 h from high and low water." : " Slack (purple) falls between high and low water, two to three hours off."}</p>`;
        },
        run: () => { A.closeCards(); A.play(false); A.set({ view: "jdf-3d", fill: "along", layer: "davg", parts: true, lines: false }); const j = M().jdf; A.time(j ? j.e.t : M().start); A.point(48.25, -123.5); } },
      { title: "5 · Puget Sound: water in = basin rising",
        html: `<p>Now a basin behind a narrow pass: South Sound behind Tacoma Narrows. The card compares two things the model computes independently — the <b>water flowing through the Narrows</b> (solid) and <b>how fast South Sound is filling</b> (its area × the rate its level rises, dashed).</p>
          <p>They are the same curve. To rise, the basin needs inflow; the faster it rises (half-tide), the harder the Narrows run; when the level stops rising (high water) the inflow stops — <b>slack at high water</b>. That's the sloshing wave, and it's why Puget Sound's currents turn near high and low water.</p>`,
        run: () => { A.closeCards(); A.play(false); A.set({ fill: "speed", layer: "surf", parts: true, lines: false }); A.time(M().floodIn); A.pass("basin", "southsound"); } },
      { title: "6 · Where the two meet",
        html: `<p>The phase map puts it together: colour is <b>how far slack is from high or low water</b>. <b>Red</b>: about 3 h — travelling (Juan de Fuca). <b>Blue</b>: at high and low water — sloshing (Puget Sound, the Gulf Islands, much of the Strait of Georgia).</p>
          <p>The changeover happens through the San Juans and Haro and Rosario straits, where slack comes an hour or two after high water. In this model Admiralty Inlet is already on the sloshing side: slack within about half an hour of high and low water.</p>
          <p class="fine">Grey: currents too weak (under ~0.4 kt) for slack to mean much.</p>`,
        run: () => { A.closeCards(); A.play(false); A.set({ view: "region-top", fill: "lag", parts: false, lines: false }); } },
      { title: "7 · A pass between two tides",
        html: `<p>Deception Pass joins Rosario Strait to Skagit Bay, two bodies of water whose tides don't match. The card shows the level on each side: one is often more than a foot higher, and the water pours downhill through the pass.</p>
          <p>The current turns when the two levels cross — not at high water on either side. That's why it runs so hard, and why one side's tide table can't time it.</p>`,
        run: () => { A.closeCards(); A.play(false); A.set({ fill: "speed", layer: "surf", parts: true, lines: false }); A.time(M().floodIn); A.pass("head", "deception"); } },
      { title: "8 · Where the tide peels off: eddies",
        html: `<p>At the strongest flood into Puget Sound, Admiralty Inlet. The colour is now <b>spin</b>: blue anticlockwise, red clockwise. Fast water shearing past headlands rolls up into eddies, which drift off and decay as the tide turns.</p>
          <p>Playing slowly with streamlines on: watch them form behind points and on the edges of the main stream. The "Eddy activity" pattern map shows where it happens most often.</p>`,
        run: () => { A.closeCards(); A.set({ view: "admiralty-top", fill: "spin", layer: "surf", parts: true, lines: true }); A.time(M().floodIn - 2 * 3600e3); A.play(true, 0.5); } },
      { title: "9 · Springs and neaps: the size changes, the timing doesn't",
        html: () => `<p>Tides come in big and small spells — over the last two months Seattle's range swung between about 9 and 14 ft (NOAA's predictions). The Lab keeps a run from each end and one between; here they are side by side, from the runs' own files:</p>
          <div id="ls-sn" class="note">Loading the other runs…</div>
          <p>With the bigger range, far more water goes through the same passes and the currents grow (the map: how many times stronger at springs, typically ~1.7×). But slack comes at nearly the same time after high and low water (the table's last row; across the whole sea it moves only 10–15 minutes). The timing pattern of this lesson holds at every tide; only the size changes.</p>
          <p>One thing goes the other way: Puget Sound's slow deep inflow at Admiralty Inlet is strongest at neaps (0.28 kt averaged over the neap run, 0.01 kt over the spring) — less tidal stirring over the sill lets the layers slide past each other, as Geyer &amp; Cannon measured in 1982. Try “Release water across this line” on the Admiralty Inlet curtain in each run.</p>
          ${this.tideButtons(this.steps.findIndex((q) => q.title.startsWith("5 ·")), "Replay the Puget Sound step at")}`,
        run: () => { A.closeCards(); A.play(false); A.set({ view: "region-top", fill: A.model.compare ? "cmp_strength" : "strength", parts: false, lines: false }); this.springNeap(); } },
      { title: "10 · Under the tides: the slow conveyor",
        html: () => `<p>Averaged over the tides, Puget Sound runs a slow two-layer circulation through Admiralty Inlet: lighter, fresher water (rivers, rain) leaves near the surface, and dense salt water from the ocean comes in underneath, over the sill — and much of the outgoing water is mixed down and carried back in (Ebbesmeyer &amp; Barnes 1980; Geyer &amp; Cannon 1982).</p>
          <p>The tide moves water back and forth by miles every few hours; the conveyor moves it a few miles a day. To see it, follow the water: <button class="btn mini on" id="ls-conveyor">Release water across Admiralty Inlet</button> ${A.model.volumeReady ? "" : `<span class="fine">(downloads the full 3D volume, ${A.volumeMB} MB, once)</span>`}</p>
          <p id="ls-conv-note" class="fine">Yellow parcels start at the surface, orange mid-depth, violet near the seabed; where each group ends up after 24 hours shows here.</p>`,
        run: () => { A.closeCards(); A.play(false); const b = $("ls-conveyor"); if (b) b.onclick = async () => { b.disabled = true; b.textContent = "Following the water…"; await A.conveyor(); b.textContent = "Released"; const n = $("ls-conv-note"); if (n) n.innerHTML = $("sc-release-note").innerHTML + " Out is toward the Strait of Juan de Fuca (northwest), in is toward Seattle (southeast). Try a different start time, or the neap run, where the deep inflow is strongest."; }; } },
      { title: "Your turn",
        html: `<p><b>Click any water</b> for its meteogram: high and low water, slack and the strongest flood and ebb, with the gap between them.</p>
          <p><b>📋 What happens here?</b> writes up any area from the run; <b>Colour</b> has more patterns (daily vs twice-daily, rotating currents, net drift, eddies); <b>Basins &amp; passes</b> has Hood Canal and all of Puget Sound; <b>Current at</b> goes down to the seabed if you load the full 3D volume.</p>
          <p class="fine">A learning tool built on model output — not for navigation. The Guide explains the data, methods and limits.</p>`,
        run: () => { A.closeCards(); A.play(false); A.set({ view: "region-3d", fill: "speed", layer: "surf", parts: true, lines: false }); A.time(Date.now()); } },
    ];
  }

  // Buttons to run the lesson (at step `step`) on each lab run; the one on screen is marked.
  tideButtons(step, lead = "Run this lesson on") {
    const L = this.app.labs || []; if (L.length < 2) return "";
    const cur = this.app.model.meta.lab?.label;
    return `<p class="ls-tides">${lead}: ${L.map((s) => s.label === cur ? `<b class="ls-cur">${s.label.split(" · ")[0]}</b>` : `<button class="btn mini" data-lab="${s.id}" data-step="${step}">${s.label.split(" · ")[0]}</button>`).join(" ")}</p>`;
  }

  // The spring/neap table: each run's Puget Sound level range and peak inflows (passes.json) and slack
  // after HW at Admiralty Inlet (phase map, same mesh) — numbers from the runs, not from a textbook.
  async springNeap() {
    const A = this.app, el = () => $("ls-sn"), L = A.labs || [];
    const runs = ["spring", "between", "neap"].map((t) => L.find((s) => s.tide === t)).filter(Boolean);
    if (runs.length < 2) { if (el()) el().textContent = "(Only one lab run is published.)"; return; }
    const adm = A.locate(48.03, -122.62), FT = 3.28084;          // (the pipeline's Admiralty Inlet point, patterns.py)
    const rows = await Promise.all(runs.map(async (s) => {
      const meta = await fetch(A.labBase + s.meta).then((r) => r.json());
      const ps = await fetch(A.labBase + meta.passes).then((r) => r.json());
      const pug = ps.basins.find((b) => b.id === "pugetsound"), south = ps.basins.find((b) => b.id === "southsound");
      const lv = pug.level.filter(Number.isFinite), range = Math.max(...lv) - Math.min(...lv);
      const q = (b, id) => Math.max(...b.passes.find((p) => p.id === id).flux) / 1000;
      const ph = A.model.meta.lab?.label === s.label ? A.model.phaseAt(adm) : A.model.compare?.[s.tide]?.phaseAt(adm);
      return { s, range, adm: q(pug, "admiralty"), nar: q(south, "narrows"), lag: ph?.ok ? Math.abs(ph.lag) : null };
    }));
    if (!el()) return;
    el().innerHTML = `<table class="ls-tab"><tr><th></th>${rows.map((r) => `<th>${r.s.label.split(" · ")[0]}</th>`).join("")}</tr>
      <tr><td>Puget Sound level range</td>${rows.map((r) => `<td>${(r.range * FT).toFixed(1)} ft</td>`).join("")}</tr>
      <tr><td>Peak inflow, Admiralty Inlet</td>${rows.map((r) => `<td>${Math.round(r.adm)}k m³/s</td>`).join("")}</tr>
      <tr><td>Peak inflow, Tacoma Narrows</td>${rows.map((r) => `<td>${Math.round(r.nar)}k m³/s</td>`).join("")}</tr>
      <tr><td>Slack vs HW/LW, Admiralty Inlet</td>${rows.map((r) => `<td>${r.lag == null ? "—" : `${Math.round(r.lag * 60)} min`}</td>`).join("")}</tr></table>`;
  }

  open(i = 0) { this.el.hidden = false; document.body.classList.add("in-lesson"); this.go(i); }
  close() { this.el.hidden = true; document.body.classList.remove("in-lesson"); this.app.play(false); }

  go(i) {
    if (i < 0 || i >= this.steps.length) { if (i >= this.steps.length) this.close(); return; }
    this.i = i;
    const s = this.steps[i];
    $("ls-title").textContent = s.title;
    $("ls-body").innerHTML = typeof s.html === "function" ? s.html() : s.html;
    for (const b of $("ls-body").querySelectorAll("button[data-lab]")) b.onclick = () => this.app.goLab(b.dataset.lab, +b.dataset.step);
    this.el.classList.toggle("tall", !!s.tall);
    $("ls-back").disabled = i === 0;
    $("ls-next").textContent = i === this.steps.length - 1 ? "Finish" : i === 0 ? "Start ›" : "Next ›";
    $("ls-dots").querySelectorAll(".dot").forEach((d, k) => d.classList.toggle("on", k === i));
    try { localStorage.setItem("ssfe.lesson", String(i)); } catch {}
    s.run();
  }
}
