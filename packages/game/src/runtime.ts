/**
 * The page plumbing every game repeats: listeners that come off together, the fixed-step
 * loop, fitting the canvas to the window, saved data, full screen, touch points.
 *
 *   import { canvasPoint, fitPixels, fitWide, fixedLoop, listeners, onAway, storage, toggleFullscreen } from '@nostalgia/game/runtime';
 *
 *   const { listen, offAll } = listeners();
 *   listen(window, 'keydown', onKey);                       // offAll() removes every one
 *   onAway(listen, () => { if (app.state === 'play') setState('pause'); });   // blur, hidden tab, pagehide
 *
 *   const loop = fixedLoop({ dt: 1 / 60, step: update, draw: () => view.draw(app) });
 *   reducedMotion ? loop.still() : loop.start();           // still: one frame, redrawn on resize
 *                                                          // (neither steps nor draws while the tab is hidden)
 *   loop.stop();
 *
 *   const unfit = fitWide(cv, { onFit: (w, h) => rebuildCaches(w, h) });   // HD: 16:9 at device pixels
 *   const unfit = fitPixels(cv, { width: 320, height: 240, snap: 1 });      // 320 × 200 shown at 4:3
 *
 *   const saved = storage('game-best', { enabled: !demo });  // the demo never reads or writes
 *   const best = { score: 0, ...saved.load({}) };            // validating it is the game's job
 *   saved.save(best);
 *
 * Canvases are always sized from the window (innerWidth / innerHeight) with an explicit CSS
 * size, never from the canvas's own client size: that feeds back through the device pixel
 * ratio and grows the canvas every frame.
 */

type Off = () => void;

/** addEventListener that remembers: offAll() removes everything listen() added. */
export function listeners(): {
  listen: (
    t: EventTarget,
    type: string,
    fn: EventListenerOrEventListenerObject,
    opts?: AddEventListenerOptions,
  ) => void;
  offAll: () => void;
} {
  const offs: Off[] = [];
  return {
    listen(t, type, fn, opts) {
      t.addEventListener(type, fn, opts);
      offs.push(() => t.removeEventListener(type, fn, opts));
    },
    offAll() {
      offs.splice(0).forEach(off => off());
    },
  };
}

/**
 * fn() when the player is away from the game: the window loses focus, the tab or app is hidden
 * (switching tabs, minimising, the iOS app going to the background — where blur alone may not
 * come), or the page is being left. The place to open the pause screen; listen's offAll()
 * removes it too.
 */
export function onAway(listen: ReturnType<typeof listeners>['listen'], fn: () => void): void {
  listen(window, 'blur', fn);
  listen(window, 'pagehide', fn);
  listen(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') fn();
  });
}

export interface FixedLoop {
  /**
   * Run on requestAnimationFrame: as many fixed steps as the time since the last frame holds,
   * then draw. Nothing runs while the tab is hidden; it picks up from where it was when shown.
   */
  start(): void;
  /** Draw one frame, and again on every resize (a still demo, for reduced motion). */
  still(): void;
  /** Stop the loop (or the still frame). */
  stop(): void;
}

/**
 * A fixed-step loop: step() runs every dt seconds of real time (at most 0.1 s caught up
 * per frame, so a background tab doesn't fast-forward), draw() once per frame.
 */
export function fixedLoop({ dt, step, draw }: { dt: number; step: () => void; draw: () => void }): FixedLoop {
  let last = 0,
    acc = 0,
    raf = 0,
    running = false,
    stopped = false;
  const redraw = () => draw();
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
  function frame(now: number) {
    raf = 0;
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= dt) {
      step();
      acc -= dt;
    }
    draw();
    if (!stopped && !hidden()) raf = requestAnimationFrame(frame);
  }
  function resume() {
    if (stopped || raf || hidden()) return;
    last = performance.now(); // no catching up on the time away
    raf = requestAnimationFrame(frame);
  }
  // hidden: no more frames are asked for (the browser mostly stops them anyway, not always at
  // once and not in every web view); shown again: on from where it was
  function visibility() {
    if (!hidden()) return resume();
    cancelAnimationFrame(raf);
    raf = 0;
  }
  return {
    start() {
      running = true;
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility);
      resume();
    },
    still() {
      redraw();
      window.addEventListener('resize', redraw);
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      raf = 0;
      if (running && typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('resize', redraw);
    },
  };
}

