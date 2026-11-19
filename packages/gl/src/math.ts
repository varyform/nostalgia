// Colours, column-major 4 × 4 matrices and frustum planes. Pure and DOM-free
// (`@nostalgia/gl/math`), so they can be tested and used in Node.

/** a 3-vector as the engine reads it: any array of three numbers */
export type V3 = ArrayLike<number>;
/** a column-major 4 × 4 matrix */
export type M4 = Float32Array;
/** a plane [nx, ny, nz, d]: inside where n·p + d > 0 */
export type Plane = number[];

/** '#rrggbb' or 'rgb(…)' / 'rgba(…)' → [r, g, b] in 0..1 (alpha ignored) */
export const hexRGB = (h: string): [number, number, number] => {
  if (h.startsWith('rgb')) {
    const m = (h.match(/[\d.]+/g) ?? []).map(Number);
    return [m[0] / 255, m[1] / 255, m[2] / 255];
  }
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** an OpenGL perspective projection (fovy in radians) */
export function perspective(fovy: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovy / 2),
    nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
/** a view matrix from an eye, a unit forward and a unit up (orthogonal to forward) */
export function viewOf(e: V3, f: V3, u: V3): M4 {
  const r = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
  const d = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return new Float32Array([
    r[0],
    u[0],
    -f[0],
    0,
    r[1],
    u[1],
    -f[1],
    0,
    r[2],
    u[2],
    -f[2],
    0,
    -d(r, e),
    -d(u, e),
    d(f, e),
    1,
  ]);
}
/** a model matrix: mesh x → right, y → up, z → back, scaled by s, at p */
export function modelOf(p: V3, f: V3, u: V3, s = 1, out: M4 = new Float32Array(16)): M4 {
  const r = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
  out[0] = r[0] * s;
  out[1] = r[1] * s;
  out[2] = r[2] * s;
  out[3] = 0;
  out[4] = u[0] * s;
  out[5] = u[1] * s;
  out[6] = u[2] * s;
  out[7] = 0;
  out[8] = -f[0] * s;
  out[9] = -f[1] * s;
  out[10] = -f[2] * s;
  out[11] = 0;
  out[12] = p[0];
  out[13] = p[1];
  out[14] = p[2];
  out[15] = 1;
  return out;
}
/** a × b */
export function mul4(a: ArrayLike<number>, b: ArrayLike<number>): M4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}
/** the inverse of a 4 × 4 matrix */
export function invert4(m: ArrayLike<number>): M4 {
  const a = m,
    o = new Float32Array(16);
  const b00 = a[0] * a[5] - a[1] * a[4],
    b01 = a[0] * a[6] - a[2] * a[4],
    b02 = a[0] * a[7] - a[3] * a[4];
  const b03 = a[1] * a[6] - a[2] * a[5],
    b04 = a[1] * a[7] - a[3] * a[5],
    b05 = a[2] * a[7] - a[3] * a[6];
  const b06 = a[8] * a[13] - a[9] * a[12],
    b07 = a[8] * a[14] - a[10] * a[12],
    b08 = a[8] * a[15] - a[11] * a[12];
  const b09 = a[9] * a[14] - a[10] * a[13],
    b10 = a[9] * a[15] - a[11] * a[13],
    b11 = a[10] * a[15] - a[11] * a[14];
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
  o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
  o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
  o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
  o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
  o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
  o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
  o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
  o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
  o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
  o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
  o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
  o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
  o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
  o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
  o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
  return o;
}
/** the six frustum planes of a view-projection, each [nx, ny, nz, d] (inside: n·p + d > 0) */
export function planes(m: ArrayLike<number>): Plane[] {
  const row = (i: number) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = row(0),
    r1 = row(1),
    r2 = row(2),
    r3 = row(3),
    out: Plane[] = [];
  for (const [s, r] of [
    [1, r0],
    [-1, r0],
    [1, r1],
    [-1, r1],
    [1, r2],
    [-1, r2],
  ] as const) {
    const p = [r3[0] + s * r[0], r3[1] + s * r[1], r3[2] + s * r[2], r3[3] + s * r[3]],
      l = Math.hypot(p[0], p[1], p[2]);
    out.push(p.map(v => v / l));
  }
  return out;
}
/** is a sphere (centre, radius) at least partly inside these planes? */
export function sphereVisible(ps: readonly Plane[], c: V3, r: number): boolean {
  for (const p of ps) if (p[0] * c[0] + p[1] * c[1] + p[2] * c[2] + p[3] < -r) return false;
  return true;
}
