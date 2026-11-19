// Geometry: a vertex builder, the low-poly parts it's made of, and every shared mesh (the
// aircraft, the ground units, the ordnance, the wrecks). All of them go into one buffer; each
// mesh is a [first, count] range in it. Mesh space: x right, y up, z back (the nose is −z),
// metres. Parts are closed shapes whose faces are turned to face out from the part's centre,
// so back faces can be culled and the sun lights the outside.
import { hexRGB } from './gl.js';

const rgb = c => (Array.isArray(c) ? c : hexRGB(c).map(v => Math.round(v * 255)));

/** a growable buffer of 20-byte vertices (see gl.js) */
export function builder(cap = 8192) {
  let buf = new ArrayBuffer(cap * 20), f32 = new Float32Array(buf), u8 = new Uint8Array(buf), i8 = new Int8Array(buf), n = 0;
  function grow() {
    cap *= 2;
    const nb = new ArrayBuffer(cap * 20);
    new Uint8Array(nb).set(u8);
    buf = nb; f32 = new Float32Array(buf); u8 = new Uint8Array(buf); i8 = new Int8Array(buf);
  }
  function vert(p, nx, ny, nz, c, k) {
    if (n >= cap) grow();
    const o = n * 5, b = n * 20 + 12;
    f32[o] = p[0]; f32[o + 1] = p[1]; f32[o + 2] = p[2];
    i8[b] = Math.round(nx * 127); i8[b + 1] = Math.round(ny * 127); i8[b + 2] = Math.round(nz * 127); i8[b + 3] = 0;
    u8[b + 4] = c[0]; u8[b + 5] = c[1]; u8[b + 6] = c[2]; u8[b + 7] = k;
    n++;
  }
  /** a triangle (counter-clockwise from the front); with `ref`, turned to face away from it */
  function tri(a, b, c, col, k = 255, ref = null, cols = null) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-9) return;
    nx /= L; ny /= L; nz /= L;
    if (ref) {
      const cx = (a[0] + b[0] + c[0]) / 3 - ref[0], cy = (a[1] + b[1] + c[1]) / 3 - ref[1], cz = (a[2] + b[2] + c[2]) / 3 - ref[2];
      if (nx * cx + ny * cy + nz * cz < 0) { const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; if (cols) cols = [cols[0], cols[2], cols[1]]; }
    }
    const c0 = cols ? cols[0] : col, c1 = cols ? cols[1] : col, c2 = cols ? cols[2] : col;
    vert(a, nx, ny, nz, c0, k); vert(b, nx, ny, nz, c1, k); vert(c, nx, ny, nz, c2, k);
  }
  function quad(a, b, c, d, col, k, ref) { tri(a, b, c, col, k, ref); tri(a, c, d, col, k, ref); }
  return { vert, tri, quad, get n() { return n; }, data: () => buf.slice(0, n * 20) };
}