const FULLSCREEN = ['fullscreenchange', 'webkitfullscreenchange'];

/** Run fit now and on every resize / full-screen change; returns the undo. */
function follow(fit: () => void): Off {
  window.addEventListener('resize', fit);
  for (const ev of FULLSCREEN) document.addEventListener(ev, fit);
  fit();
  return () => {
    window.removeEventListener('resize', fit);
    for (const ev of FULLSCREEN) document.removeEventListener(ev, fit);
  };
}

/**
 * Size a vector canvas to the largest `ratio` box in the window, at device resolution:
 * the pixel ratio is capped at maxDpr, and so that the canvas is at most maxWidth pixels
 * wide. onFit(width, height) gets the new canvas size, to rebuild size-dependent caches.
 * Returns the undo.
 */
export function fitWide(
  cv: HTMLCanvasElement,
  {
    ratio = [16, 9],
    maxDpr = 2,
    maxWidth = 2560,
    onFit,
  }: {
    ratio?: [number, number];
    maxDpr?: number;
    maxWidth?: number;
    onFit?: (width: number, height: number) => void;
  } = {},
): Off {
  const [a, b] = ratio;
  return follow(() => {
    let w = window.innerWidth,
      h = window.innerHeight;
    if (w / h > a / b) w = (h * a) / b;
    else h = (w * b) / a;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr, maxWidth / w);
    cv.style.width = Math.round(w) + 'px';
    cv.style.height = Math.round(h) + 'px';
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    onFit?.(cv.width, cv.height);
  });
}

/**
 * Show a pixel canvas as a width × height box (CSS pixels at scale 1: 320 × 240 for a
 * 320 × 200 screen on a 4:3 monitor), as large as the window allows. From a scale of
 * `snap` up it keeps to whole multiples (default: never). Only the CSS size changes; the
 * canvas keeps its own pixels. Returns the undo.
 */
export function fitPixels(
  cv: HTMLCanvasElement,
  { width, height, snap = Infinity }: { width: number; height: number; snap?: number },
): Off {
  return follow(() => {
    let s = Math.min(window.innerWidth / width, window.innerHeight / height);
    if (s >= snap) s = Math.floor(s);
    cv.style.width = Math.floor(width * s) + 'px';
    cv.style.height = Math.floor(height * s) + 'px';
  });
}

/** JSON in localStorage, quietly doing nothing where storage is blocked (or when disabled). */
export function storage(
  key: string,
  { enabled = true }: { enabled?: boolean } = {},
): { load: <T>(fallback: T) => T; save: (value: unknown) => void } {
  return {
    load<T>(fallback: T): T {
      if (!enabled) return fallback;
      try {
        const s = localStorage.getItem(key);
        return s === null ? fallback : (JSON.parse(s) as T);
      } catch {
        return fallback; // private mode, or not JSON
      }
    },
    save(value) {
      if (!enabled) return;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage blocked */
      }
    },
  };
}

type Prefixed = {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | undefined;
  webkitRequestFullscreen?: (o?: FullscreenOptions) => Promise<void> | undefined;
};

/**
 * Enter or leave full screen; call it from the input event itself, as browsers require.
 * `orientation` locks the screen that way once it is full (phones); `webkit` falls back to
 * the prefixed API of older Safari.
 */
export function toggleFullscreen({
  orientation,
  webkit = false,
}: { orientation?: string; webkit?: boolean } = {}): void {
  const d = document as Document & Prefixed,
    el = d.documentElement as HTMLElement & Prefixed;
  if (d.fullscreenElement || (webkit && d.webkitFullscreenElement)) {
    void (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.())?.catch(() => {});
    return;
  }
  const opts: FullscreenOptions = { navigationUI: 'hide' };
  let p = el.requestFullscreen ? el.requestFullscreen(opts) : webkit ? el.webkitRequestFullscreen?.(opts) : undefined;
  if (orientation) {
    const so = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
    p = p?.then(() => void so?.lock?.(orientation).catch(() => {}));
  }
  void p?.catch(() => {});
}

/** A pointer or touch position in the canvas's own pixels. */
export function canvasPoint(cv: HTMLCanvasElement, p: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = cv.getBoundingClientRect();
  return { x: ((p.clientX - r.left) / r.width) * cv.width, y: ((p.clientY - r.top) / r.height) * cv.height };
}
