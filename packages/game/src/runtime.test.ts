import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { canvasPoint, fitPixels, fitWide, fixedLoop, listeners, storage } from './runtime.ts';

type Win = EventTarget & { innerWidth: number; innerHeight: number; devicePixelRatio: number };
let win: Win, doc: EventTarget;
const canvas = () => ({ style: {} as Record<string, string>, width: 300, height: 150 }) as unknown as HTMLCanvasElement;

beforeEach(() => {
  win = Object.assign(new EventTarget(), { innerWidth: 1920, innerHeight: 1200, devicePixelRatio: 2 });
  doc = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const resize = (w: number, h: number, dpr = win.devicePixelRatio) => {
  Object.assign(win, { innerWidth: w, innerHeight: h, devicePixelRatio: dpr });
  win.dispatchEvent(new Event('resize'));
};

describe('listeners', () => {
  it('removes everything it added', () => {
    const t = new EventTarget(),
      fn = vi.fn();
    const { listen, offAll } = listeners();
    listen(t, 'a', fn);
    listen(t, 'b', fn, { passive: true });
    t.dispatchEvent(new Event('a'));
    offAll();
    t.dispatchEvent(new Event('a'));
    t.dispatchEvent(new Event('b'));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('fixedLoop', () => {
  let frames: Map<number, FrameRequestCallback>, ids: number, now: number;
  beforeEach(() => {
    frames = new Map();
    ids = 0;
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => (frames.set(++ids, f), ids));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });
  const frame = (ms: number) => {
    now += ms;
    const [id, f] = [...frames][0];
    frames.delete(id);
    f(now);
  };

  it('runs as many fixed steps as real time holds, then draws', () => {
    const step = vi.fn(),
      draw = vi.fn();
    const loop = fixedLoop({ dt: 0.01, step, draw });
    now = 5000; // the clock starts at start(), not when the loop is made
    loop.start();
    frame(25);
    expect(step).toHaveBeenCalledTimes(2);
    expect(draw).toHaveBeenCalledTimes(1);
    frame(15); // 5 ms left over + 15
    expect(step).toHaveBeenCalledTimes(4);
  });

  it('catches up at most 0.1 s per frame, and stops', () => {
    const step = vi.fn(),
      draw = vi.fn();
    const loop = fixedLoop({ dt: 0.01, step, draw });
    loop.start();
    frame(5000);
    expect(step.mock.calls.length).toBeGreaterThanOrEqual(9);
    expect(step.mock.calls.length).toBeLessThanOrEqual(10);
    expect(frames.size).toBe(1);
    loop.stop(); // cancels the frame already asked for
    expect(frames.size).toBe(0);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('a still frame is drawn once and again on resize, until stopped', () => {
    const draw = vi.fn();
    const loop = fixedLoop({ dt: 0.01, step: () => {}, draw });
    loop.still();
    expect(draw).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    resize(800, 600);
    expect(draw).toHaveBeenCalledTimes(2);
    loop.stop();
    resize(900, 600);
    expect(draw).toHaveBeenCalledTimes(2);
  });
});

describe('fitWide', () => {
  it('fills the largest 16:9 box from the window, at a capped pixel ratio', () => {
    const cv = canvas(),
      onFit = vi.fn();
    const off = fitWide(cv, { onFit });
    // 1920 × 1080 in CSS; 2× would be 3840 wide, so the ratio stops at 2560 / 1920
    expect([cv.style.width, cv.style.height, cv.width, cv.height]).toEqual(['1920px', '1080px', 2560, 1440]);
    expect(onFit).toHaveBeenLastCalledWith(2560, 1440);
    resize(1000, 400, 1); // wider than 16:9: height-bound
    expect([cv.style.width, cv.style.height, cv.width, cv.height]).toEqual(['711px', '400px', 711, 400]);
    Object.assign(win, { innerWidth: 640, innerHeight: 720, devicePixelRatio: 3 });
    doc.dispatchEvent(new Event('webkitfullscreenchange'));
    expect([cv.style.width, cv.style.height, cv.width, cv.height]).toEqual(['640px', '360px', 1280, 720]);
    off();
    resize(100, 100);
    expect(onFit).toHaveBeenCalledTimes(3);
  });
});

describe('fitPixels', () => {
  it('shows the screen at 4:3, snapping to whole multiples from `snap` up', () => {
    const size = (cv: HTMLCanvasElement) => [cv.style.width, cv.style.height, cv.width];
    const free = canvas(),
      one = canvas(),
      two = canvas();
    fitPixels(free, { width: 320, height: 240 });
    fitPixels(one, { width: 320, height: 240, snap: 1 });
    fitPixels(two, { width: 320, height: 240, snap: 2 });
    resize(1000, 700);
    expect([size(free), size(one), size(two)]).toEqual([
      ['933px', '700px', 300],
      ['640px', '480px', 300],
      ['640px', '480px', 300],
    ]);
    resize(500, 350);
    expect([size(free), size(one), size(two)]).toEqual([
      ['466px', '350px', 300],
      ['320px', '240px', 300],
      ['466px', '350px', 300],
    ]);
    resize(200, 150);
    expect(size(one)).toEqual(['200px', '150px', 300]);
  });
});

describe('storage', () => {
  let items: Map<string, string>, blocked: boolean;
  beforeEach(() => {
    items = new Map();
    blocked = false;
    const guard = () => {
      if (blocked) throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (guard(), items.get(k) ?? null),
      setItem: (k: string, v: string) => (guard(), items.set(k, v)),
    });
  });

  it('reads and writes JSON, falling back when missing, broken or blocked', () => {
    const s = storage('k');
    expect(s.load({ a: 1 })).toEqual({ a: 1 });
    s.save({ b: 2 });
    expect(items.get('k')).toBe('{"b":2}');
    expect(s.load(null)).toEqual({ b: 2 });
    items.set('k', '{oops');
    expect(s.load('x')).toBe('x');
    blocked = true;
    expect(s.load(0)).toBe(0);
    expect(() => s.save(1)).not.toThrow();
  });

  it('does nothing when disabled (the demo)', () => {
    items.set('k', '5');
    const s = storage('k', { enabled: false });
    expect(s.load(1)).toBe(1);
    s.save(9);
    expect(items.get('k')).toBe('5');
  });
});

describe('canvasPoint', () => {
  it('maps client coordinates to canvas pixels', () => {
    const cv = Object.assign(canvas(), {
      width: 640,
      height: 400,
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 320, height: 200 }),
    }) as unknown as HTMLCanvasElement;
    expect(canvasPoint(cv, { clientX: 170, clientY: 70 })).toEqual({ x: 320, y: 100 });
  });
});
