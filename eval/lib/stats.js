'use strict';
function wilson(k, n, z = 1.96) {            // selang kepercayaan Wilson untuk proporsi
  if (!n) return [0, 1]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}
const sorted = (a) => a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
function percentile(a, q) { const s = sorted(a); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); }
const median = (a) => percentile(a, 0.5), mean = (a) => { const s = sorted(a); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
module.exports = { wilson, percentile, median, mean };
