// Height fields: a square grid of heights, its surface (each cell two triangles split along
// a–d, the corner (i, j) to (i + 1, j + 1)), and its mesh cut into chunks that the view can
// cull. Pure and DOM-free (`@nostalgia/gl/terrain`): the sim samples the very surface the
// renderer draws.
//
//   grid point (i, j) is at x = origin + i * size, z = origin + j * size; heights h[j * (n + 1) + i]
import type { Builder } from './mesh.ts';

/** a chunk of a static buffer: vertex range, bounding sphere; `always` skips culling */
export interface Chunk {
  first: number;
  count: number;
  c: [number, number, number];
  r: number;
  always?: boolean;
}

/** the height of a grid's surface at (x, z), as gridChunks() draws it; `outside` beyond the grid */
export function gridHeight(
  h: ArrayLike<number>,
  n: number,
  origin: number,
  size: number,
  x: number,
  z: number,
  outside = 0,
): number {
  const gx = (x - origin) / size,
    gz = (z - origin) / size,
    V = n + 1;
  if (gx < 0 || gz < 0 || gx >= n || gz >= n) return outside;
  const i = Math.floor(gx),
    j = Math.floor(gz),
    fx = gx - i,
    fz = gz - j,
    k = j * V + i;
  const a = h[k],
    b = h[k + 1],
    c = h[k + V],
    d = h[k + V + 1];
  return fx > fz ? a + (b - a) * fx + (d - b) * fz : a + (d - c) * fx + (c - a) * fz;
}

/** the unit up-facing normal of the surface at (x, z) (of the triangle under it) */
export function gridNormal(
  h: ArrayLike<number>,
  n: number,
  origin: number,
  size: number,
  x: number,
  z: number,
): [number, number, number] {
  const gx = (x - origin) / size,
    gz = (z - origin) / size,
    V = n + 1;
  if (gx < 0 || gz < 0 || gx >= n || gz >= n) return [0, 1, 0];
  const i = Math.floor(gx),
    j = Math.floor(gz),
    k = j * V + i;
  const a = h[k],
    b = h[k + 1],
    c = h[k + V],
    d = h[k + V + 1];
  // the slopes dy/dx and dy/dz of the triangle (a, b, d) or (a, d, c)
  const sx = gx - i > gz - j ? b - a : d - c,
    sz = gx - i > gz - j ? d - b : c - a;
  const L = Math.hypot(sx, size, sz);
  return [-sx / L, size / L, -sz / L];
}

export interface GridOptions {
  /** cells per side */
  n: number;
  /** cells per chunk side; n should be a multiple (16) */
  chunk?: number;
  /** world x and z of grid point (0, 0) */
  origin: number;
  /** cell size, metres */
  size: number;
  /** a grid point's position */
  point: (i: number, j: number) => [number, number, number];
  /** emit cell (i, j) with corners a (i, j), b (i + 1, j), c (i, j + 1), d (i + 1, j + 1): its two faces and anything standing in it */
  cell: (B: Builder, i: number, j: number, a: number[], b: number[], c: number[], d: number[]) => void;
  /** added to the chunk's half height in its bounding radius, for what stands on it (30 m) */
  pad?: number;
}

/** build a grid's cells chunk by chunk into B; returns the chunks in row order */
export function gridChunks(B: Builder, { n, chunk = 16, origin, size, point, cell, pad = 30 }: GridOptions): Chunk[] {
  const C = chunk,
    chunks: Chunk[] = [];
  for (let cj = 0; cj < n / C; cj++)
    for (let ci = 0; ci < n / C; ci++) {
      const first = B.n;
      let lo = Infinity,
        hi = -Infinity;
      for (let j = cj * C; j < cj * C + C; j++)
        for (let i = ci * C; i < ci * C + C; i++) {
          const a = point(i, j),
            b = point(i + 1, j),
            c = point(i, j + 1),
            d = point(i + 1, j + 1);
          cell(B, i, j, a, b, c, d);
          for (const p of [a, b, c, d]) {
            lo = Math.min(lo, p[1]);
            hi = Math.max(hi, p[1]);
          }
        }
      const cx = origin + (ci + 0.5) * C * size,
        cz = origin + (cj + 0.5) * C * size;
      chunks.push({
        first,
        count: B.n - first,
        c: [cx, (lo + hi) / 2, cz],
        r: Math.hypot(C * size * 0.71, (hi - lo) / 2 + pad),
      });
    }
  return chunks;
}

