import { describe, expect, it } from 'vite-plus/test';
import { cullInstances, groupInstances, INSTANCE_FLOATS, instanceData } from './instances.ts';
import { mul4, perspective, planes, viewOf } from './math.ts';

describe('instanceData', () => {
  it('packs 9 floats each with defaults', () => {
    const d = instanceData([
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6, yaw: 1, s: 2, h: 3, r: 0.5, g: 0.25, b: 0 },
    ]);
    expect(INSTANCE_FLOATS).toBe(9);
    expect([...d]).toEqual([1, 2, 3, 0, 1, 1, 1, 1, 1, 4, 5, 6, 1, 2, 3, 0.5, 0.25, 0]);
  });
});

describe('groupInstances', () => {
  it('makes one contiguous run per group, in order, dropping −1', () => {
    const d = instanceData([
      { x: 15, y: 0, z: 0 },
      { x: 5, y: 1, z: 0 },
      { x: 15, y: 2, z: 0 },
      { x: -5, y: 3, z: 0 },
      { x: 6, y: 4, z: 0 },
    ]);
    const g = groupInstances(d, 2, x => (x < 0 ? -1 : Math.floor(x / 10)));
    expect([...g.first]).toEqual([0, 2]);
    expect([...g.count]).toEqual([2, 2]);
    const ys = Array.from({ length: 4 }, (_, k) => g.data[k * 9 + 1]);
    expect(ys).toEqual([1, 4, 0, 2]);
  });
});

describe('cullInstances', () => {
  it('keeps what is in view and within range', () => {
    const ps = planes(mul4(perspective(1, 1, 1, 5000), viewOf([0, 0, 0], [0, 0, -1], [0, 1, 0])));
    const d = instanceData([
      { x: 0, y: 0, z: -100 },
      { x: 0, y: 0, z: 100 },
      { x: 0, y: 0, z: -3000 },
      { x: 60, y: 0, z: -100, s: 20 },
    ]);
    const out = new Float32Array(d.length);
    expect(cullInstances(d, ps, [0, 0, 0], 2000, 2, out)).toBe(2);
    expect(out[2]).toBe(-100);
    expect(out[9]).toBe(60);
  });
});
