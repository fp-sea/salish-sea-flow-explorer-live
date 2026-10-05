// Colour ramps and keys shared by the layers.
//
// Current speed (kt): wind-volume-explorer's currents ramp (web/layers/currents.js@eac80cf RAMP,
// SYNC, verbatim), blue slack → green → yellow → red at 5.5 kt+.
// SYNC: wind-volume-explorer web/layers/currents.js@eac80cf RAMP, rampAt. Copied verbatim.
const RAMP = [[0, [0.25, 0.5, 0.8]], [1, [0.35, 0.66, 0.9]], [2, [0.25, 0.76, 0.65]], [3, [0.95, 0.82, 0.29]], [4, [0.95, 0.6, 0.23]], [5.5, [0.88, 0.28, 0.24]]];
export const rampAt = (kt) => { for (let i = 1; i < RAMP.length; i++) if (kt <= RAMP[i][0]) { const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i], f = (kt - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * f); } return RAMP.at(-1)[1]; };
// END SYNC

const lerpStops = (S) => (x) => {
  if (x <= S[0][0]) return S[0][1];
  for (let i = 1; i < S.length; i++) if (x <= S[i][0]) { const [a, ca] = S[i - 1], [b, cb] = S[i], f = (x - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * f); }
  return S.at(-1)[1];
};

