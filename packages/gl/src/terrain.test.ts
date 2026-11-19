import { describe, expect, it } from 'vite-plus/test';
import { builder } from './mesh.ts';
import { flatCell, gridChunks, gridCoarse, gridHeight, gridNormal } from './terrain.ts';

const n = 32,
  size = 10,
  origin = -160,
  V = n + 1;
const h = new Float32Array(V * V).map((_, k) => Math.sin(k * 0.37) * 20 + (k % V) * 0.5);
const point = (i: number, j: number): [number, number, number] => [origin + i * size, h[j * V + i], origin + j * size];

describe('gridHeight / gridNormal', () => {
  it('pass through the grid points and split cells along a–d', () => {
    expect(gridHeight(h, n, origin, size, origin + 3 * size, origin + 5 * size)).toBeCloseTo(h[5 * V + 3]);
    // the centre of a cell lies on the a–d diagonal
    const a = h[4 * V + 2],
      d = h[5 * V + 3];
    expect(gridHeight(h, n, origin, size, origin + 2.5 * size, origin + 4.5 * size)).toBeCloseTo((a + d) / 2);
    expect(gridHeight(h, n, origin, size, 1e6, 0, -7)).toBe(-7);
  });
  it('the normal is the slope of the triangle under the point', () => {
    const x = origin + 7.7 * size,
      z = origin + 3.2 * size,
      e = 0.01;
    const nn = gridNormal(h, n, origin, size, x, z);
    const sx = (gridHeight(h, n, origin, size, x + e, z) - gridHeight(h, n, origin, size, x - e, z)) / (2 * e);
    const sz = (gridHeight(h, n, origin, size, x, z + e) - gridHeight(h, n, origin, size, x, z - e)) / (2 * e);
    expect(Math.hypot(...nn)).toBeCloseTo(1);
    expect(-nn[0] / nn[1]).toBeCloseTo(sx, 3);
    expect(-nn[2] / nn[1]).toBeCloseTo(sz, 3);
  });
});

describe('gridChunks', () => {
  it('cuts the grid into chunks whose spheres hold their vertices, faces matching gridHeight', () => {
    const B = builder();
    const chunks = gridChunks(B, { n, chunk: 16, origin, size, point, cell: flatCell(() => [100, 120, 80]) });
    expect(chunks).toHaveLength(4);
    expect(chunks.reduce((s, c) => s + c.count, 0)).toBe(n * n * 6);
    const f = new Float32Array(B.data());
    for (const c of chunks)
      for (let v = c.first; v < c.first + c.count; v++) {
        const p = [f[v * 5], f[v * 5 + 1], f[v * 5 + 2]];
        expect(Math.hypot(p[0] - c.c[0], p[1] - c.c[1], p[2] - c.c[2])).toBeLessThanOrEqual(c.r + 1e-3);
      }
    // every triangle's centroid lies on the surface gridHeight() reads
    for (let t = 0; t < B.n; t += 3) {
      const m = [0, 1, 2].map(a => (f[t * 5 + a] + f[(t + 1) * 5 + a] + f[(t + 2) * 5 + a]) / 3);
      expect(gridHeight(h, n, origin, size, m[0], m[2])).toBeCloseTo(m[1], 3);
    }
  });
  it('gridCoarse: the same chunks at a quarter of the faces, plus skirts', () => {
    const B = builder();
    const plain = gridCoarse(B, { n, chunk: 16, step: 2, origin, size, point, colour: () => [1, 2, 3] });
    expect(plain.map(c => c.count)).toEqual([384, 384, 384, 384]);
    const S = builder();
    const skirted = gridCoarse(S, { n, chunk: 16, step: 4, origin, size, point, colour: () => [1, 2, 3], skirt: 20 });
    expect(skirted[0].count).toBe(16 * 6 + 4 * 4 * 6);
    expect([skirted[3].c[0], skirted[3].c[2]]).toEqual([plain[3].c[0], plain[3].c[2]]);
  });
});