/** the two flat faces of a cell, split along a–d as gridHeight() has it, each coloured by colour(centre y, normal y, half) */
export function flatCell(
  colour: (y: number, ny: number, half: 0 | 1, i: number, j: number) => ArrayLike<number>,
  k = 255,
) {
  return (B: Builder, i: number, j: number, a: number[], b: number[], c: number[], d: number[]): void => {
    for (const [p, q, r, half] of [
      [a, d, b, 0],
      [a, c, d, 1],
    ] as const) {
      const ux = q[0] - p[0],
        uy = q[1] - p[1],
        uz = q[2] - p[2],
        vx = r[0] - p[0],
        vy = r[1] - p[1],
        vz = r[2] - p[2];
      const ny = uz * vx - ux * vz,
        L = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
      B.tri(p, q, r, colour((p[1] + q[1] + r[1]) / 3, ny / L, half, i, j), k);
    }
  };
}

export interface CoarseOptions {
  /** cells per side of the full grid */
  n: number;
  /** full-grid cells per chunk side, as gridChunks() (16) */
  chunk?: number;
  /** full-grid cells per coarse cell (2, 4…; divides chunk) */
  step: number;
  /** world x and z of grid point (0, 0) */
  origin: number;
  /** full-grid cell size, metres */
  size: number;
  /** a full-grid point's position */
  point: (i: number, j: number) => [number, number, number];
  /** a face's colour from its centre height and normal y, and the full-grid cell of its corner a */
  colour: (y: number, ny: number, i: number, j: number) => ArrayLike<number>;
  /** a skirt this deep hangs from each chunk edge, hiding cracks against finer neighbours (metres; 0: none) */
  skirt?: number;
  /** colour kind (255 lit) */
  k?: number;
}

/**
 * The same grid at a coarser step, chunk for chunk in gridChunks() order, for the far
 * distance: draw chunk k from here instead of gridChunks()'s chunk k beyond some range. Its
 * surface is the grid sampled every `step` points, so it sits within the relief of the full one.
 */
export function gridCoarse(
  B: Builder,
  { n, chunk = 16, step, origin, size, point, colour, skirt = 0, k = 255 }: CoarseOptions,
): Chunk[] {
  const C = chunk,
    chunks: Chunk[] = [];
  const face = (p: number[], q: number[], r: number[], i: number, j: number) => {
    const ux = q[0] - p[0],
      uy = q[1] - p[1],
      uz = q[2] - p[2],
      vx = r[0] - p[0],
      vy = r[1] - p[1],
      vz = r[2] - p[2];
    const ny = uz * vx - ux * vz,
      L = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
    B.tri(p, q, r, colour((p[1] + q[1] + r[1]) / 3, ny / L, i, j), k);
  };
  for (let cj = 0; cj < n / C; cj++)
    for (let ci = 0; ci < n / C; ci++) {
      const first = B.n;
      let lo = Infinity,
        hi = -Infinity;
      const i0 = ci * C,
        j0 = cj * C;
      for (let j = j0; j < j0 + C; j += step)
        for (let i = i0; i < i0 + C; i += step) {
          const a = point(i, j),
            b = point(i + step, j),
            c = point(i, j + step),
            d = point(i + step, j + step);
          face(a, d, b, i, j);
          face(a, c, d, i, j);
          for (const p of [a, b, c, d]) {
            lo = Math.min(lo, p[1]);
            hi = Math.max(hi, p[1]);
          }
        }
      const cx = origin + (ci + 0.5) * C * size,
        cz = origin + (cj + 0.5) * C * size;
      if (skirt > 0) {
        const mid = [cx, (lo + hi) / 2, cz];
        // walk each edge: [start i, start j, di, dj]
        for (const [si, sj, di, dj] of [
          [i0, j0, step, 0],
          [i0 + C, j0, 0, step],
          [i0 + C, j0 + C, -step, 0],
          [i0, j0 + C, 0, -step],
        ]) {
          for (let s = 0; s < C; s += step) {
            const p = point(si + (di / step) * s, sj + (dj / step) * s),
              q = point(si + (di / step) * (s + step), sj + (dj / step) * (s + step));
            const pd = [p[0], p[1] - skirt, p[2]],
              qd = [q[0], q[1] - skirt, q[2]];
            const col = colour(
              (p[1] + q[1]) / 2,
              0,
              Math.min(Math.max(si + (di / step) * s, 0), n - 1),
              Math.min(Math.max(sj + (dj / step) * s, 0), n - 1),
            );
            B.quad(p, q, qd, pd, col, k, [mid[0], (p[1] + q[1]) / 2 - skirt / 2, mid[2]]);
          }
        }
      }
      chunks.push({
        first,
        count: B.n - first,
        c: [cx, (lo + hi) / 2, cz],
        r: Math.hypot(C * size * 0.71, (hi - lo) / 2),
      });
    }
  return chunks;
}
