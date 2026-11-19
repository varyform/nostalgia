import { describe, expect, it } from 'vite-plus/test';
import { hexRGB, invert4, modelOf, mul4, perspective, planes, sphereVisible, viewOf } from './math.ts';

const apply = (m: ArrayLike<number>, p: number[]) => {
  const v = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) v[r] = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * (p[3] ?? 1);
  return v;
};

describe('hexRGB', () => {
  it('reads #hex and its own rgb()/rgba() output', () => {
    expect(hexRGB('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(hexRGB('rgba(255,0,51,0.4)')).toEqual([1, 0, 0.2]);
    expect(hexRGB('rgb(0, 255, 0)')).toEqual([0, 1, 0]);
  });
});

describe('matrices', () => {
  it('invert4 undoes a view-projection', () => {
    const vp = mul4(perspective(1, 1.6, 1, 1000), viewOf([10, 20, 30], [0, 0, -1], [0, 1, 0]));
    const id = mul4(vp, invert4(vp));
    for (let i = 0; i < 16; i++) expect(id[i]).toBeCloseTo(i % 5 === 0 ? 1 : 0, 4);
  });
  it('viewOf puts the forward direction at −z', () => {
    const v = viewOf([5, 0, 0], [1, 0, 0], [0, 1, 0]);
    const p = apply(v, [15, 0, 0]);
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(0);
    expect(p[2]).toBeCloseTo(-10);
  });
  it('modelOf maps mesh −z to forward and y to up, scaled', () => {
    const m = modelOf([1, 2, 3], [1, 0, 0], [0, 1, 0], 2);
    expect(apply(m, [0, 0, -1])).toEqual([3, 2, 3, 1]);
    expect(apply(m, [0, 1, 0])).toEqual([1, 4, 3, 1]);
  });
});

describe('planes', () => {
  const vp = mul4(perspective(1, 1, 1, 1000), viewOf([0, 0, 0], [0, 0, -1], [0, 1, 0]));
  const ps = planes(vp);
  it('are six unit planes', () => {
    expect(ps).toHaveLength(6);
    for (const p of ps) expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(1);
  });
  it('keep what is ahead and drop what is behind, beside or beyond far', () => {
    expect(sphereVisible(ps, [0, 0, -50], 1)).toBe(true);
    expect(sphereVisible(ps, [0, 0, 50], 1)).toBe(false);
    expect(sphereVisible(ps, [200, 0, -50], 1)).toBe(false);
    expect(sphereVisible(ps, [200, 0, -50], 200)).toBe(true);
    expect(sphereVisible(ps, [0, 0, -1100], 1)).toBe(false);
  });
});
