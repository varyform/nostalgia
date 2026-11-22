/**
 * The screen around a game: the games keep their own shape (16:9, 4:3 for the period
 * versions), and the bars a MacBook's 16:10 or an iPhone's 19.5:9 leaves are filled with what
 * each page decided for them, once: a vertical gradient from `--backdrop-top` to
 * `--backdrop-bottom` (CSS custom properties on the page's root), picked to meet the game's own
 * top and bottom edges. A page without them keeps its plain background. Nothing is drawn per
 * frame: it repaints only when the window changes. createHdr() makes one (not in the demo) and
 * passes it through the HDR grading with the game, so the two meet without a seam.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Bars narrower than this (CSS pixels) aren't worth a backdrop. */
const MIN_BAR = 2;
/** Gradient rows; the canvas is stretched over the screen, smoothly. */
const ROWS = 256;

/** Any bar worth filling around the game's rect in a vw × vh viewport. */
export function hasBars(vw: number, vh: number, r: Rect): boolean {
  return r.left > MIN_BAR || r.top > MIN_BAR || vw - r.left - r.width > MIN_BAR || vh - r.top - r.height > MIN_BAR;
}

/** The page's decision: [top, bottom] colours, or null for none. */
export function backdropColours(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): [string, string] | null {
  const top = style.getPropertyValue('--backdrop-top').trim(),
    bottom = style.getPropertyValue('--backdrop-bottom').trim();
  return top ? [top, bottom || top] : null;
}

export interface Backdrop {
  readonly canvas: HTMLCanvasElement;
  /** Showing: the page has colours and there are bars to fill. */
  readonly active: boolean;
  /** After each frame; cheap: it only looks whether the bars came or went. */
  paint(): void;
  destroy(): void;
}

/** A backdrop behind the game's canvases (bottom first), or null when the page decides on none. */
export function createBackdrop(sources: HTMLCanvasElement[]): Backdrop | null {
  const colours = backdropColours(getComputedStyle(document.documentElement));
  if (!colours) return null;
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  cv.width = 1;
  cv.height = ROWS;
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
  const g = cv.getContext('2d', { alpha: false });
  if (g) {
    const gr = g.createLinearGradient(0, 0, 0, ROWS);
    gr.addColorStop(0, colours[0]);
    gr.addColorStop(1, colours[1]);
    g.fillStyle = gr;
    g.fillRect(0, 0, 1, ROWS);
  }
  // positioned, the game's canvases paint over the fixed backdrop before them
  for (const s of sources) if (getComputedStyle(s).position === 'static') s.style.position = 'relative';
  sources[0].before(cv);
  let active = false;

  return {
    canvas: cv,
    get active() {
      return active;
    },
    paint() {
      const r = sources[0].getBoundingClientRect();
      const on = r.width > 0 && r.height > 0 && hasBars(window.innerWidth, window.innerHeight, r);
      if (on === active) return;
      active = on;
      cv.style.display = on ? 'block' : 'none';
    },
    destroy() {
      cv.remove();
      for (const s of sources) if (s.style.position === 'relative') s.style.position = '';
    },
  };
}
