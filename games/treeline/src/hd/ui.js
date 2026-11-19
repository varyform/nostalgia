// 2D drawing for the HUD and the screens: @nostalgia/gl/ui's helper (a 1920 × 1080 reference
// frame scaled to the canvas, text, panels, prompts with the device's glyphs, word wrap) in
// Chakra Petch, Treeline's palette, and colour helpers that accept their own output.
import { createUI as baseUI } from '@nostalgia/gl/ui';

export const W = 1920, H = 1080;
export const F = "'Chakra Petch','Bahnschrift','DIN Alternate','Arial Narrow',system-ui,sans-serif";
export const COL = {
  hud: '#b4f58a', hudDim: 'rgba(180,245,138,0.45)', hudFaint: 'rgba(180,245,138,0.2)',
  amber: '#ffb84a', red: '#ff5646', ink: '#eef0e6', dim: 'rgba(238,240,230,0.62)', faint: 'rgba(238,240,230,0.3)',
  cyan: '#7fd8f0', sky: '#9ec9ff', panel: 'rgba(10,14,10,0.8)', edge: 'rgba(180,245,138,0.3)', leaf: '#6fbf5a',
  thermal: '#d8f0d0',
};

/** parse '#rgb', '#rrggbb' or 'rgb(a)(…)' into [r, g, b, a] (0–255, a 0–1) */
export function parseCol(c) {
  if (c.startsWith('rgb')) {
    const m = c.match(/[\d.]+/g).map(Number);
    return [m[0], m[1], m[2], m[3] ?? 1];
  }
  let h = c.slice(1);
  if (h.length === 3) h = [...h].map(x => x + x).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
}
/** a mix of two colours (either form) at t, as 'rgba(…)'; feeds back into itself */
export function mixCol(a, b, t) {
  const A = parseCol(a), B = parseCol(b), k = Math.max(0, Math.min(1, t));
  const v = A.map((x, i) => x + (B[i] - x) * k);
  return `rgba(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])},${+v[3].toFixed(3)})`;
}
/** a colour with its alpha replaced */
export function alpha(c, a) {
  const A = parseCol(c);
  return `rgba(${A[0]},${A[1]},${A[2]},${+a.toFixed(3)})`;
}

/** the shared HUD helper (@nostalgia/gl/ui) in Treeline's font, with a few extras */
export function createUI(g) {
  const ui = baseUI(g, { font: F });
  /** text shrunk to fit maxW */
  ui.fit = (s, x, y, size, maxW, col, o = {}) => {
    const w = ui.width(s, size, o.wgt ?? 600, o.sp ?? 0);
    ui.text(s, x, y, w > maxW ? size * (maxW / w) : size, col, o);
  };
  ui.circle = (x, y, r, col, lw = 2, fill = null) => {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (col) { g.strokeStyle = col; g.lineWidth = lw; g.stroke(); }
  };
  return ui;
}
export { fmt } from '@nostalgia/gl/ui';
