// Small drawing helpers shared by the race view: maths, a seeded hash, colours that mix their
// own output (mix() returns rgba(…), which rgb() reads back), offscreen canvases, soft sprites.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = q => (q <= 0 ? 0 : q >= 1 ? 1 : q * q * (3 - 2 * q));
export const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export const hash3 = (a, b, c) => hash(a * 31 + c * 7919, b - c * 104729);
export const strHash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
/** a seeded generator, for painting the same thing every time */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// smooth value noise on a lattice, tiling every `per` cells when given
export function vnoise(x, y, seed = 0, per = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const w = per ? (v => ((v % per) + per) % per) : (v => v);
  const h = (i, j) => hash(w(i) + seed * 1013, w(j) - seed * 7);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, seed = 0, oct = 4, per = 0) {
  let s = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) { s += vnoise(x, y, seed + o, per) * a; n += a; x *= 2; y *= 2; if (per) per *= 2; a *= 0.5; }
  return s / n;
}

// ---------- colour ----------
const cache = new Map();
export function rgb(col) {
  let c = cache.get(col);
  if (!c) {
    if (col[0] === '#') {
      const h = col.length === 4 ? col.slice(1).split('').map(x => x + x).join('') : col.slice(1, 7), n = parseInt(h, 16);
      c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    } else c = col.slice(col.indexOf('(') + 1).split(',', 3).map(Number);
    if (cache.size > 4000) cache.clear();
    cache.set(col, c);
  }
  return c;
}
export const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
export const mix = (h1, h2, t, a = 1) => { const p = rgb(h1), q = rgb(h2), k = clamp(t, 0, 1); return css([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k], a); };
export const alpha = (col, a) => css(rgb(col), a);
export const shadeOf = (col, k) => (k < 0 ? mix(col, '#000000', -k) : mix(col, '#ffffff', k));

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}
/** a soft round puff, white with an alpha falloff: tinted by drawing it on its own colour sprite */
export function puff(size, col = '#ffffff', hard = 0.35) {
  const c = canvas(size, size), g = c.getContext('2d'), r = size / 2, gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, alpha(col, 1)); gr.addColorStop(hard, alpha(col, 0.55)); gr.addColorStop(1, alpha(col, 0));
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}
/** a closed polygon (points [[x, y], …]) with each corner rounded by a curve r along its edges
 *  (or a point's own third value), never more than half an edge */
export function roundPoly(g, pts, r) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n], ri = p[2] ?? r;
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]) || 1, lb = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    const da = Math.min(ri, la / 2), db = Math.min(ri, lb / 2);
    const x0 = p[0] + (a[0] - p[0]) * da / la, y0 = p[1] + (a[1] - p[1]) * da / la;
    if (i) g.lineTo(x0, y0); else g.moveTo(x0, y0);
    if (ri > 0) g.quadraticCurveTo(p[0], p[1], p[0] + (b[0] - p[0]) * db / lb, p[1] + (b[1] - p[1]) * db / lb);
  }
  g.closePath();
}
