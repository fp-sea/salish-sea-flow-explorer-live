// SYNC: wind-volume-explorer web/shell/geo.js@eac80cf Projection. Copied verbatim (channel frames left out).
//
// Region projection. Scene convention: x east,
// y north, z up, all in km, origin at the region bbox centre. The projection is flat
// (equirectangular) at the region's projectionRefLat. That is plenty over a ~300 km
// domain, and it's the same arithmetic the Python pipeline uses.
// pipeline/region.py SceneGrid is the same arithmetic; web/tests/geo.test.mjs checks they agree.

export const KM_PER_DEG_LAT = 110.574;
export const kmPerDegLon = (lat) => 111.320 * Math.cos(lat * Math.PI / 180);

export class Projection {
  constructor(region) {
    const b = region.bbox;
    this.lat0 = (b.latMin + b.latMax) / 2;
    this.lon0 = (b.lonMin + b.lonMax) / 2;
    this.kx = kmPerDegLon(region.projectionRefLat);
    const sw = this.toXY(b.latMin, b.lonMin), ne = this.toXY(b.latMax, b.lonMax);
    this.box = { x0: sw.x, y0: sw.y, x1: ne.x, y1: ne.y };      // the scene, in km
  }
  toXY(lat, lon) { return { x: (lon - this.lon0) * this.kx, y: (lat - this.lat0) * KM_PER_DEG_LAT }; }
  toLatLon(x, y) { return { lat: this.lat0 + y / KM_PER_DEG_LAT, lon: this.lon0 + x / this.kx }; }
  contains(x, y) { const b = this.box; return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1; }
}

// True bearing (0-360) of the vector (dx east, dy north).
export const bearingDeg = (dx, dy) => ((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360;
