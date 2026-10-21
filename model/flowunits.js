// Volume flow (water through a pass or a section, per second) in the page's units: m³/s with the
// metric cards, cubic feet per second (cfs, as US river gauges report) with the feet cards — one
// switch, the ft/m select on the cards (ssfe.units).
//
// fmtFlow(m3s, units) → "36k m³/s" | "1.3 million cfs" (magnitude only; the caller says in/out).
// flowScale(units) → { k, label }: multiply m³/s by k to plot in `label` units (the passes chart).
// tagFlow(m3s, units) → a short map label: "37.1k" | "1.3M cfs" | "200k cfs".

export const CFS = 35.3147;          // ft³ per m³ (0.3048³ m³ per ft³)

const one = (v) => (v < 10 ? Math.round(v * 10) / 10 : Math.round(v)).toLocaleString("en-US");

export function fmtFlow(m3s, units = "ft") {
  const a = Math.abs(m3s);
  if (units !== "ft") return a >= 1000 ? `${one(a / 1000)}k m³/s` : `${Math.round(a)} m³/s`;
  const c = a * CFS;
  if (c >= 1e6) return `${one(c / 1e6)} million cfs`;
  if (c >= 1e4) return `${(Math.round(c / 1000) * 1000).toLocaleString("en-US")} cfs`;
  return `${(Math.round(c / 100) * 100).toLocaleString("en-US")} cfs`;
}

export const flowScale = (units = "ft") => (units === "ft" ? { k: CFS / 1e6, label: "million cfs" } : { k: 1e-3, label: "thousand m³/s" });

export function tagFlow(m3s, units = "ft") {
  const a = Math.abs(m3s);
  const c = a * CFS;
  return units === "ft" ? (c >= 1e6 ? `${one(c / 1e6)}M cfs` : `${Math.round(c / 1000)}k cfs`) : `${Math.round(a / 100) / 10}k`;
}
