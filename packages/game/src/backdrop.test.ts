import { describe, expect, it } from 'vite-plus/test';
import { backdropColours, hasBars } from './backdrop.ts';

const style = (vars: Record<string, string>) => ({ getPropertyValue: (k: string) => vars[k] ?? '' });

describe('backdrop', () => {
  it('only fills bars worth filling', () => {
    expect(hasBars(1600, 900, { left: 0, top: 0, width: 1600, height: 900 })).toBe(false);
    expect(hasBars(1600, 901, { left: 0, top: 0.5, width: 1600, height: 900 })).toBe(false);
    // a MacBook's 16:10 around 16:9: bars above and below
    expect(hasBars(1512, 982, { left: 0, top: 65.75, width: 1512, height: 850.5 })).toBe(true);
    // an iPhone's 19.5:9: bars at the sides
    expect(hasBars(852, 393, { left: 76.6, top: 0, width: 698.7, height: 393 })).toBe(true);
  });

  it("takes the page's colours, top and bottom, or none at all", () => {
    expect(backdropColours(style({ '--backdrop-top': ' #0b1a20', '--backdrop-bottom': '#071014 ' }))).toEqual([
      '#0b1a20',
      '#071014',
    ]);
    expect(backdropColours(style({ '--backdrop-top': '#123456' }))).toEqual(['#123456', '#123456']);
    expect(backdropColours(style({}))).toBeNull();
  });
});