// ---------- parts (each takes a builder, a transform and a colour) ----------
// a transform: [ox, oy, oz] offset, yaw (about y), pitch (about x), scale
function xf(T) {
  const [ox, oy, oz] = T.at ?? [0, 0, 0], cy = Math.cos(T.yaw ?? 0), sy = Math.sin(T.yaw ?? 0), cp = Math.cos(T.pitch ?? 0), sp = Math.sin(T.pitch ?? 0);
  const cr = Math.cos(T.roll ?? 0), sr = Math.sin(T.roll ?? 0), s = T.s ?? 1;
  return ([x, y, z]) => {
    x *= s; y *= s; z *= s;
    // roll about z, pitch about x, then yaw about y
    let x1 = x * cr - y * sr, y1 = x * sr + y * cr;
    const y2 = y1 * cp - z * sp, z2 = y1 * sp + z * cp;
    const x3 = x1 * cy + z2 * sy, z3 = -x1 * sy + z2 * cy;
    return [x3 + ox, y2 + oy, z3 + oz];
  };
}
export function box(B, T, [sx, sy, sz], col, k = 255) {
  const P = xf(T), c = rgb(col), hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const v = [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz], [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]].map(P);
  const ref = P([0, 0, 0]);
  for (const [a, b, cc, d] of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) B.quad(v[a], v[b], v[cc], v[d], c, k, ref);
}
/** a tapered box: bottom sx × sz, top tx × tz, height sy, standing on its base */
export function frustum(B, T, [sx, sy, sz], [tx, tz], col, k = 255) {
  const P = xf(T), c = rgb(col), ref = P([0, sy / 2, 0]);
  const v = [[-sx / 2, 0, -sz / 2], [sx / 2, 0, -sz / 2], [tx / 2, sy, -tz / 2], [-tx / 2, sy, -tz / 2], [-sx / 2, 0, sz / 2], [sx / 2, 0, sz / 2], [tx / 2, sy, tz / 2], [-tx / 2, sy, tz / 2]].map(P);
  for (const [a, b, cc, d] of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) B.quad(v[a], v[b], v[cc], v[d], c, k, ref);
}
/** a cylinder (or cone, r1 at the top) along y from 0 to h, n sides */
export function cyl(B, T, r0, r1, h, n, col, k = 255, caps = true) {
  const P = xf(T), c = rgb(col), ref = P([0, h / 2, 0]);
  const ring = (r, y) => Array.from({ length: n }, (_, i) => P([Math.cos((i / n) * Math.PI * 2) * r, y, Math.sin((i / n) * Math.PI * 2) * r]));
  const lo = ring(r0, 0), hi = ring(r1, h), top = P([0, h, 0]), bot = P([0, 0, 0]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (r1 > 0.001) B.quad(lo[i], lo[j], hi[j], hi[i], c, k, ref); else B.tri(lo[i], lo[j], top, c, k, ref);
    if (caps && r1 > 0.001) B.tri(hi[i], hi[j], top, c, k, bot);
    if (caps) B.tri(lo[i], lo[j], bot, c, k, top);
  }
}
/** a hull lofted through cross-sections: [[z, halfWidth, halfHeight, yOffset], …] with n sides */
export function loft(B, T, secs, n, col, k = 255, flat = 1) {
  const P = xf(T), c = rgb(col);
  const ring = ([z, w, h, y]) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    const sy = Math.sin(a);
    return P([Math.cos(a) * w, (sy < 0 ? sy * flat : sy) * h + (y ?? 0), z]);
  });
  const rings = secs.map(ring), mid = secs.map(([z, , , y]) => P([0, y ?? 0, z]));
  for (let s = 0; s + 1 < rings.length; s++) {
    const A = rings[s], Bq = rings[s + 1], ref = P([0, ((secs[s][3] ?? 0) + (secs[s + 1][3] ?? 0)) / 2, (secs[s][0] + secs[s + 1][0]) / 2]);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      B.tri(A[i], A[j], Bq[j], c, k, ref);
      B.tri(A[i], Bq[j], Bq[i], c, k, ref);
    }
  }
  // the ends (if not already points)
  for (const [s, other] of [[0, 1], [rings.length - 1, rings.length - 2]]) {
    if (secs[s][1] < 0.01) continue;
    for (let i = 0; i < n; i++) B.tri(rings[s][i], rings[s][(i + 1) % n], mid[s], c, k, mid[other]);
  }
}
/** a flat plate: a convex outline in the x–z plane (at y), t thick; dihedral tilts it (radians) */
export function plate(B, T, pts, t, col, k = 255) {
  const P = xf(T), c = rgb(col);
  const top = pts.map(([x, z, y = 0]) => P([x, y + t / 2, z])), bot = pts.map(([x, z, y = 0]) => P([x, y - t / 2, z]));
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length, cy = pts.reduce((s, p) => s + (p[2] ?? 0), 0) / pts.length;
  const up = P([cx, cy + 50, cz]), dn = P([cx, cy - 50, cz]), mid = P([cx, cy, cz]);
  for (let i = 1; i + 1 < pts.length; i++) {
    B.tri(top[0], top[i], top[i + 1], c, k, dn);
    B.tri(bot[0], bot[i], bot[i + 1], c, k, up);
  }
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    B.quad(top[i], top[j], bot[j], bot[i], c, k, mid);
  }
}
/** a vertical fin: an outline in the z–y plane (at x), t thick */
export function fin(B, T, pts, t, col, k = 255) {
  plate(B, { ...T, roll: (T.roll ?? 0) + Math.PI / 2 }, pts.map(([z, y]) => [y, z]), t, col, k);
}
const mirror = pts => pts.map(([x, z, y]) => [-x, z, y]).reverse();

