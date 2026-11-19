// Mesh building: a growable buffer of the engine's 20-byte vertices and the low-poly parts
// meshes are made of. Pure and DOM-free (`@nostalgia/gl/mesh`). Mesh space: x right, y up,
// z back (a vehicle's nose is −z), metres. Parts are closed shapes whose faces are turned to
// face out from the part's centre, so back faces can be culled and the sun lights the outside.
//
// Vertex layout (20 bytes): position f32 × 3, normal i8 × 4 (normalised), colour u8 × 4; the
// colour's alpha (the "kind") is 255 for lit surfaces, 128 for water, 0 for things that glow.
import { hexRGB, type V3 } from './math.ts';

/** a colour: '#rrggbb' / 'rgb(…)', or [r, g, b] in 0..255 */
export type Colour = string | ArrayLike<number>;
/** bytes per vertex */
export const STRIDE = 20;

const rgb = (c: Colour): ArrayLike<number> => (typeof c === 'string' ? hexRGB(c).map(v => Math.round(v * 255)) : c);

export interface Builder {
  /** one vertex: position, unit normal, colour [r, g, b] 0..255, kind (colour alpha) */
  vert(p: V3, nx: number, ny: number, nz: number, c: ArrayLike<number>, k: number): void;
  /** a flat triangle, counter-clockwise from the front; with `ref`, turned to face away from it; `cols` per vertex */
  tri(
    a: V3,
    b: V3,
    c: V3,
    col: ArrayLike<number> | null,
    k?: number,
    ref?: V3 | null,
    cols?: ArrayLike<number>[] | null,
  ): void;
  /** two triangles a b c, a c d */
  quad(a: V3, b: V3, c: V3, d: V3, col: ArrayLike<number>, k?: number, ref?: V3 | null): void;
  /** vertices so far */
  readonly n: number;
  /** a copy of the vertices so far */
  data(): ArrayBuffer;
}

/** a growable buffer of 20-byte vertices */
export function builder(cap = 8192): Builder {
  let buf = new ArrayBuffer(cap * 20),
    f32 = new Float32Array(buf),
    u8 = new Uint8Array(buf),
    i8 = new Int8Array(buf),
    n = 0;
  function grow() {
    cap *= 2;
    const nb = new ArrayBuffer(cap * 20);
    new Uint8Array(nb).set(u8);
    buf = nb;
    f32 = new Float32Array(buf);
    u8 = new Uint8Array(buf);
    i8 = new Int8Array(buf);
  }
  function vert(p: V3, nx: number, ny: number, nz: number, c: ArrayLike<number>, k: number) {
    if (n >= cap) grow();
    const o = n * 5,
      b = n * 20 + 12;
    f32[o] = p[0];
    f32[o + 1] = p[1];
    f32[o + 2] = p[2];
    i8[b] = Math.round(nx * 127);
    i8[b + 1] = Math.round(ny * 127);
    i8[b + 2] = Math.round(nz * 127);
    i8[b + 3] = 0;
    u8[b + 4] = c[0];
    u8[b + 5] = c[1];
    u8[b + 6] = c[2];
    u8[b + 7] = k;
    n++;
  }
  function tri(
    a: V3,
    b: V3,
    c: V3,
    col: ArrayLike<number> | null,
    k = 255,
    ref: V3 | null = null,
    cols: ArrayLike<number>[] | null = null,
  ) {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2],
      vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-9) return;
    nx /= L;
    ny /= L;
    nz /= L;
    if (ref) {
      const cx = (a[0] + b[0] + c[0]) / 3 - ref[0],
        cy = (a[1] + b[1] + c[1]) / 3 - ref[1],
        cz = (a[2] + b[2] + c[2]) / 3 - ref[2];
      if (nx * cx + ny * cy + nz * cz < 0) {
        const t = b;
        b = c;
        c = t;
        nx = -nx;
        ny = -ny;
        nz = -nz;
        if (cols) cols = [cols[0], cols[2], cols[1]];
      }
    }
    const c0 = cols ? cols[0] : col!,
      c1 = cols ? cols[1] : col!,
      c2 = cols ? cols[2] : col!;
    vert(a, nx, ny, nz, c0, k);
    vert(b, nx, ny, nz, c1, k);
    vert(c, nx, ny, nz, c2, k);
  }
  function quad(a: V3, b: V3, c: V3, d: V3, col: ArrayLike<number>, k?: number, ref?: V3 | null) {
    tri(a, b, c, col, k, ref);
    tri(a, c, d, col, k, ref);
  }
  return {
    vert,
    tri,
    quad,
    get n() {
      return n;
    },
    data: () => buf.slice(0, n * 20),
  };
}

