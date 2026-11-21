import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createHdr, grade, HDR_LEVELS } from './hdr.ts';

const [OFF, LOW, MID, HIGH] = HDR_LEVELS;
const near = (a: number[], b: number[], d = 0.002) => a.every((x, i) => Math.abs(x - b[i]) < d);

describe('grade', () => {
  it('off is the colour exactly, only moved to P3 numbers', () => {
    expect(near(grade([0, 0, 0], OFF), [0, 0, 0])).toBe(true);
    expect(near(grade([1, 1, 1], OFF), [1, 1, 1])).toBe(true);
    // sRGB red is inside P3: less than full P3 red, and nothing past white
    const red = grade([1, 0, 0], OFF);
    expect(red[0]).toBeLessThan(1);
    expect(red[0]).toBeGreaterThan(0.9);
    expect(Math.max(...red)).toBeLessThanOrEqual(1);
  });

  it('keeps the dark and the middle tones where they were', () => {
    for (const L of HDR_LEVELS) {
      expect(near(grade([0, 0, 0], L), [0, 0, 0])).toBe(true);
      expect(near(grade([0.5, 0.5, 0.5], L), [0.5, 0.5, 0.5])).toBe(true);
      expect(near(grade([0.2, 0.3, 0.4], L), grade([0.2, 0.3, 0.4], { ...L, peak: 1 }))).toBe(true);
    }
  });

  it('lifts bright colours past white, more with each level', () => {
    const peaks = HDR_LEVELS.map(L => Math.max(...grade([1, 0.2, 0.1], L)));
    expect(peaks[0]).toBeLessThanOrEqual(1);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeGreaterThan(Math.max(1, peaks[i - 1]));
  });

  it('lifts white less than a colour as bright', () => {
    for (const L of [LOW, MID, HIGH]) {
      const white = grade([1, 1, 1], L)[0],
        red = grade([1, 0, 0], L)[0];
      expect(white).toBeGreaterThan(1);
      expect(red).toBeGreaterThan(white);
    }
  });

  it('makes colours more vivid, never duller', () => {
    // a saturated green: the vivid levels push it further from grey
    const chroma = (c: number[]) => Math.max(...c) - Math.min(...c);
    const g = [0.2, 0.55, 0.25] as const;
    expect(chroma(grade(g, MID))).toBeGreaterThan(chroma(grade(g, OFF)));
    expect(chroma(grade(g, HIGH))).toBeGreaterThan(chroma(grade(g, MID)));
  });
});

describe('createHdr', () => {
  afterEach(() => vi.unstubAllGlobals());
  const canvas = () => ({ style: {}, width: 640, height: 360 }) as unknown as HTMLCanvasElement;

  it('is off and harmless without WebGPU or an HDR display', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.stubGlobal('navigator', {});
    const hdr = createHdr([canvas()]);
    expect(hdr.supported).toBe(false);
    hdr.cycle();
    hdr.present();
    hdr.destroy();
    expect(hdr.label).toBe('HDR MID');
  });

  it('never reads storage when disabled (the demo)', () => {
    const getItem = vi.fn(() => '3');
    vi.stubGlobal('localStorage', { getItem, setItem: vi.fn() });
    vi.stubGlobal('navigator', {});
    const hdr = createHdr([canvas()], { enabled: false });
    expect(getItem).not.toHaveBeenCalled();
    expect(hdr.supported).toBe(false);
  });

  it('starts from the saved level, and ignores a broken one', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('localStorage', { getItem: () => '1', setItem: vi.fn() });
    expect(createHdr([canvas()]).label).toBe('HDR LOW');
    vi.stubGlobal('localStorage', { getItem: () => '9', setItem: vi.fn() });
    expect(createHdr([canvas()]).label).toBe('HDR MID');
  });
});