// ---------- the aircraft ----------
function jet(B, { body, belly, trim, glass, size = 1 }) {
  const s = size;
  // fuselage: nose to tail
  loft(B, { s }, [[-8.4, 0.02, 0.02, 0.1], [-6.6, 0.45, 0.42, 0.1], [-4, 0.78, 0.7, 0.15], [-1, 0.95, 0.75, 0.1], [3, 1.1, 0.7, 0], [6.6, 0.9, 0.55, 0], [7.6, 0.62, 0.5, 0]], 8, body, 255, 0.8);
  loft(B, { s }, [[-5.2, 0.05, 0.05, 0.5], [-4.2, 0.42, 0.38, 0.62], [-2.2, 0.48, 0.42, 0.62], [-0.6, 0.2, 0.15, 0.55]], 6, glass);
  // intakes
  for (const side of [-1, 1]) box(B, { at: [side * 1.25 * s, -0.2 * s, 0.8 * s], s }, [0.7, 0.9, 5.2], belly);
  // delta wing with a little sweep at the root
  const wing = [[1.0, -2.6], [5.1, 3.6], [5.1, 5.2], [1.0, 5.6]];
  plate(B, { at: [0, -0.15 * s, 0], s }, wing, 0.22, body);
  plate(B, { at: [0, -0.15 * s, 0], s }, mirror(wing), 0.22, body);
  // canards
  const can = [[0.8, -4.6], [2.6, -3.5], [2.6, -3.0], [0.8, -3.2]];
  plate(B, { at: [0, 0.15 * s, 0], s }, can, 0.15, trim);
  plate(B, { at: [0, 0.15 * s, 0], s }, mirror(can), 0.15, trim);
  // twin canted fins
  for (const side of [-1, 1]) fin(B, { at: [side * 0.95 * s, 0.4 * s, 0], s, roll: side * -0.22 }, [[3.6, 0], [6.9, 0], [7.4, 2.9], [6.4, 2.9]], 0.18, trim);
  // nozzle
  cyl(B, { at: [0, 0, 7.4 * s], s, pitch: Math.PI / 2 }, 0.6, 0.55, 0.9, 8, '#3b3b3f');
}
function fighter(B, { body, trim, glass }) {
  loft(B, {}, [[-8, 0.02, 0.02, 0], [-5.8, 0.5, 0.5, 0], [-2.5, 0.95, 0.8, 0.05], [2, 1.15, 0.85, 0], [6.4, 0.95, 0.7, 0], [7.4, 0.7, 0.6, 0]], 8, body, 255, 0.85);
  loft(B, {}, [[-4.8, 0.05, 0.05, 0.55], [-3.6, 0.42, 0.42, 0.7], [-1.6, 0.45, 0.4, 0.7], [0.2, 0.15, 0.12, 0.6]], 6, glass);
  const wing = [[1.0, -1.4], [6.0, 3.2], [6.0, 4.2], [1.0, 4.4]];
  plate(B, { at: [0, -0.3, 0] }, wing.map(([x, z]) => [x, z, -0.05 * x]), 0.24, body);
  plate(B, { at: [0, -0.3, 0] }, mirror(wing.map(([x, z]) => [x, z, -0.05 * x])), 0.24, body);
  const tail = [[0.6, 4.8], [3.2, 6.8], [3.2, 7.4], [0.6, 7.4]];
  plate(B, { at: [0, 0, 0] }, tail, 0.16, body);
  plate(B, { at: [0, 0, 0] }, mirror(tail), 0.16, body);
  fin(B, { at: [0, 0.6, 0] }, [[3.4, 0], [7.2, 0], [7.6, 3.6], [6.2, 3.6]], 0.2, trim);
  for (const side of [-1, 1]) box(B, { at: [side * 1.2, -0.25, -0.5] }, [0.6, 0.9, 4], trim);
  cyl(B, { at: [0, 0, 7.3], pitch: Math.PI / 2 }, 0.62, 0.55, 0.8, 8, '#2e2e30');
}
function bomber(B) {
  const body = '#6f7563', dark = '#4d5246', glass = '#1d2a36';
  loft(B, {}, [[-18, 0.05, 0.05, 0.2], [-15.5, 1.5, 1.6, 0.2], [-11, 2.4, 2.4, 0], [8, 2.5, 2.5, 0], [14, 1.6, 2.0, 0.6], [18, 0.4, 0.6, 1.4]], 8, body);
  loft(B, {}, [[-16.8, 0.1, 0.1, 1.2], [-15.8, 1.2, 0.8, 1.5], [-13.2, 1.3, 0.7, 1.6], [-12, 0.2, 0.2, 1.6]], 6, glass);
  const wing = [[2, -3], [22, 1], [22, 4], [2, 5]];
  plate(B, { at: [0, 0.6, 0] }, wing.map(([x, z]) => [x, z, 0.04 * x]), 0.6, body);
  plate(B, { at: [0, 0.6, 0] }, mirror(wing.map(([x, z]) => [x, z, 0.04 * x])), 0.6, body);
  for (const x of [-13, -7, 7, 13]) loft(B, { at: [x, 0.1 + Math.abs(x) * 0.04, 0] }, [[-4, 0.3, 0.3, 0], [-3, 0.9, 0.9, 0], [2, 0.9, 0.9, 0], [3, 0.6, 0.6, 0]], 6, dark);
  const tail = [[1, 13], [8.5, 16.5], [8.5, 18], [1, 18]];
  plate(B, { at: [0, 1.2, 0] }, tail, 0.3, body);
  plate(B, { at: [0, 1.2, 0] }, mirror(tail), 0.3, body);
  fin(B, { at: [0, 2, 0] }, [[11, 0], [18, 0], [19, 7], [16, 7]], 0.3, dark);
}
function courier(B) {
  const body = '#e4e6e8', stripe = '#2f6fc0', glass = '#1d2a36';
  loft(B, {}, [[-14, 0.05, 0.05, 0], [-12, 1.4, 1.4, 0], [-8, 2.1, 2.1, 0.1], [7, 2.1, 2.1, 0.1], [12, 1.0, 1.4, 0.9], [14, 0.3, 0.4, 1.6]], 8, body);
  loft(B, {}, [[-12.6, 0.1, 0.1, 0.9], [-11.8, 1.1, 0.6, 1.2], [-10.2, 1.2, 0.6, 1.3], [-9.4, 0.2, 0.2, 1.3]], 6, glass);
  box(B, { at: [0, -0.2, -1] }, [4.3, 0.6, 12], stripe);
  const wing = [[1.5, -3], [16, -1.5], [16, 0.8], [1.5, 1.2]];
  plate(B, { at: [0, 2.1, 0] }, wing, 0.5, body);
  plate(B, { at: [0, 2.1, 0] }, mirror(wing), 0.5, body);
  for (const x of [-6.5, 6.5]) loft(B, { at: [x, 1.4, 0] }, [[-5, 0.3, 0.3, 0], [-4, 0.85, 0.85, 0], [1, 0.8, 0.8, 0], [2.5, 0.3, 0.3, 0]], 6, '#9aa3ac');
  fin(B, { at: [0, 1.8, 0] }, [[9, 0], [14, 0], [15, 5.5], [12.5, 5.5]], 0.3, stripe);
  const tail = [[0.3, 13.6], [5.5, 14.8], [5.5, 15.8], [0.3, 15.8]];
  plate(B, { at: [0, 7.2, 0] }, tail, 0.25, body);
  plate(B, { at: [0, 7.2, 0] }, mirror(tail), 0.25, body);
}

