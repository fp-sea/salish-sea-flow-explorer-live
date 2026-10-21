// Everything the colour on the water can show: one registry, so the menu, the key, the fill and
// the "how to read this" note all come from the same place.
//
//   kind "vec"     a current field for the time on screen (speed or along-flood), blended in time
//   kind "scalar"  a scalar for the time on screen (level, spin), blended in time
//   kind "static"  a pattern over the whole run (per element → nodes), no time
//
// read: plain-language note under the key — what you see, how to read it, what to look for.

const okTiming = (m, e) => m.phase?.ok.raw[e] === 1;
// The phase map's lag is defined modulo half an M2 period (6.21 h): a difference of 6 h is 0.
const wrapLag = (d) => { const P = 12.4206 / 2; return ((((d + P / 2) % P) + P) % P) - P / 2; };

export const MODES = [
  // ---- Right now (the time on screen)
  { id: "speed", group: "Right now", label: "Current speed", kind: "vec",
    read: "How fast the water moves at the time on screen. Dark is slack; the passes light up first as the tide turns. Play it and watch the bright bands switch on and off in step with the tide." },
  { id: "along", group: "Right now", label: "Flood or ebb", kind: "vec",
    read: "Blue water is flooding (running the way it goes as the tide comes in, here), orange is ebbing, white is slack. Watch where the colour turns first: in Puget Sound everything turns together near high and low water; in Juan de Fuca the turn sweeps along the strait." },
  { id: "level", group: "Right now", label: "Water level (the tide)", kind: "scalar",
    read: "The tide itself: high water blue-violet, low water brown. Play it: in Juan de Fuca the high water marches in from the ocean; Puget Sound and the Strait of Georgia rise and fall almost as one, like water sloshing in a bath." },
  { id: "spin", group: "Right now", label: "Spin (eddies)", kind: "scalar",
    read: "Which way the water is turning: blue anticlockwise, red clockwise, as a multiple of the Earth's own spin here (f). Values past ±2 are eddies and the shear lines that make them. Play it behind points and islands to watch eddies form, peel off and drift as the tide turns." },
  // ---- Patterns over the run
  { id: "lag", group: "Patterns over the run", label: "Slack vs high water (phase map)", kind: "static",
    values: (m) => { const p = m.phase, E = m.E, v = new Float32Array(E); for (let e = 0; e < E; e++) v[e] = p.ok.raw[e] ? Math.abs(p.lag.raw[e] * p.lag.scale) : NaN; return v; },
    read: "How far apart slack water and high/low water are, for the main twice-daily tide. <b>Blue</b>: slack at high and low water — a <b>standing wave</b> (the water stops moving when it stops rising). <b>Red</b>: slack ~3 h away, strongest current at high and low water — a <b>progressive wave</b> travelling through. Juan de Fuca is red; Puget Sound and the Gulf Islands blue; the San Juans in between." },
  { id: "hwtime", group: "Patterns over the run", label: "When high water arrives", kind: "static",
    values: (m) => m.patEl("hw_time", (v) => (v > 9 ? v - 12.42 : v)),             // (just before the entrance → negative, not 12 h)
    read: "Hours after the ocean entrance that the twice-daily high water arrives (a co-tidal map). Close colour bands = the tide wave travelling (Juan de Fuca: ~2 h to cross). One flat colour = everywhere high at once (Puget Sound, ~½ h from Admiralty Inlet to Olympia; the Strait of Georgia): a basin sloshing as a whole." },
  { id: "fltime", group: "Patterns over the run", label: "When the strongest flood arrives", kind: "static",
    values: (m) => m.patEl("fl_time", (v, e) => (okTiming(m, e) ? (v > 9 ? v - 12.42 : v) : NaN)),
    read: "Hours after high water at the entrance that the strongest flood comes, on the same clock as the high-water map. Compare the two: in Juan de Fuca the strongest flood comes with high water (same colour); in Puget Sound it comes ~2½ h before high water there — mid-way up the rising tide." },
  { id: "strength", group: "Patterns over the run", label: "Tidal current strength", kind: "static",
    values: (m) => m.patEl("strength"),
    read: "The strongest current of the run here (depth-averaged, the 98th-percentile hour). The tide's energy squeezes through the passes: Deception Pass, Tacoma Narrows, Admiralty Inlet, the San Juan channels, Seymour Narrows. Wide basins stay slack." },
  { id: "diurnal", group: "Patterns over the run", label: "Daily vs twice-daily current", kind: "static",
    values: (m) => m.patEl("diurnal", (v, e) => (okTiming(m, e) ? v : NaN)),
    read: "How much of the tidal current runs on the once-a-day (K1) tide rather than the twice-a-day (M2) one. The Salish Sea has a mixed tide; where this is high (orange), one of the day's two floods is weak or missing — slack times then jump around from tide to tide." },
  { id: "rotary", group: "Patterns over the run", label: "Back-and-forth vs rotating", kind: "static",
    values: (m) => m.patEl("rotary", (v, e) => (m.pat("strength", e) >= 0.3 ? v : NaN)),
    read: "Dark: the current runs back and forth along one line (channels and passes — it must stop to turn, so there is a real slack). Bright: it swings round the compass through the tide (open water, and behind headlands) — the speed never quite drops to zero, so 'slack' hardly exists there." },
  { id: "dominance", group: "Patterns over the run", label: "Flood- or ebb-dominant", kind: "static",
    values: (m) => m.patEl("dominance", (v, e) => (m.pat("strength", e) >= 0.4 ? v : NaN)),
    read: "Whether the flood or the ebb runs harder here (peak speeds). Blue: flood-dominant; orange: ebb-dominant. River water and the shape of the channel tilt the balance; in narrow passes it decides which way sand and drift go." },
  { id: "drift", group: "Patterns over the run", label: "Net drift (what's left after the tides)", kind: "static",
    values: (m, layer) => { const k = layer === "surf" || layer === "res_s" || layer.startsWith("d:") ? "res_s" : "res_d"; return m.patEl(`${k}_u`, (u, e) => Math.hypot(u, m.pat(`${k}_v`, e))); },
    read: "Where the water goes on balance once the back-and-forth of the tide is taken out (the mean of a tidal fit over the run). At the surface it's mostly river water heading out to sea and wind drift; behind points it marks standing eddies. Set “Current at” to <b>Net drift</b> to see it flow as particles." },
  { id: "shear", group: "Patterns over the run", label: "Surface vs the water below", kind: "static",
    values: (m) => m.patEl("shear"),
    read: "How different the surface current is from the whole water column's (rms over the run). Bright: the surface does its own thing — wind, river plumes (the Fraser, the Skagit), and the fresh layer riding over salt water. Dark: the whole column moves together." },
  // ---- Comparing the lab runs (model.compare: the spring and neap runs' patterns and phase maps; same mesh)
  { id: "cmp_strength", group: "Compare the tides (lab runs)", label: "Current strength: spring ÷ neap", kind: "static", needs: "compare",
    values: (m) => { const S = m.compare.spring, N = m.compare.neap; return m.patEl("strength", (_, e) => { const n = N.pat("strength", e); return n >= 0.3 ? S.pat("strength", e) / n : NaN; }); },
    read: "How many times stronger the tidal current runs in the spring-tide lab run than in the neap one. Across the Salish Sea it's typically about 1.7× (most places 1.3–2×); Seattle's tide range is 14 ft against 9. Grey: currents under 0.3 kt at neaps." },
  { id: "cmp_lag", group: "Compare the tides (lab runs)", label: "Slack timing: spring minus neap", kind: "static", needs: "compare",
    values: (m) => { const S = m.compare.spring, N = m.compare.neap; return m.patEl("strength", (_, e) => (S.phase.ok.raw[e] && N.phase.ok.raw[e] ? wrapLag(S.phaseAt(e).lag - N.phaseAt(e).lag) : NaN)); },
    read: "How far slack water moves relative to high and low water between the neap and the spring lab runs (twice-daily tide, the phase map's measure). Typically 10–15 minutes (90 % of places within about 35): the currents nearly double but the timing hardly moves. The biggest shift is at the east end of Juan de Fuca and in Haro Strait, where slack comes some 10–30 minutes later at springs — small next to the 1–3 h differences from place to place." },
  { id: "eddy", group: "Patterns over the run", label: "Eddy activity", kind: "static",
    values: (m) => m.patEl("eddy"),
    read: "How often the surface water here is spinning faster than it is being stretched, strongly enough to count as an eddy (Okubo–Weiss, |vorticity| > f). Hot spots sit behind headlands and in the lee of islands and passes, where the tide peels off the shore." },
  { id: "none", group: "", label: "None", kind: "none", read: "" },
];

export const MODE = Object.fromEntries(MODES.map((m) => [m.id, m]));