// The ramps the mesh fill can use: f(t) for t in 0..1 → [r, g, b] 0..1, plus a value range and key ticks.
export const RAMPS = {
  // Fill: dark at slack so the fast water lights up (the particles keep WVE's ramp above).
  speed: { f: lerpStops([[0, [0.05, 0.09, 0.20]], [0.08, [0.10, 0.22, 0.42]], [0.2, [0.13, 0.42, 0.62]], [0.36, [0.16, 0.64, 0.62]],
    [0.52, [0.55, 0.80, 0.36]], [0.68, [0.96, 0.83, 0.30]], [0.84, [0.95, 0.52, 0.20]], [1, [0.84, 0.18, 0.20]]]),
    min: 0, max: 6, unit: "kt", ticks: [0, 1, 2, 3, 4, 5, 6], title: "Current speed (kt)" },
  // Flood (into the inland sea, as defined per place: see guide) blue, ebb orange, slack pale.
  along: { f: lerpStops([[0, [0.80, 0.42, 0.10]], [0.3, [0.95, 0.68, 0.38]], [0.5, [0.94, 0.94, 0.90]], [0.7, [0.45, 0.68, 0.92]], [1, [0.10, 0.34, 0.72]]]),
    min: -4, max: 4, unit: "kt", ticks: [-4, -2, 0, 2, 4], title: "Along the channel: ebb (−) · slack · flood (+), kt" },
  // Water level: low brown-orange, mean pale, high blue-violet.
  level: { f: lerpStops([[0, [0.55, 0.30, 0.12]], [0.25, [0.88, 0.62, 0.36]], [0.5, [0.95, 0.95, 0.92]], [0.75, [0.50, 0.72, 0.90]], [1, [0.26, 0.24, 0.62]]]),
    min: -2.5, max: 2.5, unit: "m", ticks: [-2.5, -1, 0, 1, 2.5], title: "Water level vs the model's datum (m)" },
  // Phase lag |slack − HW/LW|: 0 h standing (blue) → 3.1 h progressive (red).
  lag: { f: lerpStops([[0, [0.19, 0.29, 0.62]], [0.2, [0.36, 0.56, 0.78]], [0.45, [0.92, 0.92, 0.80]], [0.7, [0.96, 0.62, 0.34]], [1, [0.70, 0.13, 0.15]]]),
    min: 0, max: 3.1, unit: "h", ticks: [0, 1, 2, 3.1], title: "Slack after/before high or low water (h)" },
  // Spin (relative vorticity / f): clockwise orange-red, none pale, anticlockwise blue-violet.
  spin: { f: lerpStops([[0, [0.75, 0.20, 0.10]], [0.35, [0.96, 0.64, 0.38]], [0.5, [0.95, 0.95, 0.92]], [0.65, [0.52, 0.66, 0.92]], [1, [0.30, 0.18, 0.62]]]),
    min: -8, max: 8, unit: "f", ticks: [-8, -4, 0, 4, 8], title: "Spin: vorticity ÷ f (− clockwise · + anticlockwise)" },
  // Arrival times along the tide wave (hours after the entrance).
  hwtime: { f: lerpStops([[0, [0.27, 0.12, 0.45]], [0.25, [0.20, 0.38, 0.66]], [0.5, [0.16, 0.62, 0.62]], [0.75, [0.62, 0.80, 0.36]], [1, [0.98, 0.86, 0.36]]]),
    min: -0.5, max: 5.5, unit: "h", ticks: [0, 1, 2, 3, 4, 5], title: "High water arrives, hours after the ocean entrance" },
  fltime: { f: lerpStops([[0, [0.27, 0.12, 0.45]], [0.25, [0.20, 0.38, 0.66]], [0.5, [0.16, 0.62, 0.62]], [0.75, [0.62, 0.80, 0.36]], [1, [0.98, 0.86, 0.36]]]),
    min: -1, max: 5, unit: "h", ticks: [-1, 0, 1, 2, 3, 4, 5], title: "Strongest flood arrives, hours after HW at the entrance" },
  strength: null, drift: null, shear: null,
  diurnal: { f: lerpStops([[0, [0.13, 0.36, 0.62]], [0.5, [0.92, 0.92, 0.86]], [1, [0.78, 0.32, 0.12]]]), min: 0, max: 1, unit: "", ticks: [0, 0.25, 0.5, 0.75, 1], title: "Daily share of the tidal current: 0 twice-daily · 1 daily" },
  rotary: { f: lerpStops([[0, [0.10, 0.18, 0.30]], [0.3, [0.20, 0.50, 0.60]], [0.6, [0.70, 0.82, 0.50]], [1, [0.98, 0.90, 0.60]]]), min: 0, max: 1, unit: "", ticks: [0, 0.5, 1], title: "Current turns: 0 back-and-forth · 1 round in a circle" },
  dominance: { f: lerpStops([[0, [0.80, 0.42, 0.10]], [0.5, [0.94, 0.94, 0.90]], [1, [0.10, 0.34, 0.72]]]), min: -0.5, max: 0.5, unit: "", ticks: [-0.5, 0, 0.5], title: "Ebb-dominant (−) · balanced · flood-dominant (+)" },
  eddy: { f: lerpStops([[0, [0.07, 0.10, 0.18]], [0.25, [0.30, 0.20, 0.50]], [0.55, [0.78, 0.30, 0.50]], [1, [1.0, 0.82, 0.45]]]), min: 0, max: 0.5, unit: "", ticks: [0, 0.1, 0.2, 0.3, 0.4, 0.5], title: "Eddy activity: share of hours the water spins" },
};
// Sequential "how much" ramps (dark → bright), shared by strength, drift and shear.
const SEQ = lerpStops([[0, [0.05, 0.09, 0.20]], [0.15, [0.13, 0.30, 0.52]], [0.35, [0.16, 0.58, 0.62]], [0.6, [0.62, 0.80, 0.36]], [0.8, [0.96, 0.70, 0.28]], [1, [0.86, 0.22, 0.20]]]);
RAMPS.strength = { f: SEQ, min: 0, max: 5, unit: "kt", ticks: [0, 1, 2, 3, 4, 5], title: "Peak tidal current in this run (kt)" };
RAMPS.drift = { f: SEQ, min: 0, max: 0.6, unit: "kt", ticks: [0, 0.2, 0.4, 0.6], title: "Net drift over the run (kt)" };
RAMPS.shear = { f: SEQ, min: 0, max: 1, unit: "kt", ticks: [0, 0.25, 0.5, 0.75, 1], title: "Surface vs whole-column difference (kt, rms)" };
// Comparing the lab runs (modes.js "Compare the tides"): how many times stronger at springs; how
// much slack shifts (spring minus neap, diverging about zero).
RAMPS.cmp_strength = { f: SEQ, min: 1, max: 2.5, unit: "×", ticks: [1, 1.5, 2, 2.5], title: "Tidal current, spring ÷ neap (×)" };
RAMPS.cmp_lag = { f: lerpStops([[0, [0.19, 0.29, 0.62]], [0.3, [0.55, 0.68, 0.86]], [0.42, [0.93, 0.93, 0.92]], [0.58, [0.93, 0.93, 0.92]], [0.7, [0.96, 0.70, 0.45]], [1, [0.70, 0.13, 0.15]]]),
  min: -1, max: 1, unit: "h", ticks: [-1, -0.5, 0, 0.5, 1], title: "Slack vs HW/LW: spring minus neap (h; − earlier at springs)" };

// A 256×1 RGBA texture of a ramp (for the shader) and a CSS gradient (for the key).
export function rampPixels(name) {
  const R = RAMPS[name], px = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) { const c = R.f(i / 255); px.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], i * 4); }
  return px;
}
export function rampCss(name) {
  const R = RAMPS[name];
  return `linear-gradient(90deg, ${[...Array(11).keys()].map((i) => { const c = R.f(i / 10); return `rgb(${c.map((v) => Math.round(v * 255)).join(",")}) ${i * 10}%`; }).join(", ")})`;
}
