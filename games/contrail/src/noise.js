// Noise and polyline helpers for the theatres' height functions (theatres.js, world.js).
export function hash2(i, j, seed) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z, seed) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j, seed), b = hash2(i + 1, j, seed), c = hash2(i, j + 1, seed), d = hash2(i + 1, j + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** fractal noise in −1..1 at a world point, `scale` metres per base wavelength */
export function fbm(x, z, seed, scale, oct = 5) {
  let a = 1, f = 1 / scale, s = 0, n = 0;
  for (let o = 0; o < oct; o++) {
    s += a * (vnoise(x * f, z * f, seed + o * 131) * 2 - 1);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}
/** ridged noise in 0..1: sharp crests */
export function ridged(x, z, seed, scale, oct = 5) {
  let a = 1, f = 1 / scale, s = 0, n = 0, w = 1;
  for (let o = 0; o < oct; o++) {
    let r = 1 - Math.abs(vnoise(x * f, z * f, seed + o * 71) * 2 - 1);
    r *= r * w; w = Math.min(1, r * 1.6);
    s += a * r; n += a; a *= 0.5; f *= 2.1;
  }
  return s / n;
}
export const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

/** distance from a point to a polyline, with the along-track position (metres) */
export function polyDist(pts, x, z) {
  let best = Infinity, along = 0, run = 0, seg = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (L * L)));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) { best = d; along = run + t * L; seg = k; }
    run += L;
  }
  return { d: best, along, seg };
}
/** the point `s` metres along a polyline, and its direction */
export function polyAt(pts, s) {
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1], L = Math.hypot(bx - ax, bz - az);
    if (s <= L || k + 2 === pts.length) {
      const t = Math.max(0, Math.min(1, s / L));
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / L, dz: (bz - az) / L, end: s >= L && k + 2 === pts.length };
    }
    s -= L;
  }
  return { x: pts[0][0], z: pts[0][1], dx: 1, dz: 0, end: true };
}
export const polyLen = pts => pts.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]), 0);