/** where a part goes: offset, yaw (about y), pitch (about x), roll (about z), uniform scale */
export interface Place {
  at?: V3;
  yaw?: number;
  pitch?: number;
  roll?: number;
  s?: number;
}

/** a part's transform as a point function: scale, roll, pitch, yaw, then offset */
export function xf(T: Place): (p: V3) => [number, number, number] {
  const [ox, oy, oz] = (T.at ?? [0, 0, 0]) as [number, number, number],
    cy = Math.cos(T.yaw ?? 0),
    sy = Math.sin(T.yaw ?? 0),
    cp = Math.cos(T.pitch ?? 0),
    sp = Math.sin(T.pitch ?? 0);
  const cr = Math.cos(T.roll ?? 0),
    sr = Math.sin(T.roll ?? 0),
    s = T.s ?? 1;
  return p => {
    let x = p[0],
      y = p[1],
      z = p[2];
    x *= s;
    y *= s;
    z *= s;
    // roll about z, pitch about x, then yaw about y
    const x1 = x * cr - y * sr,
      y1 = x * sr + y * cr;
    const y2 = y1 * cp - z * sp,
      z2 = y1 * sp + z * cp;
    const x3 = x1 * cy + z2 * sy,
      z3 = -x1 * sy + z2 * cy;
    return [x3 + ox, y2 + oy, z3 + oz];
  };
}
const BOX_FACES = [
  [0, 1, 2, 3],
  [5, 4, 7, 6],
  [4, 0, 3, 7],
  [1, 5, 6, 2],
  [3, 2, 6, 7],
  [4, 5, 1, 0],
] as const;
/** a box of size [sx, sy, sz], centred */
export function box(B: Builder, T: Place, [sx, sy, sz]: readonly number[], col: Colour, k = 255): void {
  const P = xf(T),
    c = rgb(col),
    hx = sx / 2,
    hy = sy / 2,
    hz = sz / 2;
  const v = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ].map(P);
  const ref = P([0, 0, 0]);
  for (const [a, b, cc, d] of BOX_FACES) B.quad(v[a], v[b], v[cc], v[d], c, k, ref);
}
/** a tapered box: bottom sx × sz, top tx × tz, height sy, standing on its base */
export function frustum(
  B: Builder,
  T: Place,
  [sx, sy, sz]: readonly number[],
  [tx, tz]: readonly number[],
  col: Colour,
  k = 255,
): void {
  const P = xf(T),
    c = rgb(col),
    ref = P([0, sy / 2, 0]);
  const v = [
    [-sx / 2, 0, -sz / 2],
    [sx / 2, 0, -sz / 2],
    [tx / 2, sy, -tz / 2],
    [-tx / 2, sy, -tz / 2],
    [-sx / 2, 0, sz / 2],
    [sx / 2, 0, sz / 2],
    [tx / 2, sy, tz / 2],
    [-tx / 2, sy, tz / 2],
  ].map(P);
  for (const [a, b, cc, d] of BOX_FACES) B.quad(v[a], v[b], v[cc], v[d], c, k, ref);
}
/** a cylinder (or cone, r1 at the top) along y from 0 to h, n sides */
export function cyl(
  B: Builder,
  T: Place,
  r0: number,
  r1: number,
  h: number,
  n: number,
  col: Colour,
  k = 255,
  caps = true,
): void {
  const P = xf(T),
    c = rgb(col),
    ref = P([0, h / 2, 0]);
  const ring = (r: number, y: number) =>
    Array.from({ length: n }, (_, i) =>
      P([Math.cos((i / n) * Math.PI * 2) * r, y, Math.sin((i / n) * Math.PI * 2) * r]),
    );
  const lo = ring(r0, 0),
    hi = ring(r1, h),
    top = P([0, h, 0]),
    bot = P([0, 0, 0]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (r1 > 0.001) B.quad(lo[i], lo[j], hi[j], hi[i], c, k, ref);
    else B.tri(lo[i], lo[j], top, c, k, ref);
    if (caps && r1 > 0.001) B.tri(hi[i], hi[j], top, c, k, bot);
    if (caps) B.tri(lo[i], lo[j], bot, c, k, top);
  }
}
/** a cross-section of a loft: [z, halfWidth, halfHeight, yOffset?] */
export type Section = readonly [number, number, number, number?] | readonly number[];
/** a hull lofted through cross-sections with n sides; `flat` squashes the lower half */
export function loft(B: Builder, T: Place, secs: readonly Section[], n: number, col: Colour, k = 255, flat = 1): void {
  const P = xf(T),
    c = rgb(col);
  const ring = ([z, w, h, y]: Section) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      const sy = Math.sin(a);
      return P([Math.cos(a) * w, (sy < 0 ? sy * flat : sy) * h + (y ?? 0), z]);
    });
  const rings = secs.map(ring),
    mid = secs.map(([z, , , y]) => P([0, y ?? 0, z]));
  for (let s = 0; s + 1 < rings.length; s++) {
    const A = rings[s],
      Bq = rings[s + 1],
      ref = P([0, ((secs[s][3] ?? 0) + (secs[s + 1][3] ?? 0)) / 2, (secs[s][0] + secs[s + 1][0]) / 2]);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      B.tri(A[i], A[j], Bq[j], c, k, ref);
      B.tri(A[i], Bq[j], Bq[i], c, k, ref);
    }
  }
  // the ends (if not already points)
  for (const [s, other] of [
    [0, 1],
    [rings.length - 1, rings.length - 2],
  ]) {
    if (secs[s][1] < 0.01) continue;
    for (let i = 0; i < n; i++) B.tri(rings[s][i], rings[s][(i + 1) % n], mid[s], c, k, mid[other]);
  }
}
/** an outline point of a plate: [x, z, y?] */
export type Outline = readonly (readonly number[])[];
/** a flat plate: a convex outline in the x–z plane ([x, z, y?] points), t thick */
export function plate(B: Builder, T: Place, pts: Outline, t: number, col: Colour, k = 255): void {
  const P = xf(T),
    c = rgb(col);
  const top = pts.map(([x, z, y = 0]) => P([x, y + t / 2, z])),
    bot = pts.map(([x, z, y = 0]) => P([x, y - t / 2, z]));
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length,
    cz = pts.reduce((s, p) => s + p[1], 0) / pts.length,
    cy = pts.reduce((s, p) => s + (p[2] ?? 0), 0) / pts.length;
  const up = P([cx, cy + 50, cz]),
    dn = P([cx, cy - 50, cz]),
    mid = P([cx, cy, cz]);
  for (let i = 1; i + 1 < pts.length; i++) {
    B.tri(top[0], top[i], top[i + 1], c, k, dn);
    B.tri(bot[0], bot[i], bot[i + 1], c, k, up);
  }
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    B.quad(top[i], top[j], bot[j], bot[i], c, k, mid);
  }
}
/** a vertical fin: an outline in the z–y plane ([z, y] points), t thick */
export function fin(B: Builder, T: Place, pts: Outline, t: number, col: Colour, k = 255): void {
  plate(
    B,
    { ...T, roll: (T.roll ?? 0) + Math.PI / 2 },
    pts.map(([z, y]) => [y, z]),
    t,
    col,
    k,
  );
}
