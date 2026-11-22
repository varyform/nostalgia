import { describe, expect, it } from 'vite-plus/test';
import { backdropSize, hasBars, strips } from './backdrop.ts';

describe('backdrop', () => {
  it('is small and keeps the screen shape', () => {
    expect(backdropSize(1512, 982)).toEqual([189, 123, 1 / 8]);
    const [w, h] = backdropSize(3840, 2160);
    expect(w).toBe(256);
    expect(h).toBe(144);
  });

  it('only fills bars worth filling', () => {
    expect(hasBars(1600, 900, { left: 0, top: 0, width: 1600, height: 900 })).toBe(false);
    expect(hasBars(1600, 901, { left: 0, top: 0.5, width: 1600, height: 900 })).toBe(false);
    // a MacBook's 16:10 around 16:9: bars above and below
    expect(hasBars(1512, 982, { left: 0, top: 65.75, width: 1512, height: 850.5 })).toBe(true);
    // an iPhone's 19.5:9: bars at the sides
    expect(hasBars(852, 393, { left: 76.6, top: 0, width: 698.7, height: 393 })).toBe(true);
  });

  it('stretches the matching edge across each bar, reaching a few pixels into the game', () => {
    // side bars: the left and right edge columns, the game's height
    const side = strips(100, 40, { left: 10, top: 0, width: 80, height: 40 }, 2560, 1440);
    expect(side).toEqual([
      [0, 0, 15, 1440, 0, 0, 13, 40],
      [2545, 0, 15, 1440, 87, 0, 13, 40],
    ]);
    // bars above and below: the top and bottom rows
    const tb = strips(100, 66, { left: 0, top: 5, width: 100, height: 56 }, 2560, 1440);
    expect(tb).toEqual([
      [0, 0, 2560, 9, 0, 0, 100, 8],
      [0, 1431, 2560, 9, 0, 58, 100, 8],
    ]);
  });

  it('fills the corners when the game is smaller both ways, from at least one source pixel', () => {
    const s = strips(100, 80, { left: 10, top: 10, width: 80, height: 60 }, 320, 200);
    expect(s).toHaveLength(8);
    expect(s[0].slice(0, 4)).toEqual([0, 0, 2, 200]);
    expect(s[4]).toEqual([0, 0, 2, 1, 0, 0, 13, 13]);
    expect(strips(10, 10, { left: 1, top: 1, width: 8, height: 8 }, 20, 20)[0][2]).toBe(1);
  });
});
