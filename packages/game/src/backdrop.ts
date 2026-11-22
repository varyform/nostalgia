/**
 * The screen around a game: the games keep their own shape (16:9, 4:3 for the period
 * versions) and the bars a MacBook's 16:10 or an iPhone's 19.5:9 leaves are filled by the
 * game's own edges, stretched outwards, softened and dimmed a little towards the screen's
 * edge, so a game's background carries on past its frame. A small canvas behind the game's,
 * repainted after each frame; nothing shows where the game already fills the screen.
 * createHdr() makes one (not in the demo) and paints it in present().
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One drawImage: the source's part (its pixels) and where it lands (backdrop pixels). */
export type Strip = [sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number];

/** Backdrop pixels across at most: a soft picture, cheap to paint every frame. */
const MAX_WIDTH = 256;
/** Backdrop pixels per CSS pixel at most. */
const SCALE = 1 / 8;
/** How much of the source's edge is stretched, as a share of its size. */
const EDGE = 0.006;
/** Bars narrower than this (CSS pixels) aren't worth a backdrop. */
const MIN_BAR = 2;
/** How far the strips reach under the game (backdrop pixels): past the softening's reach. */
const INSET = 3;
/** The dimming at the screen's edge, fading in from a third of the way out from the game's. */
const DIM = 0.35;

/** Backdrop size for a viewport: [width, height, backdrop pixels per CSS pixel]. */
export function backdropSize(vw: number, vh: number): [number, number, number] {
  const k = Math.min(SCALE, MAX_WIDTH / vw);
  return [Math.max(1, Math.ceil(vw * k)), Math.max(1, Math.ceil(vh * k)), k];
}

/** Any bar worth filling around the game's rect in a vw × vh viewport. */
export function hasBars(vw: number, vh: number, r: Rect): boolean {
  return r.left > MIN_BAR || r.top > MIN_BAR || vw - r.left - r.width > MIN_BAR || vh - r.top - r.height > MIN_BAR;
}

/**
 * The strips that extend a source (sw × sh pixels, shown at rect g in backdrop pixels) to a
 * bw × bh backdrop: each side's edge stretched across its bar, the corners from the corner
 * pixels. Each reaches INSET pixels into the game's rect, so the softening and the upscale mix
 * the game's edge colours there, never black (and no full frame has to be scaled down).
 */
export function strips(bw: number, bh: number, g: Rect, sw: number, sh: number): Strip[] {
  const ex = Math.max(1, Math.round(sw * EDGE)),
    ey = Math.max(1, Math.round(sh * EDGE));
  const x0 = g.left,
    y0 = g.top,
    x1 = g.left + g.width,
    y1 = g.top + g.height;
  const L = x0 > 0,
    R = x1 < bw,
    T = y0 > 0,
    B = y1 < bh;
  const out: Strip[] = [];
  const n = INSET;
  if (L) out.push([0, 0, ex, sh, 0, y0, x0 + n, g.height]);
  if (R) out.push([sw - ex, 0, ex, sh, x1 - n, y0, bw - x1 + n, g.height]);
  if (T) out.push([0, 0, sw, ey, x0, 0, g.width, y0 + n]);
  if (B) out.push([0, sh - ey, sw, ey, x0, y1 - n, g.width, bh - y1 + n]);
  if (L && T) out.push([0, 0, ex, ey, 0, 0, x0 + n, y0 + n]);
  if (R && T) out.push([sw - ex, 0, ex, ey, x1 - n, 0, bw - x1 + n, y0 + n]);
  if (L && B) out.push([0, sh - ey, ex, ey, 0, y1 - n, x0 + n, bh - y1 + n]);
  if (R && B) out.push([sw - ex, sh - ey, ex, ey, x1 - n, y1 - n, bw - x1 + n, bh - y1 + n]);
  return out;
}

export interface Backdrop {
  readonly canvas: HTMLCanvasElement;
  /** Bars to fill at the last paint: the backdrop is showing. */
  readonly active: boolean;
  /** After each frame: the game's edges as they are now. */
  paint(): void;
  destroy(): void;
}

/** A backdrop behind the game's canvases (bottom first, the first one's rect is the game's). */
export function createBackdrop(sources: HTMLCanvasElement[]): Backdrop {
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  // the pages style every canvas (pixelated for the CGA ones, a background): not this one
  Object.assign(cv.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    margin: '0',
    pointerEvents: 'none',
    imageRendering: 'auto',
    background: 'none',
    display: 'none',
  });
  // positioned, the game's canvases paint over the fixed backdrop before them
  for (const s of sources) if (getComputedStyle(s).position === 'static') s.style.position = 'relative';
  sources[0].before(cv);
  const g = cv.getContext('2d', { alpha: false });
  let active = false;

  function paint() {
    const vw = window.innerWidth,
      vh = window.innerHeight,
      r = sources[0].getBoundingClientRect();
    const on = !!g && r.width > 0 && r.height > 0 && hasBars(vw, vh, r);
    if (on !== active) {
      active = on;
      cv.style.display = on ? 'block' : 'none';
    }
    if (!on || !g) return;
    const [bw, bh, k] = backdropSize(vw, vh);
    if (cv.width !== bw || cv.height !== bh) {
      cv.width = bw;
      cv.height = bh;
    }
    const gr = { left: r.left * k, top: r.top * k, width: r.width * k, height: r.height * k };
    g.imageSmoothingEnabled = true;
    g.fillStyle = '#000';
    g.fillRect(0, 0, bw, bh);
    for (const s of sources) {
      if (!s.width || !s.height) continue;
      for (const st of strips(bw, bh, gr, s.width, s.height)) g.drawImage(s, ...st);
    }
    // softer still where the 2D canvas filters (the stretched edge's detail becomes a glow)
    if ('filter' in g) {
      g.filter = 'blur(1.5px)';
      g.drawImage(cv, 0, 0);
      g.filter = 'none';
    }
    dim(g, bw, bh, gr);
  }

  return {
    canvas: cv,
    get active() {
      return active;
    },
    paint,
    destroy() {
      cv.remove();
      for (const s of sources) if (s.style.position === 'relative') s.style.position = '';
    },
  };
}

// darker towards the screen's edges, from nothing at the game's edge
function dim(g: CanvasRenderingContext2D, bw: number, bh: number, r: Rect) {
  const x1 = r.left + r.width,
    y1 = r.top + r.height;
  const band = (x0: number, y0: number, xa: number, ya: number, w: number, h: number) => {
    const lg = g.createLinearGradient(x0, y0, xa, ya);
    lg.addColorStop(0, 'rgba(0, 0, 0, 0)');
    lg.addColorStop(0.3, 'rgba(0, 0, 0, 0)');
    lg.addColorStop(1, `rgba(0, 0, 0, ${DIM})`);
    g.fillStyle = lg;
    g.fillRect(Math.min(x0, xa), Math.min(y0, ya), w, h);
  };
  if (r.left > 0) band(r.left, 0, 0, 0, r.left, bh);
  if (x1 < bw) band(x1, 0, bw, 0, bw - x1, bh);
  if (r.top > 0) band(0, r.top, 0, 0, bw, r.top);
  if (y1 < bh) band(0, y1, 0, bh, bw, bh - y1);
}