// ---------- ground units ----------
function radar(B) {
  frustum(B, {}, [14, 5, 14], [11, 11], '#8a8c86');
  box(B, { at: [0, 6, 0] }, [6, 2.5, 6], '#6e716b');
  cyl(B, { at: [0, 7, 0] }, 1, 0.8, 8, 6, '#a0a29c');
}
function dish(B) {
  // a curved bar dish, turning about y
  for (let i = -3; i <= 3; i++) box(B, { at: [i * 2.3, 1.5 - Math.abs(i) * 0.1, Math.abs(i) * Math.abs(i) * 0.12], yaw: -i * 0.08 }, [2.35, 5, 0.6], '#d8dad4');
  box(B, { at: [0, 0, 0] }, [2, 2, 2], '#6e716b');
}
function aa(B) {
  cyl(B, {}, 7, 6.5, 1.6, 8, '#8b7d5a');
  box(B, { at: [0, 1.6, 0] }, [3.6, 1.6, 3.6], '#5d6250');
  for (const x of [-0.7, 0.7]) box(B, { at: [x, 3.2, -2.4], pitch: 0.75 }, [0.35, 0.35, 5.4], '#33352f');
}
function sam(B) {
  box(B, { at: [0, 1, 0] }, [4.6, 2, 9], '#6d7356');
  box(B, { at: [0, 2.6, 3.2] }, [4.4, 1.6, 2.6], '#5a5f47');
  const T = { at: [0, 3.4, -0.6], pitch: 0.6 };
  box(B, T, [3.6, 0.6, 7.2], '#4a4e3b');
  for (const x of [-1.1, 1.1]) cyl(B, { at: [x, 3.95, 3.0], pitch: -Math.PI / 2 + 0.6 }, 0.42, 0.06, 7.4, 6, '#e8e6dc');
}
function depot(B) {
  cyl(B, {}, 11, 11, 9, 12, '#d6d8d2');
  cyl(B, { at: [0, 9, 0] }, 11, 3, 2.2, 12, '#c4c6c0');
  box(B, { at: [14, 1.2, 0] }, [8, 2.4, 2], '#7b7d78');
  cyl(B, { at: [-15, 0, 6] }, 5, 5, 6, 10, '#d6d8d2');
}
function hangar(B) {
  // a barrel roof along z
  const n = 7, R = 15, L = 46, P = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; P.push([Math.cos(a) * R, Math.sin(a) * R * 0.75]); }
  for (let i = 0; i < n; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[i + 1];
    B.quad([x0, y0, -L / 2], [x1, y1, -L / 2], [x1, y1, L / 2], [x0, y0, L / 2], rgb('#7d8288'), 255, [0, 0, 0]);
    B.tri([0, 0, -L / 2], [x0, y0, -L / 2], [x1, y1, -L / 2], rgb('#5c6066'), 255, [0, 4, 0]);
    B.tri([0, 0, L / 2], [x0, y0, L / 2], [x1, y1, L / 2], rgb('#5c6066'), 255, [0, 4, 0]);
  }
  box(B, { at: [0, 4.5, -L / 2 - 0.1] }, [18, 9, 0.4], '#2c2f33');
}
function bridge(B, hl) {
  // the deck runs along z (the actor's f), its top at y 0
  box(B, { at: [0, -1.5, 0] }, [14, 3, hl * 2], '#7a756c');
  for (const x of [-6.6, 6.6]) {
    box(B, { at: [x, 2.2, 0] }, [0.6, 0.6, hl * 2], '#5b5750');
    for (let z = -hl + 12; z < hl; z += 24) box(B, { at: [x, 1.1, z], pitch: 0.5 }, [0.5, 0.5, 7], '#5b5750');
  }
  for (const z of [-hl * 0.55, 0, hl * 0.55]) box(B, { at: [0, -45, z] }, [8, 84, 8], '#8a847a');
}
function ship(B, L, tender) {
  const hull = '#5d6670', deck = '#8b8e86', h = L / 2;
  loft(B, { at: [0, 0, 0] }, [[-h, 0.1, 0.4, 2], [-h * 0.75, L * 0.09, 2.4, 1.2], [h * 0.6, L * 0.1, 2.6, 1.1], [h, L * 0.08, 2.4, 1.2]], 8, hull, 255, 0.6);
  box(B, { at: [0, 3.3, 0] }, [L * 0.17, 0.4, L * 0.9], deck);
  box(B, { at: [0, 6, h * 0.25] }, [L * 0.12, 5.5, L * 0.18], '#c9ccc4');
  box(B, { at: [0, 10, h * 0.2] }, [L * 0.08, 3, L * 0.08], '#9fa39b');
  cyl(B, { at: [0, 11, h * 0.25] }, 0.3, 0.3, 8, 4, '#3a3d40');
  if (tender) {
    for (const z of [-h * 0.55, -h * 0.2]) box(B, { at: [0, 5, z] }, [L * 0.13, 3.2, L * 0.14], '#a5552c');
    box(B, { at: [0, 11, -h * 0.38], pitch: 0.6 }, [0.6, 0.6, 16], '#d8a530');
  } else {
    box(B, { at: [0, 4.4, -h * 0.55] }, [2.4, 1.6, 2.4], '#41454a');
    box(B, { at: [0, 4.8, -h * 0.75] }, [0.4, 0.4, 3.4], '#26282b');
  }
}
function truck(B, flak) {
  box(B, { at: [0, 1.4, -2.9] }, [2.5, 2.4, 2.2], '#6c6450');
  box(B, { at: [0, 0.8, 0.9] }, [2.5, 0.6, 5.6], '#4b4537');
  if (flak) {
    box(B, { at: [0, 1.8, 1.2] }, [1.8, 1.4, 1.8], '#5d6250');
    box(B, { at: [0, 2.8, 0.2], pitch: 0.8 }, [0.3, 0.3, 3.6], '#2a2b27');
  } else box(B, { at: [0, 2.2, 1] }, [2.5, 2.4, 5.2], '#8d7f5c');
  for (const z of [-2.6, 0, 2.4]) for (const x of [-1.25, 1.25]) box(B, { at: [x, 0.5, z] }, [0.5, 1, 1], '#1f1f1f');
}
function factory(B) {
  box(B, { at: [0, 8, 0] }, [56, 16, 66], '#7b4a3a');
  for (let i = 0; i < 5; i++) {
    const z = -26 + i * 13;
    frustum(B, { at: [0, 16, z] }, [56, 5, 12], [56, 1], '#5b3d33');
  }
  cyl(B, { at: [20, 0, 26] }, 2.6, 2, 42, 8, '#6a4a40');
  cyl(B, { at: [-18, 0, 30] }, 2.2, 1.8, 32, 8, '#6a4a40');
}
function bunker(B) {
  frustum(B, {}, [62, 11, 62], [40, 40], '#7e7e74');
  frustum(B, { at: [0, 11, 0] }, [18, 4, 18], [12, 12], '#6a6a62');
  box(B, { at: [0, 3.5, -27] }, [14, 7, 8], '#3a3a36');
  cyl(B, { at: [14, 11, 10] }, 0.4, 0.2, 16, 4, '#2e2e2c');
}
function wreck(B) {
  for (const [x, z, sx, sy, sz, yaw] of [[0, 0, 7, 1.6, 9, 0.3], [5, -6, 4, 1, 3, 1], [-6, 4, 3, 2.2, 4, 0.7], [3, 7, 5, 0.8, 3, 2]]) box(B, { at: [x, sy / 2, z], yaw }, [sx, sy, sz], '#2c2723');
}

