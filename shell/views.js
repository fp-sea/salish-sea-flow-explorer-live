// Camera views, generated from the region (config/region.json): the whole basin and each
// subarea, each from above (a chart-like map) and in 3D. A view is a centre in scene km, how much
// ground to fit across the visible part of the screen (span, km), a tilt from straight down
// (0 = map, ~55 = the "3D" look) and the compass direction the camera sits in from the target (az).

// SYNC: wind-volume-explorer web/shell/views.js@eac80cf framing(). Copied verbatim (itself radar-explorer web/views.js@7439092).
// Camera position and target that fit `span` km into the visible rectangle.
// visible: {w, h} in px of the unobscured area; H: full canvas height; fov in degrees.
export function framing(v, center, ctx) {
  const { grid: g, vex, visible, H, fov } = ctx;
  const span = v.span === "grid" ? Math.max(g.x1 - g.x0, g.y1 - g.y0) : Math.min(v.span, Math.max(g.x1 - g.x0, g.y1 - g.y0));
  const k = Math.tan((fov / 2) * Math.PI / 180) * Math.min(visible.w, visible.h) / H;
  const tilt = (v.tilt || 0.3) * Math.PI / 180;           // never exactly overhead: keeps north up
  // A tilted camera sees a stretched footprint; pull in a little so the span still fills the view.
  // Whole-grid views keep the full distance so the near edge stays on screen.
  const d = (span / 2) / k * (1 - (v.span === "grid" ? 0.05 : 0.3) * Math.sin(tilt));
  const az = (v.az ?? 180) * Math.PI / 180;
  const target = { x: center.x, y: center.y, z: (v.lift || 0) * vex };
  const pos = {
    x: target.x + d * Math.sin(tilt) * Math.sin(az),
    y: target.y + d * Math.sin(tilt) * Math.cos(az),
    z: target.z + d * Math.cos(tilt),
  };
  return { pos, target };
}
// END SYNC

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
const norm = (d) => ((d % 360) + 360) % 360;

// All views: [{id, label, group, center: {x, y}, span, tilt, az, lift}].
export function regionViews(region, proj) {
  const b = proj.box, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, az3d = region.view3dAzDeg ?? 200;
  const out = [
    { id: "region-top", group: region.label, label: "Whole basin · from above", center: { x: cx, y: cy }, span: "grid", tilt: 0 },
    { id: "region-3d", group: region.label, label: "Whole basin · 3D", center: { x: cx, y: cy - 20 }, span: "grid", tilt: 50, az: az3d },
  ];
  for (const s of region.subareas) {
    const sw = proj.toXY(s.box.latMin, s.box.lonMin), ne = proj.toXY(s.box.latMax, s.box.lonMax);
    const c = { x: (sw.x + ne.x) / 2, y: (sw.y + ne.y) / 2 }, span = Math.max(ne.x - sw.x, ne.y - sw.y);
    out.push(
      { id: `${s.id}-top`, group: s.label, label: `${s.label} · from above`, center: c, span, tilt: 0, sub: s.id },
      { id: `${s.id}-3d`, group: s.label, label: `${s.label} · 3D`, center: c, span, tilt: 55, az: az3d, sub: s.id },
    );
  }
  return out;
}

export const homeView = (region) => region.homeView || "region-3d";
