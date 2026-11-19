import { describe, expect, it } from 'vite-plus/test';
import { box, builder, cyl, fin, frustum, loft, plate, STRIDE, xf } from './mesh.ts';

/** every face's normal points away from c */
function outward(data: ArrayBuffer, c: number[]) {
  const f = new Float32Array(data),
    i8 = new Int8Array(data),
    n = data.byteLength / STRIDE;
  for (let t = 0; t < n; t += 3) {
    const m = [0, 0, 0];
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) m[a] += f[(t + k) * 5 + a] / 3;
    const b = t * STRIDE + 12,
      nx = i8[b] / 127,
      ny = i8[b + 1] / 127,
      nz = i8[b + 2] / 127;
    if (nx * (m[0] - c[0]) + ny * (m[1] - c[1]) + nz * (m[2] - c[2]) < 0) return false;
  }
  return true;
}

describe('builder', () => {
  it('writes 20-byte vertices and grows', () => {
    const B = builder(2);
    B.tri([0, 0, 0], [1, 0, 0], [0, 1, 0], [10, 20, 30], 128);
    B.tri([0, 0, 0], [1, 0, 0], [0, 1, 0], [10, 20, 30]);
    expect(B.n).toBe(6);
    const d = B.data(),
      u8 = new Uint8Array(d),
      i8 = new Int8Array(d);
    expect(d.byteLength).toBe(6 * STRIDE);
    expect([u8[16], u8[17], u8[18], u8[19]]).toEqual([10, 20, 30, 128]);
    expect(i8[14]).toBe(127); // +z normal
    expect(u8[5 * 20 + 19]).toBe(255);
  });
  it('skips degenerate triangles and turns faces away from ref', () => {
    const B = builder();
    B.tri([0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, 0]);
    expect(B.n).toBe(0);
    B.tri([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 0], 255, [0, 0, 5]);
    expect(new Int8Array(B.data())[14]).toBe(-127);
  });
});

describe('parts', () => {
  it('box: 12 outward faces, placed by the transform', () => {
    const B = builder();
    box(B, { at: [10, 0, 0], yaw: 0.5 }, [2, 3, 4], '#808080');
    expect(B.n).toBe(36);
    expect(outward(B.data(), [10, 0, 0])).toBe(true);
  });
  it('frustum, cyl, loft, plate and fin are closed and face out', () => {
    const cases: [(B: ReturnType<typeof builder>) => void, number[]][] = [
      [B => frustum(B, {}, [4, 2, 4], [2, 2], '#fff'), [0, 1, 0]],
      [B => cyl(B, {}, 1, 0.5, 3, 6, '#fff'), [0, 1.5, 0]],
      [B => cyl(B, {}, 1, 0, 3, 5, '#fff'), [0, 1, 0]],
      [
        B =>
          loft(
            B,
            {},
            [
              [-2, 0.02, 0.02],
              [0, 1, 1],
              [2, 0.5, 0.5],
            ],
            6,
            '#fff',
          ),
        [0, 0, 0],
      ],
      [
        B =>
          plate(
            B,
            {},
            [
              [0, 0],
              [2, 0],
              [2, 2],
              [0, 2],
            ],
            0.2,
            '#fff',
          ),
        [1, 0, 1],
      ],
      [
        B =>
          fin(
            B,
            {},
            [
              [0, 0],
              [2, 0],
              [2, 2],
            ],
            0.2,
            '#fff',
          ),
        [0, 0.67, 1.33],
      ],
    ];
    for (const [make, c] of cases) {
      const B = builder();
      make(B);
      expect(B.n % 3).toBe(0);
      expect(B.n).toBeGreaterThan(0);
      expect(outward(B.data(), c)).toBe(true);
    }
  });
  it('xf: scale, then yaw turns −z toward −x', () => {
    const p = xf({ yaw: Math.PI / 2, s: 2, at: [1, 0, 0] })([0, 0, -1]);
    expect(p[0]).toBeCloseTo(-1);
    expect(p[2]).toBeCloseTo(0);
  });
});
