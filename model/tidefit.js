// The mean of an hourly series once the tide is fitted out: least squares on mean + trend + M2, K1
// and M4 (as pipeline/patterns.py), for the net exchange through the curtains (layers/curtains.js).
// Pure (no three.js), so it's unit-tested (tests/tidefit.test.mjs). With only ~73 hours the
// constituents it can't fit (N2, O1, the spring–neap beat) leak into the mean — the caller checks.
//
//   tidalMean(x[], t[] hours) → the fitted mean

// Least-squares mean of x(t) (t in hours) after fitting a trend and M2, K1, M4.
export function tidalMean(x, t) {
  const W = [28.9841042, 15.0410686, 57.9682084].map((w) => (w * Math.PI) / 180), tm = t.reduce((a, b) => a + b, 0) / t.length, span = (t.at(-1) - t[0]) || 1;
  const rows = t.map((h) => [1, (h - tm) / span, ...W.flatMap((w) => [Math.cos(w * h), Math.sin(w * h)])]), n = rows[0].length;
  const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  rows.forEach((r, k) => { for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] += r[i] * r[j]; A[i][n] += r[i] * x[k]; } });
  for (let c = 0; c < n; c++) {                                          // Gaussian elimination
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j]; }
  }
  return A[0][n] / A[0][0];
}

