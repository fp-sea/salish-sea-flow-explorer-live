// The patch of water the camera actually sees: where rays through the screen meet the water
// surface (z = 0). In a tilted 3D view that's a wedge reaching toward the horizon, not the square
// round the orbit target that a top-down view would see — particles and their grids use this so
// the far side of a tilted view isn't left empty.
//
// Inputs are plain arrays, so this needs no three.js (web/tests/footprint.test.mjs):
//   cam = { pos: [x, y, z], world: camera.matrixWorld.elements, projInv: camera.projectionMatrixInverse.elements }
//   (column-major 4×4, as three.js keeps them). Scene units are km; z up.
// footprint(cam, maxKm) → { x0, y0, x1, y1 } (km): the box round the seen water, rays above the
//   horizon (or ones meeting the surface beyond maxKm) cut off at maxKm from the camera.
// pick(cam, maxKm) → [x, y]: a random spot on the seen water, uniform on the screen (so particles
//   look evenly spread in perspective: dense near the camera on the map, sparse far off), or null.

const mul = (m, x, y, z, w) => [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w,
  m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w];

// The water point seen through screen point (nx, ny) in -1..1. clip: cut far rays at maxKm (else null).
export function hit(cam, nx, ny, maxKm, clip = true) {
  const v = mul(cam.projInv, nx, ny, 0.5, 1), e = mul(cam.world, v[0] / v[3], v[1] / v[3], v[2] / v[3], 1);
  const [px, py, pz] = cam.pos, dx = e[0] / e[3] - px, dy = e[1] / e[3] - py, dz = e[2] / e[3] - pz, L = Math.hypot(dx, dy, dz) || 1;
  const t = dz < 0 ? -pz / dz : Infinity;                           // along (dx, dy, dz) to z = 0
  if (pz > 0 && t * L <= maxKm) return [px + t * dx, py + t * dy];
  if (!clip) return null;
  const hz = Math.hypot(dx, dy); if (!hz) return null;             // above the horizon or too far: the point maxKm out, flat
  return [px + (dx / hz) * maxKm, py + (dy / hz) * maxKm];
}

export function footprint(cam, maxKm) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const N = 6;                                                     // the screen's edge and middle, 7 × 7
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const p = hit(cam, -1 + (2 * i) / N, -1 + (2 * j) / N, maxKm); if (!p) continue;
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
  }
  return x0 < x1 ? { x0, y0, x1, y1 } : null;
}

export function pick(cam, maxKm) {
  for (let k = 0; k < 8; k++) { const p = hit(cam, Math.random() * 2 - 1, Math.random() * 2 - 1, maxKm, false); if (p) return p; }
  return null;
}