// ---------- ordnance ----------
function missile(B) {
  cyl(B, { pitch: -Math.PI / 2 }, 0.32, 0.32, 3.4, 6, '#e8e8e2');
  cyl(B, { at: [0, 0, -3.4], pitch: -Math.PI / 2 }, 0.32, 0.01, 0.9, 6, '#cfcfc8');
  for (const r of [0, Math.PI / 2]) {
    plate(B, { roll: r }, [[-1.1, -0.2], [1.1, -0.2], [0, 0.9]].map(([x, z]) => [x, z]), 0.06, '#b0b0a8');
  }
}
function bomb(B) {
  loft(B, {}, [[-1.4, 0.05, 0.05, 0], [-1, 0.33, 0.33, 0], [0.6, 0.33, 0.33, 0], [1.2, 0.12, 0.12, 0]], 6, '#4e5543');
  plate(B, {}, [[-0.6, 0.9], [0.6, 0.9], [0.6, 1.4], [-0.6, 1.4]], 0.05, '#4e5543');
}

/** every shared mesh in one buffer: { buffer data, ranges: { name: [first, count] } } */
export function buildMeshes() {
  const B = builder(32768), ranges = {};
  const add = (name, fn) => { const s = B.n; fn(B); ranges[name] = [s, B.n - s]; };
  add('player', B => jet(B, { body: '#bfc6cc', belly: '#8e979f', trim: '#2f5e9c', glass: '#1b2c44' }));
  add('fighter', B => fighter(B, { body: '#8a7258', trim: '#a43a2a', glass: '#232a2e' }));
  add('ace', B => fighter(B, { body: '#2b2b31', trim: '#c4372a', glass: '#4a1d1a' }));
  add('bomber', bomber);
  add('courier', courier);
  add('radar', radar);
  add('dish', dish);
  add('aa', aa);
  add('sam', sam);
  add('depot', depot);
  add('hangar', hangar);
  add('bridge', B => bridge(B, 200));
  add('tender', B => ship(B, 96, true));
  add('gunboat', B => ship(B, 44, false));
  add('truck', B => truck(B, false));
  add('flaktruck', B => truck(B, true));
  add('factory', factory);
  add('bunker', bunker);
  add('wreck', wreck);
  add('missile', missile);
  add('bomb', bomb);
  return { data: B.data(), ranges };
}
