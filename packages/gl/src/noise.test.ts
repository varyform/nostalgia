import { describe, expect, it } from 'vite-plus/test';
import { fbm, hash2, lerp, polyAt, polyDist, polyLen, ridged, smooth } from './noise.ts';

describe('noise', () => {
  it('is deterministic and in range', () => {
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(4, 3, 5));
    for (let k = 0; k < 200; k++) {
      const x = k * 37.1,
        z = k * -11.3;
      const f = fbm(x, z, 7, 300),
        r = ridged(x, z, 7, 300);
      expect(f).toBeGreaterThanOrEqual(-1);
      expect(f).toBeLessThanOrEqual(1);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
    expect(fbm(10, 20, 3, 100)).toBe(fbm(10, 20, 3, 100));
  });
  it('smooth and lerp', () => {
    expect(smooth(0, 1, -1)).toBe(0);
    expect(smooth(0, 1, 0.5)).toBe(0.5);
    expect(smooth(0, 1, 2)).toBe(1);
    expect(lerp(2, 4, 0.25)).toBe(2.5);
  });
  it('polylines: length, distance and points along', () => {
    const p = [
      [0, 0],
      [100, 0],
      [100, 50],
    ];
    expect(polyLen(p)).toBe(150);
    expect(polyDist(p, 50, 10)).toEqual({ d: 10, along: 50, seg: 0 });
    expect(polyDist(p, 110, 25)).toEqual({ d: 10, along: 125, seg: 1 });
    expect(polyAt(p, 120)).toMatchObject({ x: 100, z: 20, dx: 0, dz: 1, end: false });
    expect(polyAt(p, 500).end).toBe(true);
  });
});
