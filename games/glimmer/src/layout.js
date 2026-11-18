// Where things sit on the 16:9 canvas, shared by the renderer (which draws them) and the
// editor and touch controls (which hit-test them). All in canvas pixels.
//
//   the 28 × 16 field, centred, one tile = ch / 18; the HUD band above it; the rest is backdrop
import { COLS, ROWS } from './level.js';

export function frame(cw, ch) {
  const ts = ch / 18, u = ch / 1080;
  return { ts, u, x0: (cw - COLS * ts) / 2, y0: ts * 1.3, w: COLS * ts, h: ROWS * ts };
}
// the tile under a canvas point (may be off the field)
export function cellAt(cw, ch, x, y) {
  const F = frame(cw, ch);
  return { c: Math.floor((x - F.x0) / F.ts), r: Math.floor((y - F.y0) / F.ts) };
}

// the editor's toolbar, in the band above the field: one box per brush, then the buttons
export const BRUSHES = ['.', '#', '=', 'H', '-', '~', '^', '*', 'P', 'G'];
export const BUTTONS = ['world', 'slot', 'clear', 'test', 'exit'];
export function toolbar(cw, ch) {
  const F = frame(cw, ch), s = F.ts * 1.05, y = F.ts * 0.12, out = [];
  BRUSHES.forEach((b, i) => out.push({ kind: 'brush', i, b, x: F.x0 + i * (s + 6 * F.u), y, w: s, h: s }));
  const bw = F.ts * 2.6;
  BUTTONS.forEach((id, i) => out.push({ kind: 'button', id, x: F.x0 + F.w - (BUTTONS.length - i) * (bw + 8 * F.u), y, w: bw, h: s }));
  return out;
}

// touch controls: a floating stick on the left half, two dig buttons and pause on the right
export function pads(cw, ch) {
  const u = ch / 1080;
  return {
    u,
    digL: { x: cw - 330 * u, y: ch - 170 * u, r: 100 * u },
    digR: { x: cw - 120 * u, y: ch - 260 * u, r: 100 * u },
    pause: { x: cw - 70 * u, y: 70 * u, r: 44 * u },
    stickR: 95 * u,
  };
}
